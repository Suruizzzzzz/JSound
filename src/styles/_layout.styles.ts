import { StyleSheet, Platform } from 'react-native';
import { ThemeColors } from '@/constants/theme';

export const createStyles = (theme: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    tabBar: {
      backgroundColor: theme.background,
      borderTopColor: theme.border,
      borderTopWidth: 1,
      height: Platform.OS === 'ios' ? 88 : 64,
      paddingBottom: Platform.OS === 'ios' ? 28 : 10,
      paddingTop: 8,
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      elevation: 8,
    },
    tabBarLabel: {
      fontSize: 11,
      fontWeight: '600',
      marginTop: 2,
    },
  });
