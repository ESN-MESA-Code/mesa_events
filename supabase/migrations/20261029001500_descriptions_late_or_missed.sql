-- ============================================================
-- MESA Events Platform – "late" is for chasing, "missed" is history
-- (review 2026-10-29, A6)
--
-- An event that happened without a description stayed under "Late" on the
-- Comms dashboard forever (C8 made a started event late). Now:
-- * late:   not in (missing, draft, changes requested), the deadline
--           passed and the event is still ahead – chase the OC;
-- * missed: the event started without a published description
--           (informational).
-- ============================================================

drop function public.description_overview();
create function public.description_overview()
returns table (
  event_id uuid, title text, starts_at timestamptz, deadline timestamptz, status text,
  submitted_at timestamptz, published_at timestamptz, late boolean, cycle_id uuid, cycle_month date,
  missed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.title, e.starts_at, c.description_deadline, coalesce(d.status, 'missing'),
         d.submitted_at, d.published_at,
         coalesce(d.status, 'missing') in ('missing', 'draft', 'changes_requested')
           and c.description_deadline is not null and c.description_deadline < now()
           and e.starts_at > now(),
         c.id, c.month,
         coalesce(d.status, 'missing') <> 'published' and e.starts_at <= now()
  from public.events e
  left join public.planning_cycles c on c.id = e.cycle_id
  left join public.descriptions d on d.event_id = e.id
  where e.status in ('confirmed', 'understaffed', 'completed')
    and (public.is_team() or public.is_event_staff(e.id));
$$;
revoke all on function public.description_overview() from public, anon;
grant execute on function public.description_overview() to authenticated;
