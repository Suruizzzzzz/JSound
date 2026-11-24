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
import * as FileSystem from 'expo-file-system/legacy';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { EventSubscription } from 'expo';

export { AudioPlayer, AudioStatus, AudioSource, AudioMetadata, AudioLockScreenOptions };

let playerInstance: AudioPlayer | null = null;
let statusSubscription: EventSubscription | null = null;
let currentStatusCallback: ((status: AudioStatus) => void) | null = null;
let isAudioModeConfigured = false;
let shouldAutoPlay = true;
let currentTrackMetadata: AudioMetadata | undefined = undefined;
let hasSyncedLockScreenForCurrentTrack = false;

// Detect Expo Go client vs compiled standalone / development build
const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient ||
  (Constants.executionEnvironment as string) === 'storeClient' ||
  Constants.appOwnership === 'expo' ||
  Boolean((Constants as unknown as { manifest2?: { extra?: { expoGo?: boolean } } })?.manifest2?.extra?.expoGo) ||
  Boolean((Constants as unknown as { manifest?: { developer?: boolean } })?.manifest?.developer);

const DEFAULT_LOCK_SCREEN_OPTIONS: AudioLockScreenOptions = {
  showSeekForward: false,
  showSeekBackward: false,
};

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
      try {
        if (typeof player.setActiveForLockScreen === 'function') {
          player.setActiveForLockScreen(
            true,
            currentTrackMetadata,
            DEFAULT_LOCK_SCREEN_OPTIONS
          );
        } else if (typeof (player as unknown as { updateLockScreenMetadata?: (meta: AudioMetadata) => void }).updateLockScreenMetadata === 'function') {
          (player as unknown as { updateLockScreenMetadata: (meta: AudioMetadata) => void }).updateLockScreenMetadata(currentTrackMetadata);
        }
      } catch (lockErr) {
        console.warn('[AudioService] Failed to sync lock screen metadata on load:', lockErr);
      }
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
): Promise<AudioPlayer> {
  await ensureAudioMode();
  currentStatusCallback = onStatusUpdate;
  shouldAutoPlay = true;
  currentTrackMetadata = metadata;
  hasSyncedLockScreenForCurrentTrack = false;

  const source: AudioSource =
    typeof uriOrSource === 'string'
      ? headers
        ? { uri: uriOrSource, headers }
        : { uri: uriOrSource }
      : uriOrSource;

  const uri =
    typeof uriOrSource === 'string'
      ? uriOrSource
      : typeof uriOrSource === 'object' && uriOrSource !== null && 'uri' in uriOrSource
      ? (uriOrSource as { uri?: string }).uri || ''
      : '';

  console.log('[AudioService] Loading URI:', uri);

  // If local file, verify existence and byte size
  if (uri.startsWith('file://')) {
    try {
      const info = await FileSystem.getInfoAsync(uri);
      console.log('[AudioService] Local file info:', {
        exists: info.exists,
        size: info.exists ? (info as { size?: number }).size : 0,
        uri: info.uri,
      });
    } catch (e) {
      console.warn('[AudioService] Could not inspect local file info:', e);
    }
  }

  try {
    // 1. Re-use existing player with .replace()
    if (playerInstance) {
      try {
        attachStatusListener(playerInstance);
        hasSyncedLockScreenForCurrentTrack = false;
        playerInstance.replace(source);

        // Update lock-screen in standalone builds
        if (!isExpoGo && currentTrackMetadata) {
          try {
            if (typeof playerInstance.setActiveForLockScreen === 'function') {
              playerInstance.setActiveForLockScreen(
                true,
                currentTrackMetadata,
                DEFAULT_LOCK_SCREEN_OPTIONS
              );
            } else if (typeof (playerInstance as unknown as { updateLockScreenMetadata?: (meta: AudioMetadata) => void }).updateLockScreenMetadata === 'function') {
              (playerInstance as unknown as { updateLockScreenMetadata: (meta: AudioMetadata) => void }).updateLockScreenMetadata(currentTrackMetadata);
            }
          } catch {
            // Ignore in Expo Go or transition states
          }
        }

        if (playerInstance.isLoaded) {
          playerInstance.play();
          shouldAutoPlay = false;
        } else {
          setTimeout(() => {
            if (playerInstance?.isLoaded && shouldAutoPlay) {
              playerInstance.play();
              shouldAutoPlay = false;
            }
          }, 60);
        }

        return playerInstance;
      } catch (replaceErr) {
        console.warn('[AudioService] Player replace failed, recreating player:', replaceErr);
        await stopAndUnloadAudio();
      }
    }

    // 2. Fresh player instantiation
    await stopAndUnloadAudio();

    const player = createAudioPlayer(source, {
      updateInterval: 250,
      keepAudioSessionActive: true,
    });
    playerInstance = player;

    attachStatusListener(player);

    if (!isExpoGo && currentTrackMetadata) {
      try {
        if (typeof player.setActiveForLockScreen === 'function') {
          player.setActiveForLockScreen(
            true,
            currentTrackMetadata,
            DEFAULT_LOCK_SCREEN_OPTIONS
          );
        }
      } catch (lockErr) {
        console.warn('[AudioService] Failed to set initial lock screen controls:', lockErr);
      }
    }

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
  shouldAutoPlay = false;
  currentStatusCallback = null;
  currentTrackMetadata = undefined;

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
      } else if (typeof (playerToRelease as unknown as { release?: () => void }).release === 'function') {
        (playerToRelease as unknown as { release: () => void }).release();
      }
    } catch {
      // ignore
    }
  }
}

export function updateAudioMetadata(metadata: AudioMetadata): void {
  currentTrackMetadata = metadata;
  if (isExpoGo || !playerInstance) return;
  try {
    if (typeof playerInstance.setActiveForLockScreen === 'function') {
      playerInstance.setActiveForLockScreen(
        true,
        metadata,
        DEFAULT_LOCK_SCREEN_OPTIONS
      );
    } else if (typeof (playerInstance as unknown as { updateLockScreenMetadata?: (meta: AudioMetadata) => void }).updateLockScreenMetadata === 'function') {
      (playerInstance as unknown as { updateLockScreenMetadata: (meta: AudioMetadata) => void }).updateLockScreenMetadata(metadata);
    }
  } catch {
    // Suppress in Expo Go or intermediate transitions
  }
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
