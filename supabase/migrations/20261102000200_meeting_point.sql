-- ============================================================
-- MESA Events Platform – the meeting point (round 2026-11-02)
--
-- Where people meet is not always where the event happens: a hike meets at
-- München Hauptbahnhof and takes place at the Tegernsee. `location` and the
-- address_* columns stay the place of the event (ESN Activities wants that
-- one); the meeting point is optional and separate:
--   meeting_point            the place's name ("München Hauptbahnhof, Starnberger Flügelbahnhof")
--   meeting_country/street/postal_code/city  its address (optional, the same shapes as address_*)
--   meeting_time             the time to be there (Berlin time, on the event's day)
-- The time is a time of day, not an instant, so it follows the event when the
-- Events team moves the date. A time or an address needs a meeting point.
--
-- Who changes it is unchanged: the OC changes the place (guard_event_update()
-- lists only what is the Events team's), so the OC sets the meeting point too.
--
-- A format has a usual meeting point (event_formats.meeting_point); a new
-- event of the format (accept_idea(), the schedule form) starts with it.
-- The calendar feed says where and when to meet.
-- ============================================================

alter table public.events
  add column meeting_point text constraint events_meeting_point_check check (length(meeting_point) <= 300),
  add column meeting_country text not null default 'DE' constraint events_meeting_country_check check (meeting_country ~ '^[A-Z]{2}$'),
  add column meeting_street text constraint events_meeting_street_check check (meeting_street is null or (length(meeting_street) between 3 and 200 and meeting_street ~ '[0-9]')),
  add column meeting_postal_code text constraint events_meeting_postal_check check (meeting_postal_code is null or length(meeting_postal_code) between 3 and 10),
  add column meeting_city text constraint events_meeting_city_check check (meeting_city is null or length(meeting_city) between 1 and 100),
  add column meeting_time time constraint events_meeting_time_check check (meeting_time is null or extract(second from meeting_time) = 0),
  add constraint events_meeting_de_postal_check check (meeting_country <> 'DE' or meeting_postal_code is null or meeting_postal_code ~ '^[0-9]{5}$'),
  add constraint events_meeting_needs_place_check check (
    (meeting_time is null and meeting_street is null and meeting_postal_code is null and meeting_city is null)
    or nullif(trim(meeting_point), '') is not null
    or meeting_street is not null
  );

comment on column public.events.meeting_point is
  'Where people meet when that is not the event''s location (a hike meets at the station); null: they meet at the location.';
comment on column public.events.meeting_time is
  'When to be at the meeting point, Berlin time on the event''s day.';

alter table public.event_formats
  add column meeting_point text constraint event_formats_meeting_point_check check (length(meeting_point) <= 300);

-- ── Accepting an idea: the format's usual place and meeting point ─────────
create or replace function public.accept_idea(
  idea uuid, cycle uuid, event_type public.event_type, starts timestamptz, helpers smallint default null,
  category uuid default null, format uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.event_ideas;
  c public.planning_cycles;
  f public.event_formats;
  new_event uuid;
begin
  if not public.has_role('events') then
    raise exception 'Only the Events team accepts ideas' using errcode = '42501';
  end if;
  select * into i from public.event_ideas where id = idea for update;
  if not found or i.status <> 'proposed' then
    raise exception 'This idea is not open any more' using errcode = '22023';
  end if;
  select * into c from public.planning_cycles where id = cycle;
  if not found or c.status not in ('planning', 'form_open') then
    raise exception 'Ideas can only be added while the schedule is being planned' using errcode = '22023';
  end if;
  select * into f from public.event_formats where id = coalesce(format, i.format_id);
  insert into public.events (cycle_id, title, type, starts_at, helpers_needed, proposed_by, status, category_id, format_id, location, meeting_point)
  values (cycle, i.title, event_type, starts, coalesce(helpers, i.helpers_needed), case when i.wants_to_oc then i.proposer_id end,
          case when c.status = 'form_open' then 'scheduled' else 'draft' end::public.event_status,
          coalesce(category, i.category_id), f.id, f.location, f.meeting_point)
  returning id into new_event;
  update public.event_ideas set status = 'accepted', event_id = new_event,
         category_id = coalesce(category, category_id), format_id = coalesce(format, format_id)
  where id = idea;
  return new_event;
end;
$$;
revoke all on function public.accept_idea(uuid, uuid, public.event_type, timestamptz, smallint, uuid, uuid) from public, anon;
grant execute on function public.accept_idea(uuid, uuid, public.event_type, timestamptz, smallint, uuid, uuid) to authenticated;

-- ── The calendar feed says where and when to meet ─────────────────────────
create or replace function public.calendar_feed_items(token text)
returns table (
  uid text,
  kind text,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  location text,
  description text,
  path text,
  cancelled boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner uuid;
  owner_email text;
  roles public.app_role[];
  board boolean;
begin
  select f.profile_id, p.email into owner, owner_email
  from public.calendar_feeds f join public.profiles p on p.id = f.profile_id
  where f.token_hash = encode(extensions.digest(coalesce(token, ''), 'sha256'), 'hex');
  if owner is null
     or owner_email not like '%@' || public.workspace_domain()
     or not exists (select 1 from public.organiser_acknowledgements a where a.email = owner_email and a.version = public.confidentiality_version()) then
    raise exception 'Unknown calendar feed' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(r.role), '{}') into roles from public.role_members r where r.email = owner_email;
  board := roles && array['executive', 'hr', 'vice_president']::public.app_role[];
  -- Calendar apps poll often; note the use at most hourly.
  update public.calendar_feeds set last_used_at = now()
  where profile_id = owner and (last_used_at is null or last_used_at < now() - interval '1 hour');

  return query
  select 'event-' || e.id::text || '@mesa',
         'event',
         e.title,
         e.starts_at,
         e.ends_at,
         concat_ws(', ', nullif(e.location, ''), nullif(e.address_street, ''), nullif(concat_ws(' ', nullif(e.address_postal_code, ''), nullif(e.address_city, '')), '')),
         concat_ws(E'\n',
           case when nullif(trim(coalesce(e.meeting_point, '')), '') is not null or e.meeting_street is not null then
             'Meeting point: '
             || concat_ws(', ', nullif(trim(coalesce(e.meeting_point, '')), ''), nullif(e.meeting_street, ''), nullif(concat_ws(' ', nullif(e.meeting_postal_code, ''), nullif(e.meeting_city, '')), ''))
             || coalesce(' at ' || to_char(e.meeting_time, 'HH24:MI'), '')
           end,
           case a.role when 'oc' then 'You are the OC.' when 'helper' then 'You are a helper.' end,
           case when e.status = 'understaffed' then 'Short of helpers.' end),
         '/events/' || e.id::text,
         e.status = 'cancelled',
         e.updated_at
  from public.events e
  left join public.assignments a on a.event_id = e.id and a.profile_id = owner and a.status = 'active'
  where e.source = 'platform'
    and e.status in ('scheduled', 'understaffed', 'confirmed', 'cancelled', 'completed')
    and e.starts_at > now() - interval '183 days'
  union all
  select 'internal-' || i.id::text || '@mesa',
         i.kind::text,
         i.title,
         i.starts_at,
         i.ends_at,
         nullif(i.location, ''),
         concat_ws(E'\n',
           case p.role when 'oc' then 'You are the OC.' when 'helper' then 'You are a helper.' when 'attendee' then 'You signed up.' end,
           nullif(i.note, ''),
           case when i.kind = 'office_hour' then nullif(s.description, '') end,
           case when i.presentation_url is not null then 'Presentation: ' || i.presentation_url end),
         case when i.kind = 'office_hour' then '/office-hours/' else '/internal/' end || i.id::text,
         i.status = 'cancelled',
         i.updated_at
  from public.internal_events i
  join public.internal_kind_settings s on s.kind = i.kind
  left join public.internal_event_people p on p.internal_event_id = i.id and p.profile_id = owner
  where (i.kind <> 'board_meeting' or board)
    and i.starts_at > now() - interval '183 days';
end;
$$;
revoke all on function public.calendar_feed_items(text) from public, anon, authenticated;
grant execute on function public.calendar_feed_items(text) to service_role;
