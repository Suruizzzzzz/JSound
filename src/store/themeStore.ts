import { create } from 'zustand';
import { LayoutAnimation, Platform, UIManager } from 'react-native';
import { ThemeColors, ThemeMode, Themes } from '@/constants/theme';
import { getSetting, setSetting } from '@/lib/database';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ThemeState {
  mode: ThemeMode;
  theme: ThemeColors;
  isLoaded: boolean;
  initTheme: () => Promise<void>;
  toggleTheme: () => void;
  setThemeMode: (mode: ThemeMode) => void;
}

const defaultThemeMode: ThemeMode = 'dark';

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
    set({
      mode: defaultThemeMode,
      theme: Themes[defaultThemeMode],
      isLoaded: true,
    });
  },

  toggleTheme: () => {
    const currentMode = get().mode;
    const nextMode: ThemeMode = currentMode === 'dark' ? 'light' : 'dark';
    get().setThemeMode(nextMode);
  },

  setThemeMode: (mode: ThemeMode) => {
    const currentMode = get().mode;
    if (currentMode === mode) {
      return;
    }

    try {
      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          180,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity
        )
      );
    } catch (e) {
      console.warn('LayoutAnimation error on theme change:', e);
    }

    set({
      mode,
      theme: Themes[mode],
    });

    setSetting('theme_mode', mode).catch((e) => {
      console.warn('Failed to persist theme:', e);
    });
  },
}));
