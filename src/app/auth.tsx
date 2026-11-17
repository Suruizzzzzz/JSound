import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore } from '@/services/authService';
import { setSetting } from '@/lib/database';
import { createStyles } from '@/styles/auth.styles';

export default function AuthScreen() {
  const router = useRouter();
  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const signInWithEmail = useAuthStore((state) => state.signInWithEmail);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const setGuestSession = useAuthStore((state) => state.setGuestSession);

  // Theme-adaptive logo
  const logoSource = useMemo(
    () =>
      mode === 'dark'
        ? require('@/assets/images/logo-dark.png')
        : require('@/assets/images/logo-light.png'),
    [mode]
  );

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Transition animation for mode switcher
  const [formFadeAnim] = useState(() => new Animated.Value(1));

  const handleModeChange = (newMode: 'login' | 'register') => {
    if (newMode === authMode) return;
    Animated.sequence([
      Animated.timing(formFadeAnim, {
        toValue: 0.15,
        duration: 120,
        useNativeDriver: true,
      }),
      Animated.timing(formFadeAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
    setAuthMode(newMode);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      // Simulate backend sign in / registration
      await new Promise((resolve) => setTimeout(resolve, 500));
      const targetEmail = email.trim() || (authMode === 'login' ? 'member@jsound.app' : 'newuser@jsound.app');
      await signInWithEmail(targetEmail);
      await setSetting('has_seen_welcome', 'true');
      router.replace('/(tabs)');
    } catch (e) {
      console.warn('Auth error:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
      await setSetting('has_seen_welcome', 'true');
      router.replace('/(tabs)');
    } catch (e) {
      console.warn('Google auth error:', e);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipGuest = async () => {
    setGuestSession(true);
    try {
      await setSetting('has_seen_welcome', 'true');
    } catch (e) {
      console.warn('Error setting welcome status:', e);
    }
    router.replace('/(tabs)');
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />

      {/* Subtle Oversized JS Monogram Background Watermark */}
      <View style={styles.watermarkContainer} pointerEvents="none">
        <Image
          source={logoSource}
          style={styles.watermarkImage}
          resizeMode="contain"
        />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Top Header Bar */}
        <View style={styles.headerTop}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            activeOpacity={0.7}
            accessibilityLabel="Go back"
          >
            <Ionicons name="chevron-back" size={22} color={theme.textPrimary} />
          </TouchableOpacity>

          <Image
            source={logoSource}
            style={styles.headerLogo}
            resizeMode="contain"
          />

          <View style={styles.headerPlaceholder} />
        </View>

        {/* Dynamic Heading */}
        <View style={styles.headingSection}>
          <Text style={styles.headingTitle}>
            {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
          </Text>
          <Text style={styles.headingSubtitle}>
            {authMode === 'login'
              ? 'Sign in to synchronize your offline tracks and playlists'
              : 'Join JSound for seamless cloud sync & backup'}
          </Text>
        </View>

        {/* Animated Segmented Mode Switcher */}
        <View style={styles.segmentedControl}>
          <TouchableOpacity
            style={[
              styles.segmentTab,
              authMode === 'login' && styles.segmentTabActive,
            ]}
            onPress={() => handleModeChange('login')}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.segmentText,
                authMode === 'login' && styles.segmentTextActive,
              ]}
            >
              Sign In
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.segmentTab,
              authMode === 'register' && styles.segmentTabActive,
            ]}
            onPress={() => handleModeChange('register')}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.segmentText,
                authMode === 'register' && styles.segmentTextActive,
              ]}
            >
              Register
            </Text>
          </TouchableOpacity>
        </View>

        {/* Form Fields with Fade Transition */}
        <Animated.View style={[styles.formContainer, { opacity: formFadeAnim }]}>
          {authMode === 'register' && (
            <View style={styles.inputWrapper}>
              <Ionicons
                name="person-outline"
                size={18}
                color={theme.textSecondary}
                style={styles.inputIcon}
              />
              <TextInput
                style={styles.inputField}
                placeholder="Full Name"
                placeholderTextColor={theme.textMuted}
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
              />
            </View>
          )}

          <View style={styles.inputWrapper}>
            <Ionicons
              name="mail-outline"
              size={18}
              color={theme.textSecondary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.inputField}
              placeholder="Email address"
              placeholderTextColor={theme.textMuted}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>

          <View style={styles.inputWrapper}>
            <Ionicons
              name="lock-closed-outline"
              size={18}
              color={theme.textSecondary}
              style={styles.inputIcon}
            />
            <TextInput
              style={styles.inputField}
              placeholder="Password"
              placeholderTextColor={theme.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPassword}
              autoCapitalize="none"
            />
            <TouchableOpacity
              onPress={() => setShowPassword(!showPassword)}
              style={styles.eyeButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons
                name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                size={18}
                color={theme.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Primary Action Button */}
          <TouchableOpacity
            style={[
              styles.primaryButton,
              isSubmitting && styles.primaryButtonDisabled,
            ]}
            onPress={handleSubmit}
            disabled={isSubmitting}
            activeOpacity={0.8}
          >
            {isSubmitting ? (
              <ActivityIndicator size="small" color={theme.onPrimary} />
            ) : (
              <Text style={styles.primaryButtonText}>
                {authMode === 'login' ? 'Sign In' : 'Create Account'}
              </Text>
            )}
          </TouchableOpacity>
        </Animated.View>

        {/* Hairline OR Divider */}
        <View style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>OR</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Continue with Google */}
        <TouchableOpacity
          style={styles.googleButton}
          onPress={handleGoogleSignIn}
          disabled={isSubmitting}
          activeOpacity={0.8}
        >
          <Ionicons name="logo-google" size={18} color={theme.textPrimary} />
          <Text style={styles.googleButtonText}>Continue with Google</Text>
        </TouchableOpacity>

        {/* Skip to Offline Guest Mode */}
        <TouchableOpacity
          style={styles.guestLink}
          onPress={handleSkipGuest}
          activeOpacity={0.7}
        >
          <Text style={styles.guestLinkText}>
            Skip &amp; Continue as Offline Guest
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}
