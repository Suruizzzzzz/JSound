import { StyleSheet, Dimensions } from 'react-native';
import { ThemeColors } from '@/constants/theme';

const { height } = Dimensions.get('window');

export const createStyles = (theme: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
      position: 'relative',
      justifyContent: 'space-between',
    },
    watermarkContainer: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
    },
    watermarkImage: {
      width: 320,
      height: 320,
      opacity: 0.04,
    },
    contentWrapper: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 28,
      paddingTop: height * 0.06,
    },
    logoSection: {
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 24,
    },
    logoImage: {
      width: 110,
      height: 110,
    },
    soundwaveContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      height: 32,
      marginVertical: 18,
      gap: 5,
    },
    soundwaveBar: {
      width: 3.5,
      borderRadius: 2,
      backgroundColor: theme.primary,
    },
    typographySection: {
      alignItems: 'center',
      marginTop: 6,
    },
    title: {
      fontSize: 34,
      fontWeight: '800',
      letterSpacing: -0.6,
      color: theme.textPrimary,
      textAlign: 'center',
    },
    subtitle: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 2.5,
      marginTop: 4,
      color: theme.textSecondary,
      textTransform: 'uppercase',
      textAlign: 'center',
    },
    tagline: {
      fontSize: 15,
      fontStyle: 'italic',
      color: theme.textMuted,
      marginTop: 14,
      textAlign: 'center',
      lineHeight: 22,
      maxWidth: 260,
    },
    actionsWrapper: {
      paddingHorizontal: 24,
      paddingBottom: 36,
      gap: 12,
      width: '100%',
      maxWidth: 400,
      alignSelf: 'center',
    },
    primaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.primary,
      paddingVertical: 15,
      borderRadius: 12,
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 3 },
      shadowOpacity: 0.15,
      shadowRadius: 5,
      elevation: 4,
    },
    primaryButtonText: {
      fontSize: 15,
      fontWeight: '700',
      color: theme.onPrimary,
      letterSpacing: 0.3,
    },
    secondaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.surfaceElevated,
      borderColor: theme.border,
      borderWidth: 1,
      paddingVertical: 14,
      borderRadius: 12,
    },
    secondaryButtonText: {
      fontSize: 14,
      fontWeight: '600',
      color: theme.textPrimary,
      letterSpacing: 0.2,
    },
  });
