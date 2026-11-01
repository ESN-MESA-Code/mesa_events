-- ============================================================
-- MESA Events Platform – pretix as a checklist (round 2026-10-31)
--
-- pretix is no longer planned on the publishing schedule: Comms ticks it
-- off per event once the pretix page is up (with its link, optionally).
-- A tick is a published pretix post of the event (so publication_status,
-- the Chat space notice and the sign-up link of a Telegram bundle keep
-- working); taking the tick back removes it. Planned pretix posts go.
-- ============================================================

update public.publication_channels set schedulable = false where key = 'pretix';
delete from public.publication_posts where channel = 'pretix' and status = 'planned';

create or replace function public.set_pretix_ready(event uuid, ready boolean, link text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  post uuid;
  clean text := nullif(trim(coalesce(set_pretix_ready.link, '')), '');
begin
  perform private.require_comms();
  if clean is not null and clean !~ '^https?://' then
    raise exception 'Paste the link of the pretix page (https://…)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.publication_channels c where c.key = 'pretix' and c.enabled) then
    raise exception 'pretix is switched off (Admin → Publishing channels)' using errcode = '22023';
  end if;
  select p.id into post
  from public.publication_posts p
  join public.publication_post_events pe on pe.post_id = p.id
  where pe.event_id = event and p.channel = 'pretix' and p.status = 'published'
  order by p.published_at
  limit 1;

  if ready then
    if post is not null then
      update public.publication_posts p set link = clean where p.id = post and p.link is distinct from clean;
      if found then
        perform private.log_post(post, 'update', jsonb_build_object('link', clean));
      end if;
      return;
    end if;
    perform private.check_post_event(event);
    insert into public.publication_posts (channel, scheduled_for, status, link, published_at, published_by)
    values ('pretix', now(), 'published', clean, now(), public.auth_email())
    returning id into post;
    insert into public.publication_post_events (post_id, event_id) values (post, event);
    perform private.log_post(post, 'insert', jsonb_build_object('published', true));
    perform private.enqueue_job('chat.channel_published', jsonb_build_object('event_id', event, 'channel', 'pretix'),
      'chat.channel_published:pretix:' || event, event);
    return;
  end if;

  -- Not ready (after all): every pretix post of the event goes; a bundle only loses the event.
  for post in
    select p.id from public.publication_posts p join public.publication_post_events pe on pe.post_id = p.id
    where pe.event_id = event and p.channel = 'pretix' and p.status <> 'skipped'
  loop
    perform private.log_post(post, 'delete', '{}');
    delete from public.publication_post_events pe where pe.post_id = post and pe.event_id = event;
    delete from public.publication_posts p where p.id = post and not exists (select 1 from public.publication_post_events pe where pe.post_id = post);
  end loop;
end;
$$;
revoke all on function public.set_pretix_ready(uuid, boolean, text) from public, anon;
grant execute on function public.set_pretix_ready(uuid, boolean, text) to authenticated;
