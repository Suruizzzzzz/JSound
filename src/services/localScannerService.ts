import * as MediaLibrary from 'expo-media-library/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getActiveUserId } from '@/lib/database';
import { saveTracks, getAllTracks, normalizeLocalFileUri } from '@/repositories/trackRepository';
import { Track } from '@/types/music';

function parseArtistAndTitle(filename: string): { title: string; artist: string } {
  // 1. Strip common audio file extensions
  let cleanName = filename.replace(/\.(mp3|m4a|wav|flac|aac|ogg|wma|alac|aiff)$/i, '').trim();

  // 2. Strip web downloader prefixes and domain tags (e.g. y2mate.com -, [ytshorts.savetube.me], etc.)
  cleanName = cleanName
    .replace(/^\[?(y2mate(\.com)?|ytmp3(\.nu)?|ssyoutube(\.com)?)\]?\s*[-_]?\s*/i, '')
    .replace(/[-_]?\d*[-_]?(ytshorts|savetube|y2mate|ytmp3|ssyoutube|snaptube|tubidy)(\.[a-z]{2,4})?/gi, '')
    .replace(/[[({][^\])}]*\b(savetube|ytshorts|y2mate|ytmp3|ssyoutube|snaptube)\b[^\])}]*[\])}]/gi, '')
    .replace(/[-_]?(128|192|256|320)\s*kbps?/gi, '')
    .replace(/\[\s*(128|192|256|320)\s*kbps?\s*\]/gi, '')
    .replace(/^[-_.\s]+|[-_.\s]+$/g, '')
    .trim();

  // 3. If formatted as "Artist - Title"
  if (cleanName.includes(' - ')) {
    const parts = cleanName.split(' - ');
    const artist = parts[0].trim();
    const title = parts.slice(1).join(' - ').trim();
    if (artist && title) {
      return { artist, title };
    }
  }

  return {
    title: cleanName || 'Unknown Track',
    artist: 'Unknown Artist',
  };
}

export async function requestMediaLibraryPermissions(): Promise<boolean> {
  try {
    const { status } = await MediaLibrary.getPermissionsAsync(false, ['audio']);
    if (status === 'granted') {
      return true;
    }
    const requestResult = await MediaLibrary.requestPermissionsAsync(false, ['audio']);
    return requestResult.status === 'granted';
  } catch (error) {
    console.warn('MediaLibrary permission check error:', error);
    return false;
  }
}

export async function scanLocalMusic(userId: string = getActiveUserId()): Promise<Track[]> {
  const hasPermission = await requestMediaLibraryPermissions();
  if (!hasPermission) {
    throw new Error('PERMISSION_RESTRICTED');
  }

  // Fetch local audio assets up to 500 items
  const mediaResult = await MediaLibrary.getAssetsAsync({
    mediaType: 'audio',
    first: 500,
  });

  const assets = mediaResult.assets || [];
  const tracks: Track[] = assets.map((asset) => {
    const { title, artist } = parseArtistAndTitle(asset.filename);
    const createdAt = asset.creationTime
      ? new Date(asset.creationTime).toISOString()
      : new Date().toISOString();

    return {
      id: `local_${asset.id}`,
      user_id: userId,
      youtube_id: null,
      title,
      artist,
      local_audio_uri: asset.uri,
      local_artwork_uri: null,
      duration: Math.round(asset.duration || 0),
      source: 'local',
      is_synced: 0,
      created_at: createdAt,
    };
  });

  if (tracks.length > 0) {
    await saveTracks(tracks);
  }

  return getAllTracks(userId);
}

export async function pickAndImportAudioFiles(userId: string = getActiveUserId()): Promise<Track[]> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'audio/*',
    multiple: true,
    copyToCacheDirectory: true,
  });

  if (result.canceled || !result.assets || result.assets.length === 0) {
    return getAllTracks(userId);
  }

  const docDir = FileSystem.documentDirectory;
  const tracksDir = docDir
    ? docDir.endsWith('/')
      ? `${docDir}jstream_tracks/`
      : `${docDir}/jstream_tracks/`
    : null;
  if (tracksDir) {
    const dirInfo = await FileSystem.getInfoAsync(tracksDir).catch(() => ({ exists: false }));
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(tracksDir, { intermediates: true });
    }
  }

  const timestamp = Date.now();
  const tracks: Track[] = await Promise.all(
    result.assets.map(async (asset, index) => {
      const { title, artist } = parseArtistAndTitle(asset.name);
      const cleanToken = asset.name.replace(/[^a-zA-Z0-9]/g, '_');
      const safeId = `imported_${timestamp}_${index}_${cleanToken}`;

      let persistedUri = normalizeLocalFileUri(asset.uri) || asset.uri;
      if (tracksDir && asset.uri) {
        const extMatch = (asset.name || '').match(/\.([a-zA-Z0-9]+)$/);
        const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '.mp3';
        const stem = (asset.name || 'track')
          .replace(/\.[^.]+$/, '')
          .replace(/[^a-zA-Z0-9_\- ]/g, '')
          .trim()
          .replace(/\s+/g, '_')
          .slice(0, 48) || 'track';
        const targetUri = `${tracksDir}local_${timestamp}_${index}_${stem}${ext}`;

        try {
          await FileSystem.copyAsync({ from: asset.uri, to: targetUri });
          const copiedInfo = await FileSystem.getInfoAsync(targetUri);
          if (copiedInfo.exists) {
            persistedUri = normalizeLocalFileUri(copiedInfo.uri || targetUri) || targetUri;
            if (asset.uri !== persistedUri) {
              FileSystem.deleteAsync(asset.uri, { idempotent: true }).catch(() => {});
            }
          }
        } catch (copyErr) {
          console.warn(`[LocalScanner] Could not copy imported file "${asset.name}" to persistent storage:`, copyErr);
        }
      }

      return {
        id: safeId,
        user_id: userId,
        youtube_id: null,
        title,
        artist,
        local_audio_uri: persistedUri,
        local_artwork_uri: null,
        duration: 0,
        source: 'local',
        is_synced: 0,
        created_at: new Date().toISOString(),
      };
    })
  );

  if (tracks.length > 0) {
    await saveTracks(tracks, userId);
  }

  return getAllTracks(userId);
}
