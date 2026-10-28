-- ============================================================
-- MESA Events Platform – who reads which activity log entries
-- (review 2026-10-28, B1)
--
-- The log_reimbursements trigger writes whole claim rows (claimant,
-- amounts, flags, payout method, Finance's note, rejection reason) with the
-- claim's event_id, and the old select policy let every OC and helper of
-- that event – and the Events team – read them. Entries are now visible by
-- what they describe:
--
-- * reimbursements (claims): Finance only (incl. the Treasurer) – the same
--   people who read the claims themselves; not executives or admins
--   (DECISIONS, milestone 6). The claimant sees their claim on its page.
-- * everything else: Events, executives and admins; the event's OC and
--   helpers only for what they can read anyway (the event, its roster, its
--   description and reviews, its attendance list).
-- Other logged tables were checked: ideas (pitch, decision note) are
-- readable by their proposer and the teams only, so they are no longer
-- shown to event staff either; volunteer responses are logged without an
-- event. Drop-out reasons are no longer copied into the log (B2).
-- ============================================================

drop policy "Events, executives and admins read the log; staff their event's" on public.activity_log;

create policy "Log entries by what they describe"
  on public.activity_log for select to authenticated
  using (
    case
      when entity = 'reimbursements' then public.has_role('finance')
      else public.has_role('events') or public.has_role('executive') or public.has_role('admin')
        or (event_id is not null
            and entity in ('events', 'assignments', 'descriptions', 'reviews', 'attendance_lists')
            and public.is_event_staff(event_id))
    end
  );

create or replace function private.log_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb := to_jsonb(coalesce(new, old));
  ev uuid;
  cy uuid;
  changed jsonb := '{}';
begin
  if tg_table_name = 'events' then
    ev := (r ->> 'id')::uuid;
    cy := (r ->> 'cycle_id')::uuid;
  elsif tg_table_name = 'planning_cycles' then
    cy := (r ->> 'id')::uuid;
  elsif r ? 'event_id' then
    ev := (r ->> 'event_id')::uuid;
  end if;
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, n.value), '{}') into changed
    from jsonb_each(to_jsonb(new)) n
    where n.key not in ('updated_at') and n.value is distinct from (to_jsonb(old) -> n.key);
    if changed = '{}' then
      return null;
    end if;
  elsif tg_op = 'INSERT' then
    changed := r;
  end if;
  -- Never copy bank details into the log.
  changed := changed - 'iban' - 'paypal_email';
  -- Drop-out reasons stay with the assignment (OC and Events only, B2).
  if changed ? 'drop_reason' then
    changed := (changed - 'drop_reason') || jsonb_build_object('drop_reason_given', changed ->> 'drop_reason' is not null);
  end if;
  perform private.log(tg_table_name, r ->> 'id', lower(tg_op), ev, cy, changed);
  return null;
end;
$$;

-- Reasons already in the log.
update public.activity_log
set details = (details - 'drop_reason') || jsonb_build_object('drop_reason_given', details ->> 'drop_reason' is not null)
where entity = 'assignments' and details ? 'drop_reason';
