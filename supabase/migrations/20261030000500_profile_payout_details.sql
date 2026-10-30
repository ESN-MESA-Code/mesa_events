-- ============================================================
-- MESA Events Platform – payout details on the member's profile
-- (round 2026-10-30)
--
-- A member saves their IBAN (with the account holder) or PayPal address
-- once, from the profile menu, instead of per receipt:
-- * profile_payout_details: one row per member, readable only by the
--   member (Finance sees the copy on each claim, as before).
-- * Saving copies them onto the member's claims that are not settled
--   (paid or rejected); a new claim without its own details gets them too.
-- * Deleting removes them from the profile and from the claims Finance
--   has not checked yet; checked claims keep theirs until they are paid
--   (then they are deleted anyway, see purge_payout_details). Not written
--   to the activity log, which the Events team reads.
-- ============================================================

create table public.profile_payout_details (
  profile_id     uuid primary key references public.profiles(id) on delete cascade,
  account_holder text constraint profile_payout_holder_check check (length(account_holder) between 1 and 200),
  iban           text constraint profile_payout_iban_check check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  paypal_email   text constraint profile_payout_paypal_check check (paypal_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(paypal_email) <= 200),
  updated_at     timestamptz not null default now(),
  constraint profile_payout_one_way check ((iban is not null) <> (paypal_email is not null)),
  constraint profile_payout_holder_for_bank check (iban is null or account_holder is not null)
);

alter table public.profile_payout_details enable row level security;
create policy "Members read their own payout details"
  on public.profile_payout_details for select to authenticated
  using (public.is_workspace_member() and profile_id = auth.uid());
revoke insert, update, delete, truncate on public.profile_payout_details from anon, authenticated;
revoke all on public.profile_payout_details from anon;

-- Copies the member's saved details onto one claim (replacing what it had).
create or replace function private.apply_profile_payout(claim uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.reimbursements;
  d public.profile_payout_details;
begin
  select * into r from public.reimbursements where id = claim;
  select * into d from public.profile_payout_details where profile_id = r.claimant_id;
  if not found then
    return;
  end if;
  delete from public.payout_details where reimbursement_id = claim;
  insert into public.payout_details (reimbursement_id, account_holder, iban, paypal_email)
  values (claim, d.account_holder, d.iban, d.paypal_email);
  update public.reimbursements set payout_method = case when d.iban is not null then 'bank' else 'paypal' end where id = claim;
end;
$$;
revoke all on function private.apply_profile_payout(uuid) from public, anon, authenticated;

create or replace function public.set_my_payout_details(method text, account_holder text default null, iban text default null, paypal_email text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim uuid;
  n integer := 0;
begin
  if not public.is_workspace_member() then
    raise exception 'Only members save payout details' using errcode = '42501';
  end if;
  if method not in ('bank', 'paypal') then
    raise exception 'Unknown payout method' using errcode = '22023';
  end if;
  insert into public.profile_payout_details as t (profile_id, account_holder, iban, paypal_email, updated_at)
  values (auth.uid(),
          case when method = 'bank' then nullif(trim(set_my_payout_details.account_holder), '') end,
          case when method = 'bank' then upper(replace(set_my_payout_details.iban, ' ', '')) end,
          case when method = 'paypal' then lower(trim(set_my_payout_details.paypal_email)) end,
          now())
  on conflict (profile_id) do update set
    account_holder = excluded.account_holder, iban = excluded.iban, paypal_email = excluded.paypal_email, updated_at = now();
  for claim in select id from public.reimbursements where claimant_id = auth.uid() and status not in ('paid', 'rejected') loop
    perform private.apply_profile_payout(claim);
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.set_my_payout_details(text, text, text, text) from public, anon;
grant execute on function public.set_my_payout_details(text, text, text, text) to authenticated;

create or replace function public.delete_my_payout_details()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.is_workspace_member() then
    raise exception 'Only members delete payout details' using errcode = '42501';
  end if;
  delete from public.profile_payout_details where profile_id = auth.uid();
  delete from public.payout_details pd using public.reimbursements r
  where r.id = pd.reimbursement_id and r.claimant_id = auth.uid() and r.status in ('not_submitted', 'beleg_received');
  get diagnostics n = row_count;
  update public.reimbursements set payout_method = null
  where claimant_id = auth.uid() and status in ('not_submitted', 'beleg_received');
  return n;
end;
$$;
revoke all on function public.delete_my_payout_details() from public, anon;
grant execute on function public.delete_my_payout_details() to authenticated;

-- A new claim without its own details gets the saved ones.
create or replace function private.claim_gets_profile_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.payout_method is null then
    perform private.apply_profile_payout(new.id);
  end if;
  return new;
end;
$$;
revoke all on function private.claim_gets_profile_payout() from public, anon, authenticated;
create trigger claim_gets_profile_payout after insert on public.reimbursements
  for each row execute function private.claim_gets_profile_payout();
