-- ============================================================
-- MESA Events Platform – hand-in and reimbursements
--
-- * reimbursement_policies / reimbursement_rules: versioned data (SPEC
--   table = version 1). Only the Treasurer publishes a new version; claims
--   keep the version they were calculated with.
-- * receipts: what an OC or helper bought (kind, amount, vendor, optional
--   reference photo in the private "receipts" bucket). The paper Beleg is
--   mandatory (German law) – the platform only tracks it.
-- * reimbursements: one claim per receipt. Status: not_submitted (Beleg
--   not handed in) → beleg_received (who/when) → checked → paid, or
--   rejected. Suggested amount by public.suggest_reimbursement() (mirrors
--   lib/reimbursement.ts); Finance confirms or overrides.
-- * payout_details: IBAN / PayPal, only Finance and the claimant, deleted
--   when the claim is paid or rejected.
-- * payout_batches: one per month; checked claims join the month's batch;
--   claims above €100 can be paid early.
-- * preapprovals: weekend-trip further expenses, decided by the Treasurer.
-- * trip_budgets: social ancillary costs of a weekend trip, set before it.
-- * event_photos: hand-in photos, uploaded to Drive by a job.
-- Receipts, claims and bank details: Finance and the claimant only.
-- ============================================================

-- ── Policies ────────────────────────────────────────────────────────────────
create table public.reimbursement_policies (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique constraint reimbursement_policies_version_check check (version > 0),
  effective_from date not null,
  notes          text not null default '' constraint reimbursement_policies_notes_check check (length(notes) <= 2000),
  created_by     text,
  created_at     timestamptz not null default now()
);

create table public.reimbursement_rules (
  id                   uuid primary key default gen_random_uuid(),
  policy_id            uuid not null references public.reimbursement_policies(id) on delete cascade,
  event_type           text not null constraint reimbursement_rules_event_type_check check (event_type in ('standard', 'special', 'day_trip', 'weekend_trip', 'any')),
  expense_kind         text not null constraint reimbursement_rules_kind_check
    check (expense_kind in ('ticket', 'food_allowance', 'ancillary', 'travel_accommodation', 'further_expenses', 'social_ancillary')),
  category             text not null constraint reimbursement_rules_category_check check (category in ('team_costs', 'ancillary_costs')),
  oc_rate_bp           integer not null constraint reimbursement_rules_oc_rate_check check (oc_rate_bp between 0 and 10000),
  helper_rate_bp       integer not null constraint reimbursement_rules_helper_rate_check check (helper_rate_bp between 0 and 10000),
  oc_cap_cents         integer constraint reimbursement_rules_oc_cap_check check (oc_cap_cents >= 0),
  helper_cap_cents     integer constraint reimbursement_rules_helper_cap_check check (helper_cap_cents >= 0),
  per_day              boolean not null default false,
  requires_preapproval boolean not null default false,
  within_trip_budget   boolean not null default false,
  condition_note       text not null default '' constraint reimbursement_rules_note_check check (length(condition_note) <= 500),
  unique (policy_id, event_type, expense_kind)
);

-- Version 1: the SPEC table (keep in step with SPEC_RULES in lib/reimbursement.ts).
with p as (
  insert into public.reimbursement_policies (version, effective_from, notes, created_by)
  values (1, '2026-01-01', 'Initial rules from the MESA Events Platform spec', 'treasurer')
  returning id
)
insert into public.reimbursement_rules
  (policy_id, event_type, expense_kind, category, oc_rate_bp, oc_cap_cents, helper_rate_bp, helper_cap_cents, per_day, requires_preapproval, within_trip_budget, condition_note)
select p.id, r.* from p, (values
  ('standard', 'ticket', 'team_costs', 10000, 1600, 5000, 800, false, false, false, ''),
  ('special', 'ticket', 'team_costs', 10000, null, 5000, null, false, false, false, ''),
  ('day_trip', 'food_allowance', 'team_costs', 10000, 1600, 10000, 800, false, false, false, 'ideally one receipt'),
  ('any', 'ancillary', 'ancillary_costs', 10000, null, 10000, null, false, false, false, ''),
  ('weekend_trip', 'travel_accommodation', 'team_costs', 10000, null, 5000, null, false, false, false, ''),
  ('weekend_trip', 'food_allowance', 'team_costs', 10000, 1600, 10000, 800, true, false, false, ''),
  ('weekend_trip', 'further_expenses', 'team_costs', 10000, null, 5000, null, false, true, false, 'Treasurer pre-approval before purchase'),
  ('weekend_trip', 'social_ancillary', 'ancillary_costs', 10000, null, 10000, null, false, false, true, 'within a trip budget set before the trip')
) as r (event_type, expense_kind, category, oc_rate_bp, oc_cap_cents, helper_rate_bp, helper_cap_cents, per_day, requires_preapproval, within_trip_budget, condition_note);

alter table public.reimbursement_policies enable row level security;
alter table public.reimbursement_rules enable row level security;
-- Everyone sees the rules (transparency); only the Treasurer changes them (publish_policy()).
create policy "Members read policies" on public.reimbursement_policies for select to authenticated using (public.is_workspace_member());
create policy "Members read rules" on public.reimbursement_rules for select to authenticated using (public.is_workspace_member());
revoke insert, update, delete, truncate on public.reimbursement_policies, public.reimbursement_rules from anon, authenticated;
revoke all on public.reimbursement_policies, public.reimbursement_rules from anon;

-- The policy in force on a day: the newest version effective by then.
create or replace function public.policy_for(day date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select id from public.reimbursement_policies where effective_from <= day order by version desc limit 1;
$$;
revoke all on function public.policy_for(date) from public;
grant execute on function public.policy_for(date) to authenticated;

-- The Treasurer publishes a new version (all rules at once; the old version stays for its claims).
create or replace function public.publish_policy(rules jsonb, effective_from date, notes text default '')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_version integer;
  new_policy uuid;
begin
  if not exists (select 1 from public.role_members r where r.email = public.auth_email() and r.role = 'treasurer')
     or not public.is_workspace_member() then
    raise exception 'Only the Treasurer edits reimbursement rules' using errcode = '42501';
  end if;
  if jsonb_typeof(rules) <> 'array' or jsonb_array_length(rules) = 0 or jsonb_array_length(rules) > 50 then
    raise exception 'A policy needs its rules' using errcode = '22023';
  end if;
  select coalesce(max(version), 0) + 1 into next_version from public.reimbursement_policies;
  insert into public.reimbursement_policies (version, effective_from, notes, created_by)
  values (next_version, effective_from, left(coalesce(notes, ''), 2000), public.auth_email())
  returning id into new_policy;
  insert into public.reimbursement_rules
    (policy_id, event_type, expense_kind, category, oc_rate_bp, oc_cap_cents, helper_rate_bp, helper_cap_cents, per_day, requires_preapproval, within_trip_budget, condition_note)
  select new_policy, x.event_type, x.expense_kind, x.category, x.oc_rate_bp, x.oc_cap_cents, x.helper_rate_bp, x.helper_cap_cents,
         coalesce(x.per_day, false), coalesce(x.requires_preapproval, false), coalesce(x.within_trip_budget, false), coalesce(x.condition_note, '')
  from jsonb_to_recordset(rules) as x (
    event_type text, expense_kind text, category text, oc_rate_bp integer, oc_cap_cents integer, helper_rate_bp integer,
    helper_cap_cents integer, per_day boolean, requires_preapproval boolean, within_trip_budget boolean, condition_note text
  );
  perform private.log('reimbursement_policies', new_policy::text, 'publish', null, null, jsonb_build_object('version', next_version));
  return next_version;
end;
$$;
revoke all on function public.publish_policy(jsonb, date, text) from public, anon;
grant execute on function public.publish_policy(jsonb, date, text) to authenticated;

-- ── The formula (mirrors suggestAmount() in lib/reimbursement.ts) ────────────
create or replace function public.suggest_reimbursement(
  rule uuid, claim_role text, amount_cents integer, days integer default null,
  preapproved boolean default false, budget_left_cents integer default null
)
returns table (suggested_cents integer, flags text[])
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  r public.reimbursement_rules;
  rate integer;
  base integer;
  cap integer;
  s integer;
  f text[] := '{}';
begin
  select * into r from public.reimbursement_rules where id = rule;
  if not found then
    raise exception 'No such rule' using errcode = '22023';
  end if;
  if amount_cents is null or amount_cents < 0 then
    raise exception 'The amount must not be negative' using errcode = '22023';
  end if;
  rate := case when claim_role = 'oc' then r.oc_rate_bp else r.helper_rate_bp end;
  base := ((amount_cents::bigint * rate + 5000) / 10000)::integer;
  cap := case when claim_role = 'oc' then r.oc_cap_cents else r.helper_cap_cents end;
  if cap is not null and r.per_day then
    cap := cap * greatest(1, coalesce(days, 1));
  end if;
  s := case when cap is null then base else least(base, cap) end;
  if cap is not null and base > cap then
    f := array_append(f, 'capped');
  end if;
  if r.requires_preapproval and not coalesce(preapproved, false) then
    f := array_append(f, 'needs_preapproval');
    s := 0;
  end if;
  if r.within_trip_budget then
    if budget_left_cents is null then
      f := array_append(f, 'no_trip_budget');
      s := 0;
    elsif s > greatest(0, budget_left_cents) then
      f := array_append(f, 'over_trip_budget');
      s := greatest(0, budget_left_cents);
    end if;
  end if;
  return query select s, f;
end;
$$;
revoke all on function public.suggest_reimbursement(uuid, text, integer, integer, boolean, integer) from public, anon;
grant execute on function public.suggest_reimbursement(uuid, text, integer, integer, boolean, integer) to authenticated;

-- ── Pre-approvals and trip budgets ──────────────────────────────────────────
create table public.preapprovals (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  requester_id    uuid not null references public.profiles(id) on delete cascade,
  description     text not null constraint preapprovals_description_check check (length(description) between 1 and 1000),
  estimated_cents integer not null constraint preapprovals_estimate_check check (estimated_cents between 0 and 10000000),
  status          text not null default 'requested' constraint preapprovals_status_check check (status in ('requested', 'approved', 'rejected')),
  decided_by      text,
  decided_at      timestamptz,
  note            text not null default '' constraint preapprovals_note_check check (length(note) <= 1000),
  created_at      timestamptz not null default now()
);

create table public.trip_budgets (
  event_id     uuid primary key references public.events(id) on delete cascade,
  amount_cents integer not null constraint trip_budgets_amount_check check (amount_cents between 0 and 10000000),
  note         text not null default '' constraint trip_budgets_note_check check (length(note) <= 500),
  set_by       text,
  set_at       timestamptz not null default now()
);

-- ── Payout batches ──────────────────────────────────────────────────────────
create table public.payout_batches (
  id         uuid primary key default gen_random_uuid(),
  month      date not null unique constraint payout_batches_month_check check (extract(day from month) = 1),
  status     text not null default 'open' constraint payout_batches_status_check check (status in ('open', 'paid')),
  paid_at    timestamptz,
  paid_by    text,
  created_at timestamptz not null default now()
);

-- ── Receipts and claims ─────────────────────────────────────────────────────
create table public.receipts (
  id                uuid primary key default gen_random_uuid(),
  event_id          uuid not null references public.events(id) on delete restrict,
  claimant_id       uuid not null references public.profiles(id) on delete restrict,
  expense_kind      text not null constraint receipts_kind_check
    check (expense_kind in ('ticket', 'food_allowance', 'ancillary', 'travel_accommodation', 'further_expenses', 'social_ancillary')),
  description       text not null default '' constraint receipts_description_check check (length(description) <= 500),
  vendor            text not null constraint receipts_vendor_check check (length(vendor) between 1 and 200),
  amount_cents      integer not null constraint receipts_amount_check check (amount_cents between 1 and 10000000),
  purchased_on      date not null,
  -- Days covered by a per-day allowance.
  days              smallint constraint receipts_days_check check (days between 1 and 31),
  -- Optional photo of the receipt: a path in the private "receipts" bucket.
  reference_path    text constraint receipts_reference_check check (reference_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|pdf)$'),
  beleg_received_at timestamptz,
  beleg_received_by text,
  created_at        timestamptz not null default now(),
  constraint receipts_beleg_check check ((beleg_received_at is null) = (beleg_received_by is null))
);
create index receipts_event_idx on public.receipts(event_id);

create table public.reimbursements (
  id               uuid primary key default gen_random_uuid(),
  receipt_id       uuid not null unique references public.receipts(id) on delete restrict,
  event_id         uuid not null references public.events(id) on delete restrict,
  claimant_id      uuid not null references public.profiles(id) on delete restrict,
  claimant_role    text not null constraint reimbursements_role_check check (claimant_role in ('oc', 'helper')),
  category         text not null constraint reimbursements_category_check check (category in ('team_costs', 'ancillary_costs')),
  policy_id        uuid not null references public.reimbursement_policies(id),
  policy_version   integer not null,
  rule_id          uuid not null references public.reimbursement_rules(id),
  suggested_cents  integer not null constraint reimbursements_suggested_check check (suggested_cents >= 0),
  flags            text[] not null default '{}',
  approved_cents   integer constraint reimbursements_approved_check check (approved_cents between 0 and 10000000),
  status           text not null default 'not_submitted'
    constraint reimbursements_status_check check (status in ('not_submitted', 'beleg_received', 'checked', 'paid', 'rejected')),
  payout_method    text constraint reimbursements_method_check check (payout_method in ('bank', 'paypal')),
  preapproval_id   uuid references public.preapprovals(id),
  early_payout     boolean not null default false,
  batch_id         uuid references public.payout_batches(id),
  finance_note     text not null default '' constraint reimbursements_note_check check (length(finance_note) <= 1000),
  checked_at       timestamptz,
  checked_by       text,
  paid_at          timestamptz,
  paid_by          text,
  rejected_reason  text constraint reimbursements_rejected_check check (length(rejected_reason) <= 1000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index reimbursements_event_idx on public.reimbursements(event_id);
create index reimbursements_claimant_idx on public.reimbursements(claimant_id);
create index reimbursements_batch_idx on public.reimbursements(batch_id);
create trigger reimbursements_updated_at before update on public.reimbursements for each row execute function public.set_updated_at();
create trigger log_reimbursements after insert or update on public.reimbursements for each row execute function private.log_row_change();

-- Bank details apart, so nothing else carries them.
create table public.payout_details (
  reimbursement_id uuid primary key references public.reimbursements(id) on delete cascade,
  account_holder   text constraint payout_details_holder_check check (length(account_holder) between 1 and 200),
  iban             text constraint payout_details_iban_check check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  paypal_email     text constraint payout_details_paypal_check check (paypal_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(paypal_email) <= 200),
  constraint payout_details_one_way check ((iban is not null) <> (paypal_email is not null))
);

-- ── Hand-in photos ──────────────────────────────────────────────────────────
create table public.event_photos (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  storage_path  text not null unique,
  file_name     text not null constraint event_photos_name_check check (length(file_name) between 1 and 200),
  mime_type     text not null constraint event_photos_mime_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic')),
  size_bytes    integer not null constraint event_photos_size_check check (size_bytes between 1 and 15728640),
  uploaded_by   text,
  status        text not null default 'pending' constraint event_photos_status_check check (status in ('pending', 'uploaded')),
  drive_file_id text,
  drive_url     text,
  created_at    timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.preapprovals enable row level security;
alter table public.trip_budgets enable row level security;
alter table public.payout_batches enable row level security;
alter table public.receipts enable row level security;
alter table public.reimbursements enable row level security;
alter table public.payout_details enable row level security;
alter table public.event_photos enable row level security;

create policy "Finance and the claimant read receipts"
  on public.receipts for select to authenticated
  using (public.has_role('finance') or (public.is_workspace_member() and claimant_id = auth.uid()));
create policy "Finance and the claimant read claims"
  on public.reimbursements for select to authenticated
  using (public.has_role('finance') or (public.is_workspace_member() and claimant_id = auth.uid()));
create policy "Finance and the claimant read payout details"
  on public.payout_details for select to authenticated
  using (
    public.has_role('finance')
    or exists (select 1 from public.reimbursements r where r.id = reimbursement_id and r.claimant_id = auth.uid() and public.is_workspace_member())
  );
create policy "Finance and the requester read pre-approvals"
  on public.preapprovals for select to authenticated
  using (public.has_role('finance') or (public.is_workspace_member() and requester_id = auth.uid()));
create policy "Finance and the trip's staff read its budget"
  on public.trip_budgets for select to authenticated
  using (public.has_role('finance') or public.is_event_staff(event_id));
create policy "Finance reads batches"
  on public.payout_batches for select to authenticated
  using (public.has_role('finance'));
create policy "Staff and teams see hand-in photos"
  on public.event_photos for select to authenticated
  using (public.is_team() or public.is_event_staff(event_id));

-- All writes through the functions below.
revoke insert, update, delete, truncate on public.preapprovals, public.trip_budgets, public.payout_batches, public.receipts,
  public.reimbursements, public.payout_details, public.event_photos from anon, authenticated;
revoke all on public.preapprovals, public.trip_budgets, public.payout_batches, public.receipts,
  public.reimbursements, public.payout_details, public.event_photos from anon;

-- Bank details live only until the claim is settled.
create or replace function private.purge_payout_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('paid', 'rejected') and old.status is distinct from new.status then
    delete from public.payout_details where reimbursement_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function private.purge_payout_details() from public, anon, authenticated;
create trigger purge_payout_details after update of status on public.reimbursements for each row execute function private.purge_payout_details();

-- ── Storage: receipts and photos, private ───────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('receipts', 'receipts', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('event-photos', 'event-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- receipts/<event id>/<claimant id>/<uuid>.<ext>: the claimant uploads into
-- their own folder of an event they are staff of; the claimant and Finance read.
create policy "Claimants upload receipt photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'receipts'
    and (storage.foldername(name))[2] = auth.uid()::text
    and public.is_event_staff(((storage.foldername(name))[1])::uuid)
  );
create policy "Claimants and Finance read receipt photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'receipts'
    and (public.has_role('finance') or ((storage.foldername(name))[2] = auth.uid()::text and public.is_workspace_member()))
  );
-- event-photos/<event id>/<uuid>.<ext>: the event's staff upload; staff and teams read.
create policy "Staff upload event photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'event-photos' and public.is_event_staff(((storage.foldername(name))[1])::uuid));
create policy "Staff and teams read event photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'event-photos'
    and (public.is_team() or public.is_event_staff(((storage.foldername(name))[1])::uuid))
  );

-- ── Registering a receipt (claimant) ────────────────────────────────────────
create or replace function private.budget_left(event uuid, except_claim uuid default null)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select b.amount_cents - coalesce((
    select sum(coalesce(r.approved_cents, r.suggested_cents))
    from public.reimbursements r join public.reimbursement_rules ru on ru.id = r.rule_id
    where r.event_id = event and ru.within_trip_budget and r.status <> 'rejected' and r.id is distinct from except_claim
  ), 0)::integer
  from public.trip_budgets b where b.event_id = event;
$$;
revoke all on function private.budget_left(uuid, uuid) from public, anon, authenticated;

create or replace function public.register_receipt(
  event uuid, kind text, vendor text, amount_cents integer, purchased_on date,
  description text default '', days integer default null, reference_path text default null,
  payout_method text default null, account_holder text default null, iban text default null, paypal_email text default null,
  preapproval uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.events;
  my_role text;
  pol public.reimbursement_policies;
  ru public.reimbursement_rules;
  pre public.preapprovals;
  sug record;
  rec_id uuid;
  claim_id uuid;
begin
  if not public.is_workspace_member() then
    raise exception 'Please sign in' using errcode = '42501';
  end if;
  select * into e from public.events where id = event;
  if not found or e.status in ('draft', 'dropped') then
    raise exception 'No such event' using errcode = '22023';
  end if;
  select a.role into my_role from public.assignments a
  where a.event_id = event and a.profile_id = auth.uid() and a.status = 'active';
  if my_role is null then
    raise exception 'Only the event''s OC and helpers claim expenses' using errcode = '42501';
  end if;
  select * into pol from public.reimbursement_policies where id = public.policy_for((e.starts_at at time zone 'Europe/Berlin')::date);
  if not found then
    raise exception 'No reimbursement policy in force' using errcode = '22023';
  end if;
  select * into ru from public.reimbursement_rules r
  where r.policy_id = pol.id and r.expense_kind = kind and r.event_type in (e.type::text, 'any')
  order by (r.event_type = 'any') limit 1;
  if not found then
    raise exception 'This kind of expense is not reimbursed for this event type' using errcode = '22023';
  end if;
  if reference_path is not null and not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'receipts' and o.name = reference_path and o.owner_id = auth.uid()::text
      and (storage.foldername(o.name))[1] = event::text
  ) then
    raise exception 'The receipt photo was not found' using errcode = '22023';
  end if;
  if preapproval is not null then
    select * into pre from public.preapprovals p where p.id = preapproval and p.requester_id = auth.uid() and p.event_id = event;
    if not found then
      raise exception 'No such pre-approval' using errcode = '22023';
    end if;
  end if;
  if payout_method is not null and payout_method not in ('bank', 'paypal') then
    raise exception 'Unknown payout method' using errcode = '22023';
  end if;

  insert into public.receipts (event_id, claimant_id, expense_kind, description, vendor, amount_cents, purchased_on, days, reference_path)
  values (event, auth.uid(), kind, left(coalesce(description, ''), 500), vendor, amount_cents, purchased_on, case when ru.per_day then days end, reference_path)
  returning id into rec_id;

  select * into sug from public.suggest_reimbursement(ru.id, my_role, amount_cents, days, coalesce(pre.status = 'approved', false), private.budget_left(event));

  insert into public.reimbursements (receipt_id, event_id, claimant_id, claimant_role, category, policy_id, policy_version, rule_id,
                                     suggested_cents, flags, payout_method, preapproval_id)
  values (rec_id, event, auth.uid(), my_role, ru.category, pol.id, pol.version, ru.id, sug.suggested_cents, sug.flags, payout_method, pre.id)
  returning id into claim_id;

  if payout_method is not null then
    insert into public.payout_details (reimbursement_id, account_holder, iban, paypal_email)
    values (claim_id, nullif(trim(account_holder), ''),
            case when payout_method = 'bank' then upper(replace(iban, ' ', '')) end,
            case when payout_method = 'paypal' then lower(trim(paypal_email)) end);
  end if;
  return claim_id;
end;
$$;
revoke all on function public.register_receipt(uuid, text, text, integer, date, text, integer, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.register_receipt(uuid, text, text, integer, date, text, integer, text, text, text, text, text, uuid) to authenticated;

-- The claimant sets or changes payout details until the claim is settled.
create or replace function public.set_payout_details(claim uuid, method text, account_holder text default null, iban text default null, paypal_email text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reimbursements;
begin
  select * into r from public.reimbursements where id = claim;
  if not found or r.claimant_id is distinct from auth.uid() or not public.is_workspace_member() then
    raise exception 'Only the claimant sets payout details' using errcode = '42501';
  end if;
  if r.status in ('paid', 'rejected') then
    raise exception 'This claim is settled' using errcode = '22023';
  end if;
  if method not in ('bank', 'paypal') then
    raise exception 'Unknown payout method' using errcode = '22023';
  end if;
  delete from public.payout_details where reimbursement_id = claim;
  insert into public.payout_details (reimbursement_id, account_holder, iban, paypal_email)
  values (claim, nullif(trim(account_holder), ''),
          case when method = 'bank' then upper(replace(iban, ' ', '')) end,
          case when method = 'paypal' then lower(trim(paypal_email)) end);
  update public.reimbursements set payout_method = method where id = claim;
end;
$$;
revoke all on function public.set_payout_details(uuid, text, text, text, text) from public, anon;
grant execute on function public.set_payout_details(uuid, text, text, text, text) to authenticated;

-- The claimant withdraws a claim before the Beleg was handed in.
create or replace function public.withdraw_receipt(claim uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reimbursements;
begin
  select * into r from public.reimbursements where id = claim for update;
  if not found or r.claimant_id is distinct from auth.uid() or not public.is_workspace_member() then
    raise exception 'Only the claimant withdraws a claim' using errcode = '42501';
  end if;
  if r.status <> 'not_submitted' then
    raise exception 'Finance already has the Beleg – ask Finance' using errcode = '22023';
  end if;
  delete from public.payout_details where reimbursement_id = claim;
  delete from public.reimbursements where id = claim;
  delete from public.receipts where id = r.receipt_id;
end;
$$;
revoke all on function public.withdraw_receipt(uuid) from public, anon;
grant execute on function public.withdraw_receipt(uuid) to authenticated;

-- ── Finance ─────────────────────────────────────────────────────────────────
create or replace function private.require_finance()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.has_role('finance') then
    raise exception 'Only the Finance team can do this' using errcode = '42501';
  end if;
end;
$$;
revoke all on function private.require_finance() from public, anon, authenticated;

-- The month's open batch (created when needed).
create or replace function private.open_batch(for_month date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  b uuid;
begin
  insert into public.payout_batches (month) values (date_trunc('month', for_month)::date) on conflict (month) do nothing;
  select id into b from public.payout_batches where month = date_trunc('month', for_month)::date and status = 'open';
  if b is null then
    -- That month was paid already: the next month's batch.
    return private.open_batch((date_trunc('month', for_month) + interval '1 month')::date);
  end if;
  return b;
end;
$$;
revoke all on function private.open_batch(date) from public, anon, authenticated;

-- Paper Beleg handed in (who and when recorded).
create or replace function public.mark_beleg_received(claim uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reimbursements;
begin
  perform private.require_finance();
  select * into r from public.reimbursements where id = claim for update;
  if not found or r.status <> 'not_submitted' then
    raise exception 'Not waiting for its Beleg' using errcode = '22023';
  end if;
  update public.receipts set beleg_received_at = now(), beleg_received_by = public.auth_email() where id = r.receipt_id;
  update public.reimbursements set status = 'beleg_received' where id = claim;
end;
$$;

-- Finance checks the claim, confirming or overriding the suggested amount;
-- it joins the month's payout batch (unless paid early).
create or replace function public.check_reimbursement(claim uuid, approved integer, note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reimbursements;
begin
  perform private.require_finance();
  select * into r from public.reimbursements where id = claim for update;
  if not found or r.status <> 'beleg_received' then
    raise exception 'Only claims with a received Beleg can be checked' using errcode = '22023';
  end if;
  if approved is null or approved < 0 then
    raise exception 'Enter the amount to pay' using errcode = '22023';
  end if;
  if not exists (select 1 from public.payout_details where reimbursement_id = claim) then
    raise exception 'The claimant has not given bank or PayPal details yet' using errcode = '22023';
  end if;
  update public.reimbursements
  set status = 'checked', approved_cents = approved, finance_note = left(coalesce(note, ''), 1000),
      checked_at = now(), checked_by = public.auth_email(),
      batch_id = private.open_batch((now() at time zone 'Europe/Berlin')::date)
  where id = claim;
end;
$$;

create or replace function public.reject_reimbursement(claim uuid, reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_finance();
  if coalesce(trim(reason), '') = '' then
    raise exception 'Give a reason' using errcode = '22023';
  end if;
  update public.reimbursements set status = 'rejected', rejected_reason = left(reason, 1000), batch_id = null
  where id = claim and status in ('not_submitted', 'beleg_received', 'checked');
  if not found then
    raise exception 'This claim cannot be rejected any more' using errcode = '22023';
  end if;
end;
$$;

-- Claims above the threshold (default €100) can leave the batch and be paid early.
create or replace function public.pay_early(claim uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reimbursements;
  threshold integer := coalesce((select (value #>> '{}')::integer from public.app_settings where key = 'early_payout_threshold_cents'), 10000);
begin
  perform private.require_finance();
  select * into r from public.reimbursements where id = claim for update;
  if not found or r.status <> 'checked' then
    raise exception 'Only checked claims can be paid' using errcode = '22023';
  end if;
  if r.approved_cents <= threshold then
    raise exception 'Only claims above % cents are paid early', threshold using errcode = '22023';
  end if;
  update public.reimbursements set early_payout = true, batch_id = null, status = 'paid', paid_at = now(), paid_by = public.auth_email()
  where id = claim;
end;
$$;

-- The month's batch is paid out: all its claims are paid.
create or replace function public.pay_batch(batch uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  perform private.require_finance();
  update public.payout_batches set status = 'paid', paid_at = now(), paid_by = public.auth_email() where id = batch and status = 'open';
  if not found then
    raise exception 'This batch is not open' using errcode = '22023';
  end if;
  update public.reimbursements set status = 'paid', paid_at = now(), paid_by = public.auth_email()
  where batch_id = batch and status = 'checked';
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Trip budget for social ancillary costs, set before the trip.
create or replace function public.set_trip_budget(event uuid, amount integer, note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.require_finance();
  if not exists (select 1 from public.events e where e.id = event and e.type = 'weekend_trip') then
    raise exception 'Trip budgets are for weekend trips' using errcode = '22023';
  end if;
  if exists (select 1 from public.events e where e.id = event and e.starts_at <= now()) then
    raise exception 'The budget is set before the trip' using errcode = '22023';
  end if;
  insert into public.trip_budgets (event_id, amount_cents, note, set_by) values (event, amount, left(coalesce(note, ''), 500), public.auth_email())
  on conflict (event_id) do update set amount_cents = excluded.amount_cents, note = excluded.note, set_by = excluded.set_by, set_at = now();
end;
$$;

-- Pre-approval: requested by the trip's staff before buying, decided by the Treasurer.
create or replace function public.request_preapproval(event uuid, description text, estimated integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p uuid;
begin
  if not public.is_event_staff(event) then
    raise exception 'Only the trip''s OC and helpers ask for pre-approval' using errcode = '42501';
  end if;
  if not exists (select 1 from public.events e where e.id = event and e.type = 'weekend_trip') then
    raise exception 'Pre-approvals are for weekend trips' using errcode = '22023';
  end if;
  insert into public.preapprovals (event_id, requester_id, description, estimated_cents) values (event, auth.uid(), description, estimated)
  returning id into p;
  return p;
end;
$$;

create or replace function public.decide_preapproval(preapproval uuid, approve boolean, decision_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.role_members r where r.email = public.auth_email() and r.role = 'treasurer')
     or not public.is_workspace_member() then
    raise exception 'Only the Treasurer decides pre-approvals' using errcode = '42501';
  end if;
  update public.preapprovals
  set status = case when approve then 'approved' else 'rejected' end, decided_by = public.auth_email(), decided_at = now(), note = left(coalesce(decision_note, ''), 1000)
  where id = preapproval and status = 'requested';
  if not found then
    raise exception 'Already decided' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.mark_beleg_received(uuid) from public, anon;
revoke all on function public.check_reimbursement(uuid, integer, text) from public, anon;
revoke all on function public.reject_reimbursement(uuid, text) from public, anon;
revoke all on function public.pay_early(uuid) from public, anon;
revoke all on function public.pay_batch(uuid) from public, anon;
revoke all on function public.set_trip_budget(uuid, integer, text) from public, anon;
revoke all on function public.request_preapproval(uuid, text, integer) from public, anon;
revoke all on function public.decide_preapproval(uuid, boolean, text) from public, anon;
grant execute on function public.mark_beleg_received(uuid) to authenticated;
grant execute on function public.check_reimbursement(uuid, integer, text) to authenticated;
grant execute on function public.reject_reimbursement(uuid, text) to authenticated;
grant execute on function public.pay_early(uuid) to authenticated;
grant execute on function public.pay_batch(uuid) to authenticated;
grant execute on function public.set_trip_budget(uuid, integer, text) to authenticated;
grant execute on function public.request_preapproval(uuid, text, integer) to authenticated;
grant execute on function public.decide_preapproval(uuid, boolean, text) to authenticated;

-- ── Hand-in photos → Drive (job) ────────────────────────────────────────────
create or replace function public.add_event_photo(event uuid, path text, file_name text, mime_type text, size_bytes integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  p uuid;
begin
  if not public.is_event_staff(event) then
    raise exception 'Only the event''s OC and helpers hand in photos' using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'event-photos' and o.name = path and o.owner_id = auth.uid()::text and (storage.foldername(o.name))[1] = event::text
  ) then
    raise exception 'The photo was not uploaded' using errcode = '22023';
  end if;
  insert into public.event_photos (event_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
  values (event, path, file_name, mime_type, size_bytes, public.auth_email())
  returning id into p;
  perform private.enqueue_job('drive.upload_photo', jsonb_build_object('photo_id', p), 'drive.upload_photo:' || p, event);
  return p;
end;
$$;
revoke all on function public.add_event_photo(uuid, text, text, text, integer) from public, anon;
grant execute on function public.add_event_photo(uuid, text, text, text, integer) to authenticated;

-- ── What the event's people may know about its claims (no amounts, no names) ─
create or replace function public.event_claims_summary(event uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'receipts', count(*),
    'belege_missing', count(*) filter (where r.status = 'not_submitted'),
    'open', count(*) filter (where r.status in ('not_submitted', 'beleg_received', 'checked')),
    'paid', count(*) filter (where r.status = 'paid')
  )
  from public.reimbursements r
  where r.event_id = event and (public.is_team() or public.is_event_staff(event));
$$;
revoke all on function public.event_claims_summary(uuid) from public, anon;
grant execute on function public.event_claims_summary(uuid) to authenticated;
