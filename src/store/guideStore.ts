import { create } from 'zustand';
import { getSetting, setSetting } from '@/lib/database';

export const TOTAL_GUIDE_STEPS = 7;

export type GuideTargetKey =
  | 'add_music_button'
  | 'scan_storage_button'
  | 'first_track_item'
  | 'search_tab_icon'
  | 'search_input_bar'
  | 'first_search_download_btn';

export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
  borderRadius?: number;
}

// In-memory registry of measured native element refs
const targetRefs: Partial<Record<GuideTargetKey, any>> = {};

export function registerGuideTarget(key: GuideTargetKey, ref: any) {
  if (ref) {
    targetRefs[key] = ref;
  } else {
    delete targetRefs[key];
  }
}

export function unregisterGuideTarget(key: GuideTargetKey) {
  delete targetRefs[key];
}

export function measureGuideTarget(key: GuideTargetKey): Promise<TargetRect | null> {
  return new Promise((resolve) => {
    const ref = targetRefs[key];
    if (ref && typeof ref.measureInWindow === 'function') {
      try {
        ref.measureInWindow((x: number, y: number, width: number, height: number) => {
          if (width > 0 && height > 0) {
            resolve({ x, y, width, height });
          } else {
            resolve(null);
          }
        });
      } catch {
        resolve(null);
      }
    } else {
      resolve(null);
    }
  });
}

interface GuideState {
  isOpen: boolean;
  currentStep: number;
  noTracksFound: boolean;
  setNoTracksFound: (val: boolean) => void;
  requestOpenAddMusicModal?: () => void;
  setRequestOpenAddMusicModal: (fn?: () => void) => void;
  requestCloseAddMusicModal?: () => void;
  setRequestCloseAddMusicModal: (fn?: () => void) => void;
  openGuide: () => void;
  closeGuide: () => Promise<void>;
  nextStep: () => void;
  prevStep: () => void;
  setStep: (step: number) => void;
  checkAndTriggerGuide: () => Promise<void>;
}

export const useGuideStore = create<GuideState>((set, get) => ({
  isOpen: false,
  currentStep: 0,
  noTracksFound: false,

  setNoTracksFound: (val: boolean) => {
    set({ noTracksFound: val });
  },

  setRequestOpenAddMusicModal: (fn) => {
    set({ requestOpenAddMusicModal: fn });
  },

  setRequestCloseAddMusicModal: (fn) => {
    set({ requestCloseAddMusicModal: fn });
  },

  openGuide: () => {
    set({ isOpen: true, currentStep: 0, noTracksFound: false });
  },

  closeGuide: async () => {
    const { requestCloseAddMusicModal } = get();
    requestCloseAddMusicModal?.();
    set({ isOpen: false });
    try {
      await setSetting('has_seen_onboarding_guide', 'true');
    } catch (err) {
      console.warn('Failed to persist onboarding guide status:', err);
    }
  },

  nextStep: () => {
    const { currentStep, closeGuide } = get();
    if (currentStep < TOTAL_GUIDE_STEPS - 1) {
      set({ currentStep: currentStep + 1 });
    } else {
      closeGuide();
    }
  },

  prevStep: () => {
    const { currentStep } = get();
    if (currentStep > 0) {
      set({ currentStep: currentStep - 1 });
    }
  },

  setStep: (step: number) => {
    if (step >= 0 && step < TOTAL_GUIDE_STEPS) {
      set({ currentStep: step });
    }
  },

  checkAndTriggerGuide: async () => {
    try {
      const seen = await getSetting('has_seen_onboarding_guide');
      if (seen !== 'true') {
        set({ isOpen: true, currentStep: 0, noTracksFound: false });
      }
    } catch (err) {
      console.warn('Failed to check onboarding guide status:', err);
    }
  },
}));
