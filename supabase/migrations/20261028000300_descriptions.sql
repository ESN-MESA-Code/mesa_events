-- ============================================================
-- MESA Events Platform – event descriptions and the Comms hand-off
--
-- One description per event in the house template (fields as JSON, see
-- lib/description/template.ts). The OC (and Events, Comms) edit it with
-- autosave; edits are merged per field, so two editors do not overwrite
-- each other's fields. Status: draft → submitted → approved → published,
-- or changes_requested back to the OC. Status changes only through the
-- functions below. Publishing is a job: the approved text is posted to the
-- event's Chat space with @all once; publishing again edits that message.
-- One deadline per cycle (planning_cycles.description_deadline).
-- ============================================================

create table public.descriptions (
  event_id               uuid primary key references public.events(id) on delete cascade,
  fields                 jsonb not null default '{}' constraint descriptions_fields_check check (jsonb_typeof(fields) = 'object' and length(fields::text) < 60000),
  status                 text not null default 'draft'
    constraint descriptions_status_check check (status in ('draft', 'submitted', 'changes_requested', 'approved', 'published')),
  -- Bumped on every save (the editor uses it to spot others' changes).
  version                integer not null default 0,
  updated_at             timestamptz not null default now(),
  updated_by             text,
  submitted_at           timestamptz,
  submitted_by           text,
  -- What Comms approved (fields and rendered Chat text): exactly this is published.
  approved_fields        jsonb,
  approved_text          text constraint descriptions_approved_text_check check (length(approved_text) <= 4096),
  approved_at            timestamptz,
  approved_by            text,
  publish_requested_at   timestamptz,
  published_at           timestamptz,
  published_by           text,
  published_text         text,
  published_message_name text
);

create table public.description_versions (
  id         bigint generated always as identity primary key,
  event_id   uuid not null references public.events(id) on delete cascade,
  version    integer not null,
  kind       text not null constraint description_versions_kind_check check (kind in ('submitted', 'approved', 'published')),
  fields     jsonb not null,
  text       text,
  created_by text,
  created_at timestamptz not null default now()
);
create index description_versions_event_idx on public.description_versions(event_id, id desc);

create table public.reviews (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  reviewer   text not null,
  decision   text not null constraint reviews_decision_check check (decision in ('approved', 'changes_requested')),
  comment    text not null default '' constraint reviews_comment_check check (length(comment) <= 4000),
  version    integer not null,
  created_at timestamptz not null default now()
);
create index reviews_event_idx on public.reviews(event_id, created_at desc);

create trigger log_descriptions after insert or update on public.descriptions for each row execute function private.log_row_change();
create trigger log_reviews after insert on public.reviews for each row execute function private.log_row_change();

-- Who edits: the OC, the Events and Comms teams.
create or replace function public.can_edit_description(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_event_oc(event) or public.has_role('events') or public.has_role('comms');
$$;
revoke all on function public.can_edit_description(uuid) from public;
grant execute on function public.can_edit_description(uuid) to authenticated;

alter table public.descriptions enable row level security;
alter table public.description_versions enable row level security;
alter table public.reviews enable row level security;

-- Staff and teams read the working copy; every member reads published
-- descriptions (templates from past events).
create policy "Staff and teams read descriptions, members published ones"
  on public.descriptions for select to authenticated
  using (public.is_team() or public.is_event_staff(event_id) or (public.is_workspace_member() and published_at is not null));
create policy "Staff and teams read versions"
  on public.description_versions for select to authenticated
  using (public.is_team() or public.is_event_staff(event_id));
create policy "Staff and teams read reviews"
  on public.reviews for select to authenticated
  using (public.is_team() or public.is_event_staff(event_id));

-- All writes go through the functions below.
revoke insert, update, delete, truncate on public.descriptions, public.description_versions, public.reviews from anon, authenticated;
revoke all on public.descriptions, public.description_versions, public.reviews from anon;

-- Live updates for editors (RLS applies to realtime too).
alter publication supabase_realtime add table public.descriptions;

-- ── Editing ─────────────────────────────────────────────────────────────────
-- Merges `patch` into the fields (keys of the template only). Editing a
-- submitted or approved description sends it back to draft (Comms may fix
-- typos during review without that); after publishing, edits wait for the
-- next review and publish, which updates the posted message.
create or replace function public.save_description(event uuid, patch jsonb)
returns table (version integer, status text, fields jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed text[] := array['title','dateIso','time','venue','price','priceNote','hook','intro','program','bring',
                          'importantHeading','important','weather','closing','esnType','esnObjectives'];
  clean jsonb;
  d public.descriptions;
begin
  if not public.can_edit_description(event) then
    raise exception 'Only the OC, Events and Comms edit this description' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events e where e.id = event and e.status not in ('dropped', 'cancelled')) then
    raise exception 'This event is not running' using errcode = '22023';
  end if;
  if jsonb_typeof(patch) <> 'object' then
    raise exception 'Invalid patch' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(k, v), '{}') into clean
  from jsonb_each(patch) as x(k, v)
  where k = any(allowed)
    and (jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 6000 or (k = 'weather' and jsonb_typeof(v) = 'boolean'));

  insert into public.descriptions as t (event_id, fields, version, updated_at, updated_by)
  values (event, clean, 1, now(), public.auth_email())
  on conflict (event_id) do update set
    fields = t.fields || clean,
    version = t.version + 1,
    updated_at = now(),
    updated_by = public.auth_email(),
    status = case
      when t.status = 'submitted' and public.has_role('comms') then 'submitted'
      when t.status in ('submitted', 'approved', 'published') then 'draft'
      else t.status
    end
  returning * into d;
  return query select d.version, d.status, d.fields;
end;
$$;
revoke all on function public.save_description(uuid, jsonb) from public, anon;
grant execute on function public.save_description(uuid, jsonb) to authenticated;

-- ── The hand-off ────────────────────────────────────────────────────────────
-- The app validates the template (lib/description) before calling this.
create or replace function public.submit_description(event uuid, rendered text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.descriptions;
begin
  if not (public.is_event_oc(event) or public.has_role('events')) then
    raise exception 'Only the OC or the Events team submits the description' using errcode = '42501';
  end if;
  select * into d from public.descriptions where event_id = event for update;
  if not found or d.status not in ('draft', 'changes_requested') then
    raise exception 'Nothing to submit' using errcode = '22023';
  end if;
  if rendered is null or length(rendered) > 4096 then
    raise exception 'The description is longer than 4,096 characters' using errcode = '22023';
  end if;
  update public.descriptions set status = 'submitted', submitted_at = now(), submitted_by = public.auth_email() where event_id = event;
  insert into public.description_versions (event_id, version, kind, fields, text, created_by)
  values (event, d.version, 'submitted', d.fields, rendered, public.auth_email());
end;
$$;

create or replace function public.review_description(event uuid, decision text, comment text, rendered text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.descriptions;
begin
  if not public.has_role('comms') then
    raise exception 'Only the Comms team reviews descriptions' using errcode = '42501';
  end if;
  if decision not in ('approved', 'changes_requested') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  select * into d from public.descriptions where event_id = event for update;
  if not found or d.status <> 'submitted' then
    raise exception 'This description is not waiting for review' using errcode = '22023';
  end if;
  if decision = 'changes_requested' and coalesce(trim(comment), '') = '' then
    raise exception 'Say what should change' using errcode = '22023';
  end if;
  if decision = 'approved' and (rendered is null or length(rendered) > 4096) then
    raise exception 'The approved text is missing or too long' using errcode = '22023';
  end if;
  insert into public.reviews (event_id, reviewer, decision, comment, version)
  values (event, public.auth_email(), decision, left(coalesce(comment, ''), 4000), d.version);
  if decision = 'approved' then
    update public.descriptions
    set status = 'approved', approved_fields = d.fields, approved_text = rendered, approved_at = now(), approved_by = public.auth_email()
    where event_id = event;
    insert into public.description_versions (event_id, version, kind, fields, text, created_by)
    values (event, d.version, 'approved', d.fields, rendered, public.auth_email());
  else
    update public.descriptions set status = 'changes_requested' where event_id = event;
  end if;
end;
$$;

-- Comms publishes an approved description: the job posts it (or edits the
-- message already posted). Idempotent: one job per event, coalescing.
create or replace function public.publish_description(event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('comms') then
    raise exception 'Only the Comms team publishes descriptions' using errcode = '42501';
  end if;
  if not exists (select 1 from public.descriptions where event_id = event and status = 'approved') then
    raise exception 'Only approved descriptions can be published' using errcode = '22023';
  end if;
  if not exists (select 1 from public.events where id = event and chat_space_requested_at is not null) then
    raise exception 'The event has no Chat space yet' using errcode = '22023';
  end if;
  update public.descriptions set publish_requested_at = now() where event_id = event;
  perform private.enqueue_job('chat.publish_description', jsonb_build_object('event_id', event), 'chat.publish_description:' || event, event, true);
end;
$$;

-- The job reports back (service role).
create or replace function public.mark_description_published(event uuid, message_name text, posted_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.descriptions;
begin
  select * into d from public.descriptions where event_id = event for update;
  update public.descriptions
  set published_message_name = message_name, published_text = posted_text, published_at = now(),
      published_by = coalesce(d.approved_by, published_by),
      -- Edited again while the job ran: keep the newer draft.
      status = case when status = 'approved' then 'published' else status end
  where event_id = event;
  insert into public.description_versions (event_id, version, kind, fields, text, created_by)
  values (event, d.version, 'published', coalesce(d.approved_fields, d.fields), posted_text, d.approved_by);
end;
$$;

revoke all on function public.submit_description(uuid, text) from public, anon;
revoke all on function public.review_description(uuid, text, text, text) from public, anon;
revoke all on function public.publish_description(uuid) from public, anon;
revoke all on function public.mark_description_published(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_description(uuid, text) to authenticated;
grant execute on function public.review_description(uuid, text, text, text) to authenticated;
grant execute on function public.publish_description(uuid) to authenticated;
grant execute on function public.mark_description_published(uuid, text, text) to service_role;

-- ── Deadlines ───────────────────────────────────────────────────────────────
-- Description state of every running event with its cycle's deadline
-- (Comms dashboard, checklist). Teams and the event's staff.
create or replace function public.description_overview()
returns table (
  event_id uuid, title text, starts_at timestamptz, deadline timestamptz, status text,
  submitted_at timestamptz, published_at timestamptz, late boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.title, e.starts_at, c.description_deadline, coalesce(d.status, 'missing'),
         d.submitted_at, d.published_at,
         c.description_deadline is not null and c.description_deadline < now()
           and coalesce(d.status, 'missing') in ('missing', 'draft', 'changes_requested')
  from public.events e
  left join public.planning_cycles c on c.id = e.cycle_id
  left join public.descriptions d on d.event_id = e.id
  where e.status in ('confirmed', 'understaffed', 'completed')
    and (public.is_team() or public.is_event_staff(e.id));
$$;
revoke all on function public.description_overview() from public, anon;
grant execute on function public.description_overview() to authenticated;
