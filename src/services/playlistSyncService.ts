import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '@/services/supabase';
import { Track, Playlist, SharedPlaylistData } from '@/types/music';
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
  deletePlaylist,
  getSetting,
  setSetting,
  getDatabase,
  getActiveUserId,
} from '@/lib/database';
import { usePlayerStore } from '@/store/playerStore';
import { useSyncProgressStore } from '@/store/syncProgressStore';

export type { SharedPlaylistData };

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

    // 1. Gather local data for this authenticated user
    const localTracks = await getAllTracks(userId);
    const localPlaylists = await getAllPlaylists(userId);
    const localPlaylistTracks = await getAllPlaylistTracksRaw(userId);

    // 2. Push local tracks to Supabase user_tracks (safe metadata only)
    if (localTracks.length > 0) {
      const remoteTracksPayload = localTracks.map((t) => ({
        id: t.id,
        user_id: userId,
        youtube_id:
          t.youtube_id ||
          (t.source === 'youtube'
            ? t.id.replace(/^online_youtube_/, '').replace(/^track_yt_/, '').replace(/^yt_/, '')
            : null),
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
        is_playlist_only: t.is_playlist_only ?? 0,
      }));

      // Upsert in batches of 50 to prevent packet size overflow
      for (let i = 0; i < remoteTracksPayload.length; i += 50) {
        const batch = remoteTracksPayload.slice(i, i + 50);
        const { error: trackErr } = await supabase
          .from('user_tracks')
          .upsert(batch, { onConflict: 'user_id, id' });
        if (trackErr) {
          console.warn('Error syncing tracks batch to cloud, trying fallback schema:', trackErr.message);
          // Fallback if remote schema hasn't had youtube_id or is_playlist_only migrated yet
          const strippedBatch = batch.map(({ youtube_id, is_playlist_only, ...rest }: any) => rest);
          const { error: fallbackErr } = await supabase
            .from('user_tracks')
            .upsert(strippedBatch, { onConflict: 'user_id, id' });
          if (fallbackErr) {
            console.warn('Fallback sync failed:', fallbackErr.message);
          }
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
            youtube_id:
              rTrk.youtube_id ||
              (rTrk.id.startsWith('track_yt_')
                ? rTrk.id.replace(/^track_yt_/, '')
                : rTrk.id.startsWith('yt_')
                ? rTrk.id.replace(/^yt_/, '')
                : null),
            title: rTrk.title,
            artist: rTrk.artist || 'Unknown Artist',
            local_audio_uri: '',
            local_artwork_uri: rTrk.artwork_url || null,
            duration: rTrk.duration || 0,
            source: 'youtube',
            is_synced: 1,
            created_at: rTrk.created_at || new Date().toISOString(),
            sort_order: rTrk.sort_order ?? 0,
            is_playlist_only: rTrk.is_playlist_only ?? 0,
          });
        }
      }

      if (newTracksToSave.length > 0) {
        await saveTracks(newTracksToSave, userId);
        // If current active user in playerStore is this user, refresh playerStore tracks
        if (getActiveUserId() === userId) {
          const updatedTracks = await getAllTracks(userId);
          usePlayerStore.getState().setTracks(updatedTracks);
        }
      }
    }

    // 8. Trigger background sequential Auto-Download Sync if enabled
    runAutoDownloadSync(userId).catch((autoErr) => {
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
export async function runAutoDownloadSync(userId?: string): Promise<void> {
  const isEnabled = (await getSetting('auto_download_synced', 'true')) === 'true';
  if (!isEnabled) return;

  try {
    const uId = userId || getActiveUserId();
    const allTracks = await getAllTracks(uId);
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
export async function sharePlaylist(
  playlistId: string,
  forcePublic?: boolean
): Promise<SharePlaylistResult> {
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
    const playlists = await getAllPlaylists(userId);
    const target = playlists.find((p) => p.id === playlistId);
    if (!target) {
      return { success: false, error: 'Playlist not found.' };
    }

    const shareCode = target.share_code || generateShareCode();

    // 1. Save share_code in local SQLite
    await setPlaylistShareCode(playlistId, shareCode);

    // 2. Fetch tracks in this playlist
    const tracks = await getPlaylistTracks(playlistId, userId);

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

    const isPublicFinal =
      forcePublic !== undefined ? forcePublic : target.is_public === 1;

    const { error: plError } = await supabase.from('user_playlists').upsert(
      {
        id: target.id,
        user_id: userId,
        name: target.name,
        cover_url: cloudCoverUrl,
        share_code: shareCode,
        is_public: isPublicFinal,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' }
    );

    if (plError) {
      throw new Error(`Cloud playlist share failed: ${plError.message}`);
    }

    if (forcePublic !== undefined) {
      await updatePlaylistPublicStatus(playlistId, forcePublic);
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
 * Enforces owner-only permission: imported playlists (is_imported === 1) cannot be published.
 * If the playlist has not been uploaded/shared to Supabase yet, automatically uploads it
 * and verifies that Supabase confirms is_public === true.
 */
export async function togglePlaylistPublic(
  playlistId: string,
  isPublic: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const db = await getDatabase();
    const pl = await db.getFirstAsync<{
      id: string;
      name: string;
      share_code: string | null;
      is_imported?: number;
      is_public?: number;
    }>('SELECT id, name, share_code, is_imported, is_public FROM playlists WHERE id = ?', [
      playlistId,
    ]);

    if (!pl) {
      return { success: false, error: 'Playlist not found.' };
    }

    if (pl.is_imported === 1) {
      return {
        success: false,
        error: 'Only the original creator can make this playlist public or private.',
      };
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      // Still update local SQLite status if offline/guest
      await updatePlaylistPublicStatus(playlistId, isPublic);
      return { success: true };
    }

    // If making public and playlist has not been shared to Supabase yet
    if (isPublic) {
      if (!pl.share_code) {
        // Upload entire playlist + tracks to Supabase with is_public = true
        const shareRes = await sharePlaylist(playlistId, true);
        if (!shareRes.success) {
          throw new Error(shareRes.error || 'Failed to upload playlist to cloud.');
        }
      } else {
        // Check if playlist row exists in user_playlists
        const { data: existingPl } = await supabase
          .from('user_playlists')
          .select('id, is_public')
          .eq('id', playlistId)
          .maybeSingle();

        if (!existingPl) {
          const shareRes = await sharePlaylist(playlistId, true);
          if (!shareRes.success) {
            throw new Error(shareRes.error || 'Failed to upload playlist to cloud.');
          }
        } else {
          const { error: upErr } = await supabase
            .from('user_playlists')
            .update({ is_public: true, updated_at: new Date().toISOString() })
            .eq('id', playlistId);
          if (upErr) throw upErr;
        }
      }

      // Verify Supabase confirms is_public === true
      const { data: verified } = await supabase
        .from('user_playlists')
        .select('is_public')
        .eq('id', playlistId)
        .maybeSingle();

      if (verified && !verified.is_public) {
        console.warn('[togglePlaylistPublic] Warning: Cloud verified is_public was not true');
      }

      await updatePlaylistPublicStatus(playlistId, true);
    } else {
      // Making private
      if (pl.share_code) {
        const { error: privErr } = await supabase
          .from('user_playlists')
          .update({ is_public: false, updated_at: new Date().toISOString() })
          .eq('id', playlistId);
        if (privErr) {
          console.warn('Failed to set playlist private in Supabase:', privErr.message);
        }
      }
      await updatePlaylistPublicStatus(playlistId, false);
    }

    return { success: true };
  } catch (err: any) {
    console.error('Failed to toggle playlist public status:', err);
    return { success: false, error: err.message || 'Failed to update playlist status.' };
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
 * Fetch public community playlists for discovery sorted by most hearts first or newest.
 */
export async function fetchPublicPlaylists(
  limit = 30,
  sortBy: 'top' | 'newest' = 'top'
): Promise<SharedPlaylistData[]> {
  try {
    let query = supabase
      .from('user_playlists')
      .select('id, user_id, name, cover_url, share_code, created_at, updated_at, is_public, likes_count')
      .eq('is_public', true)
      .not('share_code', 'is', null);

    if (sortBy === 'top') {
      query = query
        .order('likes_count', { ascending: false })
        .order('updated_at', { ascending: false });
    } else {
      query = query.order('created_at', { ascending: false });
    }

    const { data: playlists, error } = await query.limit(limit);

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
        user_id: pl.user_id,
        name: pl.name,
        cover_url: pl.cover_url,
        share_code: pl.share_code,
        created_at: pl.created_at,
        updated_at: pl.updated_at,
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
    .select('id, user_id, name, cover_url, share_code, created_at, is_public, likes_count')
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
    user_id: playlist.user_id,
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
      const { error: insertErr } = await supabase.from('user_playlist_likes').upsert(
        {
          playlist_id: playlistId,
          user_id: currentUserId,
          created_at: new Date().toISOString(),
        },
        { onConflict: 'playlist_id,user_id', ignoreDuplicates: true }
      );

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
 * Import a fetched shared playlist into local SQLite inside an atomic transaction.
 * Strict Duplicate Prevention & Foreign-Key-Safe Insertion:
 *   1. Check if a local playlist with the same share_code already exists:
 *      If it exists, reuses that playlistId and merges missing tracks into it.
 *   2. Determine ownership:
 *      If current user is original creator, is_imported = 0; else is_imported = 1.
 *   3. Upsert playlist first (INSERT OR IGNORE + UPDATE, never INSERT OR REPLACE)
 *   4. Upsert every track in shared.tracks into `tracks` BEFORE linking
 *   5. Link `playlist_tracks` last only after both parent rows are verified in SQLite
 */
export async function importSharedPlaylist(
  shared: SharedPlaylistData
): Promise<Playlist> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  const cleanName = (shared.name || 'Untitled Playlist').trim();
  const resolvedCover =
    shared.cover_url ||
    (shared.tracks.length > 0 && shared.tracks[0].local_artwork_uri
      ? shared.tracks[0].local_artwork_uri
      : null);

  // 1. Prevent duplicate playlists: Check if a local playlist with the same share_code already exists
  const normalizedCode = shared.share_code ? normalizeShareCode(shared.share_code) : null;
  let existingPl: { id: string; is_imported?: number; user_id?: string; name?: string; cover_uri?: string | null } | null = null;

  if (normalizedCode) {
    existingPl = await db.getFirstAsync<{ id: string; is_imported?: number; user_id?: string; name?: string; cover_uri?: string | null }>(
      'SELECT id, is_imported, user_id, name, cover_uri FROM playlists WHERE UPPER(share_code) = UPPER(?) LIMIT 1',
      [normalizedCode]
    );
  }
  if (!existingPl && shared.id) {
    existingPl = await db.getFirstAsync<{ id: string; is_imported?: number; user_id?: string; name?: string; cover_uri?: string | null }>(
      'SELECT id, is_imported, user_id, name, cover_uri FROM playlists WHERE id = ? LIMIT 1',
      [shared.id]
    );
  }

  // Reuse existing local playlist ID if already present so duplicates are never created
  const playlistId = existingPl ? existingPl.id : (shared.id || `pl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);

  // 2. Ownership Check: Creator (is_imported = 0) vs Imported (is_imported = 1)
  const { data: authData } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }));
  const currentUserId = authData?.session?.user?.id;
  const isOriginalCreator = Boolean(
    (currentUserId && shared.user_id && currentUserId === shared.user_id) ||
    (existingPl && existingPl.is_imported === 0 && existingPl.user_id !== 'local_guest' && existingPl.user_id !== 'imported')
  );
  const isImportedFlag = isOriginalCreator ? 0 : 1;

  const localPlaylist: Playlist = {
    id: playlistId,
    user_id: existingPl?.user_id || (isOriginalCreator && currentUserId ? currentUserId : 'local_guest'),
    name: cleanName,
    cover_uri: resolvedCover || existingPl?.cover_uri || null,
    share_code: shared.share_code || null,
    sync_status: 'synced',
    sync_version: 1,
    is_synced: 0,
    is_public: shared.is_public ? 1 : 0,
    is_imported: isImportedFlag,
    created_at: now,
    track_count: shared.tracks.length,
  };

  await db.withTransactionAsync(async () => {
    // -------------------------------------------------------------------------
    // Step 1: Upsert Playlist First
    // INSERT OR IGNORE followed by UPDATE, never INSERT OR REPLACE (prevents CASCADE delete)
    // -------------------------------------------------------------------------
    await db.runAsync(
      `INSERT OR IGNORE INTO playlists (
        id, user_id, name, cover_uri, share_code, sync_status, sync_version, is_synced, is_public, is_imported, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        playlistId,
        localPlaylist.user_id,
        cleanName,
        resolvedCover,
        shared.share_code || null,
        'synced',
        1,
        0,
        shared.is_public ? 1 : 0,
        isImportedFlag,
        now,
      ]
    );

    await db.runAsync(
      `UPDATE playlists SET
        name = ?,
        cover_uri = COALESCE(?, cover_uri),
        share_code = COALESCE(?, share_code),
        is_public = ?,
        is_imported = ?
       WHERE id = ?`,
      [cleanName, resolvedCover, shared.share_code || null, shared.is_public ? 1 : 0, isImportedFlag, playlistId]
    );

    const plVerify = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM playlists WHERE id = ?',
      [playlistId]
    );
    if (!plVerify) {
      throw new Error(`Failed to ensure playlist record "${playlistId}" exists in local database.`);
    }

    // -------------------------------------------------------------------------
    // Step 2: Upsert Every Track into `tracks` BEFORE `playlist_tracks`
    // -------------------------------------------------------------------------
    if (shared.tracks.length > 0) {
      const localTracks = await db.getAllAsync<Track>('SELECT * FROM tracks').catch(() => []);
      const linksToInsert: { trackId: string }[] = [];

      for (let index = 0; index < shared.tracks.length; index++) {
        const t = shared.tracks[index];
        const normTitle = (t.title || '').trim().toLowerCase();
        const normArtist = (t.artist || '').trim().toLowerCase();

        // Match existing track by id, youtube_id, or normalized title + artist
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

        const targetTrackId = existing ? existing.id : t.id;
        const targetAudioUri = existing?.local_audio_uri || t.local_audio_uri || '';
        const targetArtwork = existing?.local_artwork_uri || t.local_artwork_uri || null;
        const targetDuration = existing?.duration && existing.duration > 0 ? existing.duration : (t.duration || 0);
        const targetYoutubeId = existing?.youtube_id || t.youtube_id || null;
        const targetSource = existing?.source || t.source || 'youtube';

        const targetIsPlaylistOnly =
          existing &&
          existing.local_audio_uri &&
          existing.local_audio_uri.trim().length > 0 &&
          existing.is_playlist_only === 0
            ? 0
            : 1;

        // Upsert into `tracks` first using INSERT OR IGNORE + UPDATE
        await db.runAsync(
          `INSERT OR IGNORE INTO tracks (
            id, user_id, youtube_id, title, artist, local_audio_uri, local_artwork_uri, duration, source, is_synced, created_at, sort_order, is_playlist_only
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            targetTrackId,
            'local_guest',
            targetYoutubeId,
            t.title || 'Unknown Title',
            t.artist || 'Unknown Artist',
            targetAudioUri,
            targetArtwork,
            targetDuration,
            targetSource,
            0,
            t.created_at || now,
            index,
            targetIsPlaylistOnly,
          ]
        );

        await db.runAsync(
          `UPDATE tracks SET
            title = ?,
            artist = ?,
            local_audio_uri = CASE WHEN ? != '' THEN ? ELSE local_audio_uri END,
            local_artwork_uri = COALESCE(?, local_artwork_uri),
            duration = CASE WHEN ? > 0 THEN ? ELSE duration END,
            youtube_id = COALESCE(?, youtube_id),
            source = ?,
            is_playlist_only = COALESCE(?, is_playlist_only)
           WHERE id = ?`,
          [
            t.title || 'Unknown Title',
            t.artist || 'Unknown Artist',
            targetAudioUri,
            targetAudioUri,
            targetArtwork,
            targetDuration,
            targetDuration,
            targetYoutubeId,
            targetSource,
            targetIsPlaylistOnly,
            targetTrackId,
          ]
        );

        // Verify track exists in SQLite tracks
        const trackVerify = await db.getFirstAsync<{ id: string }>(
          'SELECT id FROM tracks WHERE id = ?',
          [targetTrackId]
        );
        if (trackVerify) {
          linksToInsert.push({ trackId: targetTrackId });
        } else {
          console.warn(`[importSharedPlaylist] Failed to verify track ${targetTrackId}`);
        }
      }

      // -------------------------------------------------------------------------
      // Step 3: Link `playlist_tracks` Last
      // For imported playlists (is_imported === 1), replace playlist_tracks so it
      // accurately mirrors the creator's track list and ordering.
      // For owned playlists, merge missing tracks retaining position ordering.
      // -------------------------------------------------------------------------
      if (isImportedFlag === 1) {
        await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);
        for (let i = 0; i < linksToInsert.length; i++) {
          const link = linksToInsert[i];
          const linkId = `pt_${playlistId}_${link.trackId}`;
          await db.runAsync(
            `INSERT OR REPLACE INTO playlist_tracks (
              id, playlist_id, track_id, position, sort_order, created_at, added_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [linkId, playlistId, link.trackId, i, i, now, now]
          );
        }
      } else {
        const maxPosRow = await db.getFirstAsync<{ max_pos: number | null }>(
          'SELECT MAX(COALESCE(sort_order, position, 0)) AS max_pos FROM playlist_tracks WHERE playlist_id = ?',
          [playlistId]
        );
        let nextPos = (maxPosRow?.max_pos ?? -1) + 1;

        for (const link of linksToInsert) {
          const linkId = `pt_${playlistId}_${link.trackId}`;
          await db.runAsync(
            `INSERT OR IGNORE INTO playlist_tracks (
              id, playlist_id, track_id, position, sort_order, created_at, added_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [linkId, playlistId, link.trackId, nextPos, nextPos, now, now]
          );
          nextPos++;
        }
      }
    }
  });

  return localPlaylist;
}

/**
 * Refresh an imported playlist from the cloud.
 * Re-fetches the creator's latest tracks and cover artwork using the share_code,
 * updates local SQLite metadata and tracks, but NEVER pushes any changes back to Supabase.
 */
export async function refreshPlaylistFromCloud(
  playlistId: string
): Promise<{ success: boolean; trackCount: number; error?: string }> {
  try {
    const db = await getDatabase();
    const pl = await db.getFirstAsync<{ id: string; share_code: string | null; name: string }>(
      'SELECT id, share_code, name FROM playlists WHERE id = ?',
      [playlistId]
    );

    if (!pl || !pl.share_code) {
      return { success: false, trackCount: 0, error: 'Playlist has no share code to refresh.' };
    }

    const remoteData = await fetchSharedPlaylist(pl.share_code);
    await importSharedPlaylist(remoteData);

    return { success: true, trackCount: remoteData.tracks.length };
  } catch (err: any) {
    console.error('Failed to refresh playlist from cloud:', err);
    return { success: false, trackCount: 0, error: err.message || 'Failed to refresh playlist.' };
  }
}

/**
 * Safely delete a playlist:
 * - If is_imported === 1 (or current user is not owner): deletes ONLY from local SQLite.
 *   NEVER deletes or unshares from Supabase cloud tables or storage so creator's playlist stays online.
 * - If is_imported === 0 (current user is owner): deletes from local SQLite AND deletes
 *   from Supabase user_playlists and storage.
 */
export async function deletePlaylistWithSync(playlist: Playlist): Promise<void> {
  const isImported = playlist.is_imported === 1;

  if (!isImported) {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.user && (playlist.user_id === session.user.id || playlist.user_id === 'local_guest')) {
        await supabase
          .from('user_playlists')
          .delete()
          .eq('id', playlist.id)
          .eq('user_id', session.user.id);

        await supabase.storage
          .from('playlist-covers')
          .remove([`${playlist.id}.jpg`, playlist.id]);
      }
    } catch (cloudErr) {
      console.warn('[DeletePlaylistWithSync] Cloud deletion warning:', cloudErr);
    }
  }

  // If imported playlist, clean up orphaned is_playlist_only = 1 tracks and their cached local files
  if (isImported) {
    try {
      const db = await getDatabase();
      const tracksInPlaylist = await db.getAllAsync<{
        id: string;
        local_audio_uri: string;
        local_artwork_uri: string | null;
      }>(
        `SELECT t.id, t.local_audio_uri, t.local_artwork_uri
         FROM tracks t
         JOIN playlist_tracks pt ON t.id = pt.track_id
         WHERE pt.playlist_id = ? AND t.is_playlist_only = 1`,
        [playlist.id]
      );

      for (const t of tracksInPlaylist) {
        const otherUse = await db.getFirstAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM playlist_tracks WHERE track_id = ? AND playlist_id != ?',
          [t.id, playlist.id]
        );
        if (!otherUse || otherUse.count === 0) {
          // Orphaned track: clean up cached local audio file if stored
          if (
            t.local_audio_uri &&
            (t.local_audio_uri.startsWith('file://') || t.local_audio_uri.includes('jstream_tracks'))
          ) {
            try {
              await FileSystem.deleteAsync(t.local_audio_uri, { idempotent: true });
            } catch {
              // ignore
            }
          }
          if (t.local_artwork_uri && t.local_artwork_uri.startsWith('file://')) {
            try {
              await FileSystem.deleteAsync(t.local_artwork_uri, { idempotent: true });
            } catch {
              // ignore
            }
          }
          await db.runAsync('DELETE FROM tracks WHERE id = ?', [t.id]);
        }
      }
    } catch (cleanErr) {
      console.warn('[DeletePlaylistWithSync] Orphaned track cleanup warning:', cleanErr);
    }
  }

  await deletePlaylist(playlist.id);
}

export interface LibraryBackupData {
  version: number;
  exported_at: string;
  user_id: string;
  tracks: Track[];
  playlists: Playlist[];
  playlist_tracks: {
    playlist_id: string;
    track_id: string;
    position: number;
    sort_order: number;
    added_at: string;
  }[];
}

/**
 * Serializes the user's entire local music library and playlists into an offline JSON backup.
 */
export async function exportLibraryBackupJson(userId?: string): Promise<string> {
  const uId = userId || getActiveUserId();
  const tracks = await getAllTracks(uId);
  const playlists = await getAllPlaylists(uId);
  const playlistTracks = await getAllPlaylistTracksRaw(uId);

  const backup: LibraryBackupData = {
    version: 1,
    exported_at: new Date().toISOString(),
    user_id: uId,
    tracks,
    playlists,
    playlist_tracks: playlistTracks.map((pt) => ({
      playlist_id: pt.playlist_id,
      track_id: pt.track_id,
      position: pt.position ?? pt.sort_order ?? 0,
      sort_order: pt.sort_order ?? pt.position ?? 0,
      added_at: pt.added_at || pt.created_at || new Date().toISOString(),
    })),
  };

  return JSON.stringify(backup, null, 2);
}

/**
 * Imports a previously exported JSON backup into the user's local SQLite database.
 */
export async function importLibraryBackupJson(
  jsonString: string,
  targetUserId?: string
): Promise<{ success: boolean; tracksCount: number; playlistsCount: number; error?: string }> {
  try {
    const data: LibraryBackupData = JSON.parse(jsonString);
    if (!data || !Array.isArray(data.tracks) || !Array.isArray(data.playlists)) {
      return { success: false, tracksCount: 0, playlistsCount: 0, error: 'Invalid backup file format.' };
    }

    const uId = targetUserId || getActiveUserId();
    const tracksToImport: Track[] = data.tracks.map((t) => ({
      ...t,
      user_id: uId,
      local_audio_uri: t.local_audio_uri || '',
    }));

    if (tracksToImport.length > 0) {
      await saveTracks(tracksToImport, uId);
    }

    for (const p of data.playlists) {
      await createPlaylist(p.name, p.cover_uri, p.share_code, p.id, uId, p.is_public ?? 0);
    }

    if (Array.isArray(data.playlist_tracks)) {
      for (const pt of data.playlist_tracks) {
        await upsertPlaylistTrack(pt.playlist_id, pt.track_id, pt.position, pt.sort_order, pt.added_at);
      }
    }

    // Refresh player store if importing into active user
    const currentActive = getActiveUserId();
    if (uId === currentActive) {
      const updatedTracks = await getAllTracks(uId);
      usePlayerStore.getState().setTracks(updatedTracks);
    }

    return {
      success: true,
      tracksCount: tracksToImport.length,
      playlistsCount: data.playlists.length,
    };
  } catch (err: any) {
    return {
      success: false,
      tracksCount: 0,
      playlistsCount: 0,
      error: err.message || 'Import failed.',
    };
  }
}
