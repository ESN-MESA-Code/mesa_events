-- ============================================================
-- MESA Events Platform – publishing channels and the publishing schedule
-- (brief 2026-10-29, part E: docs/BRIEF-2026-10-29-publishing.md)
--
-- * publication_channels: the channels as data (Chat space, Telegram,
--   Instagram, pretix, ESN Activities), kind auto | manual, enabled by an
--   admin; "schedulable" ones get a lane on the schedule board.
-- * publication_posts + publication_post_events: a post on a channel at a
--   time, with one event or a bundle of several (ordered); planned →
--   published (when, who, link) or skipped (reason). Comms only, through
--   the functions below; Events and executives read; members nothing.
-- * Telegram posts publish themselves: every planned Telegram post has a
--   job telegram.publish_post with run_after = its time and the idempotency
--   key telegram.publish_post:<post>:<version>; any change bumps the
--   version (a new job; the old one sees the version and skips). A
--   published post that changes is re-published at once (the job edits the
--   same messages). Manual channels are marked published with a link.
-- * publication_status(events): per event and channel – published,
--   planned, skipped or not planned – derived from the posts, the Chat
--   publication of the description and the ESN Activities link.
-- * The first publication of an event on a channel is told in its Chat
--   space, once (chat.channel_published:<channel>:<event>).
-- Every change is logged per event of the post.
-- ============================================================

-- ── Channels ────────────────────────────────────────────────────────────────
create table public.publication_channels (
  key         text primary key constraint publication_channels_key_check check (key ~ '^[a-z][a-z0-9_]{1,30}$'),
  name        text not null,
  -- auto: the platform publishes (jobs); manual: Comms publishes elsewhere and records it.
  kind        text not null constraint publication_channels_kind_check check (kind in ('auto', 'manual')),
  -- A lane on the schedule board (Chat and ESN Activities follow their own flows).
  schedulable boolean not null default true,
  enabled     boolean not null default true,
  position    smallint not null default 0
);
insert into public.publication_channels (key, name, kind, schedulable, position) values
  ('chat', 'Chat space', 'auto', false, 0),
  ('telegram', 'Telegram', 'auto', true, 1),
  ('instagram', 'Instagram', 'manual', true, 2),
  ('pretix', 'pretix', 'manual', true, 3),
  ('esn', 'ESN Activities', 'manual', false, 4);

alter table public.publication_channels enable row level security;
create policy "Members read the channels" on public.publication_channels for select to authenticated using (public.is_workspace_member());
revoke insert, update, delete, truncate on public.publication_channels from anon, authenticated;
revoke all on public.publication_channels from anon;

create or replace function public.set_channel_enabled(channel text, enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('admin') then
    raise exception 'Only admins switch channels on or off' using errcode = '42501';
  end if;
  update public.publication_channels set enabled = set_channel_enabled.enabled where key = channel;
  if not found then
    raise exception 'No such channel' using errcode = '22023';
  end if;
  perform private.log('publication_channels', channel, 'update', null, null, jsonb_build_object('enabled', enabled));
end;
$$;
revoke all on function public.set_channel_enabled(text, boolean) from public, anon;
grant execute on function public.set_channel_enabled(text, boolean) to authenticated;

-- ── Posts ───────────────────────────────────────────────────────────────────
create table public.publication_posts (
  id            uuid primary key default gen_random_uuid(),
  channel       text not null references public.publication_channels(key),
  scheduled_for timestamptz not null,
  status        text not null default 'planned' constraint publication_posts_status_check check (status in ('planned', 'published', 'skipped')),
  link          text constraint publication_posts_link_check check (link is null or link ~ '^https?://'),
  -- Telegram: a Drive file link or an image URL.
  picture       text constraint publication_posts_picture_check check (picture is null or length(picture) <= 500),
  note          text not null default '' constraint publication_posts_note_check check (length(note) <= 500),
  skip_reason   text constraint publication_posts_skip_check check (length(skip_reason) <= 300),
  -- Bumped on every change: the Telegram job of an older version skips itself.
  version       integer not null default 1,
  published_at  timestamptz,
  published_by  text,
  -- Telegram: the posted messages (ids, layout), so re-publishing edits them.
  telegram      jsonb,
  last_error    text,
  created_by    text default public.auth_email(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index publication_posts_scheduled_idx on public.publication_posts(scheduled_for);
create trigger publication_posts_updated_at before update on public.publication_posts for each row execute function public.set_updated_at();

create table public.publication_post_events (
  post_id  uuid not null references public.publication_posts(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete cascade,
  position smallint not null default 0,
  primary key (post_id, event_id)
);
create index publication_post_events_event_idx on public.publication_post_events(event_id);

alter table public.publication_posts enable row level security;
alter table public.publication_post_events enable row level security;
create policy "Comms, Events and executives read posts" on public.publication_posts for select to authenticated
  using (public.has_role('comms') or public.has_role('events') or public.has_role('executive'));
create policy "Comms, Events and executives read post events" on public.publication_post_events for select to authenticated
  using (public.has_role('comms') or public.has_role('events') or public.has_role('executive'));
revoke insert, update, delete, truncate on public.publication_posts, public.publication_post_events from anon, authenticated;
revoke all on public.publication_posts, public.publication_post_events from anon;

alter publication supabase_realtime add table public.publication_posts;
alter publication supabase_realtime add table public.publication_post_events;

-- ── Helpers ─────────────────────────────────────────────────────────────────
create or replace function private.require_comms()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_role('comms') then
    raise exception 'Only the Comms team plans publications' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_comms() from public, anon, authenticated;

-- One log entry per event of the post (so each event's activity shows it).
create or replace function private.log_post(post uuid, action text, details jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.publication_posts;
  ev record;
begin
  select * into p from public.publication_posts where id = post;
  for ev in select pe.event_id, e.cycle_id from public.publication_post_events pe join public.events e on e.id = pe.event_id where pe.post_id = post loop
    perform private.log('publication_posts', post::text, action, ev.event_id, ev.cycle_id,
      jsonb_build_object('channel', p.channel, 'scheduled_for', p.scheduled_for, 'status', p.status) || coalesce(details, '{}'));
  end loop;
end;
$$;
revoke all on function private.log_post(uuid, text, jsonb) from public, anon, authenticated;

-- After a change: a new version; Telegram posts get their job for it
-- (at the planned time, or at once when already published: the job edits).
create or replace function private.post_changed(post uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.publication_posts;
begin
  update public.publication_posts set version = version + 1, last_error = null where id = post returning * into p;
  if p.channel = 'telegram' and p.status in ('planned', 'published')
     and exists (select 1 from public.publication_post_events pe where pe.post_id = post) then
    perform private.enqueue_job('telegram.publish_post', jsonb_build_object('post_id', post, 'version', p.version),
      'telegram.publish_post:' || post || ':' || p.version, null, false,
      case when p.status = 'planned' then greatest(p.scheduled_for - now(), interval '0') else interval '0' end);
  end if;
end;
$$;
revoke all on function private.post_changed(uuid) from public, anon, authenticated;

create or replace function private.check_post_event(event uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.events e where e.id = event and e.status in ('scheduled', 'confirmed', 'understaffed', 'completed') and e.source = 'platform') then
    raise exception 'This event cannot be published' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.check_post_event(uuid) from public, anon, authenticated;

-- ── What Comms does on the board ────────────────────────────────────────────
create or replace function public.create_post(channel text, scheduled_for timestamptz, events uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  post uuid;
  ev uuid;
  i integer := 0;
begin
  perform private.require_comms();
  if not exists (select 1 from public.publication_channels c where c.key = channel and c.enabled and c.schedulable) then
    raise exception 'This channel is not on the schedule' using errcode = '22023';
  end if;
  if coalesce(array_length(events, 1), 0) = 0 then
    raise exception 'A post needs an event' using errcode = '22023';
  end if;
  insert into public.publication_posts (channel, scheduled_for) values (channel, scheduled_for) returning id into post;
  foreach ev in array events loop
    perform private.check_post_event(ev);
    insert into public.publication_post_events (post_id, event_id, position) values (post, ev, i) on conflict do nothing;
    i := i + 1;
  end loop;
  perform private.post_changed(post);
  perform private.log_post(post, 'insert', '{}');
  return post;
end;
$$;

-- Bundle: add an event to a post (at the end), or move it to `position`.
create or replace function public.add_to_post(post uuid, event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_comms();
  perform private.check_post_event(event);
  if not exists (select 1 from public.publication_posts p where p.id = post and p.status <> 'skipped') then
    raise exception 'No such post' using errcode = '22023';
  end if;
  insert into public.publication_post_events (post_id, event_id, position)
  values (post, event, coalesce((select max(position) + 1 from public.publication_post_events where post_id = post), 0))
  on conflict do nothing;
  perform private.post_changed(post);
  perform private.log_post(post, 'update', jsonb_build_object('added', event));
end;
$$;

-- Take an event out; a post without events is deleted.
create or replace function public.remove_from_post(post uuid, event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_comms();
  perform private.log_post(post, 'update', jsonb_build_object('removed', event));
  delete from public.publication_post_events where post_id = post and event_id = event;
  if not exists (select 1 from public.publication_post_events where post_id = post) then
    delete from public.publication_posts where id = post;
  else
    perform private.post_changed(post);
  end if;
end;
$$;

create or replace function public.reorder_post(post uuid, events uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  i integer;
begin
  perform private.require_comms();
  for i in 1 .. coalesce(array_length(events, 1), 0) loop
    update public.publication_post_events set position = i - 1 where post_id = post and event_id = events[i];
  end loop;
  perform private.post_changed(post);
  perform private.log_post(post, 'update', jsonb_build_object('reordered', true));
end;
$$;

create or replace function public.move_post(post uuid, scheduled_for timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_comms();
  update public.publication_posts p set scheduled_for = move_post.scheduled_for where p.id = post and p.status = 'planned';
  if not found then
    raise exception 'Only planned posts move' using errcode = '22023';
  end if;
  perform private.post_changed(post);
  perform private.log_post(post, 'update', jsonb_build_object('moved', true));
end;
$$;

-- Picture (Telegram) and note; a published Telegram post is edited at once.
create or replace function public.edit_post(post uuid, picture text, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_comms();
  update public.publication_posts p set picture = nullif(trim(coalesce(edit_post.picture, '')), ''), note = trim(coalesce(edit_post.note, ''))
  where p.id = post and p.status <> 'skipped';
  if not found then
    raise exception 'No such post' using errcode = '22023';
  end if;
  perform private.post_changed(post);
  perform private.log_post(post, 'update', jsonb_build_object('edited', true));
end;
$$;

-- Telegram: publish now instead of at the planned time.
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
  perform private.post_changed(post);
  perform private.log_post(post, 'update', jsonb_build_object('publish_now', true));
end;
$$;

-- Manual channels: Comms published it elsewhere and pastes the link.
create or replace function public.mark_post_published(post uuid, link text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.publication_posts;
  ev uuid;
begin
  perform private.require_comms();
  select * into p from public.publication_posts where id = post;
  if not found or p.status = 'skipped' then
    raise exception 'No such post' using errcode = '22023';
  end if;
  if (select kind from public.publication_channels where key = p.channel) <> 'manual' then
    raise exception 'The platform publishes this channel itself' using errcode = '22023';
  end if;
  if coalesce(link, '') !~ '^https?://' then
    raise exception 'Paste the link of the published post' using errcode = '22023';
  end if;
  update public.publication_posts set status = 'published', link = trim(mark_post_published.link), published_at = coalesce(published_at, now()),
    published_by = public.auth_email() where id = post;
  perform private.log_post(post, 'update', jsonb_build_object('published', true));
  for ev in select event_id from public.publication_post_events where post_id = post loop
    perform private.enqueue_job('chat.channel_published', jsonb_build_object('event_id', ev, 'channel', p.channel),
      'chat.channel_published:' || p.channel || ':' || ev, ev);
  end loop;
end;
$$;

create or replace function public.skip_post(post uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_comms();
  if coalesce(trim(reason), '') = '' then
    raise exception 'Give a reason, e.g. "no pretix for free events"' using errcode = '22023';
  end if;
  update public.publication_posts set status = 'skipped', skip_reason = left(trim(reason), 300) where id = post and status = 'planned';
  if not found then
    raise exception 'Only planned posts are skipped' using errcode = '22023';
  end if;
  perform private.post_changed(post);
  perform private.log_post(post, 'update', jsonb_build_object('skipped', reason));
end;
$$;

create or replace function public.delete_post(post uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_comms();
  if not exists (select 1 from public.publication_posts where id = post and status <> 'published') then
    raise exception 'Published posts stay (they are the record)' using errcode = '22023';
  end if;
  perform private.log_post(post, 'delete', '{}');
  delete from public.publication_posts where id = post;
end;
$$;

-- The Telegram job reports back (service role).
create or replace function public.post_published(post uuid, version integer, telegram jsonb, link text, by_whom text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.publication_posts;
  ev uuid;
  first boolean;
begin
  select * into p from public.publication_posts where id = post for update;
  if not found or p.version <> post_published.version then
    return false;
  end if;
  first := p.status <> 'published';
  update public.publication_posts set status = 'published', telegram = post_published.telegram, link = coalesce(nullif(post_published.link, ''), publication_posts.link),
    published_at = coalesce(published_at, now()), published_by = coalesce(published_by, by_whom), last_error = null where id = post;
  if first then
    for ev in select event_id from public.publication_post_events where post_id = post loop
      perform private.log(  'publication_posts', post::text, 'update', ev, null, jsonb_build_object('channel', p.channel, 'published', true));
      perform private.enqueue_job('chat.channel_published', jsonb_build_object('event_id', ev, 'channel', p.channel),
        'chat.channel_published:' || p.channel || ':' || ev, ev);
    end loop;
  end if;
  return true;
end;
$$;
revoke all on function public.post_published(uuid, integer, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.post_published(uuid, integer, jsonb, text, text) to service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'create_post(text, timestamptz, uuid[])', 'add_to_post(uuid, uuid)', 'remove_from_post(uuid, uuid)', 'reorder_post(uuid, uuid[])',
    'move_post(uuid, timestamptz)', 'edit_post(uuid, text, text)', 'publish_post_now(uuid)', 'mark_post_published(uuid, text)',
    'skip_post(uuid, text)', 'delete_post(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end;
$$;

-- ── Status per event and channel ────────────────────────────────────────────
create or replace function public.publication_status(events uuid[])
returns table (event_id uuid, channel text, state text, at timestamptz, link text, by_whom text, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  with ev as (
    select e.id, e.chat_space_url from public.events e
    where e.id = any(events) and (public.is_team() or public.is_event_staff(e.id))
  ),
  posts as (
    select pe.event_id, p.channel, p.status, p.scheduled_for, p.published_at, p.link, p.published_by, p.skip_reason,
           row_number() over (partition by pe.event_id, p.channel
             order by case p.status when 'published' then 0 when 'planned' then 1 else 2 end,
                      case when p.status = 'planned' then p.scheduled_for end asc,
                      p.published_at desc) as rank
    from public.publication_post_events pe
    join public.publication_posts p on p.id = pe.post_id
    where pe.event_id = any(events)
  )
  select ev.id, c.key,
         case
           when c.key = 'chat' then case when d.published_at is not null then 'published' when d.status = 'approved' then 'planned' else 'not_planned' end
           when c.key = 'esn' then case when u.event_id is not null then 'published' else 'not_planned' end
           else coalesce(p.status, 'not_planned')
         end,
         case
           when c.key = 'chat' then d.published_at
           when c.key = 'esn' then u.uploaded_at
           else coalesce(p.published_at, p.scheduled_for)
         end,
         case when c.key = 'chat' then case when d.published_at is not null then ev.chat_space_url end when c.key = 'esn' then u.activity_url else p.link end,
         case when c.key = 'chat' then d.published_by when c.key = 'esn' then u.uploaded_by else p.published_by end,
         case when c.key not in ('chat', 'esn') then p.skip_reason end
  from ev
  cross join public.publication_channels c
  left join public.descriptions d on d.event_id = ev.id
  left join public.esn_uploads u on u.event_id = ev.id
  left join posts p on p.event_id = ev.id and p.channel = c.key and p.rank = 1
  where c.enabled
  order by ev.id, c.position;
$$;
revoke all on function public.publication_status(uuid[]) from public, anon;
grant execute on function public.publication_status(uuid[]) to authenticated;

-- ── Fake Telegram (lib/telegram/fakes.ts; service role only) ───────────────
create table public.fake_telegram_messages (
  id         bigint generated always as identity primary key,
  chat_id    text not null,
  message_id integer not null,
  thread_id  integer,
  kind       text not null constraint fake_telegram_kind_check check (kind in ('text', 'photo')),
  text       text not null default '',
  photo      text,
  edits      integer not null default 0,
  deleted    boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chat_id, message_id)
);
alter table public.fake_telegram_messages enable row level security;
revoke all on public.fake_telegram_messages from anon, authenticated;

-- ── Activity log: the event's staff read their event's publication entries ──
drop policy "Log entries by what they describe" on public.activity_log;
create policy "Log entries by what they describe"
  on public.activity_log for select to authenticated
  using (
    case
      when entity = 'reimbursements' then public.has_role('finance') or public.has_role('executive')
      else public.has_role('events') or public.has_role('executive') or public.has_role('admin')
        or (entity in ('esn_uploads', 'publication_posts') and public.has_role('comms'))
        or (event_id is not null
            and entity in ('events', 'assignments', 'descriptions', 'reviews', 'attendance_lists', 'event_photo_folders', 'event_reports', 'publication_posts')
            and public.is_event_staff(event_id))
    end
  );
