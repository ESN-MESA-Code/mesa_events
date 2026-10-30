-- ============================================================
-- MESA Events Platform – HR, the Vice President and newbies as roles
-- (round 2026-10-30). HR and the Vice President plan internal events,
-- meetings and office hours (20261030001100_internal_events.sql);
-- newbies (the newbies group) get their own leaderboard on Home
-- (20261030001400_leaderboard.sql). Mapped to Google groups like every
-- role (GROUP_HR, GROUP_VICE_PRESIDENT, GROUP_NEWBIES). A new enum value
-- cannot be used in the transaction that adds it, so this file only adds
-- them.
-- ============================================================

alter type public.app_role add value if not exists 'hr';
alter type public.app_role add value if not exists 'vice_president';
alter type public.app_role add value if not exists 'newbie';
