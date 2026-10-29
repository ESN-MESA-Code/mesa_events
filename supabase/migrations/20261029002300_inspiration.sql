-- ============================================================
-- MESA Events Platform – "Get inspired": previous events on /ideas
-- (brief 2026-10-29, D)
--
-- * events.source: 'platform' (everything so far) or 'bot_archive' – past
--   events imported from the description bot's Sheet
--   (npm run import:bot-archive), with archive_ref = the bot's Event ID so
--   a re-import updates instead of duplicating. History is completed, has
--   no cycle and no roster, and is left out of every workflow: the Comms
--   overview, the photo scheduler, the calendar (in the app).
-- * inspiration_events(): what members may see of previous events – the
--   published description (title, hook, intro, venue, price), the date and
--   type, the headcount (attendance list, else the event report) and the
--   Drive photo folder; never names, rosters, claims or notes. Every member
--   who accepted the rules may call it.
-- * event_ideas.type_suggestion: "Propose this again" suggests the type.
-- ============================================================

alter table public.events
  add column source text not null default 'platform' constraint events_source_check check (source in ('platform', 'bot_archive')),
  add column archive_ref text constraint events_archive_ref_check check (archive_ref is null or source = 'bot_archive');
create unique index events_archive_ref_idx on public.events(archive_ref) where archive_ref is not null;

alter table public.event_ideas
  add column type_suggestion public.event_type;

-- ── History stays out of the Comms overview ────────────────────────────────
create or replace function public.description_overview()
returns table (
  event_id uuid, title text, starts_at timestamptz, deadline timestamptz, status text,
  submitted_at timestamptz, published_at timestamptz, late boolean, cycle_id uuid, cycle_month date,
  missed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.title, e.starts_at, c.description_deadline, coalesce(d.status, 'missing'),
         d.submitted_at, d.published_at,
         coalesce(d.status, 'missing') in ('missing', 'draft', 'changes_requested')
           and c.description_deadline is not null and c.description_deadline < now()
           and e.starts_at > now(),
         c.id, c.month,
         coalesce(d.status, 'missing') <> 'published' and e.starts_at <= now()
  from public.events e
  left join public.planning_cycles c on c.id = e.cycle_id
  left join public.descriptions d on d.event_id = e.id
  where e.status in ('confirmed', 'understaffed', 'completed')
    and e.source = 'platform'
    and (public.is_team() or public.is_event_staff(e.id));
$$;

-- ── … and out of the photo scheduler ───────────────────────────────────────
create or replace function private.schedule_photo_jobs()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer := 0;
  e record;
  today date := (now() at time zone 'Europe/Berlin')::date;
begin
  for e in
    select ev.id, ev.starts_at, ev.ends_at, ev.chat_space_name, f.folder_id, f.counted_at
    from public.events ev
    left join public.event_photo_folders f on f.event_id = ev.id
    where ev.status in ('confirmed', 'understaffed', 'completed')
      and ev.source = 'platform'
      and (ev.starts_at at time zone 'Europe/Berlin')::date <= today
      and ev.starts_at > now() - interval '30 days'
  loop
    -- The folder, from the morning of the event's day (the hand-in opens then).
    if e.folder_id is null then
      perform private.enqueue_job('drive.ensure_folder', jsonb_build_object('event_id', e.id), 'drive.ensure_folder:' || e.id, e.id);
      n := n + 1;
    end if;
    -- "Starts now – take pictures", within 12 hours of the start.
    if e.chat_space_name is not null and now() >= e.starts_at and now() < e.starts_at + interval '12 hours' then
      perform private.enqueue_job('chat.photo_reminder', jsonb_build_object('event_id', e.id, 'kind', 'start'), 'chat.photo_reminder:start:' || e.id, e.id);
      n := n + 1;
    end if;
    -- "Please upload here", the next morning, for two days.
    if e.chat_space_name is not null
       and now() >= private.photo_upload_reminder_at(e.starts_at, e.ends_at)
       and now() < private.photo_upload_reminder_at(e.starts_at, e.ends_at) + interval '2 days' then
      perform private.enqueue_job('chat.photo_reminder', jsonb_build_object('event_id', e.id, 'kind', 'upload'), 'chat.photo_reminder:upload:' || e.id, e.id);
      n := n + 1;
    end if;
    -- The count, at most hourly, for two weeks after the start.
    if e.folder_id is not null and e.starts_at > now() - interval '14 days' and e.starts_at <= now()
       and (e.counted_at is null or e.counted_at < now() - interval '1 hour') then
      perform private.enqueue_job('drive.count_photos', jsonb_build_object('event_id', e.id), 'drive.count_photos:' || e.id, e.id, true);
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- ── What members see of previous events ────────────────────────────────────
create or replace function public.inspiration_events()
returns table (
  event_id uuid, title text, starts_at timestamptz, ends_at timestamptz, type public.event_type,
  hook text, intro text, venue text, price text, headcount integer, helpers_needed smallint,
  photo_folder_url text, source text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id,
         coalesce(nullif(d.approved_fields ->> 'title', ''), e.title),
         e.starts_at, e.ends_at, e.type,
         left(coalesce(d.approved_fields ->> 'hook', ''), 300),
         left(coalesce(d.approved_fields ->> 'intro', ''), 600),
         left(coalesce(d.approved_fields ->> 'venue', ''), 300),
         left(coalesce(d.approved_fields ->> 'price', ''), 50),
         coalesce(l.headcount, r.intl_participants + r.local_participants),
         case when e.source = 'platform' then e.helpers_needed end,
         f.folder_url,
         e.source
  from public.events e
  join public.descriptions d on d.event_id = e.id and d.published_at is not null and d.approved_fields is not null
  left join public.attendance_lists l on l.event_id = e.id and l.signed_off_at is not null
  left join public.event_reports r on r.event_id = e.id
  left join public.event_photo_folders f on f.event_id = e.id
  where public.is_workspace_member()
    and e.status in ('confirmed', 'understaffed', 'completed')
    and e.starts_at <= now();
$$;
revoke all on function public.inspiration_events() from public, anon;
grant execute on function public.inspiration_events() to authenticated;
