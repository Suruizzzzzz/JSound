import { StyleSheet, Platform } from 'react-native';
import { ThemeColors } from '@/constants/theme';

export const createStyles = (theme: ThemeColors) =>
  StyleSheet.create({
    container: {
      position: 'absolute',
      left: 8,
      right: 8,
      bottom: Platform.OS === 'ios' ? 88 : 64,
      borderRadius: 10,
      overflow: 'hidden',
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.12,
      shadowRadius: 5,
      elevation: 6,
    },
    innerContent: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 10,
      paddingVertical: 8,
    },
    artContainer: {
      width: 42,
      height: 42,
      borderRadius: 8,
      overflow: 'hidden',
      borderWidth: 1,
      backgroundColor: theme.surfaceElevated,
      borderColor: theme.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    artImage: {
      width: '100%',
      height: '100%',
    },
    placeholderArt: {
      width: '100%',
      height: '100%',
      justifyContent: 'center',
      alignItems: 'center',
    },
    trackInfo: {
      flex: 1,
      marginLeft: 12,
      marginRight: 8,
    },
    title: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textPrimary,
    },
    artist: {
      fontSize: 12,
      marginTop: 2,
      color: theme.textSecondary,
    },
    controls: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    controlButton: {
      padding: 4,
      justifyContent: 'center',
      alignItems: 'center',
    },
    progressBarBackground: {
      height: 2,
      width: '100%',
      backgroundColor: theme.border,
    },
    progressBarFill: {
      height: '100%',
      backgroundColor: theme.primary,
    },
  });
