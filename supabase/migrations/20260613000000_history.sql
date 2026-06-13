-- Per-user content history + viral library, moved out of localStorage (which
-- was per-browser) into Postgres so it syncs across every device the creator
-- signs in on. Both tables are written directly by the client via the anon key;
-- Row Level Security is what makes that safe — a user can only ever read or
-- write their own rows.

-- ----------------------------------------------------------------------------
-- generations: one row per AI generation. `output` is the structured JSON the
-- claude-proxy now returns, so saved results can be reopened in full.
-- ----------------------------------------------------------------------------
create table public.generations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  tool        text not null,
  input       text,
  output      jsonb not null,
  preview     text,                                  -- denormalised for fast list rendering
  saved       boolean not null default false,        -- explicit favourite vs auto-history
  created_at  timestamptz not null default now()
);

-- The list view is always "this user's rows, newest first".
create index generations_user_recent_idx on public.generations (user_id, created_at desc);

alter table public.generations enable row level security;

create policy "generations: read own"   on public.generations
  for select using (auth.uid() = user_id);
create policy "generations: insert own" on public.generations
  for insert with check (auth.uid() = user_id);
create policy "generations: update own" on public.generations
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "generations: delete own" on public.generations
  for delete using (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- viral_posts: the "Save Post" library (was rr_viral in localStorage).
-- ----------------------------------------------------------------------------
create table public.viral_posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  platform    text,
  text        text not null,
  note        text,
  created_at  timestamptz not null default now()
);

create index viral_posts_user_recent_idx on public.viral_posts (user_id, created_at desc);

alter table public.viral_posts enable row level security;

-- A single FOR ALL policy is enough here since every action is "own rows only".
create policy "viral_posts: own rows" on public.viral_posts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
