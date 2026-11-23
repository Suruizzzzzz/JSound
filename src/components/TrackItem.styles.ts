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
    selectedContainer: {
      backgroundColor: theme.surfaceElevated,
      borderWidth: 1,
      borderColor: theme.primary + '55',
    },
    selectedActiveContainer: {
      borderWidth: 1.5,
      borderColor: theme.primary,
    },
    selectionCheckbox: {
      marginRight: 10,
      justifyContent: 'center',
      alignItems: 'center',
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
    activeArtworkContainer: {
      borderColor: theme.primary + '88',
    },
    nowPlayingArtworkBadge: {
      position: 'absolute',
      bottom: 2,
      right: 2,
      backgroundColor: theme.primary,
      borderRadius: 4,
      paddingHorizontal: 3,
      paddingVertical: 2,
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
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    title: {
      fontSize: 15,
      fontWeight: '500',
      color: theme.textPrimary,
      flexShrink: 1,
    },
    activeTitle: {
      fontWeight: '700',
      color: theme.primary,
    },
    nowPlayingTitleBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 4,
      backgroundColor: theme.primary + '18',
    },
    nowPlayingTitleBadgeText: {
      fontSize: 9.5,
      fontWeight: '800',
      color: theme.primary,
      letterSpacing: 0.5,
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
      paddingHorizontal: 6,
      paddingVertical: 6,
      justifyContent: 'center',
      alignItems: 'center',
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
