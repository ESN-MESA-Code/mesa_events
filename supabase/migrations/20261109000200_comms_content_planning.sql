-- ============================================================
-- MESA Events Platform – Comms content planning (round 2026-11-09)
--
-- Comms planned in a spreadsheet next to the schedule: a task list (what,
-- post / story / reel, deadline, who, status, caption and Canva link) and a
-- month calendar with posts that advertise no single event ("This week
-- 9–15", the month's calendar, awareness, recaps). The schedule takes that
-- over:
-- * publication_posts: title, format (post / story / reel), assignees (up
--   to three Comms members), progress (to do → in progress → ready, while
--   planned), caption, design_link.
-- * A post may have no event when it has a title – not on Telegram (its
--   messages are made from event descriptions).
-- * update_post_content(): those fields; it does not touch the version or
--   the Telegram confirmation (none of them goes into a Telegram message).
-- * comms_team(): who can be assigned.
-- ============================================================

alter table public.publication_posts
  add column title       text constraint publication_posts_title_check check (title is null or length(trim(title)) between 1 and 120),
  add column format      text constraint publication_posts_format_check check (format is null or format in ('post', 'story', 'reel')),
  add column assignees   text[] not null default '{}' constraint publication_posts_assignees_check check (cardinality(assignees) <= 3),
  add column progress    text not null default 'todo' constraint publication_posts_progress_check check (progress in ('todo', 'in_progress', 'ready')),
  add column caption     text not null default '' constraint publication_posts_caption_check check (length(caption) <= 2200),
  add column design_link text constraint publication_posts_design_link_check check (design_link is null or (design_link ~ '^https?://' and length(design_link) <= 500));
create index publication_posts_assignees_idx on public.publication_posts using gin (assignees);

-- ── Who can be assigned ─────────────────────────────────────────────────────
create or replace function public.comms_team()
returns table (email text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct r.email, coalesce(nullif(p.full_name, ''), split_part(r.email, '@', 1))
  from public.role_members r
  left join public.profiles p on p.email = r.email
  where r.role = 'comms'
    and (public.has_role('comms') or public.has_role('events') or public.has_role('executive'))
  order by 2;
$$;
revoke all on function public.comms_team() from public, anon;
grant execute on function public.comms_team() to authenticated;

-- ── A post with or without events ───────────────────────────────────────────
drop function if exists public.create_post(text, timestamptz, uuid[]);

create or replace function public.create_post(channel text, scheduled_for timestamptz, events uuid[], title text default null, format text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  post uuid;
  ev uuid;
  i integer := 0;
  clean_title text := nullif(trim(coalesce(create_post.title, '')), '');
begin
  perform private.require_comms();
  if not exists (select 1 from public.publication_channels c where c.key = channel and c.enabled and c.schedulable) then
    raise exception 'This channel is not on the schedule' using errcode = '22023';
  end if;
  if coalesce(array_length(events, 1), 0) = 0 then
    if clean_title is null then
      raise exception 'A post needs an event or a title' using errcode = '22023';
    end if;
    if channel = 'telegram' then
      raise exception 'A Telegram post is made from its events – add an event' using errcode = '22023';
    end if;
  end if;
  insert into public.publication_posts (channel, scheduled_for, title, format)
  values (channel, scheduled_for, clean_title, create_post.format) returning id into post;
  foreach ev in array coalesce(events, '{}') loop
    perform private.check_post_event(ev);
    insert into public.publication_post_events (post_id, event_id, position) values (post, ev, i) on conflict do nothing;
    i := i + 1;
  end loop;
  perform private.post_changed(post);
  perform private.log_post(post, 'insert', '{}');
  return post;
end;
$$;
revoke all on function public.create_post(text, timestamptz, uuid[], text, text) from public, anon;
grant execute on function public.create_post(text, timestamptz, uuid[], text, text) to authenticated;

-- Removing the last event deletes the post – unless it has a title of its own (and is not on Telegram).
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
  if not exists (select 1 from public.publication_post_events where post_id = post)
     and not exists (select 1 from public.publication_posts p where p.id = post and p.title is not null and p.channel <> 'telegram') then
    delete from public.publication_posts where id = post;
  else
    perform private.post_changed(post);
  end if;
end;
$$;

-- ── What, who, how far, the caption and the design ──────────────────────────
create or replace function public.update_post_content(post uuid, title text, format text, assignees text[], progress text, caption text, design_link text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean_title text := nullif(trim(coalesce(update_post_content.title, '')), '');
  who text[] := array(select distinct lower(trim(a)) from unnest(coalesce(update_post_content.assignees, '{}')) a where trim(a) <> '');
  stranger text;
begin
  perform private.require_comms();
  if not exists (select 1 from public.publication_posts p where p.id = post) then
    raise exception 'No such post' using errcode = '22023';
  end if;
  if clean_title is null and not exists (select 1 from public.publication_post_events pe where pe.post_id = post) then
    raise exception 'A post without events needs a title' using errcode = '22023';
  end if;
  select w into stranger from unnest(who) w where not exists (select 1 from public.role_members r where r.email = w and r.role = 'comms') limit 1;
  if stranger is not null then
    raise exception '% is not in the Comms team', stranger using errcode = '22023';
  end if;
  update public.publication_posts p set
    title = clean_title,
    format = nullif(update_post_content.format, ''),
    assignees = who,
    progress = coalesce(nullif(update_post_content.progress, ''), 'todo'),
    caption = trim(coalesce(update_post_content.caption, '')),
    design_link = nullif(trim(coalesce(update_post_content.design_link, '')), '')
  where p.id = post;
  perform private.log_post(post, 'update', jsonb_build_object('content', true, 'progress', update_post_content.progress, 'assignees', to_jsonb(who)));
end;
$$;
revoke all on function public.update_post_content(uuid, text, text, text[], text, text, text) from public, anon;
grant execute on function public.update_post_content(uuid, text, text, text[], text, text, text) to authenticated;
