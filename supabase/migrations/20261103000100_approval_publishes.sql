-- ============================================================
-- MESA Events Platform – an approved description goes to the Chat space by
-- itself (round 2026-11-03)
--
-- "Publish" means the event description in the event's Chat space; Comms
-- no longer clicks it. Approving a description requests the publication:
-- * at once when the event's Chat space is requested (the job posts it, or
--   edits the message already posted after a re-approval);
-- * else when the space is created (events.chat_space_name is set).
-- Descriptions approved before this round and never sent are sent now.
-- public.publish_description() stays (the same request, by hand).
-- ============================================================

-- Request the Chat publication of an approved description (idempotent: one coalescing job per event).
create or replace function private.request_description_publish(event uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.descriptions d where d.event_id = event and d.status = 'approved') then
    return;
  end if;
  if not exists (select 1 from public.events e where e.id = event and e.chat_space_requested_at is not null and e.status not in ('cancelled', 'dropped')) then
    return;
  end if;
  update public.descriptions set publish_requested_at = now() where event_id = event;
  perform private.enqueue_job('chat.publish_description', jsonb_build_object('event_id', event), 'chat.publish_description:' || event, event, true);
end;
$$;
revoke all on function private.request_description_publish(uuid) from public, anon, authenticated;

create or replace function public.review_description(event uuid, decision text, comment text, rendered text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.descriptions;
begin
  if not public.has_role('comms') then
    raise exception 'Only the Comms team reviews descriptions' using errcode = '42501';
  end if;
  if decision not in ('approved', 'changes_requested') then
    raise exception 'Unknown decision' using errcode = '22023';
  end if;
  select * into d from public.descriptions where event_id = event for update;
  if not found or d.status <> 'submitted' then
    raise exception 'This description is not waiting for review' using errcode = '22023';
  end if;
  if decision = 'changes_requested' and coalesce(trim(comment), '') = '' then
    raise exception 'Say what should change' using errcode = '22023';
  end if;
  if decision = 'approved' and (rendered is null or length(rendered) > 4096) then
    raise exception 'The approved text is missing or too long' using errcode = '22023';
  end if;
  insert into public.reviews (event_id, reviewer, decision, comment, version)
  values (event, public.auth_email(), decision, left(coalesce(comment, ''), 4000), d.version);
  if decision = 'approved' then
    update public.descriptions
    set status = 'approved', approved_fields = d.fields, approved_text = rendered, approved_at = now(), approved_by = public.auth_email()
    where event_id = event;
    insert into public.description_versions (event_id, version, kind, fields, text, created_by)
    values (event, d.version, 'approved', d.fields, rendered, public.auth_email());
    -- Approved = published to the Chat space (round 2026-11-03).
    perform private.request_description_publish(event);
  else
    update public.descriptions set status = 'changes_requested' where event_id = event;
  end if;
end;
$$;
revoke all on function public.review_description(uuid, text, text, text) from public, anon;
grant execute on function public.review_description(uuid, text, text, text) to authenticated;

-- The space exists now: an approved description waiting for it goes out.
create or replace function private.publish_when_space_exists()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.request_description_publish(new.id);
  return new;
end;
$$;
revoke all on function private.publish_when_space_exists() from public, anon, authenticated;

create trigger events_publish_when_space_exists
  after update of chat_space_name on public.events
  for each row
  when (old.chat_space_name is null and new.chat_space_name is not null)
  execute function private.publish_when_space_exists();

-- Approved before this round and never sent: send them now (upcoming events only).
do $$
declare
  ev uuid;
begin
  for ev in
    select d.event_id from public.descriptions d join public.events e on e.id = d.event_id
    where d.status = 'approved' and d.publish_requested_at is null and e.chat_space_requested_at is not null and e.starts_at > now()
  loop
    perform private.request_description_publish(ev);
  end loop;
end;
$$;
