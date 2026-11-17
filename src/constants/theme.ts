import { Platform } from 'react-native';

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  primary: string;
  onPrimary: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
}

export const SoftDarkTheme: ThemeColors = {
  background: '#141414',
  surface: '#1E1E1E',
  surfaceElevated: '#262626',
  border: '#2E2E2E',
  primary: '#F4F4F2',
  onPrimary: '#141414',
  textPrimary: '#F4F4F2',
  textSecondary: '#9A9A9A',
  textMuted: '#666666',
};

export const SoftLightTheme: ThemeColors = {
  background: '#F7F7F5',
  surface: '#FFFFFF',
  surfaceElevated: '#EFEFED',
  border: '#E2E2DF',
  primary: '#1C1C1C',
  onPrimary: '#F7F7F5',
  textPrimary: '#1C1C1C',
  textSecondary: '#686865',
  textMuted: '#9E9E9A',
};

export const Themes = {
  dark: SoftDarkTheme,
  light: SoftLightTheme,
} as const;

export const Colors = Themes;

export type ThemeMode = 'dark' | 'light';
export type ThemeColor = keyof ThemeColors;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display, sans-serif)',
    serif: 'var(--font-serif, serif)',
    rounded: 'var(--font-rounded, sans-serif)',
    mono: 'var(--font-mono, monospace)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 70 }) ?? 60;
export const MaxContentWidth = 800;
