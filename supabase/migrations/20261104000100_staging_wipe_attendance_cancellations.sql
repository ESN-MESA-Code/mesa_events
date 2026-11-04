-- ============================================================
-- MESA Events Platform – "Reset demo data" knows the newest tables (2026-11-04)
--
-- staging_wipe() refused because two tables had no wipe decision:
-- * internal_attendance (check-ins at internal meetings): wiped, with the
--   internal events it belongs to.
-- * cancellation_requests: wiped, with the events they belong to.
-- private.checkin_attempts references internal_events too, so the reset
-- truncates it in the same statement (a TRUNCATE without CASCADE fails while
-- a table outside it still references a truncated one).
-- ============================================================

create or replace function private.staging_wipe_lists()
returns table (table_name text, action text)
language sql
immutable
set search_path = ''
as $$
  select t, 'wipe' from unnest(array[
    'activity_log', 'advertising_pictures', 'assignment_drop_reasons', 'assignments', 'attendance_lists', 'calendar_feeds',
    'cancellation_requests', 'cash_box_changes', 'cash_boxes', 'cash_reports', 'description_versions', 'descriptions',
    'esn_access_tokens', 'esn_uploads', 'event_chat_members', 'event_formats', 'event_ideas', 'event_photo_folders',
    'event_reports', 'event_series', 'event_stats', 'events', 'fake_chat_members', 'fake_chat_messages',
    'fake_chat_spaces', 'fake_directory_members', 'fake_drive_files', 'fake_drive_folders',
    'fake_telegram_messages', 'finance_entries', 'internal_attendance', 'internal_event_people', 'internal_events', 'jobs',
    'participants', 'payout_batches', 'payout_details', 'planning_cycles', 'preapprovals',
    'profile_payout_details', 'publication_post_events', 'publication_posts', 'receipts',
    'reimbursements', 'reviews', 'trip_budgets', 'volunteer_choices', 'volunteer_responses'
  ]) as t
  union all
  -- reimbursement_policies/rules: versions after the first are removed;
  -- role_members: demo members' rows are removed.
  select t, 'keep' from unnest(array[
    'app_settings', 'event_categories', 'finance_categories', 'internal_kind_settings', 'organiser_acknowledgements', 'profiles',
    'publication_channels', 'reimbursement_policies', 'reimbursement_rules', 'role_members'
  ]) as t;
$$;
revoke all on function private.staging_wipe_lists() from public, anon, authenticated;

create or replace function public.staging_wipe()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  unlisted text;
  tables text;
  demo_pattern text := '\.demo@' || replace(public.workspace_domain(), '.', '\.') || '$';
begin
  perform private.require_demo_database();
  select string_agg(table_name, ', ') into unlisted from public.staging_wipe_plan() where action = 'unlisted';
  if unlisted is not null then
    raise exception 'Reset refused: no decision for table(s) %', unlisted using errcode = '55000';
  end if;
  select string_agg(format('public.%I', p.table_name), ', ') into tables
  from public.staging_wipe_plan() p where p.action = 'wipe';
  -- No CASCADE: a kept table that references a wiped one makes this fail
  -- instead of losing it silently. The private tables that reference wiped
  -- ones go in the same statement.
  execute 'truncate table ' || tables || ', private.checkin_attempts restart identity';
  insert into public.cash_boxes (name, default_for, position) values
    ('Office hour cash box', 'office_hour', 0),
    ('Events cash box', 'event', 1);
  delete from public.reimbursement_policies where version > 1;
  delete from public.role_members where email ~ demo_pattern;
  delete from public.organiser_acknowledgements where email ~ demo_pattern;
  return jsonb_build_object('wiped', (select count(*) from public.staging_wipe_plan() where action = 'wipe'));
end;
$$;
revoke all on function public.staging_wipe() from public, anon, authenticated;
grant execute on function public.staging_wipe() to service_role;
