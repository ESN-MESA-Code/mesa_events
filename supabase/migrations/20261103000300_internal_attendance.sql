-- ============================================================
-- MESA Events Platform – attendance of internal meetings (2026-11-03)
--
-- Tuesday Talks and internal events get an attendance list that members
-- cannot fill in from home: HR (or the Vice President) shows a check-in code
-- on their screen that changes every 20 seconds; members scan its QR code or
-- type its four digits. A QR token is accepted for three minutes (time to
-- sign in first), the four digits for 40 seconds and five wrong tries per
-- member and meeting. The codes are derived from a server key and the time,
-- so nothing per meeting has to be stored or shown to members.
--
-- HR keeps control: they add or remove anyone at any time (a removal is kept
-- with who and when, not deleted) and close the list. A member reads only
-- their own check-ins; planners and the executive board read all.
--
-- member_activity() counts per member and semester what HR reviews: OC and
-- helper of ESN events, office hours staffed, Tuesday Talks and other
-- internal meetings attended – only what took place and was not cancelled.
-- ============================================================

-- ── The server key for the check-in codes ───────────────────────────────────
create table private.checkin_secret (
  id     boolean primary key default true constraint checkin_secret_one check (id),
  secret bytea not null default extensions.gen_random_bytes(32)
);
insert into private.checkin_secret default values;
revoke all on private.checkin_secret from public, anon, authenticated;

-- ── The list ────────────────────────────────────────────────────────────────
alter table public.internal_events
  add column attendance_closed_at timestamptz,
  add column attendance_closed_by text;

create table public.internal_attendance (
  internal_event_id uuid not null references public.internal_events (id) on delete cascade,
  profile_id        uuid not null references public.profiles (id) on delete cascade,
  via               text not null constraint internal_attendance_via_check check (via in ('qr', 'code', 'hr')),
  added_by          text not null,
  created_at        timestamptz not null default now(),
  removed_at        timestamptz,
  removed_by        text,
  primary key (internal_event_id, profile_id)
);
create index internal_attendance_profile on public.internal_attendance (profile_id);

alter table public.internal_attendance enable row level security;
create policy "Members read their own check-ins, planners and the board all" on public.internal_attendance for select to authenticated
  using (profile_id = auth.uid() or public.is_internal_planner() or public.has_role('executive'));
-- Written only through the functions below.
revoke insert, update, delete, truncate on public.internal_attendance from anon, authenticated;
revoke all on public.internal_attendance from anon;

-- Wrong typed codes per member and meeting (five tries).
create table private.checkin_attempts (
  internal_event_id uuid not null references public.internal_events (id) on delete cascade,
  profile_id        uuid not null,
  failed            integer not null default 0,
  primary key (internal_event_id, profile_id)
);
revoke all on private.checkin_attempts from public, anon, authenticated;

-- ── Codes ───────────────────────────────────────────────────────────────────
-- A 20-second window number.
create or replace function private.checkin_window(at timestamptz)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select floor(extract(epoch from at) / 20)::bigint;
$$;

create or replace function private.checkin_mac(internal_event uuid, win bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.hmac(convert_to(internal_event::text || ':' || win::text, 'UTF8'), s.secret, 'sha256'), 'hex') from private.checkin_secret s;
$$;

-- The four digits shown under the QR code.
create or replace function private.checkin_digits(mac text)
returns text
language sql
immutable
set search_path = ''
as $$
  select lpad(((('x' || substr(mac, 1, 8))::bit(32)::bigint) % 10000)::text, 4, '0');
$$;

-- Meetings with an attendance list, and when checking in is open: from 30
-- minutes before the start to 30 minutes after the end (two hours without one).
create or replace function private.attendance_kind(kind public.internal_kind)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select kind in ('tuesday_talk', 'internal');
$$;

create or replace function private.checkin_open(e public.internal_events)
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.attendance_kind(e.kind)
    and e.status = 'scheduled'
    and e.attendance_closed_at is null
    and now() between e.starts_at - interval '30 minutes' and coalesce(e.ends_at, e.starts_at + interval '2 hours') + interval '30 minutes';
$$;

revoke all on function private.checkin_window(timestamptz), private.checkin_mac(uuid, bigint), private.checkin_digits(text), private.attendance_kind(public.internal_kind), private.checkin_open(public.internal_events) from public, anon, authenticated;

-- What HR's screen shows: the QR token, the four digits and how long they last.
create or replace function public.checkin_code(internal_event uuid)
returns table (token text, code text, seconds_left integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.internal_events;
  win bigint := private.checkin_window(now());
  mac text;
begin
  if not public.is_internal_planner() then
    raise exception 'Only HR and the Vice President show the check-in code' using errcode = '42501';
  end if;
  select * into e from public.internal_events where id = internal_event;
  if e.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if not private.checkin_open(e) then
    raise exception 'Checking in is not open for this meeting' using errcode = '22023';
  end if;
  mac := private.checkin_mac(e.id, win);
  return query select win::text || '.' || mac, private.checkin_digits(mac), (20 - (floor(extract(epoch from now()))::bigint % 20))::integer;
end;
$$;

-- A member checks in with the scanned token or the typed digits: checked_in,
-- already, or wrong (a wrong code is counted, not raised – raising would undo
-- the count).
create or replace function public.check_in_internal(internal_event uuid, token text default null, code text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.internal_events;
  win bigint := private.checkin_window(now());
  mine public.internal_attendance;
  how text;
  w bigint;
  tries integer;
begin
  if not public.is_workspace_member() then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  select * into e from public.internal_events where id = internal_event;
  if e.id is null or not public.can_read_internal_event(e.id) then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if not private.attendance_kind(e.kind) then
    raise exception 'This meeting has no attendance list' using errcode = '22023';
  end if;
  if not private.checkin_open(e) then
    raise exception 'Checking in is closed for this meeting' using errcode = '22023';
  end if;

  if token is not null then
    -- "<window>.<mac>": a window of the last three minutes, its own mac.
    if token !~ '^[0-9]+\.[0-9a-f]{64}$' then
      raise exception 'This check-in code is not valid' using errcode = '22023';
    end if;
    w := split_part(token, '.', 1)::bigint;
    if w > win or w < win - 9 or split_part(token, '.', 2) <> private.checkin_mac(e.id, w) then
      raise exception 'This check-in code has expired – scan the code on the screen again' using errcode = '22023';
    end if;
    how := 'qr';
  elsif code is not null then
    select failed into tries from private.checkin_attempts a where a.internal_event_id = e.id and a.profile_id = auth.uid();
    if coalesce(tries, 0) >= 5 then
      raise exception 'Too many wrong codes – ask HR to add you' using errcode = '22023';
    end if;
    if trim(code) not in (private.checkin_digits(private.checkin_mac(e.id, win)), private.checkin_digits(private.checkin_mac(e.id, win - 1))) then
      insert into private.checkin_attempts (internal_event_id, profile_id, failed) values (e.id, auth.uid(), 1)
      on conflict (internal_event_id, profile_id) do update set failed = private.checkin_attempts.failed + 1;
      return 'wrong';
    end if;
    how := 'code';
  else
    raise exception 'Scan the code or type its digits' using errcode = '22023';
  end if;

  select * into mine from public.internal_attendance a where a.internal_event_id = e.id and a.profile_id = auth.uid();
  if mine.profile_id is not null and mine.removed_at is not null then
    raise exception 'HR took your check-in back – ask HR' using errcode = '22023';
  end if;
  if mine.profile_id is not null then
    return 'already';
  end if;
  insert into public.internal_attendance (internal_event_id, profile_id, via, added_by)
  select e.id, auth.uid(), how, p.email from public.profiles p where p.id = auth.uid();
  return 'checked_in';
end;
$$;

-- HR adds or removes anyone, also after closing; a removal keeps who and when.
create or replace function public.mark_internal_attendance(internal_event uuid, profile uuid, present boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.internal_events;
  me text := (select email from public.profiles where id = auth.uid());
begin
  if not public.is_internal_planner() then
    raise exception 'Only HR and the Vice President change the attendance' using errcode = '42501';
  end if;
  select * into e from public.internal_events where id = internal_event;
  if e.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if not private.attendance_kind(e.kind) then
    raise exception 'This meeting has no attendance list' using errcode = '22023';
  end if;
  if present then
    insert into public.internal_attendance (internal_event_id, profile_id, via, added_by)
    values (e.id, profile, 'hr', me)
    on conflict (internal_event_id, profile_id) do update set removed_at = null, removed_by = null, via = 'hr', added_by = me, created_at = now()
    where public.internal_attendance.removed_at is not null;
  else
    update public.internal_attendance set removed_at = now(), removed_by = me
    where internal_event_id = e.id and profile_id = profile and removed_at is null;
  end if;
end;
$$;

-- Closing ends checking in; HR can reopen it.
create or replace function public.close_internal_attendance(internal_event uuid, closed boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_internal_planner() then
    raise exception 'Only HR and the Vice President close the attendance' using errcode = '42501';
  end if;
  update public.internal_events
  set attendance_closed_at = case when closed then now() end,
      attendance_closed_by = case when closed then (select email from public.profiles where id = auth.uid()) end
  where id = internal_event and private.attendance_kind(kind);
  if not found then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.checkin_code(uuid), public.check_in_internal(uuid, text, text), public.mark_internal_attendance(uuid, uuid, boolean), public.close_internal_attendance(uuid, boolean) from public, anon;
grant execute on function public.checkin_code(uuid), public.check_in_internal(uuid, text, text), public.mark_internal_attendance(uuid, uuid, boolean), public.close_internal_attendance(uuid, boolean) to authenticated;

-- ── What HR reviews: per member and semester ────────────────────────────────
create or replace function public.member_activity(semester text)
returns table (profile_id uuid, full_name text, email text, oc_count integer, helper_count integer, office_hour_count integer, talk_count integer, meeting_count integer, newbie boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b record;
begin
  if not (public.is_internal_planner() or public.has_role('executive')) then
    raise exception 'HR, the Vice President and the executive board only' using errcode = '42501';
  end if;
  if semester !~ '^[0-9]{4}-[12]$' then
    raise exception 'Not a semester: %', semester using errcode = '22023';
  end if;
  select * into b from private.semester_bounds(semester);
  return query
  with ev as (
    -- As on the leaderboard: ESN events that took place.
    select a.profile_id as id,
           (count(*) filter (where a.role = 'oc'))::integer as oc,
           (count(*) filter (where a.role = 'helper'))::integer as helper
    from public.assignments a
    join public.events e on e.id = a.event_id
    where a.status = 'active'
      and e.source = 'platform'
      and (e.status in ('confirmed', 'completed') or (e.status = 'understaffed' and e.understaffed_decision = 'run'))
      and e.starts_at < now()
      and (e.starts_at at time zone 'Europe/Berlin')::date between b.from_day and b.to_day
    group by a.profile_id
  ), oh as (
    select ip.profile_id as id, count(*)::integer as n
    from public.internal_event_people ip
    join public.internal_events ie on ie.id = ip.internal_event_id
    where ie.kind = 'office_hour' and ie.status = 'scheduled' and ip.role in ('oc', 'helper') and ie.starts_at < now()
      and (ie.starts_at at time zone 'Europe/Berlin')::date between b.from_day and b.to_day
    group by ip.profile_id
  ), att as (
    select ia.profile_id as id,
           (count(*) filter (where ie.kind = 'tuesday_talk'))::integer as talks,
           (count(*) filter (where ie.kind = 'internal'))::integer as meetings
    from public.internal_attendance ia
    join public.internal_events ie on ie.id = ia.internal_event_id
    where ia.removed_at is null and ie.status = 'scheduled'
      and (ie.starts_at at time zone 'Europe/Berlin')::date between b.from_day and b.to_day
    group by ia.profile_id
  )
  -- Every member with a profile, also those with nothing yet.
  select p.id,
         coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1)),
         p.email,
         coalesce(ev.oc, 0),
         coalesce(ev.helper, 0),
         coalesce(oh.n, 0),
         coalesce(att.talks, 0),
         coalesce(att.meetings, 0),
         exists (select 1 from public.role_members r where r.email = p.email and r.role = 'newbie')
  from public.profiles p
  left join ev on ev.id = p.id
  left join oh on oh.id = p.id
  left join att on att.id = p.id;
end;
$$;
revoke all on function public.member_activity(text) from public, anon;
grant execute on function public.member_activity(text) to authenticated;
