-- ============================================================
-- MESA Events Platform – a description is late once its event started
-- (review 2026-10-28, C8)
--
-- The deadline is one per month, so events early in the month that already
-- happened without a description were listed as "due". A description that
-- is not in (missing, draft, changes requested) is now late when the
-- deadline passed or the event has started. The overview also names the
-- cycle, for progress per month ("5 of 8 descriptions in").
-- ============================================================

drop function public.description_overview();
create function public.description_overview()
returns table (
  event_id uuid, title text, starts_at timestamptz, deadline timestamptz, status text,
  submitted_at timestamptz, published_at timestamptz, late boolean, cycle_id uuid, cycle_month date
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.title, e.starts_at, c.description_deadline, coalesce(d.status, 'missing'),
         d.submitted_at, d.published_at,
         coalesce(d.status, 'missing') in ('missing', 'draft', 'changes_requested')
           and ((c.description_deadline is not null and c.description_deadline < now()) or e.starts_at <= now()),
         c.id, c.month
  from public.events e
  left join public.planning_cycles c on c.id = e.cycle_id
  left join public.descriptions d on d.event_id = e.id
  where e.status in ('confirmed', 'understaffed', 'completed')
    and (public.is_team() or public.is_event_staff(e.id));
$$;
revoke all on function public.description_overview() from public, anon;
grant execute on function public.description_overview() to authenticated;
