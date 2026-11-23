export interface Track {
  id: string;
  user_id: string; // default 'local_guest'
  youtube_id: string | null;
  title: string;
  artist: string;
  local_audio_uri: string;
  local_artwork_uri: string | null;
  duration: number; // in seconds
  source: 'local' | 'youtube';
  is_synced: number; // 0 or 1
  created_at: string; // ISO string
  sort_order?: number;
  is_streaming?: boolean;
  headers?: Record<string, string>;
  is_playlist_only?: number; // 0 or 1
}

export interface Playlist {
  id: string;
  user_id: string;
  name: string;
  cover_uri?: string | null;
  cover_url?: string | null;
  share_code?: string | null;
  sync_status?: string | null;
  sync_version?: number;
  is_synced: number; // 0 or 1
  is_public?: number; // 0 or 1
  is_imported?: number; // 0 or 1
  likes_count?: number;
  is_liked?: boolean;
  created_at: string;
  track_count?: number;
}

export interface SharedPlaylistData {
  id: string;
  user_id?: string;
  name: string;
  cover_url: string | null;
  share_code: string;
  created_at: string;
  updated_at?: string;
  tracks: Track[];
  is_public?: boolean;
  likes_count?: number;
  is_liked?: boolean;
}

export interface PlaylistTrack {
  id: string;
  playlist_id: string;
  track_id: string;
  position: number;
  sort_order?: number;
  created_at: string;
  added_at?: string;
}

export type RepeatMode = 'off' | 'all' | 'one';
