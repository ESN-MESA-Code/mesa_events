-- ============================================================
-- MESA Events Platform – no digital receipt photos (review 2026-10-28, A2)
--
-- The paper Beleg is mandatory, so a stored photo adds nothing. Receipts
-- stay registered as data (kind, amount, vendor, date, note) for tracking.
-- Event photos (hand-in → Drive) are unchanged.
--
-- Nothing was deployed when this was written. On a stack that has receipt
-- photos, remove the files with the Storage API first (deleting the rows
-- below leaves the files of a file-backed store behind).
-- ============================================================

-- ── Storage: the bucket and its policies ────────────────────────────────────
drop policy if exists "Claimants upload receipt photos" on storage.objects;
drop policy if exists "Claimants and Finance read receipt photos" on storage.objects;

set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'receipts';
delete from storage.buckets where id = 'receipts';
reset storage.allow_delete_query;

-- ── The column and the check in register_receipt() ──────────────────────────
alter table public.receipts drop column reference_path;

drop function public.register_receipt(uuid, text, text, integer, date, text, integer, text, text, text, text, text, uuid);

create function public.register_receipt(
  event uuid, kind text, vendor text, amount_cents integer, purchased_on date,
  description text default '', days integer default null,
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
  if preapproval is not null then
    select * into pre from public.preapprovals p where p.id = preapproval and p.requester_id = auth.uid() and p.event_id = event;
    if not found then
      raise exception 'No such pre-approval' using errcode = '22023';
    end if;
  end if;
  if payout_method is not null and payout_method not in ('bank', 'paypal') then
    raise exception 'Unknown payout method' using errcode = '22023';
  end if;

  insert into public.receipts (event_id, claimant_id, expense_kind, description, vendor, amount_cents, purchased_on, days)
  values (event, auth.uid(), kind, left(coalesce(description, ''), 500), vendor, amount_cents, purchased_on, case when ru.per_day then days end)
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
revoke all on function public.register_receipt(uuid, text, text, integer, date, text, integer, text, text, text, text, uuid) from public, anon;
grant execute on function public.register_receipt(uuid, text, text, integer, date, text, integer, text, text, text, text, uuid) to authenticated;
