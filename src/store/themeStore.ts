import { create } from 'zustand';
import { ThemeColors, ThemeMode, Themes } from '@/constants/theme';
import { getSetting, setSetting } from '@/lib/database';

interface ThemeState {
  mode: ThemeMode;
  theme: ThemeColors;
  isLoaded: boolean;
  initTheme: () => Promise<void>;
  toggleTheme: () => void;
  setThemeMode: (mode: ThemeMode) => void;
}

const defaultThemeMode: ThemeMode = 'light';

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: defaultThemeMode,
  theme: Themes[defaultThemeMode],
  isLoaded: false,

  initTheme: async () => {
    try {
      const savedMode = await getSetting('theme_mode');
      if (savedMode === 'light' || savedMode === 'dark') {
        set({
          mode: savedMode,
          theme: Themes[savedMode],
          isLoaded: true,
        });
        return;
      }
    } catch (e) {
      console.warn('Failed to load saved theme mode:', e);
    }
    set({ isLoaded: true });
  },

  toggleTheme: () => {
    const currentMode = get().mode;
    const nextMode: ThemeMode = currentMode === 'dark' ? 'light' : 'dark';
    set({
      mode: nextMode,
      theme: Themes[nextMode],
    });
    setSetting('theme_mode', nextMode).catch((e) => {
      console.warn('Failed to persist theme:', e);
    });
  },

  setThemeMode: (mode: ThemeMode) => {
    set({
      mode,
      theme: Themes[mode],
    });
    setSetting('theme_mode', mode).catch((e) => {
      console.warn('Failed to persist theme:', e);
    });
  },
}));
