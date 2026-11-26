import {
  createAudioPlayer,
  setAudioModeAsync,
  requestNotificationPermissionsAsync,
  AudioPlayer,
  AudioStatus,
  AudioSource,
  AudioMetadata,
  AudioLockScreenOptions,
} from 'expo-audio';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { EventSubscription } from 'expo';
import { resolveLocalTrackUri } from '@/repositories/trackRepository';

export { AudioPlayer, AudioStatus, AudioSource, AudioMetadata, AudioLockScreenOptions };

let playerInstance: AudioPlayer | null = null;
let statusSubscription: EventSubscription | null = null;
let currentStatusCallback: ((status: AudioStatus) => void) | null = null;
let isAudioModeConfigured = false;
let shouldAutoPlay = true;
let currentTrackMetadata: AudioMetadata | undefined = undefined;
let hasSyncedLockScreenForCurrentTrack = false;
let isLockScreenActiveOnPlayer = false;
let loadRequestId = 0;

// Detect Expo Go client vs compiled standalone / development build
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants.executionEnvironment as string) === 'storeClient' ||
  Constants.appOwnership === 'expo' ||
  Boolean((Constants as unknown as { manifest2?: { extra?: { expoGo?: boolean } } })?.manifest2?.extra?.expoGo) ||
  Boolean((Constants as unknown as { manifest?: { developer?: boolean } })?.manifest?.developer);

const DEFAULT_LOCK_SCREEN_OPTIONS: AudioLockScreenOptions = {
  showSeekForward: true,
  showSeekBackward: true,
  seekForwardIntervalSeconds: 10,
  seekBackwardIntervalSeconds: 10,
};

function sanitizeMetadataArtworkUrl(artworkUrl?: string): string | undefined {
  if (!artworkUrl) return undefined;
  const trimmed = artworkUrl.trim();
  if (!trimmed) return undefined;
  if (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('file://')
  ) {
    return trimmed;
  }
  if (trimmed.startsWith('file:/')) {
    return `file:///${trimmed.slice(6).replace(/^\/+/, '')}`;
  }
  if (trimmed.startsWith('/')) {
    return `file://${trimmed}`;
  }
  return undefined;
}

function normalizeMetadata(metadata?: AudioMetadata): AudioMetadata | undefined {
  if (!metadata) return undefined;
  return {
    ...metadata,
    artworkUrl: sanitizeMetadataArtworkUrl(metadata.artworkUrl),
  };
}

function syncLockScreenControls(player: AudioPlayer, metadata?: AudioMetadata): void {
  if (isExpoGo || !metadata) return;
  try {
    if (!isLockScreenActiveOnPlayer && typeof player.setActiveForLockScreen === 'function') {
      player.setActiveForLockScreen(true, metadata, DEFAULT_LOCK_SCREEN_OPTIONS);
      isLockScreenActiveOnPlayer = true;
    } else if (
      typeof (player as unknown as { updateLockScreenMetadata?: (meta: AudioMetadata) => void })
        .updateLockScreenMetadata === 'function'
    ) {
      (
        player as unknown as { updateLockScreenMetadata: (meta: AudioMetadata) => void }
      ).updateLockScreenMetadata(metadata);
    } else if (typeof player.setActiveForLockScreen === 'function') {
      player.setActiveForLockScreen(true, metadata, DEFAULT_LOCK_SCREEN_OPTIONS);
      isLockScreenActiveOnPlayer = true;
    }
  } catch (lockErr) {
    console.warn('[AudioService] Failed to update lock screen controls:', lockErr);
  }
}

function teardownPlayerInstance(): void {
  isLockScreenActiveOnPlayer = false;
  hasSyncedLockScreenForCurrentTrack = false;

  if (statusSubscription) {
    try {
      statusSubscription.remove();
    } catch {
      // ignore
    }
    statusSubscription = null;
  }

  if (playerInstance) {
    const playerToRelease = playerInstance;
    playerInstance = null;

    try {
      playerToRelease.pause();
    } catch {
      // ignore
    }

    if (!isExpoGo) {
      try {
        if (typeof playerToRelease.clearLockScreenControls === 'function') {
          playerToRelease.clearLockScreenControls();
        } else if (typeof playerToRelease.setActiveForLockScreen === 'function') {
          playerToRelease.setActiveForLockScreen(false);
        }
      } catch {
        // ignore
      }
    }

    try {
      if (typeof playerToRelease.remove === 'function') {
        playerToRelease.remove();
      }
    } catch {
      // ignore
    }
    try {
      if (typeof (playerToRelease as unknown as { release?: () => void }).release === 'function') {
        (playerToRelease as unknown as { release: () => void }).release();
      }
    } catch {
      // ignore
    }
  }
}

function attachStatusListener(player: AudioPlayer) {
  if (statusSubscription) {
    try {
      statusSubscription.remove();
    } catch {
      // ignore
    }
    statusSubscription = null;
  }

  statusSubscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
    if (player !== playerInstance) return;

    if ('error' in status && (status as unknown as { error?: unknown }).error) {
      console.error('[AudioService] Playback error:', (status as unknown as { error: unknown }).error);
    }

    // Auto-play as soon as ExoPlayer reports isLoaded === true
    if (status.isLoaded && !status.playing && shouldAutoPlay) {
      try {
        player.play();
      } catch (playErr) {
        console.warn('[AudioService] Error calling player.play():', playErr);
      }
    }

    if (status.playing) {
      shouldAutoPlay = false;
    }

    // In standalone builds, sync lock-screen metadata once media is fully loaded and duration > 0
    if (
      !isExpoGo &&
      status.isLoaded &&
      status.duration > 0 &&
      !hasSyncedLockScreenForCurrentTrack &&
      currentTrackMetadata
    ) {
      hasSyncedLockScreenForCurrentTrack = true;
      syncLockScreenControls(player, currentTrackMetadata);
    }

    currentStatusCallback?.(status);
  });
}

export async function ensureAudioMode(): Promise<void> {
  if (isAudioModeConfigured) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: !isExpoGo,
      interruptionMode: 'doNotMix',
    });
    isAudioModeConfigured = true;

    // Request notification permission in standalone builds (never in Expo Go)
    if (!isExpoGo) {
      try {
        await requestNotificationPermissionsAsync();
      } catch {
        // Silently skip if unavailable
      }
    }
  } catch (error) {
    console.warn('[AudioService] Failed to configure audio mode:', error);
  }
}

export async function loadAndPlayAudio(
  uriOrSource: string | AudioSource,
  onStatusUpdate: (status: AudioStatus) => void,
  headers?: Record<string, string>,
  metadata?: AudioMetadata
): Promise<AudioPlayer | null> {
  const requestId = ++loadRequestId;
  await ensureAudioMode();
  if (requestId !== loadRequestId) return null;

  const rawUri =
    typeof uriOrSource === 'string'
      ? uriOrSource
      : typeof uriOrSource === 'object' && uriOrSource !== null && 'uri' in uriOrSource
      ? (uriOrSource as { uri?: string }).uri || ''
      : '';

  let effectiveUri = rawUri;
  const isRemoteUri =
    rawUri.startsWith('http://') || rawUri.startsWith('https://');

  if (!isRemoteUri && rawUri) {
    const resolvedLocal = await resolveLocalTrackUri(rawUri);
    if (requestId !== loadRequestId) return null;
    if (resolvedLocal.exists && resolvedLocal.uri) {
      effectiveUri = resolvedLocal.uri;
    } else {
      throw new Error('Local audio file is missing or corrupted on device storage.');
    }
  }

  // Assign active callback/metadata only right before touching native player (never wiped by teardown)
  currentStatusCallback = onStatusUpdate;
  shouldAutoPlay = true;
  currentTrackMetadata = normalizeMetadata(metadata);
  hasSyncedLockScreenForCurrentTrack = false;

  const source: AudioSource =
    typeof uriOrSource === 'string'
      ? headers
        ? { uri: effectiveUri, headers }
        : { uri: effectiveUri }
      : typeof uriOrSource === 'object' && uriOrSource !== null
      ? { ...(uriOrSource as Record<string, unknown>), uri: effectiveUri }
      : uriOrSource;

  try {
    // 1. Re-use existing player with .replace()
    if (playerInstance) {
      try {
        attachStatusListener(playerInstance);
        hasSyncedLockScreenForCurrentTrack = false;
        playerInstance.replace(source);

        syncLockScreenControls(playerInstance, currentTrackMetadata);

        if (playerInstance.isLoaded) {
          playerInstance.play();
          shouldAutoPlay = false;
        } else {
          const activePlayer = playerInstance;
          setTimeout(() => {
            if (
              requestId === loadRequestId &&
              playerInstance === activePlayer &&
              activePlayer.isLoaded &&
              shouldAutoPlay
            ) {
              activePlayer.play();
              shouldAutoPlay = false;
            }
          }, 60);
        }

        return playerInstance;
      } catch (replaceErr) {
        console.warn('[AudioService] Player replace failed, recreating player:', replaceErr);
        teardownPlayerInstance();
      }
    }

    if (requestId !== loadRequestId) return null;

    // 2. Fresh player instantiation (teardown old native player WITHOUT wiping current callbacks/metadata)
    teardownPlayerInstance();

    const player = createAudioPlayer(source, {
      updateInterval: 250,
      keepAudioSessionActive: true,
    });
    if (requestId !== loadRequestId) {
      try {
        player.pause();
        player.remove();
        if (typeof (player as unknown as { release?: () => void }).release === 'function') {
          (player as unknown as { release: () => void }).release();
        }
      } catch {
        // ignore
      }
      return null;
    }

    playerInstance = player;
    attachStatusListener(player);
    syncLockScreenControls(player, currentTrackMetadata);

    if (player.isLoaded) {
      player.play();
      shouldAutoPlay = false;
    }

    return player;
  } catch (error) {
    console.warn('[AudioService] Failed to create or play audio player:', error);
    throw error;
  }
}

export async function pauseAudio(): Promise<void> {
  shouldAutoPlay = false;
  if (playerInstance) {
    try {
      playerInstance.pause();
    } catch (e) {
      console.warn('[AudioService] pauseAudio error:', e);
    }
  }
}

export async function resumeAudio(): Promise<void> {
  shouldAutoPlay = true;
  if (playerInstance) {
    try {
      playerInstance.play();
    } catch (e) {
      console.warn('[AudioService] resumeAudio error:', e);
    }
  }
}

export async function seekAudio(positionSeconds: number): Promise<void> {
  if (playerInstance) {
    try {
      const clamped = Math.max(0, positionSeconds);
      await playerInstance.seekTo(clamped);
    } catch (e) {
      console.warn('[AudioService] seekAudio error:', e);
    }
  }
}

export async function stopAndUnloadAudio(): Promise<void> {
  loadRequestId += 1;
  shouldAutoPlay = false;
  currentStatusCallback = null;
  currentTrackMetadata = undefined;
  teardownPlayerInstance();
}

export function updateAudioMetadata(metadata: AudioMetadata): void {
  const normalized = normalizeMetadata(metadata);
  currentTrackMetadata = normalized;
  if (isExpoGo || !playerInstance || !normalized) return;
  syncLockScreenControls(playerInstance, normalized);
}

export function getCurrentPlayer(): AudioPlayer | null {
  return playerInstance;
}

export function getAudioPlayer(): AudioPlayer | null {
  return playerInstance;
}

export function getPlaybackPosition(): { currentTime: number; duration: number } {
  if (playerInstance) {
    try {
      const cur =
        typeof playerInstance.currentTime === 'number' &&
        !isNaN(playerInstance.currentTime) &&
        playerInstance.currentTime >= 0
          ? playerInstance.currentTime
          : 0;
      const dur =
        typeof playerInstance.duration === 'number' &&
        !isNaN(playerInstance.duration) &&
        playerInstance.duration > 0
          ? playerInstance.duration
          : 0;
      return { currentTime: cur, duration: dur };
    } catch {
      return { currentTime: 0, duration: 0 };
    }
  }
  return { currentTime: 0, duration: 0 };
}
