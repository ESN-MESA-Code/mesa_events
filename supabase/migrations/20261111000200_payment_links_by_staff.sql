-- ============================================================
-- MESA Events Platform – the OC makes the QR codes (round 2026-11-11 (2))
--
-- Finance used to create every PayPal link. Now the people on duty make
-- them where they need them – on the event's cash page or the office
-- hour's page: the OC and helpers (and Events / the internal planners,
-- and Finance) pick what they sell and set the amount; the reference is
-- made here and the category follows from what is sold (drinks and snacks
-- → cash box takings, tickets → event revenue, ESNcards → ESNcard sales,
-- anything else → other income). ESNcards stay one link each per office
-- hour (at the current price unless an amount is given). They switch their
-- links off and on; deleting stays with Finance.
-- ============================================================

create or replace function private.may_take_payments(target_event uuid, target_internal uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_role('finance')
      or (target_event is not null and (public.is_event_staff(target_event) or public.has_role('events')))
      or (target_internal is not null and (public.is_internal_staff(target_internal) or public.is_internal_planner()));
$$;
revoke all on function private.may_take_payments(uuid, uuid) from public, anon, authenticated;

create or replace function public.create_payment_link_here(
  target_event uuid default null,
  target_internal uuid default null,
  link_kind text default 'drinks',
  link_title text default null,
  link_cents integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  ik public.internal_kind;
  cat uuid;
  ref text;
  new_id uuid;
  card text := null;
  cents integer := link_cents;
  clean text := nullif(trim(coalesce(link_title, '')), '');
begin
  if num_nonnulls(target_event, target_internal) <> 1 then
    raise exception 'Name either an event or an office hour' using errcode = '22023';
  end if;
  if not private.may_take_payments(target_event, target_internal) then
    raise exception 'Only the OC and helpers make the QR codes of their event' using errcode = '42501';
  end if;
  if target_event is not null then
    if not exists (select 1 from public.events e where e.id = target_event and e.status not in ('draft', 'dropped')) then
      raise exception 'This event does not take place' using errcode = '22023';
    end if;
    if link_kind not in ('drinks', 'ticket', 'other') then
      raise exception 'At an event: drinks and snacks, a ticket or something else' using errcode = '22023';
    end if;
  else
    select e.kind into ik from public.internal_events e where e.id = target_internal and e.status = 'scheduled';
    if ik is null then
      raise exception 'This date does not take place' using errcode = '22023';
    end if;
    if link_kind in ('esncard_internal', 'esncard_external') and ik <> 'office_hour' then
      raise exception 'ESNcards are sold at office hours' using errcode = '22023';
    end if;
    if link_kind not in ('esncard_internal', 'esncard_external', 'drinks', 'other') then
      raise exception 'Unknown kind of payment' using errcode = '22023';
    end if;
  end if;
  if cents is not null and cents not between 1 and 100000000 then
    raise exception 'An amount is between € 0.01 and € 1,000,000' using errcode = '22023';
  end if;
  if clean is not null and length(clean) > 120 then
    raise exception 'Keep the name short (120 characters)' using errcode = '22023';
  end if;

  select c.id into cat from public.finance_categories c
  where c.direction = 'income' and c.name = case link_kind
    when 'drinks' then 'Cash box takings' when 'ticket' then 'Event revenue' when 'other' then 'Other income' else 'ESNcard sales' end;
  if cat is null then
    select c.id into cat from public.finance_categories c where c.direction = 'income' order by c.sort, c.name limit 1;
  end if;

  if link_kind in ('esncard_internal', 'esncard_external') then
    card := link_kind;
    if cents is null then
      select (s.value #>> '{}')::integer into cents from public.app_settings s
      where s.key = case when link_kind = 'esncard_internal' then 'esncard_price_internal_cents' else 'esncard_price_external_cents' end;
    end if;
    -- One link per card and office hour: an existing one takes the amount and is switched on again.
    select l.id, l.reference into new_id, ref from public.payment_links l where l.internal_event_id = target_internal and l.preset = link_kind;
    if new_id is not null then
      update public.payment_links l set amount_cents = coalesce(cents, l.amount_cents), active = true where l.id = new_id;
      return jsonb_build_object('id', new_id, 'reference', ref, 'existing', true);
    end if;
  end if;
  clean := coalesce(clean, case link_kind
    when 'drinks' then 'Drinks and snacks' when 'ticket' then 'Ticket' when 'esncard_internal' then 'ESNcard (member)'
    when 'esncard_external' then 'ESNcard' else 'Payment' end);

  for attempt in 1..8 loop
    ref := 'MESA-' || (select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::integer, 1), '') from generate_series(1, 5));
    begin
      insert into public.payment_links (reference, title, amount_cents, category_id, event_id, internal_event_id, preset)
      values (ref, clean, cents, cat, target_event, target_internal, card)
      returning id into new_id;
      return jsonb_build_object('id', new_id, 'reference', ref, 'existing', false);
    exception when unique_violation then
      -- The reference was taken (or a card link appeared meanwhile): try again.
      null;
    end;
  end loop;
  raise exception 'No free reference found – try again' using errcode = '55000';
end;
$$;

create or replace function public.set_payment_link_active(link uuid, on_off boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.payment_links;
begin
  select * into l from public.payment_links where id = link;
  if l.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if not (public.has_role('finance') or ((l.event_id is not null or l.internal_event_id is not null) and private.may_take_payments(l.event_id, l.internal_event_id))) then
    raise exception 'Only the OC and helpers of its event switch a link off' using errcode = '42501';
  end if;
  update public.payment_links set active = on_off where id = link;
end;
$$;

-- MESA's PayPal account (paypal.me/mesamunich) unless Finance set another one already.
insert into public.app_settings (key, value) values
  ('paypal_me_handle', to_jsonb('mesamunich'::text)),
  ('paypal_account_name', to_jsonb('ESN MESA e.V.'::text))
on conflict (key) do nothing;

revoke all on function public.create_payment_link_here(uuid, uuid, text, text, integer) from public, anon;
revoke all on function public.set_payment_link_active(uuid, boolean) from public, anon;
grant execute on function public.create_payment_link_here(uuid, uuid, text, text, integer) to authenticated;
grant execute on function public.set_payment_link_active(uuid, boolean) to authenticated;
