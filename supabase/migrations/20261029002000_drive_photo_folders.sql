-- ============================================================
-- MESA Events Platform – event photos live in Google Drive, like the bot
-- (brief 2026-10-29, A)
--
-- Before: staff uploaded photos into the private Storage bucket
-- "event-photos"; a job copied each file to Drive and deleted it. Now the
-- team uploads straight into the event's Drive folder, as with the
-- description bot (worker/Worker.gs):
--
-- * a job creates <photo drive>/<semester>/<yyyy-MM-dd Event title>
--   (SoSe_26 = April–September, WiSe_26-27 = October–March) on the event's
--   day and stores the folder here (event_photo_folders, one row per event);
-- * two Chat reminders in the event's space, once each: "starts now – take
--   pictures" at the start, "upload here: 📁 <folder>" the next morning at
--   10:00 (Berlin) after the event ended;
-- * the number of files in the folder is read through the Drive client by a
--   job and cached (photo_count, counted_at); "Check again" enqueues it now;
-- * the OC (or the Events team) can tick "Photos are uploaded" when Drive
--   cannot be read.
-- Photos count as handed in when the folder holds at least one file or the
-- tick is set (private.photos_in).
--
-- The Storage path is removed: the bucket and its policies,
-- add_event_photo() and the event_photos table (it held one row per
-- uploaded file; the count now comes from Drive, so it serves nothing).
-- Nothing was deployed; on a stack with stored photos, move them to Drive
-- and remove them with the Storage API first.
-- ============================================================

-- ── The Storage path goes ───────────────────────────────────────────────────
drop policy if exists "Staff upload event photos" on storage.objects;
drop policy if exists "Staff and teams read event photos" on storage.objects;

set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'event-photos';
delete from storage.buckets where id = 'event-photos';
reset storage.allow_delete_query;

drop function public.add_event_photo(uuid, text, text, text, integer);
drop function public.cycle_hand_in(uuid[]);
drop table public.event_photos;
delete from public.jobs where kind = 'drive.upload_photo';

-- ── Fake Drive: folders and the files in them ───────────────────────────────
-- (lib/google/fakes.ts DbDriveClient; service role only, as the other fakes)
drop table public.fake_drive_files;

create table public.fake_drive_folders (
  id         text primary key,
  -- The photo drive's root (DRIVE_PHOTOS_FOLDER_ID) is no row of its own.
  parent_id  text not null,
  name       text not null,
  created_at timestamptz not null default now(),
  unique (parent_id, name)
);

create table public.fake_drive_files (
  id         text primary key,
  folder_id  text not null references public.fake_drive_folders(id) on delete cascade,
  file_name  text not null,
  mime_type  text not null default 'image/jpeg',
  size       integer not null default 0,
  created_at timestamptz not null default now(),
  unique (folder_id, file_name)
);

alter table public.fake_drive_folders enable row level security;
alter table public.fake_drive_files enable row level security;
revoke all on public.fake_drive_folders, public.fake_drive_files from anon, authenticated;

-- ── The event's photo folder ────────────────────────────────────────────────
create table public.event_photo_folders (
  event_id           uuid primary key references public.events(id) on delete cascade,
  -- Set by the drive.ensure_folder job; null while Drive has not been reached
  -- (the row may exist earlier for the manual tick).
  folder_id          text,
  folder_url         text constraint event_photo_folders_url_check check (folder_url ~ '^https://'),
  -- "WiSe_26-27/2026-11-02 Pub quiz" – fixed once created, even if the title changes.
  folder_path        text,
  -- Files in the folder (subfolders included) when last read from Drive.
  photo_count        integer constraint event_photo_folders_count_check check (photo_count >= 0),
  counted_at         timestamptz,
  count_error        text,
  -- "Photos are uploaded" by hand (Drive cannot be read).
  marked_uploaded_at timestamptz,
  marked_uploaded_by text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger event_photo_folders_updated_at before update on public.event_photo_folders
  for each row execute function public.set_updated_at();

alter table public.event_photo_folders enable row level security;
-- Who sees the hand-in: the event's OC and helpers and the teams.
create policy "Staff and teams see the photo folder"
  on public.event_photo_folders for select to authenticated
  using (public.is_team() or public.is_event_staff(event_id));
-- Written by the jobs (service role) and the functions below.
revoke insert, update, delete, truncate on public.event_photo_folders from anon, authenticated;
revoke all on public.event_photo_folders from anon;

-- Photos count as handed in: a file in the folder, or ticked by hand.
create or replace function private.photos_in(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select f.photo_count > 0 or f.marked_uploaded_at is not null from public.event_photo_folders f where f.event_id = event), false);
$$;
revoke all on function private.photos_in(uuid) from public, anon, authenticated;

-- ── The OC's tick: "Photos are uploaded" ────────────────────────────────────
create or replace function public.mark_photos_uploaded(event uuid, uploaded boolean)
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
    raise exception 'Only the event''s OC (or the Events team) ticks the photos' using errcode = '42501';
  end if;
  if e.status not in ('confirmed', 'understaffed', 'completed') then
    raise exception 'This event does not run' using errcode = '22023';
  end if;
  insert into public.event_photo_folders (event_id, marked_uploaded_at, marked_uploaded_by)
  values (event, case when uploaded then now() end, case when uploaded then public.auth_email() end)
  on conflict (event_id) do update set
    marked_uploaded_at = excluded.marked_uploaded_at,
    marked_uploaded_by = excluded.marked_uploaded_by;
  perform private.log('event_photo_folders', event::text, 'update', event, e.cycle_id, jsonb_build_object('marked_uploaded', uploaded));
end;
$$;
revoke all on function public.mark_photos_uploaded(uuid, boolean) from public, anon;
grant execute on function public.mark_photos_uploaded(uuid, boolean) to authenticated;

-- ── "Check again": count the folder's files now (a job) ─────────────────────
create or replace function public.request_photo_count(event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_team() or public.is_event_staff(event)) then
    raise exception 'Only the event''s OC and helpers and the teams check the photos' using errcode = '42501';
  end if;
  if not exists (select 1 from public.event_photo_folders f where f.event_id = event and f.folder_id is not null) then
    raise exception 'The photo folder does not exist yet' using errcode = '22023';
  end if;
  perform private.enqueue_job('drive.count_photos', jsonb_build_object('event_id', event), 'drive.count_photos:' || event, event, true);
end;
$$;
revoke all on function public.request_photo_count(uuid) from public, anon;
grant execute on function public.request_photo_count(uuid) to authenticated;

-- ── Scheduling (pg_cron, every 5 minutes) ───────────────────────────────────
-- When the next-morning reminder is due: 10:00 Berlin on the day after the
-- event ended (its start for one-day events).
create or replace function private.photo_upload_reminder_at(starts_at timestamptz, ends_at timestamptz)
returns timestamptz
language sql
immutable
set search_path = ''
as $$
  select ((((coalesce(ends_at, starts_at) at time zone 'Europe/Berlin')::date + 1) + time '10:00') at time zone 'Europe/Berlin');
$$;
revoke all on function private.photo_upload_reminder_at(timestamptz, timestamptz) from public, anon, authenticated;

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
revoke all on function private.schedule_photo_jobs() from public, anon, authenticated;

select cron.schedule('schedule-photo-jobs', '*/5 * * * *', 'select private.schedule_photo_jobs()');

-- The DB tests run it on demand (service role only).
create or replace function public.schedule_photo_jobs()
returns integer
language sql
security definer
set search_path = ''
as $$
  select private.schedule_photo_jobs();
$$;
revoke all on function public.schedule_photo_jobs() from public, anon, authenticated;
grant execute on function public.schedule_photo_jobs() to service_role;

-- ── A cycle's hand-in now reads the folder ──────────────────────────────────
create function public.cycle_hand_in(cycles uuid[])
returns table (
  event_id uuid, cycle_id uuid, status public.event_status, starts_at timestamptz, ends_at timestamptz,
  signed_off boolean, photos_in boolean, receipts integer, belege_missing integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.cycle_id, e.status, e.starts_at, e.ends_at,
         coalesce(l.signed_off_at is not null, false),
         private.photos_in(e.id),
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

-- ── Activity log: the event's staff read the photo entries ──────────────────
drop policy "Log entries by what they describe" on public.activity_log;
create policy "Log entries by what they describe"
  on public.activity_log for select to authenticated
  using (
    case
      when entity = 'reimbursements' then public.has_role('finance') or public.has_role('executive')
      else public.has_role('events') or public.has_role('executive') or public.has_role('admin')
        or (event_id is not null
            and entity in ('events', 'assignments', 'descriptions', 'reviews', 'attendance_lists', 'event_photo_folders')
            and public.is_event_staff(event_id))
    end
  );
