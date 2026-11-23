import { StyleSheet } from 'react-native';
import { ThemeColors } from '@/constants/theme';

export const createStyles = (theme: ThemeColors) =>
  StyleSheet.create({
    stage: {
      flex: 1,
      width: '100%',
      height: '100%',
      backgroundColor: theme.surfaceElevated,
      alignItems: 'center',
      justifyContent: 'center',
      position: 'relative',
      overflow: 'hidden',
      borderRadius: 16,
    },
    watermarkWrapper: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
    },
    watermarkImage: {
      width: 140,
      height: 140,
      opacity: 0.05,
    },
    visualizerContent: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
    },
    barsContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 64,
      gap: 5,
    },
    barWrapper: {
      height: 64,
      justifyContent: 'center',
      alignItems: 'center',
    },
    bar: {
      width: 3,
      height: 52,
      borderRadius: 2,
    },
  });
