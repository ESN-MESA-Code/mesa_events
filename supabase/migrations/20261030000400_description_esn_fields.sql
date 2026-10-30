-- ============================================================
-- MESA Events Platform – the ESN Activities details of a description
-- (round 2026-10-30)
--
-- The description step now also asks for what ESN Activities needs beyond
-- the text: the goal of the event and the accessibility and sustainability
-- ratings (next to the activity type and objectives). They are not part
-- of the published text, so changing only them keeps the description's
-- status (no new review).
-- ============================================================

create or replace function public.save_description(event uuid, patch jsonb)
returns table (version integer, status text, fields jsonb)
language plpgsql
security definer
set search_path = ''
as $$
declare
  esn_only text[] := array['esnType','esnObjectives','esnGoal','esnAccess','esnSustain'];
  allowed text[] := array['title','dateIso','time','venue','price','priceNote','hook','intro','program','bring',
                          'importantHeading','important','weather','closing'] || esn_only;
  clean jsonb;
  content_changed boolean;
  d public.descriptions;
begin
  if not public.can_edit_description(event) then
    raise exception 'Only the OC, Events and Comms edit this description' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events e where e.id = event and e.status not in ('dropped', 'cancelled')) then
    raise exception 'This event is not running' using errcode = '22023';
  end if;
  if jsonb_typeof(patch) <> 'object' then
    raise exception 'Invalid patch' using errcode = '22023';
  end if;
  select coalesce(jsonb_object_agg(k, v), '{}') into clean
  from jsonb_each(patch) as x(k, v)
  where k = any(allowed)
    and (jsonb_typeof(v) = 'string' and length(v #>> '{}') <= 6000 or (k = 'weather' and jsonb_typeof(v) = 'boolean'));
  content_changed := exists (select 1 from jsonb_object_keys(clean) k where not (k = any(esn_only)));

  insert into public.descriptions as t (event_id, fields, version, updated_at, updated_by)
  values (event, clean, 1, now(), public.auth_email())
  on conflict (event_id) do update set
    fields = t.fields || clean,
    version = t.version + 1,
    updated_at = now(),
    updated_by = public.auth_email(),
    status = case
      when not content_changed then t.status
      when t.status = 'submitted' and public.has_role('comms') then 'submitted'
      when t.status in ('submitted', 'approved', 'published') then 'draft'
      else t.status
    end
  returning * into d;
  return query select d.version, d.status, d.fields;
end;
$$;
