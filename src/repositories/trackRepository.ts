import { getDatabase, getActiveUserId } from '@/lib/database';
import { Track } from '@/types/music';

export async function getAllTracks(userId: string = getActiveUserId()): Promise<Track[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Track>(
    'SELECT * FROM tracks WHERE user_id = ? AND COALESCE(is_playlist_only, 0) = 0 ORDER BY sort_order ASC, created_at DESC',
    [userId]
  );
  return rows;
}

export async function getTrackById(id: string, userId: string = getActiveUserId()): Promise<Track | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Track>(
    'SELECT * FROM tracks WHERE user_id = ? AND id = ?',
    [userId, id]
  );
  return row ?? null;
}

export async function saveTrack(track: Track, userId?: string): Promise<void> {
  const db = await getDatabase();
  const uId = userId || track.user_id || getActiveUserId();
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
      is_playlist_only = COALESCE(excluded.is_playlist_only, tracks.is_playlist_only)`,
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
      const uId = userId || track.user_id || getActiveUserId();
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
          is_playlist_only = COALESCE(excluded.is_playlist_only, tracks.is_playlist_only)`,
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
  const db = await getDatabase();
  const trimmed = query.trim();
  if (!trimmed) {
    return getAllTracks(userId);
  }

  const pattern = `%${trimmed}%`;
  const rows = await db.getAllAsync<Track>(
    `SELECT * FROM tracks 
     WHERE user_id = ? AND COALESCE(is_playlist_only, 0) = 0 AND (title LIKE ? OR artist LIKE ?) 
     ORDER BY title COLLATE NOCASE ASC`,
    [userId, pattern, pattern]
  );
  return rows;
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
} from '@/lib/database';
