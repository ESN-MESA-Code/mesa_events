-- ============================================================
-- MESA Events Platform – "Reset demo data" knows the new table
-- (round 2026-10-30): saved payout details on profiles are demo data
-- on staging and go with the other workflow tables.
-- ============================================================

create or replace function private.staging_wipe_lists()
returns table (table_name text, action text)
language sql
immutable
set search_path = ''
as $$
  select t, 'wipe' from unnest(array[
    'activity_log', 'assignment_drop_reasons', 'assignments', 'attendance_lists', 'description_versions',
    'descriptions', 'esn_access_tokens', 'esn_uploads', 'event_chat_members', 'event_ideas',
    'event_photo_folders', 'event_reports', 'event_series', 'event_stats', 'events', 'fake_chat_members',
    'fake_chat_messages', 'fake_chat_spaces', 'fake_directory_members', 'fake_drive_files',
    'fake_drive_folders', 'fake_telegram_messages', 'jobs', 'participants', 'payout_batches',
    'payout_details', 'planning_cycles', 'preapprovals', 'profile_payout_details', 'publication_post_events',
    'publication_posts', 'receipts', 'reimbursements', 'reviews', 'trip_budgets', 'volunteer_choices',
    'volunteer_responses'
  ]) as t
  union all
  -- reimbursement_policies/rules: versions after the first are removed;
  -- role_members: demo members' rows are removed.
  select t, 'keep' from unnest(array[
    'app_settings', 'organiser_acknowledgements', 'profiles', 'publication_channels',
    'reimbursement_policies', 'reimbursement_rules', 'role_members'
  ]) as t;
$$;
revoke all on function private.staging_wipe_lists() from public, anon, authenticated;
