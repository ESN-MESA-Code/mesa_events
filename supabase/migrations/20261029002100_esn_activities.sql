-- ============================================================
-- MESA Events Platform – ESN Activities uploads and their status
-- (brief 2026-10-29, B)
--
-- activities.esn.org has no API (and Cloudflare blocks server requests), so
-- as with the description bot, Comms fills the site's form "Register your
-- physical activity" in their own browser with a Tampermonkey script
-- (tools/esn-activities/mesa-esn.user.js) and links the saved activity
-- back. This migration holds:
--
-- * event_reports – the OC's report after the event (participants, goals
--   reached, what went well / could be better, accessibility needs), the
--   last part of the ESN form; one per event; written by the OC or the
--   Events team (save_event_report), read by the event's people and teams;
-- * esn_uploads – the activity link per event (who, when, by script or by
--   hand); read by Comms, Events and executives only, set by Comms only;
--   the first link posts "PR uploaded" to the event's space (a job, once);
-- * esn_access_tokens – personal access tokens of Comms members for the
--   script (cookies are not sent from activities.esn.org): shown once,
--   stored as SHA-256, expiring, revocable, logged. The API routes
--   (/api/esn/events/[id], …/linked) resolve a token with esn_token_owner()
--   (service role) and act for its owner through the esn_api_* functions,
--   which check the owner's Comms role again on every call.
-- ============================================================

-- ── The event report ────────────────────────────────────────────────────────
create table public.event_reports (
  event_id           uuid primary key references public.events(id) on delete cascade,
  intl_participants  integer not null constraint event_reports_intl_check check (intl_participants between 0 and 99999),
  local_participants integer not null default 0 constraint event_reports_local_check check (local_participants between 0 and 99999),
  organizers         integer not null constraint event_reports_organizers_check check (organizers between 0 and 99999),
  goals_reached      boolean not null default true,
  went_well          text not null constraint event_reports_went_well_check check (length(trim(went_well)) between 1 and 1000),
  could_be_better    text not null default '' constraint event_reports_better_check check (length(could_be_better) <= 1000),
  access_needs       boolean not null default false,
  access_note        text not null default '' constraint event_reports_access_note_check check (length(access_note) <= 1000),
  created_at         timestamptz not null default now(),
  created_by         text,
  updated_at         timestamptz not null default now(),
  updated_by         text
);
create trigger event_reports_updated_at before update on public.event_reports for each row execute function public.set_updated_at();
create trigger log_event_reports after insert or update on public.event_reports for each row execute function private.log_row_change();

alter table public.event_reports enable row level security;
create policy "Staff and teams read the event report"
  on public.event_reports for select to authenticated
  using (public.is_team() or public.is_event_staff(event_id));
revoke insert, update, delete, truncate on public.event_reports from anon, authenticated;
revoke all on public.event_reports from anon;

create or replace function public.save_event_report(
  event uuid, intl_participants integer, local_participants integer, organizers integer,
  goals_reached boolean, went_well text, could_be_better text default '', access_needs boolean default false, access_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
begin
  select * into e from public.events where id = event;
  if not found or not public.can_read_event(event) then
    raise exception 'No such event' using errcode = '22023';
  end if;
  if not (public.is_event_oc(event) or public.has_role('events')) then
    raise exception 'Only the event''s OC (or the Events team) writes the report' using errcode = '42501';
  end if;
  if e.status not in ('confirmed', 'understaffed', 'completed') or e.starts_at > now() then
    raise exception 'The report is written after the event has started' using errcode = '22023';
  end if;
  if coalesce(trim(went_well), '') = '' then
    raise exception 'Tell us in 1–2 sentences what went well.' using errcode = '22023';
  end if;
  insert into public.event_reports as r (event_id, intl_participants, local_participants, organizers, goals_reached, went_well,
                                          could_be_better, access_needs, access_note, created_by, updated_by)
  values (event, intl_participants, coalesce(local_participants, 0), organizers, coalesce(goals_reached, true), trim(went_well),
          trim(coalesce(could_be_better, '')), coalesce(access_needs, false),
          case when coalesce(access_needs, false) then trim(coalesce(access_note, '')) else '' end,
          public.auth_email(), public.auth_email())
  on conflict (event_id) do update set
    intl_participants = excluded.intl_participants, local_participants = excluded.local_participants,
    organizers = excluded.organizers, goals_reached = excluded.goals_reached, went_well = excluded.went_well,
    could_be_better = excluded.could_be_better, access_needs = excluded.access_needs, access_note = excluded.access_note,
    updated_by = excluded.updated_by;
end;
$$;
revoke all on function public.save_event_report(uuid, integer, integer, integer, boolean, text, text, boolean, text) from public, anon;
grant execute on function public.save_event_report(uuid, integer, integer, integer, boolean, text, text, boolean, text) to authenticated;

-- What the report form starts from: the attendance list's headcount and,
-- from its anonymous answers, how many gave German nationality (local);
-- the event's active OC and helpers as organizers. Counts only.
create or replace function public.event_report_prefill(event uuid)
returns table (headcount integer, local_participants integer, organizers integer)
language sql
stable
security definer
set search_path = ''
as $$
  select l.headcount,
         (select coalesce(sum(s.total), 0) from public.event_stats s where s.event_id = event and s.question = 'nationality' and s.answer = 'DE')::integer,
         (select count(*) from public.assignments a where a.event_id = event and a.status = 'active')::integer
  from public.events e
  left join public.attendance_lists l on l.event_id = e.id
  where e.id = event and (public.is_team() or public.is_event_staff(event));
$$;
revoke all on function public.event_report_prefill(uuid) from public, anon;
grant execute on function public.event_report_prefill(uuid) to authenticated;

-- ── The ESN Activities link per event ───────────────────────────────────────
create table public.esn_uploads (
  event_id     uuid primary key references public.events(id) on delete cascade,
  -- A saved activity: https://activities.esn.org/activity/<name>-<number> (or /node/<number>).
  activity_url text not null constraint esn_uploads_url_check
    check (activity_url ~* '^https://activities\.esn\.org/(activity/[a-z0-9-]+|node/[0-9]+)/?$'),
  -- 'script': linked back by the browser script; 'manual': pasted by Comms.
  via          text not null constraint esn_uploads_via_check check (via in ('script', 'manual')),
  uploaded_at  timestamptz not null default now(),
  uploaded_by  text not null
);
create trigger log_esn_uploads after insert or update or delete on public.esn_uploads for each row execute function private.log_row_change();

alter table public.esn_uploads enable row level security;
create policy "Comms, Events and executives read ESN uploads"
  on public.esn_uploads for select to authenticated
  using (public.has_role('comms') or public.has_role('events') or public.has_role('executive'));
revoke insert, update, delete, truncate on public.esn_uploads from anon, authenticated;
revoke all on public.esn_uploads from anon;

-- Shared by the manual link (Comms in the app) and the script (API).
create or replace function private.link_esn_activity(event uuid, url text, via text, actor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  clean text := regexp_replace(trim(coalesce(url, '')), '[?#].*$', '');
  first boolean;
begin
  select * into e from public.events where id = event;
  if not found or e.status in ('draft', 'dropped') then
    raise exception 'No such event' using errcode = '22023';
  end if;
  if clean !~* '^https://activities\.esn\.org/(activity/[a-z0-9-]+|node/[0-9]+)/?$' then
    raise exception 'This is not a saved ESN Activities page (https://activities.esn.org/activity/…)' using errcode = '22023';
  end if;
  first := not exists (select 1 from public.esn_uploads u where u.event_id = event);
  insert into public.esn_uploads (event_id, activity_url, via, uploaded_by)
  values (event, clean, via, actor)
  on conflict (event_id) do update set activity_url = excluded.activity_url, via = excluded.via,
    uploaded_at = now(), uploaded_by = excluded.uploaded_by
  where public.esn_uploads.activity_url is distinct from excluded.activity_url;
  -- The organizers hear of it once (the bot's "@all 📢 PR has uploaded …").
  if first then
    perform private.enqueue_job('chat.esn_uploaded', jsonb_build_object('event_id', event), 'chat.esn_uploaded:' || event, event);
  end if;
end;
$$;
revoke all on function private.link_esn_activity(uuid, text, text, text) from public, anon, authenticated;

create or replace function public.mark_esn_uploaded(event uuid, url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('comms') then
    raise exception 'Only the Comms team marks events uploaded to ESN Activities' using errcode = '42501';
  end if;
  perform private.link_esn_activity(event, url, 'manual', public.auth_email());
end;
$$;
revoke all on function public.mark_esn_uploaded(uuid, text) from public, anon;
grant execute on function public.mark_esn_uploaded(uuid, text) to authenticated;

-- A wrong link: Comms takes it back (logged; the Chat message stays).
create or replace function public.unmark_esn_uploaded(event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('comms') then
    raise exception 'Only the Comms team changes the ESN Activities status' using errcode = '42501';
  end if;
  delete from public.esn_uploads where event_id = event;
end;
$$;
revoke all on function public.unmark_esn_uploaded(uuid) from public, anon;
grant execute on function public.unmark_esn_uploaded(uuid) to authenticated;

-- ── Personal access tokens for the browser script ───────────────────────────
create table public.esn_access_tokens (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  label        text not null constraint esn_access_tokens_label_check check (length(trim(label)) between 1 and 60),
  -- SHA-256 (hex) of the token; the token itself is shown once and never stored.
  token_hash   text not null unique constraint esn_access_tokens_hash_check check (token_hash ~ '^[0-9a-f]{64}$'),
  -- "mesa_esn_AbCd…": enough to recognise it in the list.
  token_prefix text not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index esn_access_tokens_profile_idx on public.esn_access_tokens(profile_id);

alter table public.esn_access_tokens enable row level security;
create policy "Members see their own tokens"
  on public.esn_access_tokens for select to authenticated
  using (public.is_workspace_member() and profile_id = auth.uid());
revoke insert, update, delete, truncate on public.esn_access_tokens from anon, authenticated;
revoke all on public.esn_access_tokens from anon;

-- Comms members create one (at most 5 active); returns the token once.
create or replace function public.create_esn_token(label text, valid_days integer default 180)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  token text;
  id uuid;
begin
  if not public.has_role('comms') then
    raise exception 'Only the Comms team uploads to ESN Activities' using errcode = '42501';
  end if;
  if valid_days not in (30, 90, 180, 365) then
    raise exception 'A token is valid for 30, 90, 180 or 365 days' using errcode = '22023';
  end if;
  if (select count(*) from public.esn_access_tokens t where t.profile_id = auth.uid() and t.revoked_at is null and t.expires_at > now()) >= 5 then
    raise exception 'You have 5 active tokens – revoke one first' using errcode = '22023';
  end if;
  token := 'mesa_esn_' || rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  insert into public.esn_access_tokens (profile_id, label, token_hash, token_prefix, expires_at)
  values (auth.uid(), trim(label), encode(extensions.digest(token, 'sha256'), 'hex'), left(token, 13), now() + make_interval(days => valid_days))
  returning esn_access_tokens.id into id;
  perform private.log('esn_access_tokens', id::text, 'insert', null, null,
    jsonb_build_object('label', trim(label), 'token_prefix', left(token, 13), 'valid_days', valid_days));
  return token;
end;
$$;
revoke all on function public.create_esn_token(text, integer) from public, anon;
grant execute on function public.create_esn_token(text, integer) to authenticated;

create or replace function public.revoke_esn_token(token uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.esn_access_tokens set revoked_at = now()
  where id = token and profile_id = auth.uid() and revoked_at is null and public.is_workspace_member();
  if not found then
    raise exception 'No such token' using errcode = '22023';
  end if;
  perform private.log('esn_access_tokens', token::text, 'update', null, null, jsonb_build_object('revoked', true));
end;
$$;
revoke all on function public.revoke_esn_token(uuid) from public, anon;
grant execute on function public.revoke_esn_token(uuid) to authenticated;

-- The API: whose token is it? Null unless it is active and its owner is
-- still in the Comms team. Records its use. Service role only.
create or replace function public.esn_token_owner(hash text)
returns table (token_id uuid, profile_id uuid, email text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    update public.esn_access_tokens t set last_used_at = now()
    from public.profiles p
    where t.token_hash = hash and p.id = t.profile_id
      and t.revoked_at is null and t.expires_at > now()
      and exists (select 1 from public.role_members r where r.email = p.email and r.role = 'comms')
    returning t.id, t.profile_id, p.email;
end;
$$;
revoke all on function public.esn_token_owner(text) from public, anon, authenticated;
grant execute on function public.esn_token_owner(text) to service_role;

-- The script links the saved activity, for the token's owner. Service role only.
create or replace function public.esn_api_link(hash text, event uuid, url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner text := (select o.email from public.esn_token_owner(hash) o);
begin
  if owner is null then
    raise exception 'Invalid token' using errcode = '42501';
  end if;
  perform private.link_esn_activity(event, url, 'script', owner);
end;
$$;
revoke all on function public.esn_api_link(text, uuid, text) from public, anon, authenticated;
grant execute on function public.esn_api_link(text, uuid, text) to service_role;

-- ── Activity log: who reads the new entries ─────────────────────────────────
-- Reports: like the event's other entries (staff too). ESN links: also Comms.
-- Tokens: Events, executives and admins (as every other entry); no secret is logged.
drop policy "Log entries by what they describe" on public.activity_log;
create policy "Log entries by what they describe"
  on public.activity_log for select to authenticated
  using (
    case
      when entity = 'reimbursements' then public.has_role('finance') or public.has_role('executive')
      else public.has_role('events') or public.has_role('executive') or public.has_role('admin')
        or (entity = 'esn_uploads' and public.has_role('comms'))
        or (event_id is not null
            and entity in ('events', 'assignments', 'descriptions', 'reviews', 'attendance_lists', 'event_photo_folders', 'event_reports')
            and public.is_event_staff(event_id))
    end
  );

-- ── A cycle's hand-in: the report is part of it ─────────────────────────────
drop function public.cycle_hand_in(uuid[]);
create function public.cycle_hand_in(cycles uuid[])
returns table (
  event_id uuid, cycle_id uuid, status public.event_status, starts_at timestamptz, ends_at timestamptz,
  signed_off boolean, photos_in boolean, report_in boolean, receipts integer, belege_missing integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.cycle_id, e.status, e.starts_at, e.ends_at,
         coalesce(l.signed_off_at is not null, false),
         private.photos_in(e.id),
         exists (select 1 from public.event_reports r where r.event_id = e.id),
         (select count(*) from public.reimbursements r where r.event_id = e.id)::integer,
         (select count(*) from public.reimbursements r where r.event_id = e.id and r.status = 'not_submitted')::integer
  from public.events e
  left join public.attendance_lists l on l.event_id = e.id
  where e.cycle_id = any(cycles)
    and e.status in ('confirmed', 'understaffed', 'completed', 'cancelled')
    and public.is_team();
$$;
revoke all on function public.cycle_hand_in(uuid[]) from public, anon;
grant execute on function public.cycle_hand_in(uuid[]) to authenticated;
