import { getDatabase, getActiveUserId } from '@/lib/database';
import { Track } from '@/types/music';
import * as FileSystem from 'expo-file-system/legacy';

async function isLocalTrackFilePresent(uri: string | null | undefined): Promise<boolean> {
  if (!uri || !uri.trim()) return false;
  if (uri.startsWith('http://') || uri.startsWith('https://')) return false;
  if (uri.startsWith('file://')) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      return info.exists === true;
    } catch {
      // Never hide or drop a local track on transient FS errors
      return true;
    }
  }
  return true;
}

export async function getAllTracks(userId: string = getActiveUserId()): Promise<Track[]> {
  const db = await getDatabase();
  const primaryRows = await db.getAllAsync<Track>(
    'SELECT * FROM tracks WHERE user_id = ? AND COALESCE(is_playlist_only, 0) = 0 ORDER BY sort_order ASC, created_at DESC',
    [userId]
  );

  // Unify/recover locally downloaded tracks saved across scopes without leaking is_playlist_only = 1
  const fallbackRows =
    userId !== 'local_guest'
      ? await db.getAllAsync<Track>(
          "SELECT * FROM tracks WHERE user_id = 'local_guest' AND COALESCE(is_playlist_only, 0) = 0 AND local_audio_uri IS NOT NULL AND TRIM(local_audio_uri) != '' ORDER BY sort_order ASC, created_at DESC"
        )
      : await db.getAllAsync<Track>(
          "SELECT * FROM tracks WHERE user_id != 'local_guest' AND COALESCE(is_playlist_only, 0) = 0 AND local_audio_uri IS NOT NULL AND TRIM(local_audio_uri) != '' ORDER BY sort_order ASC, created_at DESC"
        );

  if (fallbackRows.length === 0) {
    return primaryRows;
  }

  const byId = new Map<string, Track>();
  for (const row of primaryRows) {
    byId.set(row.id, row);
  }

  for (const candidate of fallbackRows) {
    if (!(await isLocalTrackFilePresent(candidate.local_audio_uri))) {
      continue;
    }
    const existing = byId.get(candidate.id);
    if (!existing) {
      byId.set(candidate.id, candidate);
    } else if (!existing.local_audio_uri || !existing.local_audio_uri.trim()) {
      byId.set(candidate.id, {
        ...existing,
        local_audio_uri: candidate.local_audio_uri,
        local_artwork_uri: existing.local_artwork_uri || candidate.local_artwork_uri,
      });
    }
  }

  return Array.from(byId.values());
}

export async function getTrackById(id: string, userId: string = getActiveUserId()): Promise<Track | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Track>(
    'SELECT * FROM tracks WHERE user_id = ? AND id = ?',
    [userId, id]
  );
  if (row) return row;

  const fallback = await db.getFirstAsync<Track>(
    "SELECT * FROM tracks WHERE id = ? AND COALESCE(is_playlist_only, 0) = 0 AND local_audio_uri IS NOT NULL AND TRIM(local_audio_uri) != '' LIMIT 1",
    [id]
  );
  if (fallback && (await isLocalTrackFilePresent(fallback.local_audio_uri))) {
    return fallback;
  }
  return null;
}

export async function saveTrack(track: Track, userId?: string): Promise<void> {
  const db = await getDatabase();
  const uId = userId || track.user_id || getActiveUserId() || 'local_guest';
  const now = track.created_at || new Date().toISOString();

  await db.runAsync(
    `INSERT INTO tracks (
      id, user_id, youtube_id, title, artist, local_audio_uri, local_artwork_uri, duration, source, is_synced, created_at, sort_order, is_playlist_only
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, id) DO UPDATE SET
      youtube_id = COALESCE(excluded.youtube_id, tracks.youtube_id),
      title = excluded.title,
      artist = excluded.artist,
      local_audio_uri = CASE WHEN excluded.local_audio_uri != '' THEN excluded.local_audio_uri ELSE tracks.local_audio_uri END,
      local_artwork_uri = COALESCE(excluded.local_artwork_uri, tracks.local_artwork_uri),
      duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE tracks.duration END,
      source = excluded.source,
      is_synced = excluded.is_synced,
      is_playlist_only = CASE
        WHEN excluded.is_playlist_only = 1 THEN 1
        WHEN tracks.is_playlist_only = 1 AND (excluded.local_audio_uri IS NULL OR excluded.local_audio_uri = '') THEN 1
        WHEN excluded.is_playlist_only = 0 THEN 0
        ELSE tracks.is_playlist_only
      END`,
    [
      track.id,
      uId,
      track.youtube_id || null,
      track.title || 'Unknown Title',
      track.artist || 'Unknown Artist',
      track.local_audio_uri || '',
      track.local_artwork_uri || null,
      track.duration || 0,
      track.source || 'youtube',
      track.is_synced ?? 0,
      now,
      track.sort_order ?? 0,
      track.is_playlist_only ?? 0,
    ]
  );
}

export async function saveTracks(tracks: Track[], userId?: string): Promise<void> {
  if (tracks.length === 0) return;
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    for (const track of tracks) {
      const uId = userId || track.user_id || getActiveUserId() || 'local_guest';
      const now = track.created_at || new Date().toISOString();

      await db.runAsync(
        `INSERT INTO tracks (
          id, user_id, youtube_id, title, artist, local_audio_uri, local_artwork_uri, duration, source, is_synced, created_at, sort_order, is_playlist_only
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET
          youtube_id = COALESCE(excluded.youtube_id, tracks.youtube_id),
          title = excluded.title,
          artist = excluded.artist,
          local_audio_uri = CASE WHEN excluded.local_audio_uri != '' THEN excluded.local_audio_uri ELSE tracks.local_audio_uri END,
          local_artwork_uri = COALESCE(excluded.local_artwork_uri, tracks.local_artwork_uri),
          duration = CASE WHEN excluded.duration > 0 THEN excluded.duration ELSE tracks.duration END,
          source = excluded.source,
          is_synced = excluded.is_synced,
          is_playlist_only = CASE
            WHEN excluded.is_playlist_only = 1 THEN 1
            WHEN tracks.is_playlist_only = 1 AND (excluded.local_audio_uri IS NULL OR excluded.local_audio_uri = '') THEN 1
            WHEN excluded.is_playlist_only = 0 THEN 0
            ELSE tracks.is_playlist_only
          END`,
        [
          track.id,
          uId,
          track.youtube_id || null,
          track.title || 'Unknown Title',
          track.artist || 'Unknown Artist',
          track.local_audio_uri || '',
          track.local_artwork_uri || null,
          track.duration || 0,
          track.source || 'youtube',
          track.is_synced ?? 0,
          now,
          track.sort_order ?? 0,
          track.is_playlist_only ?? 0,
        ]
      );
    }
  });
}

export async function updateTrackOrder(orderedIds: string[]): Promise<void> {
  if (orderedIds.length === 0) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (let index = 0; index < orderedIds.length; index++) {
      await db.runAsync(
        'UPDATE tracks SET sort_order = ? WHERE id = ?',
        [index, orderedIds[index]]
      );
    }
  });
}

export async function searchLocalTracks(query: string, userId: string = getActiveUserId()): Promise<Track[]> {
  const allTracks = await getAllTracks(userId);
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return allTracks;
  }

  return allTracks
    .filter(
      (t) =>
        (t.title || '').toLowerCase().includes(trimmed) ||
        (t.artist || '').toLowerCase().includes(trimmed)
    )
    .sort((a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' }));
}

export async function deleteTrack(id: string, userId: string = getActiveUserId()): Promise<void> {
  const db = await getDatabase();
  // Get track to know local_audio_uri before deleting
  const track = await db.getFirstAsync<{ local_audio_uri?: string }>(
    'SELECT local_audio_uri FROM tracks WHERE user_id = ? AND id = ?',
    [userId, id]
  );

  await db.runAsync('DELETE FROM tracks WHERE user_id = ? AND id = ?', [userId, id]);
  await db.runAsync(
    'DELETE FROM playlist_tracks WHERE track_id = ? AND playlist_id IN (SELECT id FROM playlists WHERE user_id = ?)',
    [id, userId]
  );

  // Safeguard: Check if any other user or playlist still references this physical file
  if (track?.local_audio_uri && track.local_audio_uri.startsWith('file://')) {
    try {
      const otherReferences = await db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM tracks WHERE local_audio_uri = ?',
        [track.local_audio_uri]
      );
      if ((otherReferences?.count ?? 0) === 0) {
        // No other user has this song, safely delete file from disk to reclaim storage
        const FileSystem = await import('expo-file-system/legacy');
        await FileSystem.deleteAsync(track.local_audio_uri, { idempotent: true });
      }
    } catch (err) {
      console.warn('Failed to clean up physical audio file:', err);
    }
  }
}

export async function clearAllTracks(userId: string = getActiveUserId()): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM tracks WHERE user_id = ?', [userId]);
}

export {
  upsertTrack,
  cleanupDuplicateImportedPlaylists,
  updateTrackArtwork,
  updateTrackMetadata,
  createPlaylist,
  getAllPlaylists,
  getPlaylistById,
  deletePlaylist,
  updatePlaylistName,
  updatePlaylistCover,
  setPlaylistShareCode,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  getPlaylistTracks,
  isTrackInPlaylist,
  getPlaylistsContainingTrack,
  upsertPlaylistTrack,
  getAllPlaylistTracksRaw,
  cleanupImportedTracks,
} from '@/lib/database';
