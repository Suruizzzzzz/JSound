import { getDatabase } from '@/lib/database';
import { Track } from '@/types/music';

export async function getAllTracks(userId: string = 'local_guest'): Promise<Track[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Track>(
    'SELECT * FROM tracks WHERE user_id = ? AND COALESCE(is_playlist_only, 0) = 0 ORDER BY sort_order ASC, created_at DESC',
    [userId]
  );
  return rows;
}

export async function getTrackById(id: string): Promise<Track | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Track>(
    'SELECT * FROM tracks WHERE id = ?',
    [id]
  );
  return row ?? null;
}

export async function saveTrack(track: Track): Promise<void> {
  const db = await getDatabase();
  const now = track.created_at || new Date().toISOString();
  await db.runAsync(
    `INSERT OR IGNORE INTO tracks (
      id, user_id, youtube_id, title, artist, local_audio_uri, local_artwork_uri, duration, source, is_synced, created_at, sort_order, is_playlist_only
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      track.id,
      track.user_id || 'local_guest',
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

  await db.runAsync(
    `UPDATE tracks SET
      user_id = COALESCE(?, user_id),
      youtube_id = COALESCE(?, youtube_id),
      title = ?,
      artist = ?,
      local_audio_uri = CASE WHEN ? != '' THEN ? ELSE local_audio_uri END,
      local_artwork_uri = COALESCE(?, local_artwork_uri),
      duration = CASE WHEN ? > 0 THEN ? ELSE duration END,
      source = ?,
      is_synced = COALESCE(?, is_synced),
      is_playlist_only = COALESCE(?, is_playlist_only)
    WHERE id = ?`,
    [
      track.user_id || 'local_guest',
      track.youtube_id || null,
      track.title || 'Unknown Title',
      track.artist || 'Unknown Artist',
      track.local_audio_uri || '',
      track.local_audio_uri || '',
      track.local_artwork_uri || null,
      track.duration || 0,
      track.duration || 0,
      track.source || 'youtube',
      track.is_synced ?? 0,
      track.is_playlist_only ?? null,
      track.id,
    ]
  );
}

export async function saveTracks(tracks: Track[]): Promise<void> {
  if (tracks.length === 0) return;
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    for (const track of tracks) {
      const now = track.created_at || new Date().toISOString();
      await db.runAsync(
        `INSERT OR IGNORE INTO tracks (
          id, user_id, youtube_id, title, artist, local_audio_uri, local_artwork_uri, duration, source, is_synced, created_at, sort_order, is_playlist_only
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          track.id,
          track.user_id || 'local_guest',
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

      await db.runAsync(
        `UPDATE tracks SET
          user_id = COALESCE(?, user_id),
          youtube_id = COALESCE(?, youtube_id),
          title = ?,
          artist = ?,
          local_audio_uri = CASE WHEN ? != '' THEN ? ELSE local_audio_uri END,
          local_artwork_uri = COALESCE(?, local_artwork_uri),
          duration = CASE WHEN ? > 0 THEN ? ELSE duration END,
          source = ?,
          is_synced = COALESCE(?, is_synced),
          is_playlist_only = COALESCE(?, is_playlist_only)
        WHERE id = ?`,
        [
          track.user_id || 'local_guest',
          track.youtube_id || null,
          track.title || 'Unknown Title',
          track.artist || 'Unknown Artist',
          track.local_audio_uri || '',
          track.local_audio_uri || '',
          track.local_artwork_uri || null,
          track.duration || 0,
          track.duration || 0,
          track.source || 'youtube',
          track.is_synced ?? 0,
          track.is_playlist_only ?? null,
          track.id,
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

export async function searchLocalTracks(query: string, userId: string = 'local_guest'): Promise<Track[]> {
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

export async function deleteTrack(id: string): Promise<void> {
  const db = await getDatabase();
  await db.runAsync('DELETE FROM tracks WHERE id = ?', [id]);
}

export async function clearAllTracks(userId: string = 'local_guest'): Promise<void> {
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
