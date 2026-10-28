-- ============================================================
-- MESA Events Platform – stale running jobs respect max_attempts
-- (review 2026-10-28, B4)
--
-- claim_jobs() re-claimed jobs locked for more than 10 minutes (the worker
-- died) without looking at their attempts, so a job that hangs or crashes
-- the runner every time looped forever. Such a job is now marked dead once
-- it has used up its attempts; admins can retry it (Admin → Background jobs).
-- ============================================================

create or replace function public.claim_jobs(worker text, max_jobs integer default 10)
returns setof public.jobs
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.jobs
  set status = 'dead', locked_at = null, locked_by = null, rerun = false,
      last_error = left(concat_ws(E'\n', last_error, 'Gave up: the worker stopped without finishing (attempt ' || attempts || ' of ' || max_attempts || ').'), 2000)
  where status = 'running' and locked_at < now() - interval '10 minutes' and attempts >= max_attempts;

  return query
  update public.jobs j
  set status = 'running', locked_at = now(), locked_by = worker, attempts = j.attempts + 1, rerun = false
  where j.id in (
    select id from public.jobs
    where (status in ('pending', 'failed') and run_after <= now())
       or (status = 'running' and locked_at < now() - interval '10 minutes' and attempts < max_attempts)
    order by run_after, id
    for update skip locked
    limit greatest(1, least(max_jobs, 100))
  )
  returning j.*;
end;
$$;
revoke all on function public.claim_jobs(text, integer) from public, anon, authenticated;
grant execute on function public.claim_jobs(text, integer) to service_role;
