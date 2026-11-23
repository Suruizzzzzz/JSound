import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/services/supabase';
import { Track, Playlist } from '@/types/music';
import {
  getAllTracks,
  saveTracks,
} from '@/repositories/trackRepository';
import {
  createPlaylist,
  getAllPlaylists,
  getPlaylistTracks,
  setPlaylistShareCode,
  updatePlaylistPublicStatus,
  upsertPlaylistTrack,
  getAllPlaylistTracksRaw,
  addTrackToPlaylist,
  getSetting,
  setSetting,
} from '@/lib/database';
import { useSyncProgressStore } from '@/store/syncProgressStore';

export interface SharedPlaylistData {
  id: string;
  name: string;
  cover_url: string | null;
  share_code: string;
  created_at: string;
  tracks: Track[];
  is_public?: boolean;
  likes_count?: number;
  is_liked?: boolean;
}

export interface SharePlaylistResult {
  success: boolean;
  shareCode?: string;
  shareUrl?: string;
  error?: string;
}

/**
 * Generate a clean 6-character sharing code formatted like JST-XXXX
 */
function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let randomPart = '';
  for (let i = 0; i < 4; i++) {
    randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `JST-${randomPart}`;
}

/**
 * Clean and normalize a share code from raw user input (code or jstream:// URL)
 */
export function normalizeShareCode(input: string): string {
  let cleaned = input.trim();
  // Strip query parameters (?...) and hash (#...)
  cleaned = cleaned.replace(/[?#].*$/, '');
  // Strip protocol / deep link prefixes
  cleaned = cleaned.replace(/^jstream:\/\/playlist\//i, '');
  cleaned = cleaned.replace(/^https?:\/\/[^/]+\/playlist\//i, '');
  // Strip trailing slashes
  cleaned = cleaned.replace(/\/+$/, '');
  // Remove all whitespace
  cleaned = cleaned.replace(/\s+/g, '').toUpperCase().trim();
  // Normalize JST-XXXX or bare 4-char code
  if (cleaned.startsWith('JST-')) {
    const codePart = cleaned.replace(/^JST-/, '').replace(/[^A-Z0-9]/g, '');
    return `JST-${codePart}`;
  }
  const cleanAlphanumeric = cleaned.replace(/[^A-Z0-9]/g, '');
  if (cleanAlphanumeric.length === 4) {
    return `JST-${cleanAlphanumeric}`;
  }
  return cleaned;
}

/**
 * Two-way synchronization between local SQLite database and Supabase cloud tables.
 * Safely backs up local tracks and playlists, and pulls remote playlists down.
 */
export async function syncPlaylistsToCloud(): Promise<{ success: boolean; error?: string }> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      return { success: false, error: 'User is not authenticated' };
    }

    const userId = session.user.id;

    // 1. Gather local data
    const localTracks = await getAllTracks();
    const localPlaylists = await getAllPlaylists();
    const localPlaylistTracks = await getAllPlaylistTracksRaw();

    // 2. Push local tracks to Supabase user_tracks (safe metadata only)
    if (localTracks.length > 0) {
      const remoteTracksPayload = localTracks.map((t) => ({
        id: t.id,
        user_id: userId,
        title: t.title || 'Unknown Title',
        artist: t.artist || 'Unknown Artist',
        duration: Math.round(t.duration || 0),
        artwork_url:
          t.local_artwork_uri &&
          !t.local_artwork_uri.startsWith('file://') &&
          !t.local_artwork_uri.startsWith('content://')
            ? t.local_artwork_uri
            : null,
        sort_order: t.sort_order ?? 0,
      }));

      // Upsert in batches of 50 to prevent packet size overflow
      for (let i = 0; i < remoteTracksPayload.length; i += 50) {
        const batch = remoteTracksPayload.slice(i, i + 50);
        const { error: trackErr } = await supabase
          .from('user_tracks')
          .upsert(batch, { onConflict: 'user_id, id' });
        if (trackErr) {
          console.warn('Error syncing tracks batch to cloud:', trackErr.message);
        }
      }
    }

    // 3. Push local playlists to Supabase user_playlists
    if (localPlaylists.length > 0) {
      const remotePlaylistsPayload = localPlaylists.map((p) => ({
        id: p.id,
        user_id: userId,
        name: p.name,
        cover_url:
          p.cover_uri &&
          !p.cover_uri.startsWith('file://') &&
          !p.cover_uri.startsWith('content://')
            ? p.cover_uri
            : null,
        share_code: p.share_code || null,
        is_public: p.is_public === 1,
        updated_at: new Date().toISOString(),
      }));

      const { error: plErr } = await supabase
        .from('user_playlists')
        .upsert(remotePlaylistsPayload, { onConflict: 'id' });

      if (plErr) {
        console.warn('Error syncing playlists to cloud:', plErr.message);
      }
    }

    // 4. Push local playlist track relationships to Supabase user_playlist_tracks
    if (localPlaylistTracks.length > 0) {
      const remotePtPayload = localPlaylistTracks.map((pt) => ({
        playlist_id: pt.playlist_id,
        track_id: pt.track_id,
        user_id: userId,
        sort_order: pt.sort_order ?? pt.position ?? 0,
        added_at: pt.added_at || pt.created_at || new Date().toISOString(),
      }));

      for (let i = 0; i < remotePtPayload.length; i += 50) {
        const batch = remotePtPayload.slice(i, i + 50);
        const { error: ptErr } = await supabase
          .from('user_playlist_tracks')
          .upsert(batch, { onConflict: 'playlist_id, track_id' });
        if (ptErr) {
          console.warn('Error syncing playlist tracks to cloud:', ptErr.message);
        }
      }
    }

    // 5. Pull remote playlists down to local SQLite
    const { data: remotePlaylists, error: pullPlErr } = await supabase
      .from('user_playlists')
      .select('*')
      .eq('user_id', userId);

    if (!pullPlErr && remotePlaylists) {
      const localMap = new Map(localPlaylists.map((p) => [p.id, p]));

      for (const rPl of remotePlaylists) {
        if (!localMap.has(rPl.id)) {
          await createPlaylist(
            rPl.name,
            rPl.cover_url,
            rPl.share_code,
            rPl.id,
            userId,
            rPl.is_public ? 1 : 0
          );
        }
      }
    }

    // 6. Pull remote playlist tracks down to local SQLite
    const { data: remotePt, error: pullPtErr } = await supabase
      .from('user_playlist_tracks')
      .select('*')
      .eq('user_id', userId);

    if (!pullPtErr && remotePt) {
      for (const item of remotePt) {
        await upsertPlaylistTrack(
          item.playlist_id,
          item.track_id,
          item.sort_order ?? 0,
          item.sort_order ?? 0,
          item.added_at
        );
      }
    }

    // 7. Pull remote tracks metadata into local SQLite
    const { data: remoteTracks, error: pullTrkErr } = await supabase
      .from('user_tracks')
      .select('*')
      .eq('user_id', userId);

    if (!pullTrkErr && remoteTracks) {
      const localTrackMap = new Map(localTracks.map((t) => [t.id, t]));
      const newTracksToSave: Track[] = [];

      for (const rTrk of remoteTracks) {
        if (!localTrackMap.has(rTrk.id)) {
          newTracksToSave.push({
            id: rTrk.id,
            user_id: userId,
            youtube_id: rTrk.id.startsWith('track_yt_')
              ? rTrk.id.replace(/^track_yt_/, '')
              : rTrk.id.startsWith('yt_')
              ? rTrk.id.replace(/^yt_/, '')
              : null,
            title: rTrk.title,
            artist: rTrk.artist || 'Unknown Artist',
            local_audio_uri: '',
            local_artwork_uri: rTrk.artwork_url || null,
            duration: rTrk.duration || 0,
            source: 'youtube',
            is_synced: 1,
            created_at: rTrk.created_at || new Date().toISOString(),
            sort_order: rTrk.sort_order ?? 0,
          });
        }
      }

      if (newTracksToSave.length > 0) {
        await saveTracks(newTracksToSave);
      }
    }

    // 8. Trigger background sequential Auto-Download Sync if enabled
    runAutoDownloadSync().catch((autoErr) => {
      console.warn('[AutoDownload] Background sync task error:', autoErr);
    });

    return { success: true };
  } catch (err: any) {
    console.error('Failed to sync playlists to cloud:', err);
    return { success: false, error: err.message || 'Unknown sync error' };
  }
}

/**
 * Checks if the local audio file for a track is missing from device storage.
 */
export async function isTrackAudioMissing(track: Track): Promise<boolean> {
  if (!track.local_audio_uri) return true;
  if (!track.local_audio_uri.startsWith('file://')) return true;
  try {
    const info = await FileSystem.getInfoAsync(track.local_audio_uri);
    return !info.exists || (info.size !== undefined && info.size < 10000);
  } catch {
    return true;
  }
}

/**
 * Background sequential Auto-Download Sync:
 * Iterates through synced tracks missing local audio and downloads them sequentially
 * using the live sync progress store.
 */
export async function runAutoDownloadSync(): Promise<void> {
  const isEnabled = (await getSetting('auto_download_synced', 'true')) === 'true';
  if (!isEnabled) return;

  try {
    const allTracks = await getAllTracks();
    const missing: Track[] = [];
    for (const t of allTracks) {
      if (await isTrackAudioMissing(t)) {
        missing.push(t);
      }
    }

    if (missing.length > 0) {
      await useSyncProgressStore.getState().startSyncDownload(missing);
    }
  } catch (err) {
    console.warn('[AutoDownload] Error initiating auto-download sync:', err);
  }
}

/**
 * Upload a local playlist cover image to Supabase Storage ('playlist-covers').
 * Returns the public URL with a cache-buster timestamp.
 */
export async function uploadPlaylistCoverToCloud(
  playlistId: string,
  localUri: string
): Promise<string | null> {
  if (!localUri) return null;
  if (localUri.startsWith('http://') || localUri.startsWith('https://')) {
    return localUri;
  }

  try {
    const response = await fetch(localUri);
    const arrayBuffer = await response.arrayBuffer();
    const filePath = `${playlistId}.jpg`;

    const { error: uploadErr } = await supabase.storage
      .from('playlist-covers')
      .upload(filePath, arrayBuffer, {
        contentType: 'image/jpeg',
        upsert: true,
      });

    if (uploadErr) {
      console.warn('[UploadPlaylistCover] Storage upload error:', uploadErr.message);
      return null;
    }

    const { data } = supabase.storage.from('playlist-covers').getPublicUrl(filePath);
    if (!data?.publicUrl) return null;

    return `${data.publicUrl}?t=${Date.now()}`;
  } catch (err) {
    console.warn('[UploadPlaylistCover] Failed to upload cover:', err);
    return null;
  }
}

/**
 * Generate a share code for a playlist, upload it and its tracks to Supabase,
 * and copy the shareable deep link (jstream://playlist/JST-XXXX) to clipboard.
 */
export async function sharePlaylist(playlistId: string): Promise<SharePlaylistResult> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      return {
        success: false,
        error: 'Please sign in or create an account to share playlists with friends.',
      };
    }

    const userId = session.user.id;

    // Check if playlist already has a share code
    const playlists = await getAllPlaylists();
    const target = playlists.find((p) => p.id === playlistId);
    if (!target) {
      return { success: false, error: 'Playlist not found.' };
    }

    const shareCode = target.share_code || generateShareCode();

    // 1. Save share_code in local SQLite
    await setPlaylistShareCode(playlistId, shareCode);

    // 2. Fetch tracks in this playlist
    const tracks = await getPlaylistTracks(playlistId);

    // 3. Upsert tracks to Supabase user_tracks so public read can query them
    if (tracks.length > 0) {
      const tracksPayload = tracks.map((t) => ({
        id: t.id,
        user_id: userId,
        title: t.title || 'Unknown Title',
        artist: t.artist || 'Unknown Artist',
        duration: Math.round(t.duration || 0),
        artwork_url:
          t.local_artwork_uri &&
          !t.local_artwork_uri.startsWith('file://') &&
          !t.local_artwork_uri.startsWith('content://')
            ? t.local_artwork_uri
            : null,
        sort_order: t.sort_order ?? 0,
      }));

      try {
        const payloadWithYt = tracksPayload.map((p, idx) => ({
          ...p,
          youtube_id: tracks[idx]?.youtube_id || null,
        }));
        const { error: ytErr } = await supabase
          .from('user_tracks')
          .upsert(payloadWithYt, { onConflict: 'user_id, id' });
        if (ytErr) throw ytErr;
      } catch {
        const { error: trkErr } = await supabase
          .from('user_tracks')
          .upsert(tracksPayload, { onConflict: 'user_id, id' });
        if (trkErr) {
          throw new Error(`Failed to upload track metadata: ${trkErr.message}`);
        }
      }
    }

    // 4. Upload playlist cover to Supabase Storage if present and upsert to user_playlists
    let cloudCoverUrl: string | null = null;
    if (target.cover_uri) {
      if (target.cover_uri.startsWith('http://') || target.cover_uri.startsWith('https://')) {
        cloudCoverUrl = target.cover_uri;
      } else {
        cloudCoverUrl = await uploadPlaylistCoverToCloud(target.id, target.cover_uri);
      }
    }

    const { error: plError } = await supabase.from('user_playlists').upsert(
      {
        id: target.id,
        user_id: userId,
        name: target.name,
        cover_url: cloudCoverUrl,
        share_code: shareCode,
        is_public: target.is_public === 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (plError) {
      throw new Error(`Cloud playlist share failed: ${plError.message}`);
    }

    // 5. Sync playlist track links to Supabase user_playlist_tracks
    // First delete any tracks removed locally from this playlist:
    const currentTrackIds = new Set(tracks.map((t) => t.id));
    const { data: existingPt, error: fetchPtErr } = await supabase
      .from('user_playlist_tracks')
      .select('track_id')
      .eq('playlist_id', target.id);

    if (!fetchPtErr && existingPt) {
      const toDelete = existingPt
        .map((r) => r.track_id)
        .filter((tid) => !currentTrackIds.has(tid));
      if (toDelete.length > 0) {
        const { error: delErr } = await supabase
          .from('user_playlist_tracks')
          .delete()
          .eq('playlist_id', target.id)
          .in('track_id', toDelete);
        if (delErr) {
          console.warn('Warning deleting removed tracks from cloud playlist:', delErr.message);
        }
      }
    }

    if (tracks.length > 0) {
      const ptPayload = tracks.map((t, index) => ({
        playlist_id: target.id,
        track_id: t.id,
        user_id: userId,
        sort_order: index,
        added_at: new Date().toISOString(),
      }));

      const { error: uptErr } = await supabase
        .from('user_playlist_tracks')
        .upsert(ptPayload, { onConflict: 'playlist_id, track_id' });

      if (uptErr) {
        throw new Error(`Failed to sync playlist tracks to cloud: ${uptErr.message}`);
      }
    }

    // 6. Generate share URL and copy to clipboard
    const shareUrl = `jstream://playlist/${shareCode}`;
    await Clipboard.setStringAsync(shareUrl);

    return {
      success: true,
      shareCode,
      shareUrl,
    };
  } catch (err: any) {
    console.error('Error sharing playlist:', err);
    return {
      success: false,
      error: err.message || 'Failed to share playlist.',
    };
  }
}

/**
 * Background auto-sync helper for playlists that already have a share_code.
 * If the user is authenticated and the playlist has a share_code, re-runs sharePlaylist()
 * to keep cloud tracks and relationships up to date without interrupting the user.
 */
export async function syncSharedPlaylistTracks(playlistId: string): Promise<void> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return;

    const playlists = await getAllPlaylists();
    const target = playlists.find((p) => p.id === playlistId);
    if (!target || !target.share_code) return;

    await sharePlaylist(playlistId);
  } catch (err) {
    console.warn('[SyncSharedPlaylist] Background sync error:', err);
  }
}

/**
 * Toggle a playlist's public discovery status in local SQLite and Supabase.
 */
export async function togglePlaylistPublic(
  playlistId: string,
  isPublic: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    await updatePlaylistPublicStatus(playlistId, isPublic);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (session?.user) {
      const { error } = await supabase
        .from('user_playlists')
        .update({ is_public: isPublic, updated_at: new Date().toISOString() })
        .eq('id', playlistId);
      if (error) {
        console.warn('Failed to update playlist public status in Supabase:', error.message);
      }
    }
    return { success: true };
  } catch (err: any) {
    console.error('Failed to toggle playlist public status:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Helper to get active user ID or persistent local guest device ID for liking.
 */
export async function getCurrentUserOrDeviceId(): Promise<string> {
  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.user?.id) return session.user.id;
  } catch {
    // ignore
  }

  try {
    let deviceId = await getSetting('device_client_id');
    if (!deviceId) {
      deviceId = 'dev_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
      await setSetting('device_client_id', deviceId);
    }
    return deviceId;
  } catch {
    return 'guest_device';
  }
}

/**
 * Fetch public community playlists for discovery sorted by most hearts first.
 */
export async function fetchPublicPlaylists(limit = 30): Promise<SharedPlaylistData[]> {
  try {
    const { data: playlists, error } = await supabase
      .from('user_playlists')
      .select('id, name, cover_url, share_code, created_at, is_public, likes_count')
      .eq('is_public', true)
      .not('share_code', 'is', null)
      .order('likes_count', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !playlists) {
      console.warn('Failed to fetch public playlists:', error?.message);
      return [];
    }

    const playlistIds = playlists.map((p) => p.id);
    if (playlistIds.length === 0) return [];

    const currentUserId = await getCurrentUserOrDeviceId();
    let likedSet = new Set<string>();
    try {
      const { data: userLikes } = await supabase
        .from('user_playlist_likes')
        .select('playlist_id')
        .eq('user_id', currentUserId)
        .in('playlist_id', playlistIds);
      if (userLikes) {
        likedSet = new Set(userLikes.map((l) => l.playlist_id));
      }
    } catch {
      // ignore
    }

    const { data: ptRows } = await supabase
      .from('user_playlist_tracks')
      .select('playlist_id, track_id, sort_order')
      .in('playlist_id', playlistIds)
      .order('sort_order', { ascending: true });

    const trackIds = Array.from(new Set((ptRows || []).map((pt) => pt.track_id)));
    let trackMap = new Map<string, any>();
    if (trackIds.length > 0) {
      const { data: trackData } = await supabase
        .from('user_tracks')
        .select('id, title, artist, duration, artwork_url, youtube_id')
        .in('id', trackIds);
      if (trackData) {
        trackMap = new Map(trackData.map((t) => [t.id, t]));
      }
    }

    const result: SharedPlaylistData[] = [];
    for (const pl of playlists) {
      const relatedPt = (ptRows || []).filter((pt) => pt.playlist_id === pl.id);
      const plTracks: Track[] = [];
      for (const pt of relatedPt) {
        const t = trackMap.get(pt.track_id);
        if (t) {
          const ytId =
            t.youtube_id ||
            (t.id?.startsWith('online_youtube_')
              ? t.id.replace('online_youtube_', '')
              : t.id?.startsWith('yt_')
              ? t.id.replace('yt_', '')
              : null);
          plTracks.push({
            id: ytId ? `online_youtube_${ytId}` : t.id,
            user_id: 'local_guest',
            youtube_id: ytId,
            title: t.title,
            artist: t.artist || 'Unknown Artist',
            local_audio_uri: '',
            local_artwork_uri: t.artwork_url || null,
            duration: t.duration || 0,
            source: 'youtube',
            is_synced: 0,
            created_at: pl.created_at,
          });
        }
      }

      result.push({
        id: pl.id,
        name: pl.name,
        cover_url: pl.cover_url,
        share_code: pl.share_code,
        created_at: pl.created_at,
        tracks: plTracks,
        is_public: true,
        likes_count: pl.likes_count || 0,
        is_liked: likedSet.has(pl.id),
      });
    }

    return result;
  } catch (err) {
    console.warn('Error in fetchPublicPlaylists:', err);
    return [];
  }
}

/**
 * Fetch a shared playlist and its track metadata from Supabase by share code.
 * Readable by anyone (including unauthenticated guests) due to public RLS policies.
 */
export async function fetchSharedPlaylist(rawCode: string): Promise<SharedPlaylistData> {
  const code = normalizeShareCode(rawCode);

  // 1. Fetch playlist metadata
  const { data: playlist, error: pError } = await supabase
    .from('user_playlists')
    .select('id, name, cover_url, share_code, created_at, is_public, likes_count')
    .eq('share_code', code)
    .maybeSingle();

  if (pError || !playlist) {
    throw new Error(
      `No playlist found with code "${code}". Please check the code and try again.`
    );
  }

  // 2. Fetch track links for this playlist
  const { data: playlistTracks, error: ptError } = await supabase
    .from('user_playlist_tracks')
    .select('track_id, sort_order, added_at')
    .eq('playlist_id', playlist.id)
    .order('sort_order', { ascending: true });

  if (ptError) {
    throw new Error(`Failed to load tracks for shared playlist: ${ptError.message}`);
  }

  const trackIds = playlistTracks?.map((pt) => pt.track_id) || [];
  let tracks: Track[] = [];

  if (trackIds.length > 0) {
    let remoteTracks: any[] | null = null;
    const { data, error: tError } = await supabase
      .from('user_tracks')
      .select('id, title, artist, duration, artwork_url, sort_order, youtube_id')
      .in('id', trackIds);

    if (tError || !data) {
      const { data: fallbackTracks } = await supabase
        .from('user_tracks')
        .select('id, title, artist, duration, artwork_url, sort_order')
        .in('id', trackIds);
      remoteTracks = fallbackTracks || [];
    } else {
      remoteTracks = data;
    }

    const trackMap = new Map((remoteTracks || []).map((t) => [t.id, t]));

    // Preserve the original playlist sort order
    const resultTracks: Track[] = [];
    for (const tid of trackIds) {
      const t = trackMap.get(tid);
      if (t) {
        const ytId =
          t.youtube_id ||
          (t.id?.startsWith('online_youtube_')
            ? t.id.replace('online_youtube_', '')
            : t.id?.startsWith('yt_')
            ? t.id.replace('yt_', '')
            : null);
        resultTracks.push({
          id: ytId ? `online_youtube_${ytId}` : t.id,
          user_id: 'local_guest',
          youtube_id: ytId,
          title: t.title,
          artist: t.artist || 'Unknown Artist',
          local_audio_uri: '',
          local_artwork_uri: t.artwork_url || null,
          duration: t.duration || 0,
          source: 'youtube',
          is_synced: 0,
          created_at: new Date().toISOString(),
          sort_order: t.sort_order ?? 0,
        });
      }
    }
    tracks = resultTracks;
  }

  const currentUserId = await getCurrentUserOrDeviceId();
  let isLiked = false;
  try {
    const { data: likeRow } = await supabase
      .from('user_playlist_likes')
      .select('playlist_id')
      .eq('playlist_id', playlist.id)
      .eq('user_id', currentUserId)
      .maybeSingle();
    isLiked = Boolean(likeRow);
  } catch {
    // ignore
  }

  return {
    id: playlist.id,
    name: playlist.name,
    cover_url: playlist.cover_url,
    share_code: playlist.share_code,
    created_at: playlist.created_at,
    tracks,
    is_public: Boolean(playlist.is_public),
    likes_count: playlist.likes_count || 0,
    is_liked: isLiked,
  };
}

/**
 * Toggle like/heart on a public/shared playlist in Supabase.
 * Returns the updated { liked, likes_count }.
 */
export async function togglePlaylistLike(
  playlistId: string,
  currentlyLiked: boolean
): Promise<{ liked: boolean; likes_count: number }> {
  try {
    const currentUserId = await getCurrentUserOrDeviceId();
    const shouldLike = !currentlyLiked;

    if (shouldLike) {
      const { error: insertErr } = await supabase.from('user_playlist_likes').insert({
        playlist_id: playlistId,
        user_id: currentUserId,
        created_at: new Date().toISOString(),
      });

      if (insertErr && !insertErr.message?.includes('duplicate')) {
        console.warn('Error liking playlist in Supabase:', insertErr.message);
      }
    } else {
      const { error: delErr } = await supabase
        .from('user_playlist_likes')
        .delete()
        .eq('playlist_id', playlistId)
        .eq('user_id', currentUserId);

      if (delErr) {
        console.warn('Error unliking playlist in Supabase:', delErr.message);
      }
    }

    const { data: updatedPl } = await supabase
      .from('user_playlists')
      .select('likes_count')
      .eq('id', playlistId)
      .maybeSingle();

    const fallbackCount = shouldLike ? 1 : 0;
    const count =
      updatedPl?.likes_count !== undefined && updatedPl?.likes_count !== null
        ? updatedPl.likes_count
        : fallbackCount;

    return {
      liked: shouldLike,
      likes_count: Math.max(0, count),
    };
  } catch (err) {
    console.warn('Error in togglePlaylistLike:', err);
    return {
      liked: !currentlyLiked,
      likes_count: currentlyLiked ? 0 : 1,
    };
  }
}

/**
 * Import a fetched shared playlist into local SQLite, creating the playlist
 * and inserting all of its tracks so it can be viewed and played locally.
 * Includes zero-duplicate guard: existing tracks on device are reused instead of duplicated.
 */
export async function importSharedPlaylist(
  shared: SharedPlaylistData
): Promise<Playlist> {
  // 1. Create a new local playlist (or recreate with custom name)
  const resolvedCover =
    shared.cover_url ||
    (shared.tracks.length > 0 && shared.tracks[0].local_artwork_uri
      ? shared.tracks[0].local_artwork_uri
      : null);

  const localPlaylist = await createPlaylist(
    shared.name,
    resolvedCover,
    shared.share_code,
    undefined,
    'local_guest',
    shared.is_public ? 1 : 0
  );

  // 2. Query existing SQLite tracks to prevent duplicate tracks and re-downloading
  if (shared.tracks.length > 0) {
    const localTracks = await getAllTracks().catch(() => []);
    const tracksToSave: Track[] = [];

    for (let index = 0; index < shared.tracks.length; index++) {
      const t = shared.tracks[index];
      const normTitle = (t.title || '').trim().toLowerCase();
      const normArtist = (t.artist || '').trim().toLowerCase();

      // Check existing SQLite/store tracks by id, youtube_id, or normalized case-insensitive title + artist
      const existing = localTracks.find((loc) => {
        if (loc.id === t.id) return true;
        if (t.youtube_id && loc.youtube_id === t.youtube_id) return true;
        if (
          t.id &&
          (loc.id === `online_youtube_${t.id}` ||
            `online_youtube_${loc.youtube_id}` === t.id ||
            loc.youtube_id === t.id.replace(/^online_youtube_/, ''))
        ) {
          return true;
        }
        const locTitle = (loc.title || '').trim().toLowerCase();
        const locArtist = (loc.artist || '').trim().toLowerCase();
        return (
          locTitle.length > 0 &&
          locTitle === normTitle &&
          (normArtist.length === 0 || locArtist === normArtist)
        );
      });

      if (existing) {
        // Reuse existing track ID and local_audio_uri when linking to the imported playlist
        await addTrackToPlaylist(localPlaylist.id, existing.id);
      } else {
        const newTrack: Track = {
          ...t,
          user_id: 'local_guest',
          sort_order: index,
          created_at: new Date().toISOString(),
        };
        tracksToSave.push(newTrack);
        await addTrackToPlaylist(localPlaylist.id, newTrack.id);
      }
    }

    if (tracksToSave.length > 0) {
      await saveTracks(tracksToSave);
    }
  }

  return localPlaylist;
}
