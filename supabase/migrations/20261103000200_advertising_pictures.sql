-- ============================================================
-- MESA Events Platform – advertising pictures (round 2026-11-03)
--
-- A Telegram post of several events is one message per event; each event's
-- message can have its own picture, and an event without one takes the
-- default picture of its format (event series), else of its type – chosen
-- once by Comms on the "Pictures" tab, so recurring events need no new
-- upload every time.
-- * publication_post_events.picture: "upload:<path>" in post-pictures
--   (removed once the post is out, as the post's own picture).
-- * advertising_pictures: one default per format or per event type,
--   "library:<path>" in the private bucket advertising-pictures (kept).
-- ============================================================

alter table public.publication_post_events
  add column picture text constraint publication_post_events_picture_check check (picture is null or length(picture) <= 500);

-- An event's own picture in a post (empty = none). A post of one event keeps
-- one picture: the event's, so the post's own goes.
create or replace function public.set_post_event_picture(post uuid, event uuid, picture text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_comms();
  if not exists (select 1 from public.publication_posts p where p.id = post and p.status <> 'skipped') then
    raise exception 'No such post' using errcode = '22023';
  end if;
  update public.publication_post_events pe set picture = nullif(trim(coalesce(set_post_event_picture.picture, '')), '')
  where pe.post_id = post and pe.event_id = event;
  if not found then
    raise exception 'The event is not in this post' using errcode = '22023';
  end if;
  if (select count(*) from public.publication_post_events pe where pe.post_id = post) = 1 then
    update public.publication_posts p set picture = null where p.id = post;
  end if;
  perform private.post_changed(post);
  perform private.log_post(post, 'update', jsonb_build_object('picture', event));
end;
$$;
revoke all on function public.set_post_event_picture(uuid, uuid, text) from public, anon;
grant execute on function public.set_post_event_picture(uuid, uuid, text) to authenticated;

-- ── Default pictures ────────────────────────────────────────────────────────
create table public.advertising_pictures (
  id         uuid primary key default gen_random_uuid(),
  format_id  uuid unique references public.event_formats(id) on delete cascade,
  event_type public.event_type unique,
  picture    text not null constraint advertising_pictures_picture_check check (picture ~ '^library:[\w/.-]+$' and length(picture) <= 500),
  updated_by text default public.auth_email(),
  updated_at timestamptz not null default now(),
  constraint advertising_pictures_one_key check ((format_id is null) <> (event_type is null))
);
alter table public.advertising_pictures enable row level security;
create policy "Comms, Events and executives read the default pictures" on public.advertising_pictures for select to authenticated
  using (public.has_role('comms') or public.has_role('events') or public.has_role('executive'));
revoke insert, update, delete, truncate on public.advertising_pictures from anon, authenticated;
revoke all on public.advertising_pictures from anon;

-- Set (or with an empty picture: remove) the default of a format or a type.
create or replace function public.set_default_picture(format uuid, type text, picture text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := nullif(trim(coalesce(set_default_picture.picture, '')), '');
begin
  perform private.require_comms();
  if (format is null) = (type is null) then
    raise exception 'A default picture is for a format or for a type' using errcode = '22023';
  end if;
  if format is not null and not exists (select 1 from public.event_formats f where f.id = format) then
    raise exception 'No such format' using errcode = '22023';
  end if;
  if type is not null and type not in ('standard', 'special', 'day_trip', 'weekend_trip') then
    raise exception 'No such event type' using errcode = '22023';
  end if;
  if clean is null then
    delete from public.advertising_pictures a where (format is not null and a.format_id = format) or (type is not null and a.event_type = type::public.event_type);
  elsif format is not null then
    insert into public.advertising_pictures (format_id, picture) values (format, clean)
    on conflict (format_id) do update set picture = excluded.picture, updated_by = public.auth_email(), updated_at = now();
  else
    insert into public.advertising_pictures (event_type, picture) values (type::public.event_type, clean)
    on conflict (event_type) do update set picture = excluded.picture, updated_by = public.auth_email(), updated_at = now();
  end if;
  perform private.log('advertising_pictures', coalesce(format::text, type), case when clean is null then 'delete' else 'update' end, null, null, jsonb_build_object('picture', clean));
end;
$$;
revoke all on function public.set_default_picture(uuid, text, text) from public, anon;
grant execute on function public.set_default_picture(uuid, text, text) to authenticated;

-- ── The pictures themselves (kept; Comms uploads and removes) ───────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('advertising-pictures', 'advertising-pictures', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "Comms uploads advertising pictures"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'advertising-pictures' and public.has_role('comms'));
create policy "Comms, Events and executives see advertising pictures"
  on storage.objects for select to authenticated
  using (bucket_id = 'advertising-pictures' and (public.has_role('comms') or public.has_role('events') or public.has_role('executive')));
create policy "Comms removes advertising pictures"
  on storage.objects for delete to authenticated
  using (bucket_id = 'advertising-pictures' and public.has_role('comms'));

-- ── "Reset demo data" on staging: the defaults go with the formats ──────────
create or replace function private.staging_wipe_lists()
returns table (table_name text, action text)
language sql
immutable
set search_path = ''
as $$
  select t, 'wipe' from unnest(array[
    'activity_log', 'advertising_pictures', 'assignment_drop_reasons', 'assignments', 'attendance_lists', 'calendar_feeds',
    'cash_box_changes', 'cash_boxes', 'cash_reports', 'description_versions', 'descriptions',
    'esn_access_tokens', 'esn_uploads', 'event_chat_members', 'event_formats', 'event_ideas', 'event_photo_folders',
    'event_reports', 'event_series', 'event_stats', 'events', 'fake_chat_members', 'fake_chat_messages',
    'fake_chat_spaces', 'fake_directory_members', 'fake_drive_files', 'fake_drive_folders',
    'fake_telegram_messages', 'finance_entries', 'internal_event_people', 'internal_events', 'jobs',
    'participants', 'payout_batches', 'payout_details', 'planning_cycles', 'preapprovals',
    'profile_payout_details', 'publication_post_events', 'publication_posts', 'receipts',
    'reimbursements', 'reviews', 'trip_budgets', 'volunteer_choices', 'volunteer_responses'
  ]) as t
  union all
  -- reimbursement_policies/rules: versions after the first are removed;
  -- role_members: demo members' rows are removed.
  select t, 'keep' from unnest(array[
    'app_settings', 'event_categories', 'finance_categories', 'internal_kind_settings', 'organiser_acknowledgements', 'profiles',
    'publication_channels', 'reimbursement_policies', 'reimbursement_rules', 'role_members'
  ]) as t;
$$;
revoke all on function private.staging_wipe_lists() from public, anon, authenticated;
