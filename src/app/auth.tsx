import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Animated,
  Image,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore } from '@/store/authStore';
import { setSetting } from '@/lib/database';
import { createStyles } from '@/styles/auth.styles';

export default function AuthScreen() {
  const router = useRouter();
  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const signInWithEmail = useAuthStore((state) => state.signInWithEmail);
  const signUp = useAuthStore((state) => state.signUp);
  const resendConfirmation = useAuthStore((state) => state.resendConfirmation);
  const checkEmailConfirmed = useAuthStore((state) => state.checkEmailConfirmed);
  const signInWithGoogle = useAuthStore((state) => state.signInWithGoogle);
  const setGuestSession = useAuthStore((state) => state.setGuestSession);
  const user = useAuthStore((state) => state.user);

  // Auto-redirect to Library tabs immediately upon user login or session detection
  useEffect(() => {
    if (user?.is_logged_in) {
      setSetting('has_seen_welcome', 'true').catch(() => {});
      router.replace('/(tabs)');
    }
  }, [user?.is_logged_in, router]);

  // Theme-adaptive logo
  const logoSource = useMemo(
    () =>
      mode === 'dark'
        ? require('@/assets/images/logo-dark.png')
        : require('@/assets/images/logo-light.png'),
    [mode]
  );

  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [isCheckEmailView, setIsCheckEmailView] = useState(false);
  const [showCollisionModal, setShowCollisionModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingConfirmation, setIsCheckingConfirmation] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Transition animation for view switching
  const [formFadeAnim] = useState(() => new Animated.Value(1));

  // Countdown timer for confirmation email resend cooldown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  const animateFormTransition = (callback: () => void) => {
    Animated.sequence([
      Animated.timing(formFadeAnim, {
        toValue: 0.15,
        duration: 100,
        useNativeDriver: true,
      }),
      Animated.timing(formFadeAnim, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }),
    ]).start();
    callback();
  };

  const handleModeChange = (newMode: 'login' | 'register') => {
    if (newMode === authMode && !isCheckEmailView) return;
    setErrorMessage(null);
    setInfoMessage(null);
    setIsCheckEmailView(false);
    animateFormTransition(() => setAuthMode(newMode));
  };

  // Primary action button handler (Sign In / Register)
  const handleSubmit = async () => {
    setErrorMessage(null);
    setInfoMessage(null);

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }

    if (!password) {
      setErrorMessage('Please enter your password.');
      return;
    }

    if (authMode === 'register' && password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (authMode === 'login') {
        await signInWithEmail(cleanEmail, password);
        await setSetting('has_seen_welcome', 'true');
        router.replace('/(tabs)');
      } else {
        // Register mode: create account and send confirmation link
        const res = await signUp(cleanEmail, password, fullName.trim());
        if (res.identityCollision) {
          setShowCollisionModal(true);
          return;
        }
        if (res.needsConfirmation) {
          animateFormTransition(() => {
            setIsCheckEmailView(true);
            setResendCooldown(60);
            setInfoMessage('Confirmation email has been sent!');
          });
        } else {
          // Immediately logged in (if email confirmation was turned off in Supabase)
          await setSetting('has_seen_welcome', 'true');
          router.replace('/(tabs)');
        }
      }
    } catch (err: any) {
      const msg = err?.message || 'Authentication error. Please check your details.';
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Check if user confirmed their email via link
  const handleCheckEmailConfirmed = async () => {
    setErrorMessage(null);
    setInfoMessage(null);
    setIsCheckingConfirmation(true);

    try {
      await checkEmailConfirmed({
        email: email.trim(),
        password,
      });
      await setSetting('has_seen_welcome', 'true');
      router.replace('/(tabs)');
    } catch (err: any) {
      setErrorMessage(
        err?.message ||
          "Your email isn't confirmed yet. Please open your inbox and tap 'Confirm email address' first."
      );
    } finally {
      setIsCheckingConfirmation(false);
    }
  };

  // Resend confirmation email link
  const handleResendConfirmation = async () => {
    if (resendCooldown > 0 || isResending) return;
    setIsResending(true);
    setErrorMessage(null);
    try {
      await resendConfirmation(email.trim());
      setResendCooldown(60);
      setInfoMessage('New confirmation link sent! Please check your inbox.');
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to resend confirmation email. Please try again.');
    } finally {
      setIsResending(false);
    }
  };

  // Return to registration form to change email
  const handleBackToRegister = () => {
    setErrorMessage(null);
    setInfoMessage(null);
    animateFormTransition(() => {
      setIsCheckEmailView(false);
    });
  };

  // Google OAuth sign-in
  const handleGoogleSignIn = async () => {
    setErrorMessage(null);
    setInfoMessage(null);
    setIsSubmitting(true);
    try {
      await signInWithGoogle();
      await setSetting('has_seen_welcome', 'true');
      router.replace('/(tabs)');
    } catch (err: any) {
      if (err?.message && !err.message.includes('cancelled')) {
        setErrorMessage(err.message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Offline Guest Mode
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
    if (isCheckEmailView) {
      handleBackToRegister();
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />

      {/* Subtle Oversized Cat Logo Background Watermark */}
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
        </View>

        {isCheckEmailView ? (
          /* ========================================================
             Check Your Inbox Verification Screen (Link-Based)
             ======================================================== */
          <Animated.View style={[styles.checkEmailContainer, { opacity: formFadeAnim }]}>
            {/* Large Circular Mail Icon Badge */}
            <View style={styles.mailBadgeContainer}>
              <View style={styles.mailBadge}>
                <Ionicons name="mail-outline" size={38} color={theme.primary} />
              </View>
            </View>

            {/* Heading & Instructions */}
            <Text style={styles.checkEmailTitle}>Check Your Inbox</Text>
            <Text style={styles.checkEmailSubtitle}>
              We sent a confirmation link to{' '}
              <Text style={styles.highlightEmail}>{email.trim()}</Text>. Open your email app,
              tap <Text style={styles.highlightEmail}>&quot;Confirm email address&quot;</Text>, then come
              back here and tap the button below.
            </Text>

            {/* Error Message Feedback */}
            {errorMessage ? (
              <View style={[styles.errorContainer, { width: '100%', marginBottom: 14 }]}>
                <Ionicons name="alert-circle-outline" size={18} color={theme.error} />
                <Text style={styles.errorText}>{errorMessage}</Text>
              </View>
            ) : null}

            {/* Info / Success Feedback */}
            {infoMessage ? (
              <View style={[styles.infoContainer, { width: '100%', marginBottom: 14 }]}>
                <Ionicons name="checkmark-circle-outline" size={18} color="#22C55E" />
                <Text style={styles.infoText}>{infoMessage}</Text>
              </View>
            ) : null}

            {/* Subtle Step-by-Step Hint Card */}
            <View style={styles.hintCard}>
              <View style={styles.hintRow}>
                <Text style={styles.hintNumber}>1.</Text>
                <Text style={styles.hintText}>Open your email inbox (check Spam if needed)</Text>
              </View>
              <View style={styles.hintRow}>
                <Text style={styles.hintNumber}>2.</Text>
                <Text style={styles.hintText}>Tap &quot;Confirm email address&quot;</Text>
              </View>
              <View style={styles.hintRow}>
                <Text style={styles.hintNumber}>3.</Text>
                <Text style={styles.hintText}>Return here and tap &quot;I&apos;ve Confirmed My Email&quot;</Text>
              </View>
            </View>

            {/* Primary Action Button */}
            <TouchableOpacity
              style={[
                styles.checkEmailButton,
                isCheckingConfirmation && styles.checkEmailButtonDisabled,
              ]}
              onPress={handleCheckEmailConfirmed}
              disabled={isCheckingConfirmation}
              activeOpacity={0.8}
            >
              {isCheckingConfirmation ? (
                <ActivityIndicator size="small" color={theme.onPrimary} />
              ) : (
                <Text style={styles.checkEmailButtonText}>I&apos;ve Confirmed My Email</Text>
              )}
            </TouchableOpacity>

            {/* Secondary Action Row: Resend Email & Use Different Email */}
            <View style={styles.secondaryActionsRow}>
              <TouchableOpacity
                style={[
                  styles.secondaryActionBtn,
                  resendCooldown > 0 && styles.secondaryActionBtnDisabled,
                ]}
                onPress={handleResendConfirmation}
                disabled={resendCooldown > 0 || isResending}
                activeOpacity={0.7}
              >
                <Text style={styles.secondaryActionText}>
                  {isResending
                    ? 'Resending...'
                    : resendCooldown > 0
                    ? `Resend Email (${resendCooldown}s)`
                    : 'Resend Email'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.secondaryActionBtn}
                onPress={handleBackToRegister}
                activeOpacity={0.7}
              >
                <Text style={styles.secondaryActionTextMuted}>Use Different Email</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        ) : (
          /* ========================================================
             Standard Sign In & Register Form View
             ======================================================== */
          <>
            {/* Dynamic Heading */}
            <View style={styles.headingSection}>
              <Text style={styles.headingTitle}>
                {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
              </Text>
              <Text style={styles.headingSubtitle}>
                {authMode === 'login'
                  ? 'Sign in to synchronize your offline tracks and playlists'
                  : 'Join JStream for seamless cloud sync & backup'}
              </Text>
            </View>

            {/* Mode Switcher */}
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
              {/* Error Message Feedback */}
              {errorMessage ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle-outline" size={18} color={theme.error} />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : null}

              {/* Info / Success Feedback */}
              {infoMessage ? (
                <View style={styles.infoContainer}>
                  <Ionicons name="checkmark-circle-outline" size={18} color="#22C55E" />
                  <Text style={styles.infoText}>{infoMessage}</Text>
                </View>
              ) : null}

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
                    returnKeyType="next"
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
                  returnKeyType="next"
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
                  returnKeyType="done"
                  onSubmitEditing={handleSubmit}
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

            {/* Alternative Auth Providers */}
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
          </>
        )}
      </ScrollView>

      {/* Account Already Exists Collision Modal */}
      <Modal
        visible={showCollisionModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowCollisionModal(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setShowCollisionModal(false)}
        >
          <View style={styles.modalContent} onStartShouldSetResponder={() => true}>
            <View style={styles.collisionIconBadge}>
              <Ionicons name="logo-google" size={26} color={theme.textPrimary} />
            </View>

            <Text style={styles.collisionModalTitle}>Account Already Exists</Text>
            <Text style={styles.collisionModalSubtitle}>
              This email is already linked to a Google sign-in. Please use &quot;Continue with Google&quot; to access your account.
            </Text>

            <TouchableOpacity
              style={styles.collisionGoogleButton}
              onPress={() => {
                setShowCollisionModal(false);
                handleGoogleSignIn();
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="logo-google" size={17} color={theme.onPrimary} />
              <Text style={styles.collisionGoogleButtonText}>Continue with Google</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.collisionCancelButton}
              onPress={() => setShowCollisionModal(false)}
              activeOpacity={0.7}
            >
              <Text style={styles.collisionCancelButtonText}>Cancel / Use Another Email</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}
