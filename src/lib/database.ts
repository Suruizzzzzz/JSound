import * as SQLite from 'expo-sqlite';
import { Track, Playlist } from '@/types/music';

let dbInstance: SQLite.SQLiteDatabase | null = null;
let activeUserIdGetter: (() => string) | null = null;

export function registerActiveUserIdGetter(getter: () => string) {
  activeUserIdGetter = getter;
}

export function getActiveUserId(): string {
  if (activeUserIdGetter) {
    try {
      return activeUserIdGetter() || 'local_guest';
    } catch {
      return 'local_guest';
    }
  }
  return 'local_guest';
}

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
      id TEXT NOT NULL,
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
      is_playlist_only INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (user_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON tracks (user_id);
    CREATE INDEX IF NOT EXISTS idx_tracks_id ON tracks (id);
    CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks (title);
    CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks (artist);

    CREATE TABLE IF NOT EXISTS playlists (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'local_guest',
      name TEXT NOT NULL,
      cover_uri TEXT,
      share_code TEXT,
      sync_status TEXT DEFAULT 'synced',
      sync_version INTEGER NOT NULL DEFAULT 1,
      is_synced INTEGER NOT NULL DEFAULT 0,
      is_public INTEGER NOT NULL DEFAULT 0,
      is_imported INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      PRIMARY KEY (user_id, id)
    );

    CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists (user_id);
    CREATE INDEX IF NOT EXISTS idx_playlists_id ON playlists (id);

    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id TEXT,
      playlist_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      added_at TEXT,
      PRIMARY KEY (playlist_id, track_id)
    );

    CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks (playlist_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_track_unique ON playlist_tracks (playlist_id, track_id);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  try {
    await db.execAsync("ALTER TABLE tracks ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local_guest';");
  } catch {
    // Column already exists, safe to ignore
  }

  try {
    await db.execAsync("ALTER TABLE playlists ADD COLUMN user_id TEXT NOT NULL DEFAULT 'local_guest';");
  } catch {
    // Column already exists, safe to ignore
  }

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

  // Check and migrate tracks table to composite PRIMARY KEY (user_id, id) if currently standalone id PK or has unique index on id alone
  try {
    const tracksInfo = await db.getAllAsync<{ name: string; pk: number }>('PRAGMA table_info(tracks);');
    const isTracksCompositePk = tracksInfo.filter((c) => c.pk > 0).length >= 2;

    let hasTracksSingleIdUnique = false;
    try {
      const idxList = await db.getAllAsync<{ name: string; unique: number }>('PRAGMA index_list(tracks);');
      for (const idx of idxList) {
        if (idx.unique === 1) {
          const idxCols = await db.getAllAsync<{ name: string }>(`PRAGMA index_info("${idx.name}");`);
          if (idxCols.length === 1 && idxCols[0].name === 'id') {
            hasTracksSingleIdUnique = true;
            break;
          }
        }
      }
    } catch {
      // ignore
    }

    if ((!isTracksCompositePk || hasTracksSingleIdUnique) && tracksInfo.length > 0) {
      await db.execAsync(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE tracks_new (
          id TEXT NOT NULL,
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
          is_playlist_only INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (user_id, id)
        );
        INSERT OR IGNORE INTO tracks_new (
          id, user_id, youtube_id, title, artist, local_audio_uri, local_artwork_uri,
          duration, source, is_synced, created_at, sort_order, is_playlist_only
        )
        SELECT id, COALESCE(user_id, 'local_guest'), youtube_id, title, artist, local_audio_uri, local_artwork_uri,
          duration, source, is_synced, created_at, COALESCE(sort_order, 0), COALESCE(is_playlist_only, 0)
        FROM tracks;
        DROP TABLE tracks;
        ALTER TABLE tracks_new RENAME TO tracks;
        CREATE INDEX IF NOT EXISTS idx_tracks_user_id ON tracks (user_id);
        CREATE INDEX IF NOT EXISTS idx_tracks_id ON tracks (id);
        CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks (title);
        CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks (artist);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_user_id_id ON tracks (user_id, id);
        PRAGMA foreign_keys = ON;
      `);
      console.log('✓ Successfully rebuilt tracks table with composite PRIMARY KEY (user_id, id)');
    }
  } catch (migErr) {
    console.warn('Tracks composite PK migration warning:', migErr);
  }

  // Check and migrate playlists table to composite PRIMARY KEY (user_id, id) if currently standalone id PK or has unique index on id alone
  try {
    const playlistsInfo = await db.getAllAsync<{ name: string; pk: number }>('PRAGMA table_info(playlists);');
    const isPlaylistsCompositePk = playlistsInfo.filter((c) => c.pk > 0).length >= 2;

    let hasPlaylistsSingleIdUnique = false;
    try {
      const plIdxList = await db.getAllAsync<{ name: string; unique: number }>('PRAGMA index_list(playlists);');
      for (const idx of plIdxList) {
        if (idx.unique === 1) {
          const idxCols = await db.getAllAsync<{ name: string }>(`PRAGMA index_info("${idx.name}");`);
          if (idxCols.length === 1 && idxCols[0].name === 'id') {
            hasPlaylistsSingleIdUnique = true;
            break;
          }
        }
      }
    } catch {
      // ignore
    }

    if ((!isPlaylistsCompositePk || hasPlaylistsSingleIdUnique) && playlistsInfo.length > 0) {
      await db.execAsync(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE playlists_new (
          id TEXT NOT NULL,
          user_id TEXT NOT NULL DEFAULT 'local_guest',
          name TEXT NOT NULL,
          cover_uri TEXT,
          share_code TEXT,
          sync_status TEXT DEFAULT 'synced',
          sync_version INTEGER NOT NULL DEFAULT 1,
          is_synced INTEGER NOT NULL DEFAULT 0,
          is_public INTEGER NOT NULL DEFAULT 0,
          is_imported INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          PRIMARY KEY (user_id, id)
        );
        INSERT OR IGNORE INTO playlists_new (
          id, user_id, name, cover_uri, share_code, sync_status, sync_version, is_synced, is_public, is_imported, created_at
        )
        SELECT id, COALESCE(user_id, 'local_guest'), name, cover_uri, share_code, COALESCE(sync_status, 'synced'),
          COALESCE(sync_version, 1), COALESCE(is_synced, 0), COALESCE(is_public, 0), COALESCE(is_imported, 0), created_at
        FROM playlists;
        DROP TABLE playlists;
        ALTER TABLE playlists_new RENAME TO playlists;
        CREATE INDEX IF NOT EXISTS idx_playlists_user_id ON playlists (user_id);
        CREATE INDEX IF NOT EXISTS idx_playlists_id ON playlists (id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_user_id_id ON playlists (user_id, id);
        PRAGMA foreign_keys = ON;
      `);
      console.log('✓ Successfully rebuilt playlists table with composite PRIMARY KEY (user_id, id)');
    }
  } catch (migErr) {
    console.warn('Playlists composite PK migration warning:', migErr);
  }

  // Check and migrate playlist_tracks table to remove foreign key references
  try {
    let hasForeignKey = false;
    try {
      const fkList = await db.getAllAsync<{ table: string }>('PRAGMA foreign_key_list(playlist_tracks);');
      if (fkList && fkList.length > 0) {
        hasForeignKey = true;
      }
    } catch {
      // ignore
    }

    if (!hasForeignKey) {
      try {
        const tableDef = await db.getFirstAsync<{ sql: string }>(
          "SELECT sql FROM sqlite_master WHERE type='table' AND name='playlist_tracks';"
        );
        if (tableDef?.sql && /REFERENCES/i.test(tableDef.sql)) {
          hasForeignKey = true;
        }
      } catch {
        // ignore
      }
    }

    if (hasForeignKey) {
      const ptCols = await db.getAllAsync<{ name: string }>('PRAGMA table_info(playlist_tracks);');
      const ptColNames = new Set(ptCols.map((c) => c.name));

      const idExpr = ptColNames.has('id') ? "COALESCE(id, 'pt_' || playlist_id || '_' || track_id)" : "'pt_' || playlist_id || '_' || track_id";
      const posExpr = ptColNames.has('position') ? 'COALESCE(position, 0)' : '0';
      const sortExpr = ptColNames.has('sort_order') ? 'COALESCE(sort_order, 0)' : '0';
      const createdExpr = ptColNames.has('created_at') ? "COALESCE(created_at, datetime('now'))" : "datetime('now')";
      const addedExpr = ptColNames.has('added_at') ? "COALESCE(added_at, datetime('now'))" : "datetime('now')";

      await db.execAsync(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE playlist_tracks_new (
          id TEXT,
          playlist_id TEXT NOT NULL,
          track_id TEXT NOT NULL,
          position INTEGER NOT NULL DEFAULT 0,
          sort_order INTEGER NOT NULL DEFAULT 0,
          created_at TEXT,
          added_at TEXT,
          PRIMARY KEY (playlist_id, track_id)
        );
        INSERT OR IGNORE INTO playlist_tracks_new (id, playlist_id, track_id, position, sort_order, created_at, added_at)
        SELECT ${idExpr}, playlist_id, track_id, ${posExpr}, ${sortExpr}, ${createdExpr}, ${addedExpr}
        FROM playlist_tracks;
        DROP TABLE playlist_tracks;
        ALTER TABLE playlist_tracks_new RENAME TO playlist_tracks;
        CREATE INDEX IF NOT EXISTS idx_playlist_tracks_playlist ON playlist_tracks (playlist_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_playlist_track_unique ON playlist_tracks (playlist_id, track_id);
        PRAGMA foreign_keys = ON;
      `);
      console.log('✓ Successfully rebuilt playlist_tracks table without foreign key constraints');
    }
  } catch (ptMigErr) {
    console.warn('playlist_tracks foreign key removal migration warning:', ptMigErr);
  }

  // Ensure unique indexes exist unconditionally for ON CONFLICT(user_id, id) matching
  try {
    await db.execAsync(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_tracks_user_id_id ON tracks (user_id, id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_user_id_id ON playlists (user_id, id);
    `);
  } catch {
    // Ignore if already present
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

  // Safe cleanup: ensure tracks that exist ONLY inside imported playlists (is_imported = 1)
  // and not in any personal/non-imported playlist have is_playlist_only = 1 so they do not leak into All Songs.
  try {
    await db.execAsync(`
      UPDATE tracks
      SET is_playlist_only = 1
      WHERE id IN (
        SELECT pt.track_id
        FROM playlist_tracks pt
        JOIN playlists p ON pt.playlist_id = p.id
        WHERE p.is_imported = 1
          AND (p.user_id = tracks.user_id OR tracks.user_id = 'local_guest')
      )
      AND id NOT IN (
        SELECT pt.track_id
        FROM playlist_tracks pt
        JOIN playlists p ON pt.playlist_id = p.id
        WHERE COALESCE(p.is_imported, 0) = 0
          AND (p.user_id = tracks.user_id OR tracks.user_id = 'local_guest')
      );
    `);
  } catch (cleanErr) {
    console.warn('Imported playlist tracks cleanup warning:', cleanErr);
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

  // Auto-migrate any leftover 'local_guest' rows if a logged-in user is active
  try {
    const activeUserId = getActiveUserId();
    if (activeUserId && activeUserId !== 'local_guest') {
      await claimGuestLibrary(activeUserId);
    }
  } catch (claimErr) {
    console.warn('[Database] Auto-claim guest library startup warning:', claimErr);
  }

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
  userId?: string,
  isPublic: boolean | number = 0,
  isImported: boolean | number = 0
): Promise<Playlist> {
  const db = await getDatabase();
  const uId = userId || getActiveUserId();
  const id = customId || `pl_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();
  const cleanName = name.trim() || 'Untitled Playlist';
  const publicFlag = isPublic ? 1 : 0;
  const importedFlag = isImported ? 1 : 0;
  const playlist: Playlist = {
    id,
    user_id: uId,
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

  // Safe UPSERT with composite key (user_id, id)
  await db.runAsync(
    `INSERT INTO playlists (id, user_id, name, cover_uri, share_code, sync_status, sync_version, is_synced, is_public, is_imported, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, id) DO UPDATE SET
       name = excluded.name,
       cover_uri = COALESCE(excluded.cover_uri, playlists.cover_uri),
       share_code = COALESCE(excluded.share_code, playlists.share_code),
       is_public = excluded.is_public,
       is_imported = excluded.is_imported`,
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

  return playlist;
}

export async function getAllPlaylists(userId?: string): Promise<Playlist[]> {
  const db = await getDatabase();
  const uId = userId || getActiveUserId();
  const rows = await db.getAllAsync<Playlist & { track_count: number }>(
    `SELECT p.*, COUNT(pt.track_id) AS track_count
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
     WHERE p.user_id = ?
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [uId]
  );
  return rows;
}

export async function getPlaylistById(playlistId: string, userId?: string): Promise<Playlist | null> {
  const db = await getDatabase();
  const uId = userId || getActiveUserId();
  const row = await db.getFirstAsync<Playlist & { track_count: number }>(
    `SELECT p.*, COUNT(pt.track_id) AS track_count
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON p.id = pt.playlist_id
     WHERE p.id = ? AND p.user_id = ?
     GROUP BY p.id`,
    [playlistId, uId]
  );
  return row ?? null;
}

export async function deletePlaylist(playlistId: string, userId?: string): Promise<void> {
  const db = await getDatabase();
  const uId = userId || getActiveUserId();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);
    await db.runAsync(
      'DELETE FROM playlists WHERE id = ? AND (user_id = ? OR user_id = ? OR user_id = "local_guest")',
      [playlistId, uId, userId || uId]
    );
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

export async function getPlaylistTracks(playlistId: string, userId?: string): Promise<Track[]> {
  const db = await getDatabase();
  const uId = userId || getActiveUserId();
  const rows = await db.getAllAsync<Track>(
    `SELECT t.*
     FROM tracks t
     JOIN playlist_tracks pt ON t.id = pt.track_id
     WHERE pt.playlist_id = ? AND (t.user_id = ? OR t.user_id = 'local_guest')
     ORDER BY COALESCE(pt.sort_order, pt.position, 0) ASC, pt.created_at ASC`,
    [playlistId, uId]
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

export async function getPlaylistsContainingTrack(trackId: string, userId?: string): Promise<string[]> {
  const db = await getDatabase();
  const uId = userId || getActiveUserId();
  const rows = await db.getAllAsync<{ playlist_id: string }>(
    `SELECT DISTINCT pt.playlist_id
     FROM playlist_tracks pt
     JOIN playlists p ON pt.playlist_id = p.id
     WHERE pt.track_id = ? AND (p.user_id = ? OR p.user_id = 'local_guest')`,
    [trackId, uId]
  );
  return rows.map((r) => r.playlist_id);
}

export async function getPlaylistsMembershipForTracks(
  trackIds: string[],
  userId?: string
): Promise<Record<string, number>> {
  if (trackIds.length === 0) return {};
  const db = await getDatabase();
  const uId = userId || getActiveUserId();
  const placeholders = trackIds.map(() => '?').join(',');
  const rows = await db.getAllAsync<{ playlist_id: string; count: number }>(
    `SELECT pt.playlist_id, COUNT(pt.track_id) as count
     FROM playlist_tracks pt
     JOIN playlists p ON pt.playlist_id = p.id
     WHERE (p.user_id = ? OR p.user_id = 'local_guest') AND pt.track_id IN (${placeholders})
     GROUP BY pt.playlist_id`,
    [uId, ...trackIds]
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

export async function getAllPlaylistTracksRaw(userId?: string): Promise<
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
  if (userId) {
    return await db.getAllAsync(
      `SELECT pt.*
       FROM playlist_tracks pt
       JOIN playlists p ON pt.playlist_id = p.id
       WHERE p.user_id = ?`,
      [userId]
    );
  }
  return await db.getAllAsync('SELECT * FROM playlist_tracks');
}

/**
 * Claim/Import all on-device 'local_guest' tracks and playlists into a registered user account.
 * Re-attributes database rows while pointing to the exact same audio files on disk.
 */
export async function claimGuestLibrary(targetUserId: string): Promise<{ tracksCount: number; playlistsCount: number }> {
  if (!targetUserId || targetUserId === 'local_guest') {
    return { tracksCount: 0, playlistsCount: 0 };
  }

  const db = await getDatabase();
  let tracksCount = 0;
  let playlistsCount = 0;

  // Fast check: return immediately if no guest data exists
  const guestTracks = await db.getAllAsync<Track>(
    "SELECT * FROM tracks WHERE user_id = 'local_guest'"
  );
  const guestPlaylists = await db.getAllAsync<Playlist>(
    "SELECT * FROM playlists WHERE user_id = 'local_guest'"
  );

  if (guestTracks.length === 0 && guestPlaylists.length === 0) {
    return { tracksCount: 0, playlistsCount: 0 };
  }

  await db.withTransactionAsync(async () => {
    // 1. Reassign guest tracks to target user (INSERT OR IGNORE to not overwrite existing account tracks)
    for (const t of guestTracks) {
      await db.runAsync(
        `INSERT OR IGNORE INTO tracks (
          id, user_id, youtube_id, title, artist, local_audio_uri, local_artwork_uri,
          duration, source, is_synced, created_at, sort_order, is_playlist_only
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          t.id,
          targetUserId,
          t.youtube_id || null,
          t.title,
          t.artist,
          t.local_audio_uri || '',
          t.local_artwork_uri || null,
          t.duration || 0,
          t.source || 'youtube',
          t.created_at || new Date().toISOString(),
          t.sort_order ?? 0,
          t.is_playlist_only ?? 0,
        ]
      );

      // If the target user already had this track without local audio, attach the guest's local file
      if (t.local_audio_uri) {
        await db.runAsync(
          `UPDATE tracks
           SET local_audio_uri = ?
           WHERE user_id = ? AND id = ? AND (local_audio_uri IS NULL OR local_audio_uri = '')`,
          [t.local_audio_uri, targetUserId, t.id]
        );
      }

      tracksCount++;
    }

    // 2. Reassign guest playlists to target user (INSERT OR IGNORE to not overwrite existing playlists)
    for (const pl of guestPlaylists) {
      await db.runAsync(
        `INSERT OR IGNORE INTO playlists (
          id, user_id, name, cover_uri, share_code, sync_status, sync_version, is_synced, is_public, is_imported, created_at
        ) VALUES (?, ?, ?, ?, ?, 'synced', 1, 0, ?, ?, ?)`,
        [
          pl.id,
          targetUserId,
          pl.name,
          pl.cover_uri || null,
          pl.share_code || null,
          pl.is_public ?? 0,
          pl.is_imported ?? 0,
          pl.created_at || new Date().toISOString(),
        ]
      );
      playlistsCount++;
    }

    // 3. Re-attribute guest playlist tracks
    const guestPtRows = await db.getAllAsync<{ id: string; playlist_id: string; track_id: string; position: number; sort_order: number; created_at: string; added_at?: string }>(
      `SELECT pt.* FROM playlist_tracks pt
       JOIN playlists p ON pt.playlist_id = p.id
       WHERE p.user_id = 'local_guest'`
    );

    for (const pt of guestPtRows) {
      await db.runAsync(
        `INSERT OR IGNORE INTO playlist_tracks (id, playlist_id, track_id, position, sort_order, created_at, added_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [pt.id, pt.playlist_id, pt.track_id, pt.position, pt.sort_order, pt.created_at, pt.added_at || pt.created_at]
      );
    }

    // 4. Clean up guest rows so they are not duplicated
    await db.runAsync("DELETE FROM tracks WHERE user_id = 'local_guest'");
    await db.runAsync("DELETE FROM playlists WHERE user_id = 'local_guest'");
  });

  return { tracksCount, playlistsCount };
}
