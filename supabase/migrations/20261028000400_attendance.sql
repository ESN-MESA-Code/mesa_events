-- ============================================================
-- MESA Events Platform – attendance lists (moved in from MESAttendance)
--
-- Every event has an attendance list (attendance_lists, created with the
-- event): a QR code token for the public form, an optional risk notice, the
-- sign-off with a headcount. The rules are MESAttendance's, attached to the
-- platform's events and roles:
-- * sign-ins through public.sign_in() only, from 2 hours before the event
--   until 24 hours after it (or the sign-off); optional answers are only
--   counted (event_stats), never stored with a name;
-- * names: the event's OC and helpers and the Events team while the list is
--   open, executives always; everyone on the teams sees the numbers;
-- * the OC signs off with the number of people counted (closes the list);
-- * the date and risk notice are fixed once someone signed in;
-- * lists are deleted at the end of the third calendar year after the event
--   (the event and its receipts stay);
-- * no deletes through the API.
-- ============================================================

-- ── The sign-in window (keep in step with lib/attendance/window.ts) ─────────
create or replace function public.signins_open_at(event_date timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  select event_date - interval '2 hours';
$$;

create or replace function public.signins_close_at(event_date timestamptz)
returns timestamptz language sql immutable set search_path = '' as $$
  select event_date + interval '24 hours';
$$;

-- ── Lists ───────────────────────────────────────────────────────────────────
create table public.attendance_lists (
  event_id      uuid primary key references public.events(id) on delete cascade,
  -- The QR code's key to the public form: 128 random bits.
  public_token  text not null unique default encode(extensions.gen_random_bytes(16), 'hex'),
  risk_notice   text constraint attendance_lists_risk_notice_check check (length(risk_notice) between 1 and 2000),
  signed_off_at timestamptz,
  signed_off_by text,
  headcount     integer constraint attendance_lists_headcount_check check (headcount between 0 and 10000),
  created_at    timestamptz not null default now(),
  constraint attendance_lists_signed_off_check check (
    (signed_off_at is null and signed_off_by is null and headcount is null)
    or (signed_off_at is not null and signed_off_by is not null and headcount is not null)
  )
);

create or replace function private.create_attendance_list()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.attendance_lists (event_id) values (new.id) on conflict do nothing;
  return null;
end;
$$;
revoke all on function private.create_attendance_list() from public, anon, authenticated;
create trigger create_attendance_list after insert on public.events for each row execute function private.create_attendance_list();
insert into public.attendance_lists (event_id) select id from public.events on conflict do nothing;

create table public.participants (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references public.attendance_lists(event_id) on delete cascade,
  first_name     text not null,
  last_name      text not null,
  -- 'self': own phone (QR code); 'kiosk': on an organiser's device
  entry_method   text not null default 'self' constraint participants_entry_method_check check (entry_method in ('self', 'kiosk')),
  -- Email of the OC/helper whose device recorded a kiosk sign-in
  recorded_by    text,
  -- Version (date) of the data processing notice shown and of the terms accepted
  notice_version text not null constraint participants_notice_version_check check (notice_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  terms_version  text not null constraint participants_terms_version_check check (terms_version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  created_at     timestamptz not null default now(),
  constraint participants_name_length_check check (length(first_name) between 1 and 200 and length(last_name) between 1 and 200)
);
create index participants_event_id_idx on public.participants(event_id);

-- Counts of the optional answers, never linked to a person.
create table public.event_stats (
  event_id uuid not null references public.attendance_lists(event_id) on delete cascade,
  question text not null constraint event_stats_question_check check (question in ('nationality', 'university', 'exchange_program', 'esn_card')),
  answer   text not null constraint event_stats_answer_check check (length(answer) between 1 and 30),
  total    integer not null default 0 constraint event_stats_total_check check (total >= 0),
  primary key (event_id, question, answer)
);

alter table public.attendance_lists enable row level security;
alter table public.participants enable row level security;
alter table public.event_stats enable row level security;

-- ── Who sees and changes what ───────────────────────────────────────────────
-- Open: not signed off, the event not cancelled, less than 24 hours after it.
create or replace function public.event_list_open(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e join public.attendance_lists l on l.event_id = e.id
    where e.id = event and l.signed_off_at is null and e.status not in ('cancelled', 'dropped')
      and now() < public.signins_close_at(e.starts_at)
  );
$$;

create or replace function public.event_accepts_signins(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events e join public.attendance_lists l on l.event_id = e.id
    where e.id = event and l.signed_off_at is null and e.status not in ('cancelled', 'dropped', 'draft')
      and now() >= public.signins_open_at(e.starts_at)
      and now() < public.signins_close_at(e.starts_at)
  );
$$;

-- The event's OC and helpers and the Events team run the list.
create or replace function public.is_list_organiser(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_event_staff(event) or public.has_role('events');
$$;

revoke all on function public.event_list_open(uuid) from public;
revoke all on function public.event_accepts_signins(uuid) from public;
revoke all on function public.is_list_organiser(uuid) from public;
grant execute on function public.event_list_open(uuid) to authenticated;
grant execute on function public.event_accepts_signins(uuid) to anon, authenticated;
grant execute on function public.is_list_organiser(uuid) to authenticated;

create policy "Staff and teams read lists"
  on public.attendance_lists for select to authenticated
  using (public.is_team() or public.is_event_staff(event_id));
-- Risk notice and sign-off; guard_attendance_list() decides the details.
create policy "Organisers change their event's list"
  on public.attendance_lists for update to authenticated
  using (public.is_list_organiser(event_id)) with check (public.is_list_organiser(event_id));

create policy "Organisers read open lists, executives all lists"
  on public.participants for select to authenticated
  using (public.is_executive() or (public.is_list_organiser(event_id) and public.event_list_open(event_id)));

revoke insert, delete, truncate on public.attendance_lists from anon, authenticated;
revoke insert, update, delete, truncate on public.participants from anon, authenticated;
revoke all on public.event_stats from anon, authenticated;
revoke all on public.attendance_lists, public.participants from anon;

-- Sign-off by the OC (Events if the event has no OC), once, with a headcount
-- recorded by the database; the risk notice is fixed once people signed in.
create or replace function public.guard_attendance_list()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated' then
    return new;
  end if;
  if new.public_token is distinct from old.public_token or new.event_id is distinct from old.event_id then
    raise exception 'The list''s token cannot be changed' using errcode = '42501';
  end if;
  if new.risk_notice is distinct from old.risk_notice
     and exists (select 1 from public.participants p where p.event_id = old.event_id) then
    raise exception 'The risk notice cannot change once people have signed in' using errcode = '42501';
  end if;
  if (new.signed_off_at, new.signed_off_by, new.headcount) is distinct from (old.signed_off_at, old.signed_off_by, old.headcount) then
    if old.signed_off_at is not null then
      raise exception 'This list is already signed off' using errcode = '42501';
    end if;
    if not (public.is_event_oc(old.event_id)
            or (public.has_role('events') and not exists (
                  select 1 from public.assignments a where a.event_id = old.event_id and a.role = 'oc' and a.status = 'active'))) then
      raise exception 'Only the event''s OC can sign the list off' using errcode = '42501';
    end if;
    if new.headcount is null then
      raise exception 'A sign-off needs the number of people counted' using errcode = '23514';
    end if;
    new.signed_off_at := now();
    new.signed_off_by := public.auth_email();
  end if;
  return new;
end;
$$;
revoke all on function public.guard_attendance_list() from public, anon, authenticated;
create trigger guard_attendance_list before update on public.attendance_lists for each row execute function public.guard_attendance_list();
create trigger log_attendance_lists after update on public.attendance_lists for each row execute function private.log_row_change();

-- What participants saw stays as it was: the event's date too.
create or replace function public.guard_event_date_after_signins()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') = 'authenticated'
     and new.starts_at is distinct from old.starts_at
     and exists (select 1 from public.participants p where p.event_id = old.id) then
    raise exception 'The date cannot change once people have signed in' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_event_date_after_signins() from public, anon, authenticated;
create trigger guard_event_date_after_signins before update of starts_at on public.events
  for each row execute function public.guard_event_date_after_signins();

-- ── Signing in ──────────────────────────────────────────────────────────────
create or replace function public.sign_in(
  event uuid,
  first_name text,
  last_name text,
  notice_version text,
  terms_version text,
  nationality text default null,
  university text default null,
  exchange_program text default null,
  esn_card boolean default null,
  kiosk boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  nat text := nullif(nationality, '');
  uni text := nullif(university, '');
  prog text := nullif(exchange_program, '');
begin
  if not public.event_accepts_signins(event) then
    raise exception 'This attendance list is not open for sign-ins' using errcode = '42501';
  end if;
  if kiosk and not public.is_list_organiser(event) then
    raise exception 'Only the event''s organisers record sign-ins on their device' using errcode = '42501';
  end if;
  if nat !~ '^[A-Z]{2}$'
     or uni not in ('LMU', 'TUM', 'Other')
     or prog not in ('Erasmus+', 'LMUexchange', 'Full-time degree', 'Other') then
    raise exception 'Unknown answer' using errcode = '23514';
  end if;

  insert into public.participants (event_id, first_name, last_name, entry_method, recorded_by, notice_version, terms_version)
  values (
    event, first_name, last_name,
    case when kiosk then 'kiosk' else 'self' end,
    case when kiosk then public.auth_email() end,
    notice_version, terms_version
  );

  insert into public.event_stats as s (event_id, question, answer, total)
  values
    (event, 'nationality', coalesce(nat, 'not_given'), 1),
    (event, 'university', coalesce(uni, 'not_given'), 1),
    (event, 'exchange_program', coalesce(prog, 'not_given'), 1),
    (event, 'esn_card', case esn_card when true then 'yes' when false then 'no' else 'not_given' end, 1)
  on conflict (event_id, question, answer) do update set total = s.total + 1;
end;
$$;
revoke all on function public.sign_in(uuid, text, text, text, text, text, text, text, boolean, boolean) from public;
grant execute on function public.sign_in(uuid, text, text, text, text, text, text, text, boolean, boolean) to anon, authenticated;

-- The public form learns the window and the risk notice (no names of organisers).
create or replace function public.get_public_event(token text)
returns table (id uuid, title text, event_date timestamptz, risk_notice text, opens_at timestamptz, closes_at timestamptz, closed boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.title, e.starts_at, l.risk_notice,
         public.signins_open_at(e.starts_at),
         public.signins_close_at(e.starts_at),
         l.signed_off_at is not null or e.status in ('cancelled', 'dropped') or now() >= public.signins_close_at(e.starts_at)
  from public.attendance_lists l join public.events e on e.id = l.event_id
  where l.public_token = token and e.status <> 'draft';
$$;
revoke all on function public.get_public_event(text) from public;
grant execute on function public.get_public_event(text) to anon, authenticated;

-- ── Numbers ─────────────────────────────────────────────────────────────────
-- What the event's staff and the teams (Finance checks) see: the numbers,
-- and once the list is closed the counts per answer.
create or replace function public.event_summary(event uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  summary jsonb;
begin
  if not (public.is_team() or public.is_event_staff(event)) then
    return null;
  end if;
  if not exists (select 1 from public.attendance_lists where event_id = event) then
    return null;
  end if;
  select jsonb_build_object(
    'signins', count(*),
    'kiosk', count(*) filter (where p.entry_method = 'kiosk'),
    'first_signin', min(p.created_at),
    'last_signin', max(p.created_at)
  ) into summary
  from public.participants p where p.event_id = event;

  if not public.event_list_open(event) then
    summary := summary || coalesce((
      select jsonb_object_agg(q.question, q.answers)
      from (
        select s.question, jsonb_object_agg(s.answer, s.total) as answers
        from public.event_stats s where s.event_id = event group by s.question
      ) q
    ), '{}'::jsonb);
  end if;
  return summary;
end;
$$;
revoke all on function public.event_summary(uuid) from public;
grant execute on function public.event_summary(uuid) to authenticated;

create or replace function public.event_signin_counts()
returns table (event_id uuid, signins integer)
language sql
stable
security definer
set search_path = ''
as $$
  select p.event_id, count(*)::integer
  from public.participants p
  where public.is_team() or public.is_event_staff(p.event_id)
  group by p.event_id;
$$;
revoke all on function public.event_signin_counts() from public;
grant execute on function public.event_signin_counts() to authenticated;

-- ── Live list ───────────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.participants;

-- ── Retention: three years (legal/details.json) ─────────────────────────────
-- The list goes (sign-ins, counts, token); the event and its finance
-- records stay.
create or replace function public.delete_expired_lists()
returns integer
language sql
security definer
set search_path = ''
as $$
  with deleted as (
    delete from public.attendance_lists l
    using public.events e
    where e.id = l.event_id and e.starts_at < date_trunc('year', now()) - interval '3 years'
    returning 1
  )
  select count(*)::integer from deleted;
$$;
revoke all on function public.delete_expired_lists() from public, anon, authenticated;
select cron.schedule('delete-expired-lists', '30 3 * * *', 'select public.delete_expired_lists()');
