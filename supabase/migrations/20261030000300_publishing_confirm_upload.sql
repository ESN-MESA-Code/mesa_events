-- ============================================================
-- MESA Events Platform – publishing: confirm Telegram posts, uploaded
-- pictures, every event on the three channels (round 2026-10-30)
--
-- * Telegram posts go out only once Comms confirmed them (after a look at
--   the preview): confirm_post() for the planned time, publish_post_now()
--   at once. Any later change (events, picture, heading, time) takes the
--   confirmation back, so nothing unseen is posted.
-- * The picture of a Telegram post is uploaded into the private bucket
--   post-pictures (JPG, PNG, WebP, 10 MB) and kept there until the post is
--   published; publication_posts.picture is then "upload:<path>".
-- * Channels can be required: every event is published on all of them
--   (Telegram, Instagram, pretix). plan_everywhere() plans an event on each
--   required channel it is not on yet, on one day.
-- ============================================================

alter table public.publication_channels add column required boolean not null default false;
update public.publication_channels set required = true where key in ('telegram', 'instagram', 'pretix');

alter table public.publication_posts
  add column confirmed_at timestamptz,
  add column confirmed_by text;

-- After a change: a new version and no confirmation (unless this change is
-- the confirmation). Confirmed Telegram posts get their job for the version
-- (at the planned time, or at once when already published: the job edits).
drop function private.post_changed(uuid);
create function private.post_changed(post uuid, confirm boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.publication_posts;
begin
  update public.publication_posts
  set version = version + 1, last_error = null,
      confirmed_at = case when confirm then now() end,
      confirmed_by = case when confirm then public.auth_email() end
  where id = post returning * into p;
  if confirm and p.channel = 'telegram' and p.status in ('planned', 'published')
     and exists (select 1 from public.publication_post_events pe where pe.post_id = post) then
    perform private.enqueue_job('telegram.publish_post', jsonb_build_object('post_id', post, 'version', p.version),
      'telegram.publish_post:' || post || ':' || p.version, null, false,
      case when p.status = 'planned' then greatest(p.scheduled_for - now(), interval '0') else interval '0' end);
  end if;
end;
$$;
revoke all on function private.post_changed(uuid, boolean) from public, anon, authenticated;

-- Telegram: Comms confirms the post (after the preview); it then goes out at its time.
create or replace function public.confirm_post(post uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_comms();
  if not exists (select 1 from public.publication_posts p where p.id = post and p.channel = 'telegram' and p.status in ('planned', 'published')) then
    raise exception 'Only Telegram posts are confirmed for sending' using errcode = '22023';
  end if;
  perform private.post_changed(post, true);
  perform private.log_post(post, 'update', jsonb_build_object('confirmed', true));
end;
$$;

-- Telegram: publish now instead of at the planned time (the click is the confirmation).
create or replace function public.publish_post_now(post uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_comms();
  update public.publication_posts p set scheduled_for = least(p.scheduled_for, now())
  where p.id = post and p.channel = 'telegram' and p.status in ('planned', 'published');
  if not found then
    raise exception 'Only Telegram posts are published by the platform' using errcode = '22023';
  end if;
  perform private.post_changed(post, true);
  perform private.log_post(post, 'update', jsonb_build_object('publish_now', true, 'confirmed', true));
end;
$$;

-- One event on every required channel it is not planned or published on
-- yet, all on the same day; returns the new posts.
create or replace function public.plan_everywhere(event uuid, scheduled_for timestamptz)
returns setof uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  ch record;
  post uuid;
begin
  perform private.require_comms();
  perform private.check_post_event(event);
  for ch in
    select c.key from public.publication_channels c
    where c.required and c.enabled and c.schedulable
      and not exists (
        select 1 from public.publication_post_events pe join public.publication_posts p on p.id = pe.post_id
        where pe.event_id = event and p.channel = c.key and p.status <> 'skipped')
    order by c.position
  loop
    post := public.create_post(ch.key, scheduled_for, array[event]);
    return next post;
  end loop;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['confirm_post(uuid)', 'publish_post_now(uuid)', 'plan_everywhere(uuid, timestamptz)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- ── Uploaded pictures (kept until the post is published) ───────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('post-pictures', 'post-pictures', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- post-pictures/<post id>/<uuid>.<ext>: Comms uploads, reads (the preview) and removes.
create policy "Comms uploads post pictures"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'post-pictures' and public.has_role('comms'));
create policy "Comms reads post pictures"
  on storage.objects for select to authenticated
  using (bucket_id = 'post-pictures' and public.has_role('comms'));
create policy "Comms removes post pictures"
  on storage.objects for delete to authenticated
  using (bucket_id = 'post-pictures' and public.has_role('comms'));
