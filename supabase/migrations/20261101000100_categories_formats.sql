-- ============================================================
-- MESA Events Platform – event categories and formats (round 2026-11-01)
--
-- * event_categories: what kind of event it is (hiking, party, city tour,
--   rally …), one per event and idea. Separate from events.type, which
--   decides the reimbursement rules. The Events team edits them; they are
--   never deleted, only hidden. `keywords` suggest a category from a title
--   (lib/formats.ts, first match in `sort` order – so the seed is ordered
--   specific → general); `esn_type` prefills the ESN Activities type of a
--   new description.
-- * event_formats: a recurring event ("Language Café", "Partnachklamm
--   hike", "Bouldering") – events and ideas that are another run of it
--   point to it. A format has the usual type, helpers and venue; its last
--   published description is the template for the next run.
-- * Setting a format fills the category (when none is given); only the
--   Events team changes an event's category or format.
-- * accept_idea() carries the idea's category and format to the event;
--   inspiration_events() returns both.
-- * sort_past_events(): the backfill – many events to a category and an
--   (existing or new) format in one go; merge_formats() joins two formats.
-- ============================================================

create table public.event_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null constraint event_categories_name_check check (length(trim(name)) between 1 and 60),
  emoji      text not null default '' constraint event_categories_emoji_check check (length(emoji) <= 16),
  -- ESN Activities type id (lib/description/template.ts ESN_TYPES), or null.
  esn_type   text constraint event_categories_esn_type_check check (esn_type is null or esn_type ~ '^\d{1,5}$'),
  -- Words that suggest this category from a title (space separated).
  keywords   text not null default '' constraint event_categories_keywords_check check (length(keywords) <= 2000),
  active     boolean not null default true,
  sort       smallint not null default 100,
  created_at timestamptz not null default now()
);
create unique index event_categories_name_idx on public.event_categories(lower(name));

-- Ordered specific → general: the first category whose keyword matches wins
-- ("Singing Workshop" is music, "Cycling Tour" and "Paintball" sports, "Bar Rallye" a rally,
-- "Hiking Trip" a hike, "Day Trip to Neuschwanstein Castle" a trip).
insert into public.event_categories (name, emoji, esn_type, sort, keywords) values
  ('Language & Meet-ups', '🗣️', '10', 10, 'language languages sprach tandem german speedfriending gettogether meetup hispanic buddy stammtisch'),
  ('Movies & Watch parties', '📺', '10', 20, 'watchparty movie movies cinema kino film publicviewing'),
  ('Social impact', '🌱', '439', 30, 'cleanup charity demonstration csd parade swap stadtradeln europe volunteering donation sustainability'),
  ('Rally & Scavenger hunt', '🧭', '10', 40, 'rally rallye ralley scavenger hunt schnitzeljagd cluedo kastenlauf'),
  ('Karaoke & Music', '🎤', '10', 50, 'karaoke singing sing concert music musik choir'),
  ('Festivals & Traditions', '🎄', '438', 60, 'oktoberfest oktober wiesn tollwood dult kirchweih christmas weihnacht advent christkindl halloween easter ostern carnival fasching martin lantern laterne schaeffler festival biermeile maibaum'),
  ('Dance & Yoga', '💃', '31', 70, 'dance dancing tanz salsa bachata latin yoga pilates'),
  ('Food & Drinks', '🍝', '441', 80, 'dinner lunch brunch breakfast bbq barbecue grill picnic potluck food cooking baking kochen weisswurst brewery friendsgiving tasting biergarten beergarden'),
  ('Sports', '🧗', '31', 90, 'boulder bouldering climbing klettern football fussball soccer volleyball basketball ball bowling minigolf neongolf golf skating skate ice ski skiing skitrip snowboard sledding rodeln swim swimming volksbad bike biking cycling bicycle paintball ropes kayak sport sports rafting canoe'),
  ('Hiking & Outdoors', '🥾', '31', 94, 'hike hiking wandern wanderung klamm gorge trek trekking mountain alps alpen outdoor'),
  ('Trips & Excursions', '🚌', '9', 96, 'trip trips daytrip excursion ausflug weekend weekendtrip roadtrip'),
  ('Creative workshops', '🎨', '13', 100, 'workshop paint painting pottery ceramic origami craft crafts drawing carving improv theatre theater diy'),
  ('Museums & Culture', '🏛️', '438', 110, 'museum museums pinakothek gallery galerie exhibition ausstellung art kunst residenz schloss castle palace botanic opera oper'),
  ('City tours & Visits', '🗺️', '438', 120, 'citytour tour tours stadtfuehrung walking dachau kz memorial parliament landtag'),
  ('Games & Quiz', '🎲', '10', 140, 'game games boardgame boardgames spieleabend quiz pubquiz chess schach schafkopf poker bingo pong beerpong flunkyball tipping escape escaperoom'),
  ('Party & Nightlife', '🎉', '442', 150, 'party parties night nightlife club clubbing disco bar bars hopping welcome closing tram pubcrawl');

create table public.event_formats (
  id             uuid primary key default gen_random_uuid(),
  name           text not null constraint event_formats_name_check check (length(trim(name)) between 1 and 200),
  category_id    uuid references public.event_categories(id) on delete restrict,
  type           public.event_type not null default 'standard',
  helpers_needed smallint not null default 2 constraint event_formats_helpers_check check (helpers_needed between 0 and 50),
  location       text constraint event_formats_location_check check (length(location) <= 300),
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  created_by     text default public.auth_email()
);
create unique index event_formats_name_idx on public.event_formats(lower(name));

alter table public.events
  add column category_id uuid references public.event_categories(id) on delete restrict,
  add column format_id   uuid references public.event_formats(id) on delete restrict;
create index events_category_idx on public.events(category_id);
create index events_format_idx on public.events(format_id);

alter table public.event_ideas
  add column category_id uuid references public.event_categories(id) on delete restrict,
  add column format_id   uuid references public.event_formats(id) on delete restrict;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.event_categories enable row level security;
alter table public.event_formats enable row level security;
create policy "Members read categories" on public.event_categories for select to authenticated using (public.is_workspace_member());
create policy "Events team adds categories" on public.event_categories for insert to authenticated with check (public.has_role('events'));
create policy "Events team changes categories" on public.event_categories for update to authenticated using (public.has_role('events')) with check (public.has_role('events'));
create policy "Members read formats" on public.event_formats for select to authenticated using (public.is_workspace_member());
create policy "Events team adds formats" on public.event_formats for insert to authenticated with check (public.has_role('events'));
create policy "Events team changes formats" on public.event_formats for update to authenticated using (public.has_role('events')) with check (public.has_role('events'));
-- Never deleted: events and ideas keep theirs (hidden instead).
revoke delete, truncate on public.event_categories, public.event_formats from anon, authenticated;
revoke all on public.event_categories, public.event_formats from anon;

-- ── A format brings its category ──────────────────────────────────────────
-- On insert without a category, and when the format changes but the
-- category was not changed with it.
create or replace function public.fill_category_from_format()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cat uuid;
begin
  if new.format_id is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.category_id is not null then
      return new;
    end if;
  elsif new.format_id is not distinct from old.format_id or new.category_id is distinct from old.category_id then
    return new;
  end if;
  select f.category_id into cat from public.event_formats f where f.id = new.format_id;
  if cat is not null then
    new.category_id := cat;
  end if;
  return new;
end;
$$;
revoke all on function public.fill_category_from_format() from public, anon, authenticated;
create trigger fill_category_from_format before insert or update of format_id, category_id on public.events
  for each row execute function public.fill_category_from_format();
create trigger fill_category_from_format before insert or update of format_id, category_id on public.event_ideas
  for each row execute function public.fill_category_from_format();

-- ── Only the Events team sorts events (the OC changes place and price) ────
create or replace function public.guard_event_sorting()
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
  if (new.category_id, new.format_id) is distinct from (old.category_id, old.format_id) then
    raise exception 'Only the Events team changes the category and format' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_event_sorting() from public, anon, authenticated;
create trigger guard_event_sorting before update of category_id, format_id on public.events
  for each row execute function public.guard_event_sorting();

-- ── Accepting an idea keeps its category and format ───────────────────────
drop function public.accept_idea(uuid, uuid, public.event_type, timestamptz, smallint);
create function public.accept_idea(
  idea uuid, cycle uuid, event_type public.event_type, starts timestamptz, helpers smallint default null,
  category uuid default null, format uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  i public.event_ideas;
  c public.planning_cycles;
  f public.event_formats;
  new_event uuid;
begin
  if not public.has_role('events') then
    raise exception 'Only the Events team accepts ideas' using errcode = '42501';
  end if;
  select * into i from public.event_ideas where id = idea for update;
  if not found or i.status <> 'proposed' then
    raise exception 'This idea is not open any more' using errcode = '22023';
  end if;
  select * into c from public.planning_cycles where id = cycle;
  if not found or c.status not in ('planning', 'form_open') then
    raise exception 'Ideas can only be added while the schedule is being planned' using errcode = '22023';
  end if;
  select * into f from public.event_formats where id = coalesce(format, i.format_id);
  insert into public.events (cycle_id, title, type, starts_at, helpers_needed, proposed_by, status, category_id, format_id, location)
  values (cycle, i.title, event_type, starts, coalesce(helpers, i.helpers_needed), case when i.wants_to_oc then i.proposer_id end,
          case when c.status = 'form_open' then 'scheduled' else 'draft' end::public.event_status,
          coalesce(category, i.category_id), f.id, f.location)
  returning id into new_event;
  update public.event_ideas set status = 'accepted', event_id = new_event,
         category_id = coalesce(category, category_id), format_id = coalesce(format, format_id)
  where id = idea;
  return new_event;
end;
$$;
revoke all on function public.accept_idea(uuid, uuid, public.event_type, timestamptz, smallint, uuid, uuid) from public, anon;
grant execute on function public.accept_idea(uuid, uuid, public.event_type, timestamptz, smallint, uuid, uuid) to authenticated;

-- ── Get inspired: category and format of previous events ──────────────────
drop function public.inspiration_events();
create function public.inspiration_events()
returns table (
  event_id uuid, title text, starts_at timestamptz, ends_at timestamptz, type public.event_type,
  hook text, intro text, venue text, price text, headcount integer, helpers_needed smallint,
  photo_folder_url text, source text, category_id uuid, format_id uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id,
         coalesce(nullif(d.approved_fields ->> 'title', ''), e.title),
         e.starts_at, e.ends_at, e.type,
         left(coalesce(d.approved_fields ->> 'hook', ''), 300),
         left(coalesce(d.approved_fields ->> 'intro', ''), 600),
         left(coalesce(d.approved_fields ->> 'venue', ''), 300),
         left(coalesce(d.approved_fields ->> 'price', ''), 50),
         coalesce(l.headcount, r.intl_participants + r.local_participants),
         case when e.source = 'platform' then e.helpers_needed end,
         f.folder_url,
         e.source,
         e.category_id,
         e.format_id
  from public.events e
  join public.descriptions d on d.event_id = e.id and d.published_at is not null and d.approved_fields is not null
  left join public.attendance_lists l on l.event_id = e.id and l.signed_off_at is not null
  left join public.event_reports r on r.event_id = e.id
  left join public.event_photo_folders f on f.event_id = e.id
  where public.is_workspace_member()
    and e.status in ('confirmed', 'understaffed', 'completed')
    and e.starts_at <= now();
$$;
revoke all on function public.inspiration_events() from public, anon;
grant execute on function public.inspiration_events() to authenticated;

-- ── Sorting past events (the backfill) ────────────────────────────────────
-- items: [{ "event_ids": [uuid…], "category_id": uuid|null,
--           "format_id": uuid|null, "new_format": { "name", "type", "helpers_needed", "location" }|null }]
-- A new format whose name exists already joins that one. Returns how many
-- events were sorted.
create or replace function public.sort_past_events(items jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  it jsonb;
  fmt uuid;
  cat uuid;
  n integer := 0;
  k integer;
begin
  if not public.has_role('events') then
    raise exception 'Only the Events team sorts events' using errcode = '42501';
  end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 1000 then
    raise exception 'Invalid items' using errcode = '22023';
  end if;
  for it in select * from jsonb_array_elements(items) loop
    cat := nullif(it ->> 'category_id', '')::uuid;
    fmt := nullif(it ->> 'format_id', '')::uuid;
    if fmt is null and jsonb_typeof(it -> 'new_format') = 'object' then
      select f.id into fmt from public.event_formats f where lower(f.name) = lower(trim(it -> 'new_format' ->> 'name'));
      if fmt is null then
        insert into public.event_formats (name, category_id, type, helpers_needed, location)
        values (trim(it -> 'new_format' ->> 'name'), cat,
                coalesce(nullif(it -> 'new_format' ->> 'type', ''), 'standard')::public.event_type,
                coalesce((it -> 'new_format' ->> 'helpers_needed')::smallint, 2),
                nullif(trim(coalesce(it -> 'new_format' ->> 'location', '')), ''))
        returning id into fmt;
      end if;
    end if;
    if cat is null and fmt is not null then
      select f.category_id into cat from public.event_formats f where f.id = fmt;
    end if;
    update public.events e
    set category_id = coalesce(cat, e.category_id), format_id = coalesce(fmt, e.format_id)
    where e.id in (select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(it -> 'event_ids', '[]')) x);
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end;
$$;
revoke all on function public.sort_past_events(jsonb) from public, anon;
grant execute on function public.sort_past_events(jsonb) to authenticated;

-- Joins format `from_format` into `into_format`: its events and ideas move, it is hidden.
create or replace function public.merge_formats(from_format uuid, into_format uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  if not public.has_role('events') then
    raise exception 'Only the Events team merges formats' using errcode = '42501';
  end if;
  if from_format = into_format or not exists (select 1 from public.event_formats where id = into_format) then
    raise exception 'Pick another format to merge into' using errcode = '22023';
  end if;
  update public.events set format_id = into_format where format_id = from_format;
  get diagnostics n = row_count;
  update public.event_ideas set format_id = into_format where format_id = from_format;
  update public.event_formats set active = false where id = from_format;
  return n;
end;
$$;
revoke all on function public.merge_formats(uuid, uuid) from public, anon;
grant execute on function public.merge_formats(uuid, uuid) to authenticated;

-- ── "Reset demo data" on staging: formats go with the events, categories stay
create or replace function private.staging_wipe_lists()
returns table (table_name text, action text)
language sql
immutable
set search_path = ''
as $$
  select t, 'wipe' from unnest(array[
    'activity_log', 'assignment_drop_reasons', 'assignments', 'attendance_lists', 'calendar_feeds',
    'cash_box_changes', 'cash_boxes', 'cash_reports', 'description_versions', 'descriptions',
    'esn_access_tokens', 'esn_uploads', 'event_chat_members', 'event_formats', 'event_ideas', 'event_photo_folders',
    'event_reports', 'event_series', 'event_stats', 'events', 'fake_chat_members', 'fake_chat_messages',
    'fake_chat_spaces', 'fake_directory_members', 'fake_drive_files', 'fake_drive_folders',
    'fake_telegram_messages', 'finance_entries', 'internal_event_people', 'internal_events', 'jobs',
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
