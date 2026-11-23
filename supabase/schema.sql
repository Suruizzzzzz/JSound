-- ==============================================================================
-- JStream Supabase SQL Schema
-- Lightweight Metadata Architecture with Row-Level Security (RLS) & Sharing
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

-- 3. User Playlists Table (Text IDs compatible with SQLite pl_... identifiers)
create table if not exists public.user_playlists (
  id text primary key,
  user_id uuid references auth.users on delete cascade not null,
  name text not null,
  description text,
  cover_url text,
  share_code text unique,
  is_public boolean default false,
  likes_count integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_user_playlists_user on public.user_playlists(user_id);
create index if not exists idx_user_playlists_share_code on public.user_playlists(share_code);
create index if not exists idx_user_playlists_public on public.user_playlists(is_public) where is_public = true;

-- 4. User Playlist Tracks Table
create table if not exists public.user_playlist_tracks (
  playlist_id text references public.user_playlists(id) on delete cascade not null,
  track_id text not null,
  user_id uuid references auth.users on delete cascade not null,
  sort_order integer default 0,
  added_at timestamptz default now(),
  primary key (playlist_id, track_id)
);

create index if not exists idx_user_playlist_tracks_playlist on public.user_playlist_tracks(playlist_id);

-- 5. User Playlist Likes Table
create table if not exists public.user_playlist_likes (
  playlist_id text references public.user_playlists(id) on delete cascade not null,
  user_id text not null,
  created_at timestamptz default now(),
  primary key (playlist_id, user_id)
);

create index if not exists idx_user_playlist_likes_playlist on public.user_playlist_likes(playlist_id);
create index if not exists idx_user_playlist_likes_user on public.user_playlist_likes(user_id);

-- Trigger function to automatically maintain likes_count on user_playlists
create or replace function public.handle_playlist_like_change()
returns trigger as $$
begin
  if (TG_OP = 'INSERT') then
    update public.user_playlists
    set likes_count = coalesce(likes_count, 0) + 1
    where id = new.playlist_id;
    return new;
  elsif (TG_OP = 'DELETE') then
    update public.user_playlists
    set likes_count = greatest(0, coalesce(likes_count, 0) - 1)
    where id = old.playlist_id;
    return old;
  end if;
  return null;
end;
$$ language plpgsql security definer;

drop trigger if exists on_playlist_like_change on public.user_playlist_likes;
create trigger on_playlist_like_change
  after insert or delete on public.user_playlist_likes
  for each row execute procedure public.handle_playlist_like_change();

-- ==============================================================================
-- Row-Level Security (RLS) Configuration
-- ==============================================================================

-- Enable RLS on all tables
alter table public.profiles enable row level security;
alter table public.user_tracks enable row level security;
alter table public.user_playlists enable row level security;
alter table public.user_playlist_tracks enable row level security;
alter table public.user_playlist_likes enable row level security;

-- Profiles Policies
drop policy if exists "Users can view own profile" on public.profiles;
create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

drop policy if exists "Users can delete own profile" on public.profiles;
create policy "Users can delete own profile"
  on public.profiles for delete
  using (auth.uid() = id);

-- User Tracks Policies
drop policy if exists "Users can select own tracks" on public.user_tracks;
create policy "Users can select own tracks"
  on public.user_tracks for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.user_playlist_tracks pt
      join public.user_playlists p on p.id = pt.playlist_id
      where pt.track_id = user_tracks.id
      and (p.share_code is not null or p.is_public = true)
    )
  );

drop policy if exists "Users can insert own tracks" on public.user_tracks;
create policy "Users can insert own tracks"
  on public.user_tracks for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own tracks" on public.user_tracks;
create policy "Users can update own tracks"
  on public.user_tracks for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own tracks" on public.user_tracks;
create policy "Users can delete own tracks"
  on public.user_tracks for delete
  using (auth.uid() = user_id);

-- User Playlists Policies
drop policy if exists "Users can select own playlists" on public.user_playlists;
create policy "Users can select own playlists"
  on public.user_playlists for select
  using (auth.uid() = user_id or share_code is not null or is_public = true);

drop policy if exists "Users can insert own playlists" on public.user_playlists;
create policy "Users can insert own playlists"
  on public.user_playlists for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own playlists" on public.user_playlists;
create policy "Users can update own playlists"
  on public.user_playlists for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own playlists" on public.user_playlists;
create policy "Users can delete own playlists"
  on public.user_playlists for delete
  using (auth.uid() = user_id);

-- User Playlist Tracks Policies
drop policy if exists "Users can select own playlist tracks" on public.user_playlist_tracks;
create policy "Users can select own playlist tracks"
  on public.user_playlist_tracks for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.user_playlists
      where id = user_playlist_tracks.playlist_id
      and (share_code is not null or is_public = true)
    )
  );

drop policy if exists "Users can insert own playlist tracks" on public.user_playlist_tracks;
create policy "Users can insert own playlist tracks"
  on public.user_playlist_tracks for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own playlist tracks" on public.user_playlist_tracks;
create policy "Users can update own playlist tracks"
  on public.user_playlist_tracks for update
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own playlist tracks" on public.user_playlist_tracks;
create policy "Users can delete own playlist tracks"
  on public.user_playlist_tracks for delete
  using (auth.uid() = user_id);

-- User Playlist Likes Policies
drop policy if exists "Anyone can select playlist likes" on public.user_playlist_likes;
create policy "Anyone can select playlist likes"
  on public.user_playlist_likes for select
  using (true);

drop policy if exists "Users can insert playlist likes" on public.user_playlist_likes;
create policy "Users can insert playlist likes"
  on public.user_playlist_likes for insert
  with check (true);

drop policy if exists "Users can delete own playlist likes" on public.user_playlist_likes;
create policy "Users can delete own playlist likes"
  on public.user_playlist_likes for delete
  using (true);

-- ==============================================================================
-- 5. Supabase Storage: User Avatars Bucket
-- ==============================================================================

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "Avatar images are publicly accessible" on storage.objects;
create policy "Avatar images are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "Users can upload own avatar" on storage.objects;
create policy "Users can upload own avatar"
  on storage.objects for insert
  with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Users can update own avatar" on storage.objects;
create policy "Users can update own avatar"
  on storage.objects for update
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "Users can delete own avatar" on storage.objects;
create policy "Users can delete own avatar"
  on storage.objects for delete
  using (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- ==============================================================================
-- 6. Supabase Storage: Playlist Covers Bucket
-- ==============================================================================

insert into storage.buckets (id, name, public)
values ('playlist-covers', 'playlist-covers', true)
on conflict (id) do nothing;

drop policy if exists "Playlist covers are publicly accessible" on storage.objects;
create policy "Playlist covers are publicly accessible"
  on storage.objects for select
  using (bucket_id = 'playlist-covers');

drop policy if exists "Users can upload playlist covers" on storage.objects;
create policy "Users can upload playlist covers"
  on storage.objects for insert
  with check (bucket_id = 'playlist-covers');

drop policy if exists "Users can update playlist covers" on storage.objects;
create policy "Users can update playlist covers"
  on storage.objects for update
  using (bucket_id = 'playlist-covers');

drop policy if exists "Users can delete playlist covers" on storage.objects;
create policy "Users can delete playlist covers"
  on storage.objects for delete
  using (bucket_id = 'playlist-covers');
