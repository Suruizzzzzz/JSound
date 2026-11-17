import { getDatabase } from '@/lib/database';
import { Track } from '@/types/music';

export async function getAllTracks(userId: string = 'local_guest'): Promise<Track[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Track>(
    'SELECT * FROM tracks WHERE user_id = ? ORDER BY title COLLATE NOCASE ASC',
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
  await db.runAsync(
    `INSERT OR REPLACE INTO tracks (
      id, user_id, youtube_id, title, artist, local_audio_uri, local_artwork_uri, duration, source, is_synced, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      track.id,
      track.user_id || 'local_guest',
      track.youtube_id,
      track.title,
      track.artist,
      track.local_audio_uri,
      track.local_artwork_uri,
      track.duration,
      track.source,
      track.is_synced ?? 0,
      track.created_at,
    ]
  );
}

export async function saveTracks(tracks: Track[]): Promise<void> {
  if (tracks.length === 0) return;
  const db = await getDatabase();

  await db.withTransactionAsync(async () => {
    for (const track of tracks) {
      await db.runAsync(
        `INSERT OR REPLACE INTO tracks (
          id, user_id, youtube_id, title, artist, local_audio_uri, local_artwork_uri, duration, source, is_synced, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          track.id,
          track.user_id || 'local_guest',
          track.youtube_id,
          track.title,
          track.artist,
          track.local_audio_uri,
          track.local_artwork_uri,
          track.duration,
          track.source,
          track.is_synced ?? 0,
          track.created_at,
        ]
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
     WHERE user_id = ? AND (title LIKE ? OR artist LIKE ?) 
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
