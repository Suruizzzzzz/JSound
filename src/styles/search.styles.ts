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
    listContent: {
      paddingBottom: 150, // Clearance for MiniPlayer + Bottom Navigation
    },
    header: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 16,
    },
    headerTitle: {
      fontSize: 26,
      fontWeight: '800',
      letterSpacing: -0.5,
      marginBottom: 16,
      color: theme.textPrimary,
    },
    searchBar: {
      flexDirection: 'row',
      alignItems: 'center',
      borderRadius: 10,
      paddingHorizontal: 12,
      height: 46,
      borderWidth: 1,
      backgroundColor: theme.surface,
      borderColor: theme.border,
    },
    searchIcon: {
      marginRight: 8,
    },
    searchInput: {
      flex: 1,
      fontSize: 15,
      paddingVertical: 8,
      color: theme.textPrimary,
    },
    clearButton: {
      padding: 4,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 14,
      paddingHorizontal: 4,
    },
    metaText: {
      fontSize: 13,
      fontWeight: '600',
      color: theme.textSecondary,
    },
    emptyContainer: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      paddingTop: 60,
    },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '700',
      marginTop: 16,
      marginBottom: 8,
      textAlign: 'center',
      color: theme.textPrimary,
    },
    emptySubtitle: {
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
      color: theme.textSecondary,
    },
  });
