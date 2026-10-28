-- ============================================================
-- MESA Events Platform – executives read Finance's records (read-only)
-- (review 2026-10-28, C4)
--
-- The navigation showed executives "Finance" but the page and the data were
-- Finance-only. Executives "see everything" (SPEC), so they now read
-- receipts, claims, payout batches, pre-approvals, trip budgets and the
-- claims' log entries – read-only, every change stays with Finance and the
-- Treasurer. Bank and PayPal details stay Finance's and the claimant's only
-- (needed for paying, nothing to oversee).
-- ============================================================

drop policy "Finance and the claimant read receipts" on public.receipts;
create policy "Finance, executives and the claimant read receipts"
  on public.receipts for select to authenticated
  using (public.has_role('finance') or public.has_role('executive') or (public.is_workspace_member() and claimant_id = auth.uid()));

drop policy "Finance and the claimant read claims" on public.reimbursements;
create policy "Finance, executives and the claimant read claims"
  on public.reimbursements for select to authenticated
  using (public.has_role('finance') or public.has_role('executive') or (public.is_workspace_member() and claimant_id = auth.uid()));

drop policy "Finance and the requester read pre-approvals" on public.preapprovals;
create policy "Finance, executives and the requester read pre-approvals"
  on public.preapprovals for select to authenticated
  using (public.has_role('finance') or public.has_role('executive') or (public.is_workspace_member() and requester_id = auth.uid()));

drop policy "Finance and the trip's staff read its budget" on public.trip_budgets;
create policy "Finance, executives and the trip's staff read its budget"
  on public.trip_budgets for select to authenticated
  using (public.has_role('finance') or public.has_role('executive') or public.is_event_staff(event_id));

drop policy "Finance reads batches" on public.payout_batches;
create policy "Finance and executives read batches"
  on public.payout_batches for select to authenticated
  using (public.has_role('finance') or public.has_role('executive'));

drop policy "Log entries by what they describe" on public.activity_log;
create policy "Log entries by what they describe"
  on public.activity_log for select to authenticated
  using (
    case
      when entity = 'reimbursements' then public.has_role('finance') or public.has_role('executive')
      else public.has_role('events') or public.has_role('executive') or public.has_role('admin')
        or (event_id is not null
            and entity in ('events', 'assignments', 'descriptions', 'reviews', 'attendance_lists')
            and public.is_event_staff(event_id))
    end
  );
