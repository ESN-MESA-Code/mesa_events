-- ============================================================
-- MESA Events Platform – drop-out reasons: the OC and Events only
-- (review 2026-10-28, B2)
--
-- assignments.drop_reason was readable by everyone who can read the roster
-- (all members once it is published). Reasons can be personal (people
-- write "I'm sick"), so they move to their own table that only the event's
-- OC and the Events team read – like bank details apart from claims. Not
-- logged (the activity log only records that a reason was given).
-- ============================================================

create table public.assignment_drop_reasons (
  assignment_id uuid primary key references public.assignments(id) on delete cascade,
  event_id      uuid not null references public.events(id) on delete cascade,
  reason        text not null constraint assignment_drop_reasons_reason_check check (length(reason) between 1 and 500),
  created_at    timestamptz not null default now()
);
create index assignment_drop_reasons_event_idx on public.assignment_drop_reasons(event_id);

insert into public.assignment_drop_reasons (assignment_id, event_id, reason, created_at)
select id, event_id, drop_reason, coalesce(dropped_at, now()) from public.assignments where nullif(trim(drop_reason), '') is not null;

alter table public.assignments drop column drop_reason;

alter table public.assignment_drop_reasons enable row level security;
create policy "The event's OC and the Events team read drop-out reasons"
  on public.assignment_drop_reasons for select to authenticated
  using (public.has_role('events') or public.is_event_oc(event_id));
-- Written only by drop_out().
revoke insert, update, delete, truncate on public.assignment_drop_reasons from anon, authenticated;
revoke all on public.assignment_drop_reasons from anon;

create or replace function public.drop_out(assignment uuid, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.assignments;
begin
  select * into a from public.assignments where id = assignment for update;
  if not found or a.status <> 'active' then
    raise exception 'No such assignment' using errcode = '22023';
  end if;
  if not (public.is_workspace_member() and (a.profile_id = auth.uid() or public.has_role('events'))) then
    raise exception 'You can only drop out yourself' using errcode = '42501';
  end if;
  if exists (select 1 from public.events e where e.id = a.event_id and e.starts_at <= now()) then
    raise exception 'The event has already started' using errcode = '22023';
  end if;
  update public.assignments set status = 'dropped_out', dropped_at = now() where id = assignment;
  if nullif(trim(reason), '') is not null then
    insert into public.assignment_drop_reasons (assignment_id, event_id, reason)
    values (assignment, a.event_id, left(trim(reason), 500));
  end if;
  perform private.refresh_staffing(a.event_id);
  perform private.enqueue_job('chat.roster_message',
    jsonb_build_object('event_id', a.event_id, 'kind', 'dropout', 'profile_id', a.profile_id, 'role', a.role, 'assignment_id', a.id),
    'chat.roster_message:dropout:' || a.id, a.event_id);
end;
$$;
