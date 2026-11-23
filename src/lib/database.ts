import * as SQLite from 'expo-sqlite';
import { Track, Playlist } from '@/types/music';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!dbInstance) {
    dbInstance = await SQLite.openDatabaseAsync('jstream.db');
  }
  return dbInstance;
}

export async function initDatabase(): Promise<SQLite.SQLiteDatabase> {
  const db = await getDatabase();

  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS tracks (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local_guest',
      youtube_id TEXT,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      local_audio_uri TEXT NOT NULL,
      local_artwork_uri TEXT,
      duration REAL NOT NULL DEFAULT 0,
      source TEXT NOT NULL CHECK(source IN ('local', 'youtube')),
      is_synced INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_playlist_only INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON tracks (user_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks (title);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks (artist);

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local_guest',
      name TEXT NOT NULL,
      cover_uri TEXT,
      share_code TEXT,
      sync_status TEXT DEFAULT 'synced',
      sync_version INTEGER NOT NULL DEFAULT 1,
      is_synced INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 0,
      is_imported INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists (user_id);

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id TEXT PRIMARY KEY NOT NULL,
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      added_at TEXT,
      FOREIGN KEY (playlist_id) REFERENCES playlists (id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES tracks (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks (playlist_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_track_unique ON playlist_tracks (playlist_id, track_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  try {
    await db.execAsync('ALTER TABLE tracks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;');
  } catch {
    // Column already exists, safe to ignore
  }

  try {
    await db.execAsync('ALTER TABLE tracks ADD COLUMN is_playlist_only INTEGER NOT NULL DEFAULT 0;');
  } catch {
    // Column already exists, safe to ignore
  }

  // Backfill: Remove existing un-downloaded cloud tracks from "Your Library -> All Songs"
  // if they belong to a playlist.
  try {
    await db.execAsync(`
      UPDATE tracks
      SET is_playlist_only = 1
      WHERE COALESCE(is_playlist_only, 0) = 0
        AND (local_audio_uri IS NULL OR TRIM(local_audio_uri) = '')
        AND id IN (SELECT DISTINCT track_id FROM playlist_tracks);
    `);
  } catch {
    // Ignore if tables not yet populated
  }

  try {
    await db.execAsync('ALTER TABLE playlists ADD COLUMN cover_uri TEXT;');
  } catch {
    // Column already exists, safe to ignore
  }

  try {
    await db.execAsync('ALTER TABLE playlists ADD COLUMN share_code TEXT;');
  } catch {
    // Column already exists, safe to ignore
  }

  try {
    await db.execAsync('ALTER TABLE playlists ADD COLUMN sync_version INTEGER NOT NULL DEFAULT 1;');
  } catch {
    // Column already exists, safe to ignore
  }

  try {
    await db.execAsync("ALTER TABLE playlists ADD COLUMN sync_status TEXT DEFAULT 'synced';");
  } catch {
    // Column already exists, safe to ignore
  }

  try {
    await db.execAsync('ALTER TABLE playlist_tracks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;');
  } catch {
    // Column already exists, safe to ignore
  }

  try {
    await db.execAsync('ALTER TABLE playlist_tracks ADD COLUMN added_at TEXT;');
  } catch {
    // Column already exists, safe to ignore
  }

  try {
    await db.execAsync('ALTER TABLE playlists ADD COLUMN is_public INTEGER NOT NULL DEFAULT 0;');
  } catch {
    // Column already exists, safe to ignore
  }

  try {
    await db.execAsync('ALTER TABLE playlists ADD COLUMN is_imported INTEGER NOT NULL DEFAULT 0;');
  } catch {
    // Column already exists, safe to ignore
  }

  // Safe startup cleanup for empty duplicate imported playlists
  await cleanupDuplicateImportedPlaylists();

  return db;
}

export async function getSetting(key: string, defaultValue: string | null = null): Promise<string | null> {
  try {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM app_settings WHERE key = ?',
      [key]
    );
    return row?.value ?? defaultValue;
  } catch {
    return defaultValue;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  try {
    const db = await getDatabase();
    await db.runAsync(
      'INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)',
      [key, value]
    );
  } catch (err) {
    console.warn('Failed to persist setting:', err);
  }
}

// -------------------------------------------------------------
// Track Artwork & Metadata Update Helpers
// -------------------------------------------------------------

export async function updateTrackArtwork(
  trackId: string,
  newArtworkUri: string | null
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE tracks SET local_artwork_uri = ? WHERE id = ?',
    [newArtworkUri, trackId]
  );
}

export async function updateTrackMetadata(
  trackId: string,
  updates: { title?: string; artist?: string; local_artwork_uri?: string | null }
): Promise<void> {
  const db = await getDatabase();
  const fields: string[] = [];
  const params: any[] = [];

  if (updates.title !== undefined) {
    fields.push('title = ?');
    params.push(updates.title);
  }
  if (updates.artist !== undefined) {
    fields.push('artist = ?');
    params.push(updates.artist);
  }
  if (updates.local_artwork_uri !== undefined) {
    fields.push('local_artwork_uri = ?');
    params.push(updates.local_artwork_uri);
  }

  if (fields.length === 0) return;
  params.push(trackId);

  await db.runAsync(
    `UPDATE tracks SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
}

export async function updatePlaylistCover(
  playlistId: string,
  newCoverUri: string | null
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE playlists SET cover_uri = ? WHERE id = ?',
    [newCoverUri, playlistId]
  );
}

// -------------------------------------------------------------
// Offline Playlist Helpers
// -------------------------------------------------------------

export async function updatePlaylistName(
  playlistId: string,
  name: string
): Promise<void> {
  const db = await getDatabase();
  const cleanName = name.trim() || 'Untitled Playlist';
  await db.runAsync(
    'UPDATE playlists SET name = ?, sync_version = COALESCE(sync_version, 1) + 1 WHERE id = ?',
    [cleanName, playlistId]
  );
}

export async function setPlaylistShareCode(
  playlistId: string,
  shareCode: string | null
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE playlists SET share_code = ? WHERE id = ?',
    [shareCode, playlistId]
  );
}

export async function updatePlaylistPublicStatus(
  playlistId: string,
  isPublic: boolean
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'UPDATE playlists SET is_public = ?, sync_version = COALESCE(sync_version, 1) + 1 WHERE id = ?',
    [isPublic ? 1 : 0, playlistId]
  );
}

export async function upsertTrack(track: Track): Promise<void> {
  const db = await getDatabase();
  const now = track.created_at || new Date().toISOString();
  await db.runAsync(
    `INSERT OR IGNORE INTO tracks (
      id, user_id, youtube_id, title, artist, local_audio_uri, local_artwork_uri, duration, source, is_synced, created_at, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      is_synced = COALESCE(?, is_synced)
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
      track.id,
    ]
  );
}

/**
 * Safe cleanup helper that removes empty (0 tracks) duplicate playlist rows
 * that share the same share_code as an existing populated playlist.
 */
export async function cleanupDuplicateImportedPlaylists(): Promise<number> {
  try {
    const db = await getDatabase();
    const emptyDups = await db.getAllAsync<{ id: string }>(
      `SELECT p1.id
       FROM playlists p1
       LEFT JOIN playlist_tracks pt1 ON p1.id = pt1.playlist_id
       WHERE p1.share_code IS NOT NULL AND TRIM(p1.share_code) != ''
       GROUP BY p1.id
       HAVING COUNT(pt1.track_id) = 0
       AND EXISTS (
         SELECT 1
         FROM playlists p2
         JOIN playlist_tracks pt2 ON p2.id = pt2.playlist_id
         WHERE UPPER(p2.share_code) = UPPER(p1.share_code)
         AND p2.id != p1.id
       )`
    );

    let removed = 0;
    if (emptyDups.length > 0) {
      await db.withTransactionAsync(async () => {
        for (const row of emptyDups) {
          await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ?', [row.id]);
          await db.runAsync('DELETE FROM playlists WHERE id = ?', [row.id]);
          removed++;
        }
      });
    }

    return removed;
  } catch (err) {
    console.warn('[database] cleanupDuplicateImportedPlaylists error:', err);
    return 0;
  }
}

export async function createPlaylist(
  name: string,
  coverUri?: string | null,
  shareCode?: string | null,
  customId?: string,
  userId: string = 'local_guest',
  isPublic: boolean | number = 0,
  isImported: boolean | number = 0
): Promise<Playlist> {
  const db = await getDatabase();
  const id = customId || `pl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();
  const cleanName = name.trim() || 'Untitled Playlist';
  const publicFlag = isPublic ? 1 : 0;
  const importedFlag = isImported ? 1 : 0;
  const playlist: Playlist = {
    id,
    user_id: userId,
    name: cleanName,
    cover_uri: coverUri || null,
    share_code: shareCode || null,
    sync_status: 'synced',
    sync_version: 1,
    is_synced: 0,
    is_public: publicFlag,
    is_imported: importedFlag,
    created_at: now,
    track_count: 0,
  };

  // Safe UPSERT (INSERT OR IGNORE + UPDATE) to prevent triggering ON DELETE CASCADE
  await db.runAsync(
    `INSERT OR IGNORE INTO playlists (id, user_id, name, cover_uri, share_code, sync_status, sync_version, is_synced, is_public, is_imported, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      playlist.id,
      playlist.user_id,
      playlist.name,
      playlist.cover_uri ?? null,
      playlist.share_code ?? null,
      playlist.sync_status ?? 'synced',
      playlist.sync_version ?? 1,
      0,
      playlist.is_public ?? 0,
      playlist.is_imported ?? 0,
      playlist.created_at,
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
    [
      playlist.name,
      playlist.cover_uri ?? null,
      playlist.share_code ?? null,
      playlist.is_public ?? 0,
      playlist.is_imported ?? 0,
      playlist.id,
    ]
  );

  return playlist;
}

export async function getAllPlaylists(): Promise<Playlist[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Playlist & { track_count: number }>(
    `SELECT p.*, COUNT(pt.track_id) AS track_count
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
     GROUP BY p.id
     ORDER BY p.created_at DESC`
  );
  return rows;
}

export async function getPlaylistById(playlistId: string): Promise<Playlist | null> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<Playlist & { track_count: number }>(
    `SELECT p.*, COUNT(pt.track_id) AS track_count
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
     WHERE p.id = ?
     GROUP BY p.id`,
    [playlistId]
  );
  return row ?? null;
}

export async function deletePlaylist(playlistId: string): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);
    await db.runAsync('DELETE FROM playlists WHERE id = ?', [playlistId]);
  });
}

export async function addTrackToPlaylist(
  playlistId: string,
  trackId: string
): Promise<boolean> {
  const db = await getDatabase();

  // Guard: Block local device tracks (must have a valid youtube_id)
  const track = await db.getFirstAsync<{ id: string; youtube_id: string | null }>(
    'SELECT id, youtube_id FROM tracks WHERE id = ?',
    [trackId]
  );
  if (!track || !track.youtube_id) {
    return false;
  }

  // Guard against duplicate track in playlist
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
    [playlistId, trackId]
  );
  if (existing) {
    return false;
  }

  const id = `pt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();

  // Find next sort_order
  const row = await db.getFirstAsync<{ max_pos: number | null }>(
    'SELECT MAX(COALESCE(sort_order, position, 0)) AS max_pos FROM playlist_tracks WHERE playlist_id = ?',
    [playlistId]
  );
  const nextPos = (row?.max_pos ?? -1) + 1;

  await db.runAsync(
    `INSERT OR IGNORE INTO playlist_tracks (id, playlist_id, track_id, position, sort_order, created_at, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, playlistId, trackId, nextPos, nextPos, now, now]
  );
  return true;
}

export async function addTracksToPlaylist(
  playlistId: string,
  trackIds: string[]
): Promise<number> {
  if (trackIds.length === 0) return 0;
  const db = await getDatabase();

  // Guard: Filter out tracks that do not have a valid youtube_id
  const placeholders = trackIds.map(() => '?').join(',');
  const validRows = await db.getAllAsync<{ id: string }>(
    `SELECT id FROM tracks WHERE id IN (${placeholders}) AND youtube_id IS NOT NULL AND youtube_id != ''`,
    trackIds
  );
  const validTrackIds = validRows.map((r) => r.id);
  if (validTrackIds.length === 0) return 0;

  let addedCount = 0;

  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<{ max_pos: number | null }>(
      'SELECT MAX(COALESCE(sort_order, position, 0)) AS max_pos FROM playlist_tracks WHERE playlist_id = ?',
      [playlistId]
    );
    let nextPos = (row?.max_pos ?? -1) + 1;
    const now = new Date().toISOString();

    for (const trackId of validTrackIds) {
      const existing = await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
        [playlistId, trackId]
      );
      if (!existing) {
        const id = `pt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}_${addedCount}`;
        await db.runAsync(
          `INSERT OR IGNORE INTO playlist_tracks (id, playlist_id, track_id, position, sort_order, created_at, added_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, playlistId, trackId, nextPos, nextPos, now, now]
        );
        nextPos++;
        addedCount++;
      }
    }
  });

  return addedCount;
}

export async function removeTrackFromPlaylist(
  playlistId: string,
  trackId: string
): Promise<void> {
  const db = await getDatabase();
  await db.runAsync(
    'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
    [playlistId, trackId]
  );
}

export async function removeTracksFromPlaylist(
  playlistId: string,
  trackIds: string[]
): Promise<void> {
  if (trackIds.length === 0) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const trackId of trackIds) {
      await db.runAsync(
        'DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
        [playlistId, trackId]
      );
    }
  });
}

export async function reorderPlaylistTracks(
  playlistId: string,
  orderedTrackIds: string[]
): Promise<void> {
  if (orderedTrackIds.length === 0) return;
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (let i = 0; i < orderedTrackIds.length; i++) {
      await db.runAsync(
        'UPDATE playlist_tracks SET sort_order = ?, position = ? WHERE playlist_id = ? AND track_id = ?',
        [i, i, playlistId, orderedTrackIds[i]]
      );
    }
  });
}

export async function getPlaylistTracks(playlistId: string): Promise<Track[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<Track>(
    `SELECT t.*
     FROM tracks t
     JOIN playlist_tracks pt ON t.id = pt.track_id
     WHERE pt.playlist_id = ?
     ORDER BY COALESCE(pt.sort_order, pt.position, 0) ASC, pt.created_at ASC`,
    [playlistId]
  );
  return rows;
}

export async function isTrackInPlaylist(
  playlistId: string,
  trackId: string
): Promise<boolean> {
  const db = await getDatabase();
  const row = await db.getFirstAsync<{ count: number }>(
    'SELECT COUNT(*) as count FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?',
    [playlistId, trackId]
  );
  return (row?.count ?? 0) > 0;
}

export async function getPlaylistsContainingTrack(trackId: string): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.getAllAsync<{ playlist_id: string }>(
    'SELECT playlist_id FROM playlist_tracks WHERE track_id = ?',
    [trackId]
  );
  return rows.map((r) => r.playlist_id);
}

export async function getPlaylistsMembershipForTracks(
  trackIds: string[]
): Promise<Record<string, number>> {
  if (trackIds.length === 0) return {};
  const db = await getDatabase();
  const placeholders = trackIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ playlist_id: string; count: number }>(
    `SELECT playlist_id, COUNT(track_id) as count
     FROM playlist_tracks
     WHERE track_id IN (${placeholders})
     GROUP BY playlist_id`,
    trackIds
  );
  const result: Record<string, number> = {};
  for (const r of rows) {
    result[r.playlist_id] = r.count;
  }
  return result;
}

export async function upsertPlaylistTrack(
  playlistId: string,
  trackId: string,
  position: number = 0,
  sortOrder: number = 0,
  addedAt?: string | null
): Promise<void> {
  const db = await getDatabase();
  const id = `pt_${playlistId}_${trackId}`;
  const now = addedAt || new Date().toISOString();
  await db.runAsync(
    `INSERT OR IGNORE INTO playlist_tracks (id, playlist_id, track_id, position, sort_order, created_at, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, playlistId, trackId, position, sortOrder, now, now]
  );
  await db.runAsync(
    `UPDATE playlist_tracks SET position = ?, sort_order = ?, added_at = COALESCE(?, added_at)
     WHERE playlist_id = ? AND track_id = ?`,
    [position, sortOrder, now, playlistId, trackId]
  );
}

export async function getAllPlaylistTracksRaw(): Promise<
  {
    id: string;
    playlist_id: string;
    track_id: string;
    position: number;
    sort_order: number;
    created_at: string;
    added_at?: string;
  }[]
> {
  const db = await getDatabase();
  return await db.getAllAsync('SELECT * FROM playlist_tracks');
}
