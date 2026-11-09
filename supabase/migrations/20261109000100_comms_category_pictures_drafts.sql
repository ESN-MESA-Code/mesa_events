-- ============================================================
-- MESA Events Platform – Comms: category pictures, advertising drafts (round 2026-11-09)
--
-- * advertising_pictures.category_id: a default picture per event category
--   (hike, pub, city tour …). An event without its own picture takes its
--   format's, else its category's, else its type's.
-- * set_default_picture(format, type, picture, category): one of the three.
-- * private.check_post_event: a draft (its cycle is still being planned)
--   may be advertised once it is at most six weeks away – so an event early
--   next month can be advertised a month ahead, before its volunteer form
--   opens. Drafts further out stay off the schedule.
-- ============================================================

alter table public.advertising_pictures
  add column category_id uuid unique references public.event_categories(id) on delete cascade;
alter table public.advertising_pictures drop constraint advertising_pictures_one_key;
alter table public.advertising_pictures
  add constraint advertising_pictures_one_key check (num_nonnulls(format_id, event_type, category_id) = 1);

drop function if exists public.set_default_picture(uuid, text, text);

-- Set (or with an empty picture: remove) the default of a format, a category or a type.
create or replace function public.set_default_picture(format uuid, type text, picture text, category uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := nullif(trim(coalesce(set_default_picture.picture, '')), '');
begin
  perform private.require_comms();
  if num_nonnulls(format, type, category) <> 1 then
    raise exception 'A default picture is for a format, a category or a type' using errcode = '22023';
  end if;
  if format is not null and not exists (select 1 from public.event_formats f where f.id = format) then
    raise exception 'No such format' using errcode = '22023';
  end if;
  if category is not null and not exists (select 1 from public.event_categories c where c.id = category) then
    raise exception 'No such category' using errcode = '22023';
  end if;
  if type is not null and type not in ('standard', 'special', 'day_trip', 'weekend_trip') then
    raise exception 'No such event type' using errcode = '22023';
  end if;
  if clean is null then
    delete from public.advertising_pictures a
    where (format is not null and a.format_id = format)
       or (category is not null and a.category_id = category)
       or (type is not null and a.event_type = type::public.event_type);
  elsif format is not null then
    insert into public.advertising_pictures (format_id, picture) values (format, clean)
    on conflict (format_id) do update set picture = excluded.picture, updated_by = public.auth_email(), updated_at = now();
  elsif category is not null then
    insert into public.advertising_pictures (category_id, picture) values (category, clean)
    on conflict (category_id) do update set picture = excluded.picture, updated_by = public.auth_email(), updated_at = now();
  else
    insert into public.advertising_pictures (event_type, picture) values (type::public.event_type, clean)
    on conflict (event_type) do update set picture = excluded.picture, updated_by = public.auth_email(), updated_at = now();
  end if;
  perform private.log('advertising_pictures', coalesce(format::text, category::text, type), case when clean is null then 'delete' else 'update' end, null, null, jsonb_build_object('picture', clean));
end;
$$;
revoke all on function public.set_default_picture(uuid, text, text, uuid) from public, anon;
grant execute on function public.set_default_picture(uuid, text, text, uuid) to authenticated;

-- ── Advertising a month ahead ───────────────────────────────────────────────
create or replace function private.check_post_event(event uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.events e
    where e.id = event and e.source = 'platform'
      and (e.status in ('scheduled', 'confirmed', 'understaffed', 'completed')
           or (e.status = 'draft' and e.starts_at < now() + interval '42 days'))
  ) then
    raise exception 'This event cannot be published' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.check_post_event(uuid) from public, anon, authenticated;
