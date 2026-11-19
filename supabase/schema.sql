-- ==============================================================================
-- JStream Supabase SQL Schema
-- Lightweight Metadata Architecture with Row-Level Security (RLS)
-- ==============================================================================

-- 1. Profiles Table
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  display_name text,
  avatar_url text,
  updated_at timestamptz default now()
);

-- Trigger function to automatically create a profile row on new user signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    avatar_url = excluded.avatar_url,
    updated_at = now();
  return new;
end;
$$ language plpgsql security definer;

-- Auto-trigger on auth.users insert
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 2. User Tracks Table (Metadata only, on-device audio stays local)
create table if not exists public.user_tracks (
  id text not null,
  user_id uuid references auth.users on delete cascade not null,
  title text not null,
  artist text,
  duration integer,
  artwork_url text,
  sort_order integer default 0,
  created_at timestamptz default now(),
  primary key (user_id, id)
);

-- 3. User Playlists Table
create table if not exists public.user_playlists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  description text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 4. User Playlist Tracks Table
create table if not exists public.user_playlist_tracks (
  playlist_id uuid references public.user_playlists(id) on delete cascade not null,
  track_id text not null,
  user_id uuid references auth.users on delete cascade not null,
  sort_order integer default 0,
  added_at timestamptz default now(),
  primary key (playlist_id, track_id)
);

-- ==============================================================================
-- Row-Level Security (RLS) Configuration
-- ==============================================================================

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.user_tracks enable row level security;
alter table public.user_playlists enable row level security;
alter table public.user_playlist_tracks enable row level security;

-- Profiles Policies
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can delete own profile"
  on public.profiles for delete
  using (auth.uid() = id);

-- User Tracks Policies (auth.uid() = user_id)
create policy "Users can select own tracks"
  on public.user_tracks for select
  using (auth.uid() = user_id);

create policy "Users can insert own tracks"
  on public.user_tracks for insert
  with check (auth.uid() = user_id);

create policy "Users can update own tracks"
  on public.user_tracks for update
  using (auth.uid() = user_id);

create policy "Users can delete own tracks"
  on public.user_tracks for delete
  using (auth.uid() = user_id);

-- User Playlists Policies (auth.uid() = user_id)
create policy "Users can select own playlists"
  on public.user_playlists for select
  using (auth.uid() = user_id);

create policy "Users can insert own playlists"
  on public.user_playlists for insert
  with check (auth.uid() = user_id);

create policy "Users can update own playlists"
  on public.user_playlists for update
  using (auth.uid() = user_id);

create policy "Users can delete own playlists"
  on public.user_playlists for delete
  using (auth.uid() = user_id);

-- User Playlist Tracks Policies (auth.uid() = user_id)
create policy "Users can select own playlist tracks"
  on public.user_playlist_tracks for select
  using (auth.uid() = user_id);

create policy "Users can insert own playlist tracks"
  on public.user_playlist_tracks for insert
  with check (auth.uid() = user_id);

create policy "Users can update own playlist tracks"
  on public.user_playlist_tracks for update
  using (auth.uid() = user_id);

create policy "Users can delete own playlist tracks"
  on public.user_playlist_tracks for delete
  using (auth.uid() = user_id);
