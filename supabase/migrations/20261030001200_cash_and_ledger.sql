-- ============================================================
-- MESA Events Platform – cash boxes and the finance ledger
-- (round 2026-10-30)
--
-- * cash_reports: one per office hour (or Stammtisch) and one per ESN
--   event that uses the cash box (drinks and the like). The OC and
--   helpers count the box before and after (notes and coins), office
--   hours count ESNcards sold (internal = members, external), and the
--   OC closes it ("sign off"): counts and sales are then fixed. Finance
--   checks it, reopens it, or books its takings into the ledger.
-- * finance_categories / finance_entries: Finance's ledger of other
--   income and spending (merch, an event's revenue, a Beleg paid
--   straight from the MESA bank account …), optionally per event.
--   Reimbursements stay in their own tables; the overview adds them.
-- Cash and ledger: Finance and executives see everything; the staff see
-- their own cash box; nobody else.
-- ============================================================

-- ── Cash reports ────────────────────────────────────────────────────────────
create table public.cash_reports (
  id                         uuid primary key default gen_random_uuid(),
  event_id                   uuid unique references public.events(id) on delete restrict,
  internal_event_id          uuid unique references public.internal_events(id) on delete restrict,
  -- Counts per denomination in cents: {"5000": 1, "200": 4}.
  opening_counts             jsonb not null default '{}',
  opening_cents              integer constraint cash_reports_opening_check check (opening_cents between 0 and 100000000),
  opening_counted_at         timestamptz,
  opening_counted_by         text,
  closing_counts             jsonb not null default '{}',
  closing_cents              integer constraint cash_reports_closing_check check (closing_cents between 0 and 100000000),
  closing_counted_at         timestamptz,
  closing_counted_by         text,
  esncards_internal          integer not null default 0 constraint cash_reports_cards_internal_check check (esncards_internal between 0 and 10000),
  esncards_external          integer not null default 0 constraint cash_reports_cards_external_check check (esncards_external between 0 and 10000),
  -- ESNcard prices when the box was opened (office hours), for the expected cash.
  card_price_internal_cents  integer constraint cash_reports_price_internal_check check (card_price_internal_cents between 0 and 100000),
  card_price_external_cents  integer constraint cash_reports_price_external_check check (card_price_external_cents between 0 and 100000),
  -- What was sold or paid out of the box (drinks, change …).
  note                       text not null default '' constraint cash_reports_note_check check (length(note) <= 1000),
  closed_at                  timestamptz,
  closed_by                  text,
  checked_at                 timestamptz,
  checked_by                 text,
  created_at                 timestamptz not null default now(),
  created_by                 text default public.auth_email(),
  updated_at                 timestamptz not null default now(),
  constraint cash_reports_one_target check (num_nonnulls(event_id, internal_event_id) = 1),
  constraint cash_reports_closed_check check ((closed_at is null) = (closed_by is null)),
  constraint cash_reports_closed_counted check (closed_at is null or (opening_cents is not null and closing_cents is not null)),
  constraint cash_reports_checked_check check (checked_at is null or closed_at is not null)
);
create trigger cash_reports_updated_at before update on public.cash_reports for each row execute function public.set_updated_at();

-- The total of a count; refuses anything that is not a euro note or coin.
create or replace function private.cash_total(counts jsonb)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  total bigint := 0;
begin
  if jsonb_typeof(counts) <> 'object' then
    raise exception 'A count is an object of denominations' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(counts) loop
    if k not in ('1', '2', '5', '10', '20', '50', '100', '200', '500', '1000', '2000', '5000', '10000', '20000', '50000') then
      raise exception 'Not a euro note or coin: %', k using errcode = '22023';
    end if;
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric) or (v #>> '{}')::numeric not between 0 and 100000 then
      raise exception 'A count is a whole number from 0 to 100000' using errcode = '22023';
    end if;
    total := total + k::bigint * (v #>> '{}')::bigint;
  end loop;
  if total > 100000000 then
    raise exception 'More than € 1,000,000 in the box?' using errcode = '22023';
  end if;
  return total::integer;
end;
$$;
revoke all on function private.cash_total(jsonb) from public, anon, authenticated;

create or replace function private.cash_report_staff(report public.cash_reports)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when report.event_id is not null then public.is_event_staff(report.event_id)
              else public.is_internal_staff(report.internal_event_id) end;
$$;

create or replace function private.cash_report_oc(report public.cash_reports)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when report.event_id is not null then public.is_event_oc(report.event_id)
              else public.is_internal_oc(report.internal_event_id) end;
$$;
revoke all on function private.cash_report_staff(public.cash_reports) from public, anon, authenticated;
revoke all on function private.cash_report_oc(public.cash_reports) from public, anon, authenticated;

alter table public.cash_reports enable row level security;
create policy "Finance, executives, the staff and their planners read cash reports"
  on public.cash_reports for select to authenticated
  using (
    public.has_role('finance') or public.has_role('executive')
    or (event_id is not null and (public.is_event_staff(event_id) or public.has_role('events')))
    or (internal_event_id is not null and (public.is_internal_staff(internal_event_id) or public.is_internal_planner()))
  );
revoke insert, update, delete, truncate on public.cash_reports from anon, authenticated;
revoke all on public.cash_reports from anon;

-- The staff start the cash box of their event or office hour (once).
create or replace function public.ensure_cash_report(event uuid default null, internal_event uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  id uuid;
  k public.internal_kind;
begin
  if num_nonnulls(event, internal_event) <> 1 then
    raise exception 'Name either an event or an internal event' using errcode = '22023';
  end if;
  if event is not null then
    if not public.is_event_staff(event) then
      raise exception 'Only the event''s OC and helpers count its cash box' using errcode = '42501';
    end if;
    if exists (select 1 from public.events e where e.id = event and e.status in ('draft', 'dropped')) then
      raise exception 'This event does not take place' using errcode = '22023';
    end if;
    select r.id into id from public.cash_reports r where r.event_id = event;
    if id is null then
      insert into public.cash_reports (event_id) values (event) on conflict (event_id) do nothing returning cash_reports.id into id;
      if id is null then select r.id into id from public.cash_reports r where r.event_id = event; end if;
    end if;
    return id;
  end if;
  if not public.is_internal_staff(internal_event) then
    raise exception 'Only the OC and helpers count the cash box' using errcode = '42501';
  end if;
  select kind into k from public.internal_events e where e.id = internal_event;
  select r.id into id from public.cash_reports r where r.internal_event_id = internal_event;
  if id is null then
    insert into public.cash_reports (internal_event_id, card_price_internal_cents, card_price_external_cents)
    values (
      internal_event,
      case when k = 'office_hour' then (select (s.value #>> '{}')::integer from public.app_settings s where s.key = 'esncard_price_internal_cents') end,
      case when k = 'office_hour' then (select (s.value #>> '{}')::integer from public.app_settings s where s.key = 'esncard_price_external_cents') end
    )
    on conflict (internal_event_id) do nothing returning cash_reports.id into id;
    if id is null then select r.id into id from public.cash_reports r where r.internal_event_id = internal_event; end if;
  end if;
  return id;
end;
$$;

-- An open report the signed-in member may count (staff), locked for update.
create or replace function private.open_report_for_staff(report uuid)
returns public.cash_reports
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cash_reports;
begin
  select * into r from public.cash_reports where id = report for update;
  if r.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if not private.cash_report_staff(r) then
    raise exception 'Only the OC and helpers count the cash box' using errcode = '42501';
  end if;
  if r.closed_at is not null then
    raise exception 'The cash box was signed off – ask Finance to reopen it' using errcode = '22023';
  end if;
  return r;
end;
$$;
revoke all on function private.open_report_for_staff(uuid) from public, anon, authenticated;

create or replace function public.save_cash_count(report uuid, phase text, counts jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cash_reports := private.open_report_for_staff(report);
  total integer := private.cash_total(counts);
  clean jsonb;
begin
  -- Keep only the denominations counted.
  select coalesce(jsonb_object_agg(key, value), '{}') into clean from jsonb_each(counts) where (value #>> '{}')::integer > 0;
  if phase = 'opening' then
    update public.cash_reports set opening_counts = clean, opening_cents = total, opening_counted_at = now(), opening_counted_by = public.auth_email() where id = r.id;
  elsif phase = 'closing' then
    update public.cash_reports set closing_counts = clean, closing_cents = total, closing_counted_at = now(), closing_counted_by = public.auth_email() where id = r.id;
  else
    raise exception 'Count the box at the opening or the closing' using errcode = '22023';
  end if;
  return total;
end;
$$;

-- ESNcards sold at an office hour, counted up and down from several phones at once.
create or replace function public.bump_esncards(report uuid, card text, delta integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cash_reports := private.open_report_for_staff(report);
  out public.cash_reports;
begin
  if r.internal_event_id is null or not exists (select 1 from public.internal_events e where e.id = r.internal_event_id and e.kind = 'office_hour') then
    raise exception 'ESNcards are sold at office hours' using errcode = '22023';
  end if;
  if delta not between -50 and 50 or delta = 0 then
    raise exception 'Count one card at a time' using errcode = '22023';
  end if;
  if card = 'internal' then
    update public.cash_reports set esncards_internal = greatest(0, esncards_internal + delta) where id = r.id returning * into out;
  elsif card = 'external' then
    update public.cash_reports set esncards_external = greatest(0, esncards_external + delta) where id = r.id returning * into out;
  else
    raise exception 'An ESNcard is internal or external' using errcode = '22023';
  end if;
  return jsonb_build_object('internal', out.esncards_internal, 'external', out.esncards_external);
end;
$$;

create or replace function public.set_cash_note(report uuid, note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cash_reports := private.open_report_for_staff(report);
begin
  update public.cash_reports set note = left(coalesce(set_cash_note.note, ''), 1000) where id = r.id;
end;
$$;

-- The OC signs off: counts and sales are final.
create or replace function public.close_cash_report(report uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cash_reports := private.open_report_for_staff(report);
begin
  if not private.cash_report_oc(r) then
    raise exception 'Only the OC signs off the cash box' using errcode = '42501';
  end if;
  if r.opening_cents is null or r.closing_cents is null then
    raise exception 'Count the box before and after first' using errcode = '22023';
  end if;
  update public.cash_reports set closed_at = now(), closed_by = public.auth_email() where id = r.id;
end;
$$;

revoke all on function public.ensure_cash_report(uuid, uuid) from public, anon;
revoke all on function public.save_cash_count(uuid, text, jsonb) from public, anon;
revoke all on function public.bump_esncards(uuid, text, integer) from public, anon;
revoke all on function public.set_cash_note(uuid, text) from public, anon;
revoke all on function public.close_cash_report(uuid) from public, anon;
grant execute on function public.ensure_cash_report(uuid, uuid) to authenticated;
grant execute on function public.save_cash_count(uuid, text, jsonb) to authenticated;
grant execute on function public.bump_esncards(uuid, text, integer) to authenticated;
grant execute on function public.set_cash_note(uuid, text) to authenticated;
grant execute on function public.close_cash_report(uuid) to authenticated;

-- ── Ledger ──────────────────────────────────────────────────────────────────
create table public.finance_categories (
  id         uuid primary key default gen_random_uuid(),
  direction  text not null constraint finance_categories_direction_check check (direction in ('income', 'expense')),
  name       text not null constraint finance_categories_name_check check (length(trim(name)) between 1 and 80),
  active     boolean not null default true,
  sort       smallint not null default 100,
  created_at timestamptz not null default now()
);
create unique index finance_categories_name_idx on public.finance_categories(direction, lower(name));

insert into public.finance_categories (direction, name, sort) values
  ('income', 'Event revenue', 10),
  ('income', 'ESNcard sales', 20),
  ('income', 'Cash box takings', 30),
  ('income', 'Membership fees', 40),
  ('income', 'Sponsoring and grants', 50),
  ('income', 'Other income', 90),
  ('expense', 'Event costs', 10),
  ('expense', 'Merchandise', 20),
  ('expense', 'ESNcards', 30),
  ('expense', 'Office and supplies', 40),
  ('expense', 'Travel and conferences', 50),
  ('expense', 'Bank and payment fees', 60),
  ('expense', 'Other spending', 90);

create table public.finance_entries (
  id                uuid primary key default gen_random_uuid(),
  direction         text not null constraint finance_entries_direction_check check (direction in ('income', 'expense')),
  category_id       uuid not null references public.finance_categories(id) on delete restrict,
  event_id          uuid references public.events(id) on delete restrict,
  internal_event_id uuid references public.internal_events(id) on delete restrict,
  -- Takings booked from a signed-off cash box (once).
  cash_report_id    uuid unique references public.cash_reports(id) on delete restrict,
  amount_cents      integer not null constraint finance_entries_amount_check check (amount_cents between 1 and 100000000),
  booked_on         date not null,
  description       text not null constraint finance_entries_description_check check (length(trim(description)) between 1 and 300),
  counterparty      text not null default '' constraint finance_entries_counterparty_check check (length(counterparty) <= 200),
  payment_method    text not null default 'bank' constraint finance_entries_method_check check (payment_method in ('bank', 'cash', 'paypal', 'card', 'other')),
  -- The paper Beleg: its number or reference, and whether Finance has it.
  beleg_ref         text not null default '' constraint finance_entries_beleg_ref_check check (length(beleg_ref) <= 100),
  beleg_received    boolean not null default false,
  note              text not null default '' constraint finance_entries_note_check check (length(note) <= 1000),
  created_at        timestamptz not null default now(),
  created_by        text default public.auth_email(),
  updated_at        timestamptz not null default now(),
  updated_by        text,
  constraint finance_entries_one_target check (num_nonnulls(event_id, internal_event_id) <= 1)
);
create index finance_entries_booked_on_idx on public.finance_entries(booked_on);
create index finance_entries_event_idx on public.finance_entries(event_id) where event_id is not null;
create trigger finance_entries_stamp before update on public.finance_entries for each row execute function private.stamp_updated_by();

create or replace function private.guard_finance_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.finance_categories c where c.id = new.category_id and c.direction = new.direction) then
    raise exception 'The category is for the other direction' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_finance_entry() from public, anon, authenticated;
create trigger guard_finance_entry before insert or update on public.finance_entries for each row execute function private.guard_finance_entry();

alter table public.finance_categories enable row level security;
alter table public.finance_entries enable row level security;
create policy "Finance and executives read categories" on public.finance_categories for select to authenticated
  using (public.has_role('finance') or public.has_role('executive'));
create policy "Finance adds categories" on public.finance_categories for insert to authenticated with check (public.has_role('finance'));
create policy "Finance changes categories" on public.finance_categories for update to authenticated
  using (public.has_role('finance')) with check (public.has_role('finance'));
revoke delete, truncate on public.finance_categories from anon, authenticated;

create policy "Finance and executives read the ledger" on public.finance_entries for select to authenticated
  using (public.has_role('finance') or public.has_role('executive'));
create policy "Finance books entries" on public.finance_entries for insert to authenticated with check (public.has_role('finance'));
create policy "Finance corrects entries" on public.finance_entries for update to authenticated
  using (public.has_role('finance')) with check (public.has_role('finance'));
create policy "Finance removes entries" on public.finance_entries for delete to authenticated using (public.has_role('finance'));
revoke all on public.finance_categories, public.finance_entries from anon;

-- ── Finance on cash reports ─────────────────────────────────────────────────
create or replace function public.check_cash_report(report uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_finance();
  update public.cash_reports set checked_at = now(), checked_by = public.auth_email()
  where id = report and closed_at is not null and checked_at is null;
  if not found then
    raise exception 'Only a signed-off cash box can be checked (once)' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.reopen_cash_report(report uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_finance();
  if exists (select 1 from public.finance_entries f where f.cash_report_id = report) then
    raise exception 'Its takings are booked – remove the ledger entry first' using errcode = '22023';
  end if;
  update public.cash_reports set closed_at = null, closed_by = null, checked_at = null, checked_by = null
  where id = report and closed_at is not null;
  if not found then
    raise exception 'This cash box is open' using errcode = '22023';
  end if;
end;
$$;

-- Books a signed-off box's takings (closing − opening) as income.
create or replace function public.book_cash_report(report uuid, category uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.cash_reports;
  takings integer;
  what text;
  day date;
  id uuid;
begin
  perform private.require_finance();
  select * into r from public.cash_reports where cash_reports.id = report for update;
  if r.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if r.closed_at is null then
    raise exception 'The OC has not signed off this cash box' using errcode = '22023';
  end if;
  takings := r.closing_cents - r.opening_cents;
  if takings <= 0 then
    raise exception 'No takings to book (the box holds no more than at the start)' using errcode = '22023';
  end if;
  if r.event_id is not null then
    select 'Cash box: ' || e.title, (e.starts_at at time zone 'Europe/Berlin')::date into what, day from public.events e where e.id = r.event_id;
  else
    select 'Cash box: ' || e.title, (e.starts_at at time zone 'Europe/Berlin')::date into what, day from public.internal_events e where e.id = r.internal_event_id;
  end if;
  insert into public.finance_entries (direction, category_id, event_id, internal_event_id, cash_report_id, amount_cents, booked_on, description, payment_method)
  values ('income', category, r.event_id, r.internal_event_id, r.id, takings, day, left(what, 300), 'cash')
  returning finance_entries.id into id;
  return id;
end;
$$;

-- ESNcard prices (the expected cash of an office hour).
create or replace function public.set_esncard_prices(internal_cents integer, external_cents integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_finance();
  if internal_cents not between 0 and 100000 or external_cents not between 0 and 100000 then
    raise exception 'A price is between € 0 and € 1,000' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value, updated_by) values
    ('esncard_price_internal_cents', to_jsonb(internal_cents), public.auth_email()),
    ('esncard_price_external_cents', to_jsonb(external_cents), public.auth_email())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.check_cash_report(uuid) from public, anon;
revoke all on function public.reopen_cash_report(uuid) from public, anon;
revoke all on function public.book_cash_report(uuid, uuid) from public, anon;
revoke all on function public.set_esncard_prices(integer, integer) from public, anon;
grant execute on function public.check_cash_report(uuid) to authenticated;
grant execute on function public.reopen_cash_report(uuid) to authenticated;
grant execute on function public.book_cash_report(uuid, uuid) to authenticated;
grant execute on function public.set_esncard_prices(integer, integer) to authenticated;
