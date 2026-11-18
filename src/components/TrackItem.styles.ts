import { StyleSheet } from 'react-native';
import { ThemeColors } from '@/constants/theme';

export const createStyles = (theme: ThemeColors) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      marginHorizontal: 8,
      marginVertical: 1,
    },
    activeContainer: {
      backgroundColor: theme.surfaceElevated,
    },
    artworkContainer: {
      width: 44,
      height: 44,
      borderRadius: 8,
      overflow: 'hidden',
      borderWidth: 1,
      backgroundColor: theme.surfaceElevated,
      borderColor: theme.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    artwork: {
      width: '100%',
      height: '100%',
    },
    placeholder: {
      width: '100%',
      height: '100%',
      backgroundColor: theme.surfaceElevated,
      justifyContent: 'center',
      alignItems: 'center',
    },
    info: {
      flex: 1,
      marginLeft: 12,
      marginRight: 8,
    },
    title: {
      fontSize: 15,
      fontWeight: '500',
      color: theme.textPrimary,
    },
    activeTitle: {
      fontWeight: '700',
      color: theme.primary,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: 3,
    },
    artist: {
      fontSize: 13,
      maxWidth: '75%',
      color: theme.textSecondary,
    },
    metaDot: {
      fontSize: 11,
      marginHorizontal: 5,
      color: theme.textMuted,
    },
    duration: {
      fontSize: 12,
      color: theme.textMuted,
    },
    deleteButton: {
      padding: 6,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionIconButton: {
      padding: 6,
      justifyContent: 'center',
      alignItems: 'center',
    },
    actionsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    dragHandle: {
      paddingHorizontal: 8,
      paddingVertical: 6,
      justifyContent: 'center',
      alignItems: 'center',
    },
    reorderControlsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginLeft: 4,
    },
    reorderArrowBtn: {
      padding: 6,
      borderRadius: 6,
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.border,
      justifyContent: 'center',
      alignItems: 'center',
    },
    reorderArrowDisabled: {
      opacity: 0.25,
    },
    downloadProgressContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 5,
      paddingHorizontal: 8,
      borderRadius: 12,
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.border,
      gap: 4,
    },
    downloadProgressText: {
      fontSize: 11,
      fontWeight: '700',
      color: theme.primary,
    },
  });
