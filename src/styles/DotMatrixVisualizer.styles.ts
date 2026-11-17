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
      width: 150,
      height: 150,
      opacity: 0.055,
    },
    visualizerContent: {
      width: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1,
      paddingHorizontal: 12,
    },
    matrixRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 3.5,
    },
    column: {
      alignItems: 'center',
      width: 4,
    },
    upperBar: {
      width: 4,
      gap: 3,
      flexDirection: 'column-reverse',
      alignItems: 'center',
      transformOrigin: 'bottom',
    },
    horizonLine: {
      width: '88%',
      maxWidth: 260,
      height: 1,
      backgroundColor: theme.primary,
      opacity: 0.18,
      marginVertical: 4,
      borderRadius: 0.5,
    },
    lowerBar: {
      width: 4,
      gap: 3,
      flexDirection: 'column',
      alignItems: 'center',
      transformOrigin: 'top',
    },
    dot: {
      width: 4,
      height: 4,
      borderRadius: 1,
      backgroundColor: theme.primary,
    },
  });
