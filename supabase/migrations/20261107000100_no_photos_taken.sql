-- ============================================================
-- MESA Events Platform – "No photos taken": photos are no longer a must
-- for the hand-in (round 2026-11-07)
--
-- Photos counted towards the hand-in only with a file in the Drive folder
-- or the OC's tick "Photos are uploaded", and until then the OC was
-- reminded. When nobody took pictures there is nothing to upload, so the
-- step could never be done. Now the OC, a helper or the Events team can
-- press "No photos taken" (a reason is optional). It closes the photo step
-- like photos would, is logged, shows who said it, and can be taken back by
-- the same people. Photos found in the folder later still count as photos.
-- ============================================================

alter table public.event_photo_folders
  add column no_photos_at     timestamptz,
  add column no_photos_by     text,
  add column no_photos_reason text
    constraint event_photo_folders_no_photos_reason_check check (char_length(no_photos_reason) between 1 and 300);

-- Photos count as handed in: a file in the folder, ticked by hand, or "No photos taken".
create or replace function private.photos_in(event uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select f.photo_count > 0 or f.marked_uploaded_at is not null or f.no_photos_at is not null
    from public.event_photo_folders f where f.event_id = event
  ), false);
$$;
revoke all on function private.photos_in(uuid) from public, anon, authenticated;

-- ── "No photos taken" (declared = false: take it back) ──────────────────────────
create or replace function public.declare_no_photos(event uuid, declared boolean, reason text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  why text := case when declared then nullif(btrim(reason), '') end;
begin
  select * into e from public.events where id = event;
  if not found or not public.can_read_event(event) then
    raise exception 'No such event' using errcode = '22023';
  end if;
  if not (public.is_event_staff(event) or public.has_role('events')) then
    raise exception 'Only the event''s OC and helpers (or the Events team) say no photos were taken' using errcode = '42501';
  end if;
  if e.status not in ('confirmed', 'understaffed', 'completed') then
    raise exception 'This event does not run' using errcode = '22023';
  end if;
  if declared and e.starts_at > now() then
    raise exception 'The event has not started yet' using errcode = '22023';
  end if;
  if char_length(why) > 300 then
    raise exception 'Keep the reason under 300 characters' using errcode = '22023';
  end if;
  insert into public.event_photo_folders (event_id, no_photos_at, no_photos_by, no_photos_reason)
  values (event, case when declared then now() end, case when declared then public.auth_email() end, why)
  on conflict (event_id) do update set
    no_photos_at     = excluded.no_photos_at,
    no_photos_by     = excluded.no_photos_by,
    no_photos_reason = excluded.no_photos_reason;
  perform private.log('event_photo_folders', event::text, 'update', event, e.cycle_id,
    jsonb_strip_nulls(jsonb_build_object('no_photos', declared, 'reason', why)));
end;
$$;
revoke all on function public.declare_no_photos(uuid, boolean, text) from public, anon;
grant execute on function public.declare_no_photos(uuid, boolean, text) to authenticated;
