import {
  createAudioPlayer,
  setAudioModeAsync,
  AudioPlayer,
  AudioStatus,
} from 'expo-audio';
import { EventSubscription } from 'expo';

let playerInstance: AudioPlayer | null = null;
let statusSubscription: EventSubscription | null = null;
let isAudioModeConfigured = false;

export async function ensureAudioMode(): Promise<void> {
  if (isAudioModeConfigured) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    });
    isAudioModeConfigured = true;
  } catch (error) {
    console.warn('Failed to configure audio mode:', error);
  }
}

export async function loadAndPlayAudio(
  uri: string,
  onStatusUpdate: (status: AudioStatus) => void
): Promise<AudioPlayer> {
  await ensureAudioMode();

  // Safely release previous player to prevent memory leaks and audio crashes
  await stopAndUnloadAudio();

  try {
    const player = createAudioPlayer({ uri }, { updateInterval: 250 });
    playerInstance = player;

    statusSubscription = player.addListener('playbackStatusUpdate', (status: AudioStatus) => {
      onStatusUpdate(status);
    });

    player.play();
    return player;
  } catch (error) {
    console.warn('Failed to create or play audio player:', error);
    throw error;
  }
}

export async function pauseAudio(): Promise<void> {
  if (playerInstance) {
    playerInstance.pause();
  }
}

export async function resumeAudio(): Promise<void> {
  if (playerInstance) {
    playerInstance.play();
  }
}

export async function seekAudio(positionSeconds: number): Promise<void> {
  if (playerInstance) {
    const clamped = Math.max(0, positionSeconds);
    await playerInstance.seekTo(clamped);
  }
}

export async function stopAndUnloadAudio(): Promise<void> {
  if (statusSubscription) {
    try {
      statusSubscription.remove();
    } catch {
      // ignore
    }
    statusSubscription = null;
  }

  if (playerInstance) {
    try {
      playerInstance.pause();
    } catch {
      // ignore
    }

    try {
      if (typeof (playerInstance as any).release === 'function') {
        (playerInstance as any).release();
      }
      if (typeof playerInstance.remove === 'function') {
        playerInstance.remove();
      }
    } catch (e) {
      console.warn('Error releasing player:', e);
    }

    playerInstance = null;
  }
}

export function getCurrentPlayer(): AudioPlayer | null {
  return playerInstance;
}
