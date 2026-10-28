-- ============================================================
-- Fake Google services (lib/google/fakes.ts)
--
-- Without a service account (GOOGLE_MODE=fake, the default) the jobs
-- runner talks to these tables instead of Google Chat, Drive and the
-- Directory API, so the whole workflow runs locally and in tests and the
-- result can be inspected. Only the service role reads or writes them; in
-- production with real clients they stay empty.
-- ============================================================

create table public.fake_directory_members (
  group_email  text not null,
  member_email text not null,
  primary key (group_email, member_email)
);

create table public.fake_chat_spaces (
  name         text primary key,
  display_name text not null,
  description  text not null default '',
  guidelines   text not null default '',
  request_id   text not null unique,
  created_at   timestamptz not null default now()
);

create table public.fake_chat_members (
  space    text not null references public.fake_chat_spaces(name) on delete cascade,
  email    text not null,
  added_at timestamptz not null default now(),
  primary key (space, email)
);

create table public.fake_chat_messages (
  name       text primary key,
  -- The space, or 'dm:<email>' for direct messages.
  space      text not null,
  text       text not null,
  edits      integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.fake_drive_files (
  id         text primary key,
  folder     text not null,
  file_name  text not null,
  mime_type  text not null,
  size       integer not null,
  created_at timestamptz not null default now(),
  unique (folder, file_name)
);

alter table public.fake_directory_members enable row level security;
alter table public.fake_chat_spaces enable row level security;
alter table public.fake_chat_members enable row level security;
alter table public.fake_chat_messages enable row level security;
alter table public.fake_drive_files enable row level security;

revoke all on public.fake_directory_members, public.fake_chat_spaces, public.fake_chat_members,
  public.fake_chat_messages, public.fake_drive_files from anon, authenticated;
