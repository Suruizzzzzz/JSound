import { StyleSheet } from 'react-native';
import { ThemeColors } from '@/constants/theme';

export const createStyles = (theme: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
      position: 'relative',
    },
    watermarkContainer: {
      position: 'absolute',
      top: '56%',
      left: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 20,
    },
    watermarkImage: {
      width: 260,
      height: 260,
      opacity: 0.05,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 16,
    },
    backButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: theme.surfaceElevated,
      borderColor: theme.border,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: 14,
    },
    headerTitle: {
      fontSize: 24,
      fontWeight: '800',
      letterSpacing: -0.4,
      color: theme.textPrimary,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 4,
      paddingBottom: 60,
    },
    sectionHeader: {
      marginTop: 20,
      marginBottom: 8,
      paddingHorizontal: 4,
    },
    sectionTitle: {
      fontSize: 11.5,
      fontWeight: '700',
      letterSpacing: 1.2,
      color: theme.textSecondary,
      textTransform: 'uppercase',
    },
    card: {
      backgroundColor: theme.surface,
      borderColor: theme.border,
      borderWidth: 1,
      borderRadius: 14,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 14,
      paddingHorizontal: 16,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flex: 1,
      marginRight: 8,
    },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: 9,
      backgroundColor: theme.surfaceElevated,
      borderColor: theme.border,
      borderWidth: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowTextGroup: {
      flex: 1,
    },
    rowTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textPrimary,
    },
    rowSubtitle: {
      fontSize: 12,
      color: theme.textMuted,
      marginTop: 2,
    },
    rowDivider: {
      height: 1,
      backgroundColor: theme.border,
      marginLeft: 62,
    },
    themeSegmentGroup: {
      flexDirection: 'row',
      backgroundColor: theme.surfaceElevated,
      borderRadius: 18,
      padding: 3,
      borderWidth: 1,
      borderColor: theme.border,
    },
    themeSegmentButton: {
      paddingVertical: 5,
      paddingHorizontal: 12,
      borderRadius: 15,
    },
    themeSegmentActive: {
      backgroundColor: theme.primary,
    },
    themeSegmentText: {
      fontSize: 12,
      fontWeight: '600',
      color: theme.textSecondary,
    },
    themeSegmentTextActive: {
      color: theme.onPrimary,
      fontWeight: '700',
    },
    timerPillGroup: {
      flexDirection: 'row',
      gap: 6,
    },
    timerPill: {
      paddingVertical: 5,
      paddingHorizontal: 9,
      borderRadius: 10,
      backgroundColor: theme.surfaceElevated,
      borderColor: theme.border,
      borderWidth: 1,
    },
    timerPillActive: {
      backgroundColor: theme.primary,
      borderColor: theme.primary,
    },
    timerPillText: {
      fontSize: 11.5,
      fontWeight: '600',
      color: theme.textSecondary,
    },
    timerPillTextActive: {
      color: theme.onPrimary,
      fontWeight: '700',
    },
    dangerText: {
      color: theme.textPrimary,
    },
    footerText: {
      fontSize: 11,
      textAlign: 'center',
      color: theme.textMuted,
      marginTop: 32,
      letterSpacing: 0.5,
    },
  });
