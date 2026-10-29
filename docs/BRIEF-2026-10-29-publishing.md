# Brief 2026-10-29 (part E) – publishing channels and a publishing schedule

Addition to `docs/BRIEF-2026-10-29-photos-esn-inspiration.md`, requested by the user while that
round was running. Do it after A–D; it builds on B (ESN status) and C (the month-based Comms page).

The user's words: bring the Telegram feature back, or at least track whether an event is published
to **Telegram, pretix and Instagram**, and add a tool to **schedule the publication**: an easy
**drag-and-drop** tool to put events together into a publishing schedule and keep track of things.

## E1. Publication status per event and channel

- Channels: **Chat space** (exists), **Telegram**, **pretix**, **Instagram**, **ESN Activities**
  (from B).
  - Keep the list as data (a small `publication_channels` table: key, name, kind `auto` |
    `manual`, enabled) so a channel can be added without code changes.
  - Admin can enable or disable channels.
- Status per event and channel: `not planned` → `planned` (date, which post) → `published`
  (when, by whom, link), or `skipped` (with a reason, e.g. "no pretix for free events").
  - Derived from the posts in E3 where possible.
  - Logged in the activity log.
  - Comms writes; Events and executives read.
- The Comms stage row (C) shows a chip per channel: ✓ published, ⏰ planned for a date, – not
  planned, ⨯ skipped. A filter shows events "not yet on <channel>".
- Event page: a small "Published on" box for staff (read-only).

## E2. Telegram, back as in the bot (automatic)

Port the bot's Telegram upload (`src/Integrations.gs`: `uploadTelegram_`, `telegramCall_`,
`telegramMultipart_`, `pictureBlob_`, `telegramLink_`; README *Uploads to Telegram, pretix and ESN
Activities*).
- Post the bold event title plus the rendered description (same 4,096-character template) to
  the configured channel.
- Optional topic (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_TOPIC_ID` in env and
  `.env.example`).
- Optional picture: a Drive file link or image URL on the post.
  - If title and text fit a 1,024-character caption: one photo post; otherwise photo with
    caption, then the text.
  - Convert HEIC and files over 10 MB to JPEG, or refuse them with a clear message if conversion
    isn't feasible without a native dependency (decide and document).
- **Re-publishing edits the same messages** (store message ids).
- Refuse to post while the price is TBA or the description is not approved (as the bot did).
- Goes through the **jobs queue** with an idempotency key. The job runs at the post's scheduled
  time (`run_after`), so a planned Telegram post publishes itself.
- On first publish, post "📢 Comms has published *Event* on Telegram" to the event's Chat space
  (once).
- Telegram client behind an interface with a **fake** (`fake_*` table), as for Chat and Drive. No
  real Telegram calls.

pretix and Instagram are **tracked manually** in this round: Comms marks them published and pastes
the link. Instagram's API needs a business account, and pretix is still an open design question.
Keep the channel interface so either can become `auto` later.

## E3. Publishing schedule (drag and drop)

A new Comms page, `/team/comms/schedule`, using the month selector from C.
- **Board:** days of the selected month (week rows or a scrollable day strip; pick what works at
  375 px too) with one **lane per channel** (Telegram, Instagram, pretix, …).
- **Tray:** that month's events that are not yet planned for a channel, filterable by channel,
  each card showing the event date and description stage.
- **Posts:** dropping an event onto a day in a lane creates a **post** (`publication_posts`:
  channel, scheduled_for, status planned/published/skipped, link, picture, note, created_by;
  `publication_post_events`: post_id, event_id, position).
  - Dropping more events onto an existing post **bundles them** (e.g. one Instagram post or a
    Telegram "This week" overview with several events). Reorder inside a bundle.
  - Drag a post to another day to move it; drag an event out to remove it.
  - Keyboard alternative ("Move to…" menu), as on the roster board.
- **Telegram bundles** post a short block per event (title, date, price, link) instead of the full
  descriptions. The template is ported in the style of the bot's (unit-tested, 4,096 limit).
- **Warnings on the card:**
  - planned before the description is approved;
  - planned after the event date;
  - price TBA for Telegram;
  - an event already planned twice on the same channel.
- **Post card actions:**
  - Telegram: "Publish now" and "Edit".
  - Manual channels: "Mark published" (link) and "Skip".
  - Status chips update the per-event status in E1.
- **Realtime:** two Comms members on the page see each other's changes (Supabase Realtime, like
  the description editor's presence).
- Home Comms queue: "Posts planned this week" and "Overdue posts" (planned time passed, still
  not published).

## Tests and done

- Unit: the Telegram message builder (single and bundle, caption split, 4,096 limit), status
  derivation, warnings.
- DB/RLS: only Comms writes posts and statuses; Events/executives read; members see nothing of the
  schedule; job enqueued once per post version.
- Jobs: the Telegram handler against the fake (publish, re-publish edits, scheduled run_after,
  refusal on TBA/unapproved).
- E2E: drag an event from the tray onto a day (and the keyboard alternative), bundle a second
  event, mark an Instagram post published, and see a scheduled Telegram post publish via
  `run-jobs`.
- The demo seed contains a planned schedule for the demo months.
- The "Done when" of the main brief applies: all checks pass, only demo data remains, docs are
  updated, everything is committed to local `main`, and nothing is pushed or deployed.
