-- ============================================================
-- MESA Events Platform – a cycle's hand-in (review 2026-10-29, A4)
--
-- Cycles never finished: after the descriptions the stepper had nothing to
-- say. It now goes on to Hand-in (per event: attendance list signed off,
-- photos handed in, every Beleg with Finance – "3 of 5 events handed in")
-- and Done. This function gives the teams those facts for many cycles at
-- once (the Events dashboard, Home, Comms); counts only, no names or
-- amounts – what event_claims_summary() already tells the teams per event.
-- ============================================================

create or replace function public.cycle_hand_in(cycles uuid[])
returns table (
  event_id uuid, cycle_id uuid, status public.event_status, starts_at timestamptz, ends_at timestamptz,
  signed_off boolean, photos integer, receipts integer, belege_missing integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.cycle_id, e.status, e.starts_at, e.ends_at,
         coalesce(l.signed_off_at is not null, false),
         (select count(*) from public.event_photos p where p.event_id = e.id)::integer,
         (select count(*) from public.reimbursements r where r.event_id = e.id)::integer,
         (select count(*) from public.reimbursements r where r.event_id = e.id and r.status = 'not_submitted')::integer
  from public.events e
  left join public.attendance_lists l on l.event_id = e.id
  where e.cycle_id = any(cycles)
    and e.status in ('confirmed', 'understaffed', 'completed', 'cancelled')
    and public.is_team();
$$;
revoke all on function public.cycle_hand_in(uuid[]) from public, anon;
grant execute on function public.cycle_hand_in(uuid[]) to authenticated;
