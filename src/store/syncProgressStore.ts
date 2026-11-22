import { create } from 'zustand';
import { Track } from '@/types/music';
import { getAllTracks } from '@/repositories/trackRepository';
import { isTrackAudioMissing } from '@/services/playlistSyncService';
import { downloadTrackToOfflineLibrary, OnlineTrackResult } from '@/services/musicDownloadService';
import { usePlayerStore } from '@/store/playerStore';

export interface SyncProgressState {
  isDownloading: boolean;
  currentIndex: number;
  totalCount: number;
  currentTitle: string;
  currentProgress: number; // 0 - 100
  showSyncHistoryModal: boolean;
  syncedTracks: (Track & { isMissingAudio?: boolean })[];
  isLoadingHistory: boolean;

  openSyncHistoryModal: () => void;
  closeSyncHistoryModal: () => void;
  fetchCloudHistory: () => Promise<void>;
  startSyncDownload: (missingTracks?: Track[]) => Promise<void>;
  cancelSyncDownload: () => void;
}

let isCancelled = false;

export const useSyncProgressStore = create<SyncProgressState>((set, get) => ({
  isDownloading: false,
  currentIndex: 0,
  totalCount: 0,
  currentTitle: '',
  currentProgress: 0,
  showSyncHistoryModal: false,
  syncedTracks: [],
  isLoadingHistory: false,

  openSyncHistoryModal: () => {
    set({ showSyncHistoryModal: true });
    get().fetchCloudHistory();
  },

  closeSyncHistoryModal: () => {
    set({ showSyncHistoryModal: false });
  },

  fetchCloudHistory: async () => {
    set({ isLoadingHistory: true });
    try {
      const allTracks = await getAllTracks();
      const withStatus = await Promise.all(
        allTracks.map(async (t) => {
          const isMissing = await isTrackAudioMissing(t);
          return { ...t, isMissingAudio: isMissing };
        })
      );
      set({ syncedTracks: withStatus, isLoadingHistory: false });
    } catch {
      set({ isLoadingHistory: false });
    }
  },

  startSyncDownload: async (tracksToDownload?: Track[]) => {
    if (get().isDownloading) return;

    let targets = tracksToDownload;
    if (!targets || targets.length === 0) {
      const allTracks = await getAllTracks();
      const missing: Track[] = [];
      for (const t of allTracks) {
        if (await isTrackAudioMissing(t)) {
          missing.push(t);
        }
      }
      targets = missing;
    }

    if (!targets || targets.length === 0) return;

    isCancelled = false;
    set({
      isDownloading: true,
      currentIndex: 0,
      totalCount: targets.length,
      currentTitle: '',
      currentProgress: 0,
    });

    for (let i = 0; i < targets.length; i++) {
      if (isCancelled) break;
      const track = targets[i];
      set({
        currentIndex: i + 1,
        currentTitle: track.title,
        currentProgress: 0,
      });

      const onlineId =
        track.youtube_id ||
        (track.id.startsWith('track_yt_')
          ? track.id.replace(/^track_yt_/, '')
          : track.id.startsWith('yt_')
          ? track.id.replace(/^yt_/, '')
          : null);

      try {
        const onlineTrack: OnlineTrackResult = {
          id: onlineId || `query_${encodeURIComponent(track.title)}`,
          title: track.title,
          artist: track.artist || 'Unknown Artist',
          duration: track.duration || 0,
          thumbnailUrl: track.local_artwork_uri,
          source: 'youtube',
        };

        await downloadTrackToOfflineLibrary(onlineTrack, (pct) => {
          if (!isCancelled) {
            set({ currentProgress: Math.min(100, Math.max(0, Math.round(pct))) });
          }
        });
      } catch (err) {
        console.warn(`[SyncProgress] Error downloading "${track.title}":`, err);
      }
    }

    // Refresh tracks in Zustand playerStore upon completion
    const refreshed = await getAllTracks().catch(() => []);
    if (refreshed.length > 0) {
      usePlayerStore.getState().setTracks(refreshed);
    }

    set({
      isDownloading: false,
      currentIndex: 0,
      totalCount: 0,
      currentTitle: '',
      currentProgress: 0,
    });

    // Refresh history if modal is currently open
    if (get().showSyncHistoryModal) {
      get().fetchCloudHistory();
    }
  },

  cancelSyncDownload: () => {
    isCancelled = true;
    set({
      isDownloading: false,
      currentIndex: 0,
      totalCount: 0,
      currentTitle: '',
      currentProgress: 0,
    });
  },
}));
