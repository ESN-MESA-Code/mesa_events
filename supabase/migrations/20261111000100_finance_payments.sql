-- ============================================================
-- MESA Events Platform – payments, budgets and tax (round 2026-11-11)
--
-- * payment_links: a PayPal.me link with an amount and a unique reference
--   (MESA-XXXXX) for an event, an office hour or nothing at all (merch).
--   The payer writes the reference into the PayPal note; the import finds
--   it and books the payment to the link's event and category.
-- * payment_imports / payments: PayPal activity downloads (CSV). Each
--   transaction once (by its transaction code); it is booked into the
--   ledger (finance_entries, with its PayPal fee as a second line), or
--   ignored (transfers to the bank account, holds …), or waits in Finance's
--   "To label" queue – with a suggestion when the import found one.
-- * pretix_orders: orders from pretix (CSV export or the REST API),
--   matched to events by the pretix event slug. Comms must paste the link
--   of the pretix page now; the slug is taken from it.
-- * budget_lines: planned income and spending per semester and category
--   (optionally per event); account_balances: bank balance snapshots.
-- * finance_categories.sphere: the tax sphere of a non-profit (ideeller
--   Bereich, Vermögensverwaltung, Zweckbetrieb, wirtschaftlicher
--   Geschäftsbetrieb) for the EÜR export.
-- Finance writes; Finance and executives read. Payment links are read by
-- every member (the staff of an office hour show their QR codes).
-- ============================================================

-- ── Tax spheres ─────────────────────────────────────────────────────────────
alter table public.finance_categories
  add column sphere text not null default 'ideell'
  constraint finance_categories_sphere_check check (sphere in ('ideell', 'vermoegen', 'zweckbetrieb', 'wirtschaftlich'));

update public.finance_categories set sphere = case
  when direction = 'income' and name in ('Event revenue') then 'zweckbetrieb'
  when direction = 'income' and name in ('ESNcard sales', 'Cash box takings') then 'wirtschaftlich'
  when direction = 'expense' and name in ('Event costs') then 'zweckbetrieb'
  when direction = 'expense' and name in ('Merchandise', 'ESNcards') then 'wirtschaftlich'
  else 'ideell' end;

insert into public.finance_categories (direction, name, sort, sphere) values
  ('income', 'Merchandise sales', 25, 'wirtschaftlich'),
  ('income', 'Donations', 45, 'ideell'),
  ('income', 'Interest', 60, 'vermoegen'),
  ('expense', 'Refunds', 15, 'zweckbetrieb')
on conflict do nothing;

-- ── Ledger lines from imported payments ─────────────────────────────────────
-- (payments is created below; the column is added after it.)

-- ── Payment links ───────────────────────────────────────────────────────────
create table public.payment_links (
  id                uuid primary key default gen_random_uuid(),
  -- MESA- and five letters/digits without 0, O, 1, I (read aloud, typed on a phone).
  reference         text not null unique constraint payment_links_reference_check check (reference ~ '^MESA-[2-9A-HJ-NP-Z]{5}$'),
  title             text not null constraint payment_links_title_check check (length(trim(title)) between 1 and 120),
  -- null: the payer enters the amount.
  amount_cents      integer constraint payment_links_amount_check check (amount_cents between 1 and 100000000),
  category_id       uuid not null references public.finance_categories(id) on delete restrict,
  event_id          uuid references public.events(id) on delete cascade,
  internal_event_id uuid references public.internal_events(id) on delete cascade,
  -- Presets: what the link is for, so "Create the usual links" does not create one twice.
  preset            text constraint payment_links_preset_check check (preset ~ '^[a-z_]{1,40}$'),
  note              text not null default '' constraint payment_links_note_check check (length(note) <= 500),
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  created_by        text default public.auth_email(),
  constraint payment_links_one_target check (num_nonnulls(event_id, internal_event_id) <= 1)
);
create index payment_links_event_idx on public.payment_links(event_id) where event_id is not null;
create index payment_links_internal_idx on public.payment_links(internal_event_id) where internal_event_id is not null;
create unique index payment_links_preset_idx on public.payment_links(coalesce(event_id, internal_event_id), preset) where preset is not null and (event_id is not null or internal_event_id is not null);

create or replace function private.guard_payment_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.finance_categories c where c.id = new.category_id and c.direction = 'income') then
    raise exception 'A payment link books income – pick an income category' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_payment_link() from public, anon, authenticated;
create trigger guard_payment_link before insert or update on public.payment_links for each row execute function private.guard_payment_link();

alter table public.payment_links enable row level security;
create policy "Members read payment links" on public.payment_links for select to authenticated using (public.is_workspace_member());
create policy "Finance creates payment links" on public.payment_links for insert to authenticated with check (public.has_role('finance'));
create policy "Finance changes payment links" on public.payment_links for update to authenticated using (public.has_role('finance')) with check (public.has_role('finance'));
create policy "Finance removes payment links" on public.payment_links for delete to authenticated using (public.has_role('finance'));
revoke all on public.payment_links from anon;

-- ── Imports and payments ────────────────────────────────────────────────────
create table public.payment_imports (
  id            uuid primary key default gen_random_uuid(),
  source        text not null constraint payment_imports_source_check check (source in ('paypal', 'pretix_csv', 'pretix_api')),
  filename      text not null default '' constraint payment_imports_filename_check check (length(filename) <= 200),
  period_from   date,
  period_to     date,
  rows_total    integer not null default 0,
  rows_new      integer not null default 0,
  rows_skipped  integer not null default 0,
  -- The PayPal balance after the last transaction of the file.
  balance_cents integer,
  balance_on    date,
  created_at    timestamptz not null default now(),
  created_by    text default public.auth_email()
);

create table public.payments (
  id                  uuid primary key default gen_random_uuid(),
  import_id           uuid references public.payment_imports(id) on delete set null,
  source              text not null default 'paypal' constraint payments_source_check check (source in ('paypal')),
  external_id         text not null constraint payments_external_id_check check (length(external_id) between 1 and 60),
  occurred_at         timestamptz not null,
  booked_on           date not null,
  type                text not null default '' constraint payments_type_check check (length(type) <= 120),
  name                text not null default '' constraint payments_name_check check (length(name) <= 200),
  email               text not null default '' constraint payments_email_check check (length(email) <= 200),
  -- Signed: incoming > 0, outgoing < 0. The fee as PayPal shows it (a charge < 0).
  gross_cents         integer not null constraint payments_gross_check check (gross_cents <> 0 and gross_cents between -100000000 and 100000000),
  fee_cents           integer not null default 0 constraint payments_fee_check check (fee_cents between -10000000 and 10000000),
  currency            text not null default 'EUR' constraint payments_currency_check check (currency ~ '^[A-Z]{3}$'),
  subject             text not null default '' constraint payments_subject_check check (length(subject) <= 500),
  note                text not null default '' constraint payments_note_check check (length(note) <= 1000),
  invoice             text not null default '' constraint payments_invoice_check check (length(invoice) <= 200),
  reference_txn       text not null default '' constraint payments_reference_txn_check check (length(reference_txn) <= 60),
  status              text not null default 'open' constraint payments_status_check check (status in ('open', 'booked', 'ignored')),
  -- What the import suggests for an open payment (Finance confirms).
  suggested_link_id   uuid references public.payment_links(id) on delete set null,
  suggested_category_id uuid references public.finance_categories(id) on delete set null,
  suggested_event_id  uuid references public.events(id) on delete set null,
  suggested_internal_event_id uuid references public.internal_events(id) on delete set null,
  suggestion          text not null default '' constraint payments_suggestion_check check (length(suggestion) <= 300),
  -- How it was booked.
  link_id             uuid references public.payment_links(id) on delete set null,
  matched_by          text constraint payments_matched_by_check check (matched_by in ('reference', 'pretix', 'suggestion', 'manual')),
  ignore_reason       text not null default '' constraint payments_ignore_reason_check check (length(ignore_reason) <= 200),
  decided_at          timestamptz,
  decided_by          text,
  -- When the matching last looked at it (null: still to match).
  checked_at          timestamptz,
  created_at          timestamptz not null default now(),
  constraint payments_external_unique unique (source, external_id)
);
create index payments_booked_on_idx on public.payments(booked_on);
create index payments_status_idx on public.payments(status) where status = 'open';
create index payments_email_idx on public.payments(lower(email)) where email <> '';

alter table public.finance_entries
  add column payment_id uuid references public.payments(id) on delete cascade,
  add column is_fee boolean not null default false;
create unique index finance_entries_payment_idx on public.finance_entries(payment_id, is_fee) where payment_id is not null;

-- Lines of an imported payment keep its amount, direction and date; category, event and text may change.
create or replace function private.guard_payment_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.payment_id is not null and (
    new.payment_id is distinct from old.payment_id or new.amount_cents <> old.amount_cents
    or new.direction <> old.direction or new.booked_on <> old.booked_on or new.is_fee <> old.is_fee
  ) then
    raise exception 'This line comes from an imported payment – unbook the payment instead' using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_payment_entry() from public, anon, authenticated;
create trigger guard_payment_entry before update on public.finance_entries for each row execute function private.guard_payment_entry();

-- Finance removes lines of imported payments by unbooking the payment.
drop policy "Finance removes entries" on public.finance_entries;
create policy "Finance removes entries" on public.finance_entries for delete to authenticated using (public.has_role('finance') and payment_id is null);

alter table public.payment_imports enable row level security;
alter table public.payments enable row level security;
create policy "Finance and executives read imports" on public.payment_imports for select to authenticated using (public.has_role('finance') or public.has_role('executive'));
create policy "Finance imports" on public.payment_imports for insert to authenticated with check (public.has_role('finance'));
create policy "Finance corrects imports" on public.payment_imports for update to authenticated using (public.has_role('finance')) with check (public.has_role('finance'));
create policy "Finance removes imports" on public.payment_imports for delete to authenticated using (public.has_role('finance'));
create policy "Finance and executives read payments" on public.payments for select to authenticated using (public.has_role('finance') or public.has_role('executive'));
create policy "Finance imports payments" on public.payments for insert to authenticated with check (public.has_role('finance') and status = 'open');
-- Suggestions only; booking and ignoring go through the functions below.
create policy "Finance updates suggestions" on public.payments for update to authenticated using (public.has_role('finance')) with check (public.has_role('finance'));
revoke all on public.payment_imports, public.payments from anon;
revoke delete on public.payments from authenticated;

create or replace function private.guard_payment_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Direct updates (PostgREST) may only change the suggestion; the functions set private.booking.
  if coalesce(current_setting('private.booking', true), '') <> 'on' and (
    new.status <> old.status or new.link_id is distinct from old.link_id or new.matched_by is distinct from old.matched_by
    or new.external_id <> old.external_id or new.gross_cents <> old.gross_cents or new.fee_cents <> old.fee_cents
    or new.booked_on <> old.booked_on or new.occurred_at <> old.occurred_at
  ) then
    raise exception 'Book or ignore a payment with its buttons' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_payment_update() from public, anon, authenticated;
create trigger guard_payment_update before update on public.payments for each row execute function private.guard_payment_update();

-- Books a payment: its gross amount as income (or spending) in a category,
-- optionally for an event or an internal event, and its PayPal fee as a
-- second line ("Bank and payment fees").
create or replace function public.book_payment(
  payment uuid,
  category uuid,
  event uuid default null,
  internal_event uuid default null,
  link uuid default null,
  description text default null,
  matched_by text default 'manual'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.payments;
  dir text;
  fee_category uuid;
  text_of text;
begin
  perform private.require_finance();
  if num_nonnulls(event, internal_event) > 1 then
    raise exception 'Book a payment to an event or an internal event, not both' using errcode = '22023';
  end if;
  if matched_by not in ('reference', 'pretix', 'suggestion', 'manual') then
    raise exception 'Unknown way of matching' using errcode = '22023';
  end if;
  select * into p from public.payments where id = payment for update;
  if p.id is null then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if p.status <> 'open' then
    raise exception 'This payment is booked or ignored already' using errcode = '22023';
  end if;
  dir := case when p.gross_cents > 0 then 'income' else 'expense' end;
  if not exists (select 1 from public.finance_categories c where c.id = category and c.direction = dir) then
    raise exception 'Pick a category for %', case when dir = 'income' then 'income' else 'spending' end using errcode = '22023';
  end if;
  text_of := coalesce(nullif(trim(description), ''), nullif(trim(p.subject), ''), nullif(trim(p.note), ''), nullif(trim(p.type), ''), 'PayPal payment');

  insert into public.finance_entries (direction, category_id, event_id, internal_event_id, amount_cents, booked_on, description, counterparty, payment_method, beleg_ref, beleg_received, note, payment_id, is_fee)
  values (dir, category, event, internal_event, abs(p.gross_cents), p.booked_on, left(text_of, 300), left(p.name, 200), 'paypal', left('PayPal ' || p.external_id, 100),
          -- An incoming PayPal payment is its own record; spending still needs the invoice.
          dir = 'income', left(trim(p.note), 1000), p.id, false);

  if p.fee_cents <> 0 then
    select c.id into fee_category from public.finance_categories c
    where c.direction = case when p.fee_cents < 0 then 'expense' else 'income' end
      and c.name = case when p.fee_cents < 0 then 'Bank and payment fees' else 'Other income' end;
    if fee_category is null then
      select c.id into fee_category from public.finance_categories c where c.direction = case when p.fee_cents < 0 then 'expense' else 'income' end order by c.sort, c.name limit 1;
    end if;
    insert into public.finance_entries (direction, category_id, event_id, internal_event_id, amount_cents, booked_on, description, counterparty, payment_method, beleg_ref, beleg_received, payment_id, is_fee)
    values (case when p.fee_cents < 0 then 'expense' else 'income' end, fee_category, event, internal_event, abs(p.fee_cents), p.booked_on,
            left('PayPal fee: ' || text_of, 300), 'PayPal', 'paypal', left('PayPal ' || p.external_id, 100), true, p.id, true);
  end if;

  perform set_config('private.booking', 'on', true);
  update public.payments set status = 'booked', link_id = link, matched_by = book_payment.matched_by, decided_at = now(), decided_by = public.auth_email()
  where id = p.id;
  perform set_config('private.booking', 'off', true);
end;
$$;

create or replace function public.unbook_payment(payment uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_finance();
  delete from public.finance_entries where payment_id = payment;
  perform set_config('private.booking', 'on', true);
  update public.payments set status = 'open', link_id = null, matched_by = null, ignore_reason = '', decided_at = null, decided_by = null
  where id = payment and status <> 'open';
  if not found then
    perform set_config('private.booking', 'off', true);
    raise exception 'This payment is open' using errcode = '22023';
  end if;
  perform set_config('private.booking', 'off', true);
end;
$$;

-- Transfers between MESA's own accounts, holds, private mistakes: not income or spending.
create or replace function public.ignore_payment(payment uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_finance();
  if length(trim(coalesce(reason, ''))) = 0 then
    raise exception 'Say why (e.g. "transfer to the bank account")' using errcode = '22023';
  end if;
  perform set_config('private.booking', 'on', true);
  update public.payments set status = 'ignored', ignore_reason = left(trim(reason), 200), decided_at = now(), decided_by = public.auth_email()
  where id = payment and status = 'open';
  if not found then
    perform set_config('private.booking', 'off', true);
    raise exception 'Only an open payment can be ignored' using errcode = '22023';
  end if;
  perform set_config('private.booking', 'off', true);
end;
$$;

revoke all on function public.book_payment(uuid, uuid, uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.unbook_payment(uuid) from public, anon;
revoke all on function public.ignore_payment(uuid, text) from public, anon;
grant execute on function public.book_payment(uuid, uuid, uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.unbook_payment(uuid) to authenticated;
grant execute on function public.ignore_payment(uuid, text) to authenticated;

-- ── pretix ──────────────────────────────────────────────────────────────────
-- The event's pretix event (its slug, "kayaking26" of https://pretix.eu/esn-mesa/kayaking26/).
alter table public.events
  add column pretix_slug text constraint events_pretix_slug_check check (pretix_slug ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$');
create unique index events_pretix_slug_idx on public.events(lower(pretix_slug)) where pretix_slug is not null;

-- The slug of a pretix link: the second part of the path (pretix.eu/<organizer>/<event>/),
-- or the only one (an organizer's own domain: tickets.example.org/<event>/). Mirrors lib/payments/pretix.ts.
create or replace function private.pretix_slug_of(link text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  path text;
  parts text[];
  slug text;
begin
  if link is null or link !~ '^https?://' then
    return null;
  end if;
  path := split_part(split_part(regexp_replace(link, '^https?://[^/]*', ''), '?', 1), '#', 1);
  parts := array_remove(string_to_array(path, '/'), '');
  slug := case when coalesce(array_length(parts, 1), 0) >= 2 then parts[2] when coalesce(array_length(parts, 1), 0) = 1 then parts[1] end;
  if slug is null or slug !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' then
    return null;
  end if;
  return slug;
end;
$$;
revoke all on function private.pretix_slug_of(text) from public, anon, authenticated;

-- The pretix links Comms pasted so far.
update public.events e set pretix_slug = s.slug
from (
  select distinct on (lower(private.pretix_slug_of(p.link))) pe.event_id, private.pretix_slug_of(p.link) as slug
  from public.publication_posts p
  join public.publication_post_events pe on pe.post_id = p.id
  where p.channel = 'pretix' and p.status = 'published' and private.pretix_slug_of(p.link) is not null
  order by lower(private.pretix_slug_of(p.link)), p.published_at
) s
where e.id = s.event_id;

-- Comms ticks the pretix page off only with its link now (Finance matches ticket sales by it).
create or replace function public.set_pretix_ready(event uuid, ready boolean, link text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  post uuid;
  clean text := nullif(trim(coalesce(set_pretix_ready.link, '')), '');
  slug text;
begin
  perform private.require_comms();
  if clean is not null and clean !~ '^https?://' then
    raise exception 'Paste the link of the pretix page (https://…)' using errcode = '22023';
  end if;
  if not exists (select 1 from public.publication_channels c where c.key = 'pretix' and c.enabled) then
    raise exception 'pretix is switched off (Admin → Publishing channels)' using errcode = '22023';
  end if;
  if ready then
    if clean is null then
      raise exception 'Paste the link of the pretix page – Finance matches the ticket sales to the event by it' using errcode = '22023';
    end if;
    slug := private.pretix_slug_of(clean);
    if slug is null then
      raise exception 'This is not the link of a pretix event page (https://pretix.eu/<organizer>/<event>/)' using errcode = '22023';
    end if;
    if exists (select 1 from public.events e where lower(e.pretix_slug) = lower(slug) and e.id <> event) then
      raise exception 'Another event has this pretix page already' using errcode = '22023';
    end if;
  end if;
  select p.id into post
  from public.publication_posts p
  join public.publication_post_events pe on pe.post_id = p.id
  where pe.event_id = event and p.channel = 'pretix' and p.status = 'published'
  order by p.published_at
  limit 1;

  if ready then
    update public.events e set pretix_slug = slug where e.id = event and e.pretix_slug is distinct from slug;
    update public.pretix_orders o set event_id = event where lower(o.event_slug) = lower(slug) and o.event_id is distinct from event;
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

create table public.pretix_orders (
  id               uuid primary key default gen_random_uuid(),
  import_id        uuid references public.payment_imports(id) on delete set null,
  event_slug       text not null constraint pretix_orders_slug_check check (event_slug ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  code             text not null constraint pretix_orders_code_check check (code ~ '^[A-Za-z0-9]{1,30}$'),
  event_id         uuid references public.events(id) on delete set null,
  status           text not null constraint pretix_orders_status_check check (status in ('paid', 'pending', 'canceled', 'expired')),
  email            text not null default '' constraint pretix_orders_email_check check (length(email) <= 200),
  name             text not null default '' constraint pretix_orders_name_check check (length(name) <= 200),
  total_cents      integer not null constraint pretix_orders_total_check check (total_cents between 0 and 100000000),
  fees_cents       integer not null default 0 constraint pretix_orders_fees_check check (fees_cents between -10000000 and 10000000),
  tickets          integer not null default 1 constraint pretix_orders_tickets_check check (tickets between 0 and 10000),
  provider         text not null default '' constraint pretix_orders_provider_check check (length(provider) <= 60),
  ordered_at       timestamptz,
  paid_on          date,
  -- The PayPal transaction it arrived as, or the ledger line it was booked with.
  payment_id       uuid references public.payments(id) on delete set null,
  finance_entry_id uuid references public.finance_entries(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index pretix_orders_code_idx on public.pretix_orders(lower(event_slug), upper(code));
create index pretix_orders_event_idx on public.pretix_orders(event_id) where event_id is not null;
create trigger pretix_orders_updated_at before update on public.pretix_orders for each row execute function public.set_updated_at();

alter table public.pretix_orders enable row level security;
create policy "Finance and executives read pretix orders" on public.pretix_orders for select to authenticated using (public.has_role('finance') or public.has_role('executive'));
create policy "Finance imports pretix orders" on public.pretix_orders for insert to authenticated with check (public.has_role('finance'));
create policy "Finance updates pretix orders" on public.pretix_orders for update to authenticated using (public.has_role('finance')) with check (public.has_role('finance'));
create policy "Finance removes pretix orders" on public.pretix_orders for delete to authenticated using (public.has_role('finance'));
revoke all on public.pretix_orders from anon;

-- Finance links a pretix event to an event (older events, or a link Comms got wrong).
create or replace function public.link_pretix_event(event uuid, slug text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  clean text := nullif(trim(coalesce(slug, '')), '');
begin
  perform private.require_finance();
  if clean is not null and clean !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' then
    raise exception 'A pretix event slug is letters, digits, dots and dashes' using errcode = '22023';
  end if;
  if clean is not null and exists (select 1 from public.events e where lower(e.pretix_slug) = lower(clean) and e.id <> event) then
    raise exception 'Another event has this pretix page already' using errcode = '22023';
  end if;
  update public.pretix_orders o set event_id = null where o.event_id = event;
  update public.events e set pretix_slug = clean where e.id = event;
  if not found then
    raise exception 'Not found' using errcode = 'P0002';
  end if;
  if clean is not null then
    update public.pretix_orders o set event_id = event where lower(o.event_slug) = lower(clean);
  end if;
end;
$$;

-- Books an event's paid pretix orders that did not come through PayPal
-- (bank transfer, card …) as one income line per payment provider.
create or replace function public.book_pretix_orders(event uuid, category uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  entry uuid;
  n integer := 0;
  title text;
begin
  perform private.require_finance();
  if not exists (select 1 from public.finance_categories c where c.id = category and c.direction = 'income') then
    raise exception 'Pick an income category' using errcode = '22023';
  end if;
  select e.title into title from public.events e where e.id = event;
  for r in
    select o.provider, sum(o.total_cents)::integer as cents, count(*)::integer as orders, max(coalesce(o.paid_on, o.ordered_at::date)) as last_day
    from public.pretix_orders o
    where o.event_id = event and o.status = 'paid' and o.total_cents > 0 and o.payment_id is null and o.finance_entry_id is null
      and lower(o.provider) not like '%paypal%'
    group by o.provider
  loop
    insert into public.finance_entries (direction, category_id, event_id, amount_cents, booked_on, description, counterparty, payment_method, beleg_ref, beleg_received, note)
    values ('income', category, event, r.cents, coalesce(r.last_day, current_date),
            left(format('Ticket sales (pretix, %s orders%s)', r.orders, case when r.provider <> '' then ', ' || r.provider else '' end), 300),
            'pretix',
            case when lower(r.provider) like '%bank%' then 'bank' when lower(r.provider) ~ 'stripe|card|sofort' then 'card' when lower(r.provider) ~ 'cash|box' then 'cash' else 'other' end,
            left('pretix ' || coalesce(title, ''), 100), true, 'Booked from the pretix orders')
    returning id into entry;
    update public.pretix_orders o set finance_entry_id = entry
    where o.event_id = event and o.status = 'paid' and o.total_cents > 0 and o.payment_id is null and o.finance_entry_id is null
      and o.provider is not distinct from r.provider;
    n := n + r.orders;
  end loop;
  return n;
end;
$$;

revoke all on function public.link_pretix_event(uuid, text) from public, anon;
revoke all on function public.book_pretix_orders(uuid, uuid) from public, anon;
grant execute on function public.link_pretix_event(uuid, text) to authenticated;
grant execute on function public.book_pretix_orders(uuid, uuid) to authenticated;

-- ── Budget and balances ─────────────────────────────────────────────────────
create table public.budget_lines (
  id           uuid primary key default gen_random_uuid(),
  -- "2026-2" = WiSe 26/27 (lib/internal.ts).
  semester     text not null constraint budget_lines_semester_check check (semester ~ '^\d{4}-[12]$'),
  category_id  uuid not null references public.finance_categories(id) on delete restrict,
  event_id     uuid references public.events(id) on delete cascade,
  label        text not null default '' constraint budget_lines_label_check check (length(label) <= 120),
  planned_cents integer not null constraint budget_lines_planned_check check (planned_cents between 0 and 100000000),
  note         text not null default '' constraint budget_lines_note_check check (length(note) <= 500),
  created_at   timestamptz not null default now(),
  created_by   text default public.auth_email(),
  updated_at   timestamptz not null default now(),
  updated_by   text
);
create index budget_lines_semester_idx on public.budget_lines(semester);
create trigger budget_lines_stamp before update on public.budget_lines for each row execute function private.stamp_updated_by();

create table public.account_balances (
  id         uuid primary key default gen_random_uuid(),
  account    text not null constraint account_balances_account_check check (account in ('bank', 'paypal', 'other')),
  as_of      date not null,
  cents      integer not null constraint account_balances_cents_check check (cents between -100000000 and 1000000000),
  note       text not null default '' constraint account_balances_note_check check (length(note) <= 300),
  created_at timestamptz not null default now(),
  created_by text default public.auth_email()
);
create index account_balances_idx on public.account_balances(account, as_of desc);

alter table public.budget_lines enable row level security;
alter table public.account_balances enable row level security;
create policy "Finance and executives read the budget" on public.budget_lines for select to authenticated using (public.has_role('finance') or public.has_role('executive'));
create policy "Finance plans" on public.budget_lines for insert to authenticated with check (public.has_role('finance'));
create policy "Finance changes the plan" on public.budget_lines for update to authenticated using (public.has_role('finance')) with check (public.has_role('finance'));
create policy "Finance removes budget lines" on public.budget_lines for delete to authenticated using (public.has_role('finance'));
create policy "Finance and executives read balances" on public.account_balances for select to authenticated using (public.has_role('finance') or public.has_role('executive'));
create policy "Finance notes balances" on public.account_balances for insert to authenticated with check (public.has_role('finance'));
create policy "Finance removes balances" on public.account_balances for delete to authenticated using (public.has_role('finance'));
revoke all on public.budget_lines, public.account_balances from anon;
revoke update on public.account_balances from authenticated;

-- Category spheres are Finance's to set (the generic update policy allows it already).

-- ── Settings: the PayPal.me name ────────────────────────────────────────────
create or replace function public.set_paypal_settings(handle text, account_name text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  h text := nullif(trim(coalesce(handle, '')), '');
begin
  perform private.require_finance();
  if h is not null and h !~ '^[A-Za-z0-9]{1,20}$' then
    raise exception 'The PayPal.me name is letters and digits only (paypal.me/<name>)' using errcode = '22023';
  end if;
  insert into public.app_settings (key, value, updated_by) values
    ('paypal_me_handle', to_jsonb(coalesce(h, '')), public.auth_email()),
    ('paypal_account_name', to_jsonb(left(trim(coalesce(account_name, '')), 120)), public.auth_email())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by;
end;
$$;
revoke all on function public.set_paypal_settings(text, text) from public, anon;
grant execute on function public.set_paypal_settings(text, text) to authenticated;

-- ── Reset demo data knows the new tables ────────────────────────────────────
create or replace function private.staging_wipe_lists()
returns table (table_name text, action text)
language sql
immutable
set search_path = ''
as $$
  select t, 'wipe' from unnest(array[
    'account_balances', 'activity_log', 'advertising_pictures', 'assignment_drop_reasons', 'assignments', 'attendance_lists', 'attendance_reports',
    'budget_lines', 'calendar_feeds',
    'cancellation_requests', 'cash_box_changes', 'cash_boxes', 'cash_reports', 'description_versions', 'descriptions',
    'esn_access_tokens', 'esn_uploads', 'event_chat_members', 'event_formats', 'event_ideas', 'event_photo_folders',
    'event_reports', 'event_series', 'event_stats', 'events', 'fake_chat_members', 'fake_chat_messages',
    'fake_chat_spaces', 'fake_directory_members', 'fake_drive_files', 'fake_drive_folders',
    'fake_telegram_messages', 'finance_entries', 'idea_partners', 'internal_attendance', 'internal_event_people', 'internal_events', 'jobs',
    'participants', 'payment_imports', 'payment_links', 'payments', 'payout_batches', 'payout_details', 'planning_cycles', 'preapprovals',
    'pretix_orders', 'profile_payout_details', 'publication_post_events', 'publication_posts', 'receipts',
    'reimbursements', 'reviews', 'trip_budgets', 'volunteer_blacklist', 'volunteer_choices', 'volunteer_responses'
  ]) as t
  union all
  -- reimbursement_policies/rules: versions after the first are removed;
  -- role_members: demo members' rows are removed.
  select t, 'keep' from unnest(array[
    'app_settings', 'event_categories', 'finance_categories', 'internal_kind_settings', 'organiser_acknowledgements', 'profiles',
    'publication_channels', 'reimbursement_policies', 'reimbursement_rules', 'role_members'
  ]) as t;
$$;
revoke all on function private.staging_wipe_lists() from public, anon, authenticated;
