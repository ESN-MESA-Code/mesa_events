-- ============================================================
-- MESA Events Platform – only the Events team moves an event's date
-- (review 2026-10-28, B3)
--
-- The dates drive the month schedule, the volunteer form, the description
-- deadline and which reimbursement policy applies, so starts_at and ends_at
-- join the Events-only columns. The OC keeps the practical details they
-- organise themselves: location, price and capacity (DECISIONS.md).
-- ============================================================

create or replace function public.guard_event_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'authenticated'
     or coalesce(current_setting('mesa.system_update', true), '') = 'on'
     or public.has_role('events') then
    return new;
  end if;
  -- An OC: location, price, capacity, and run / cancel an under-staffed event.
  if (new.starts_at, new.ends_at) is distinct from (old.starts_at, old.ends_at) then
    raise exception 'Only the Events team changes the date' using errcode = '42501';
  end if;
  if (new.cycle_id, new.series_id, new.title, new.type, new.helpers_needed, new.visibility,
      new.chat_space_name, new.chat_space_url, new.chat_space_requested_at, new.proposed_by, new.created_by)
     is distinct from
     (old.cycle_id, old.series_id, old.title, old.type, old.helpers_needed, old.visibility,
      old.chat_space_name, old.chat_space_url, old.chat_space_requested_at, old.proposed_by, old.created_by) then
    raise exception 'Only the Events team can change this' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not (old.status = 'understaffed' and new.status in ('confirmed', 'cancelled')) then
    raise exception 'The OC can only decide whether an under-staffed event runs' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_event_update() from public, anon, authenticated;
