import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Easing,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect, useRootNavigationState } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore } from '@/store/authStore';
import { initDatabase, setSetting, getSetting } from '@/lib/database';
import { createStyles } from '@/styles/welcome.styles';

export default function WelcomeScreen() {
  const router = useRouter();
  const rootNavState = useRootNavigationState();
  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);
  const setGuestSession = useAuthStore((state) => state.setGuestSession);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Theme-adaptive logo
  const logoSource = useMemo(
    () =>
      mode === 'dark'
        ? require('@/assets/images/logo-dark.png')
        : require('@/assets/images/logo-light.png'),
    [mode]
  );

  // Entrance animation values
  const [isCheckingWelcome, setIsCheckingWelcome] = useState(true);
  const [textTranslate] = useState(() => new Animated.Value(18));
  const [textOpacity] = useState(() => new Animated.Value(0));
  const [actionsTranslate] = useState(() => new Animated.Value(24));
  const [actionsOpacity] = useState(() => new Animated.Value(0));

  // 5 Equalizer bar scale animations
  const [bar1] = useState(() => new Animated.Value(0.3));
  const [bar2] = useState(() => new Animated.Value(0.5));
  const [bar3] = useState(() => new Animated.Value(0.2));
  const [bar4] = useState(() => new Animated.Value(0.6));
  const [bar5] = useState(() => new Animated.Value(0.3));

  // Wavy dot matrix wave loop
  const [waveAnim] = useState(() => new Animated.Value(0));

  const WAVY_COLS = 8;
  const WAVY_ROWS = 12;

  const colAnimations = useMemo(() => {
    return Array.from({ length: WAVY_COLS }, (_, c) => {
      const fraction = c / (WAVY_COLS - 1);
      const mid = 0.2 + fraction * 0.6;
      return {
        opacity: waveAnim.interpolate({
          inputRange: [0, mid, 1],
          outputRange: [0.10, 0.22, 0.10],
        }),
        scaleY: waveAnim.interpolate({
          inputRange: [0, mid, 1],
          outputRange: [0.85, 1.25, 0.85],
        }),
      };
    });
  }, [waveAnim]);

  useEffect(() => {
    if (isCheckingWelcome) return;

    // 1. Entrance sequence
    Animated.sequence([
      Animated.parallel([
        Animated.timing(textTranslate, {
          toValue: 0,
          duration: 550,
          useNativeDriver: true,
        }),
        Animated.timing(textOpacity, {
          toValue: 1,
          duration: 550,
          useNativeDriver: true,
        }),
      ]),
      Animated.parallel([
        Animated.timing(actionsTranslate, {
          toValue: 0,
          duration: 450,
          useNativeDriver: true,
        }),
        Animated.timing(actionsOpacity, {
          toValue: 1,
          duration: 450,
          useNativeDriver: true,
        }),
      ]),
    ]).start();

    // 2. Loop equalizer animations with varied frequencies
    const createBarLoop = (val: Animated.Value, peak: number, duration: number) => {
      return Animated.loop(
        Animated.sequence([
          Animated.timing(val, {
            toValue: peak,
            duration,
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: 0.25,
            duration,
            useNativeDriver: true,
          }),
        ])
      );
    };

    const l1 = createBarLoop(bar1, 0.95, 420);
    const l2 = createBarLoop(bar2, 1.0, 580);
    const l3 = createBarLoop(bar3, 0.85, 360);
    const l4 = createBarLoop(bar4, 1.0, 520);
    const l5 = createBarLoop(bar5, 0.75, 460);

    l1.start();
    l2.start();
    l3.start();
    l4.start();
    l5.start();

    // 3. Wavy dot matrix background wave
    const waveLoop = Animated.loop(
      Animated.timing(waveAnim, {
        toValue: 1,
        duration: 3800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    waveLoop.start();

    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
      l4.stop();
      l5.stop();
      waveLoop.stop();
    };
  }, [
    isCheckingWelcome,
    textTranslate,
    textOpacity,
    actionsTranslate,
    actionsOpacity,
    bar1,
    bar2,
    bar3,
    bar4,
    bar5,
    waveAnim,
  ]);

  // Check if user has already seen onboarding; if so, skip directly to player tabs
  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      // Failsafe timeout to prevent any splash hanging even if rootNavState?.key isn't ready on first tick
      const failsafeTimer = setTimeout(() => {
        if (isMounted) {
          setIsCheckingWelcome(false);
        }
        SplashScreen.hideAsync().catch(() => {});
      }, 1000);

      // Confirm root <Stack> navigator is mounted and ready before attempting navigation;
      // useFocusEffect re-runs once rootNavState?.key becomes available.
      if (!rootNavState?.key) {
        return () => {
          isMounted = false;
          clearTimeout(failsafeTimer);
        };
      }

      async function checkExistingWelcome() {
        try {
          await initDatabase();
          if (!useAuthStore.getState().isAuthHydrated) {
            await useAuthStore.getState().initProfile();
          }
          const seen = await getSetting('has_seen_welcome');
          const { user: currentUser, isGuestSession: isGuest } = useAuthStore.getState();

          if (seen === 'true' && (currentUser?.is_logged_in || isGuest) && isMounted) {
            router.replace('/(tabs)');
            return;
          }
        } catch (err) {
          console.warn('Welcome check error:', err);
        } finally {
          if (isMounted) {
            setIsCheckingWelcome(false);
          }
          SplashScreen.hideAsync().catch(() => {});
        }
      }

      checkExistingWelcome();

      return () => {
        isMounted = false;
        clearTimeout(failsafeTimer);
      };
    }, [router, rootNavState?.key])
  );

  const handleGetStarted = () => {
    router.push('/auth');
  };

  const handleContinueGuest = async () => {
    setGuestSession(true);
    try {
      await setSetting('has_seen_welcome', 'true');
    } catch (e) {
      console.warn('Error setting welcome status:', e);
    }
    router.replace('/(tabs)');
  };

  if (isCheckingWelcome) {
    return (
      <SafeAreaView style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
        <ActivityIndicator size="small" color={theme.primary} />
      </SafeAreaView>
    );
  }

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

      {/* Minimalist Animated Wavy Dot Matrix Background */}
      <View style={styles.wavyDotGrid} pointerEvents="none">
        {colAnimations.map((anim, colIdx) => (
          <Animated.View
            key={`col-${colIdx}`}
            style={[
              styles.wavyDotCol,
              {
                opacity: anim.opacity,
                transform: [{ scaleY: anim.scaleY }],
              },
            ]}
          >
            {Array.from({ length: WAVY_ROWS }).map((_, rowIdx) => (
              <View key={`dot-${rowIdx}`} style={styles.wavyDot} />
            ))}
          </Animated.View>
        ))}
      </View>

      {/* Center Hero Area */}
      <View style={styles.contentWrapper}>
        {/* Minimalist Animated 5-Bar Soundwave / Equalizer */}
        <View style={styles.soundwaveContainer}>
          <Animated.View
            style={[
              styles.soundwaveBar,
              { height: 26, transform: [{ scaleY: bar1 }] },
            ]}
          />
          <Animated.View
            style={[
              styles.soundwaveBar,
              { height: 26, transform: [{ scaleY: bar2 }] },
            ]}
          />
          <Animated.View
            style={[
              styles.soundwaveBar,
              { height: 26, transform: [{ scaleY: bar3 }] },
            ]}
          />
          <Animated.View
            style={[
              styles.soundwaveBar,
              { height: 26, transform: [{ scaleY: bar4 }] },
            ]}
          />
          <Animated.View
            style={[
              styles.soundwaveBar,
              { height: 26, transform: [{ scaleY: bar5 }] },
            ]}
          />
        </View>

        {/* Staggered Typography Entrance */}
        <Animated.View
          style={[
            styles.typographySection,
            {
              opacity: textOpacity,
              transform: [{ translateY: textTranslate }],
            },
          ]}
        >
          <Text style={styles.title}>JStream</Text>
          <Text style={styles.subtitle}>PERSONAL MUSIC</Text>
          <Text style={styles.tagline}>
            &ldquo;Your music, offline-first and unbound.&rdquo;
          </Text>
        </Animated.View>
      </View>

      {/* Staggered Bottom Action Buttons */}
      <Animated.View
        style={[
          styles.actionsWrapper,
          {
            opacity: actionsOpacity,
            transform: [{ translateY: actionsTranslate }],
          },
        ]}
      >
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={handleGetStarted}
          activeOpacity={0.8}
        >
          <Text style={styles.primaryButtonText}>Get Started</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.secondaryButton}
          onPress={handleContinueGuest}
          activeOpacity={0.8}
        >
          <Text style={styles.secondaryButtonText}>Continue Offline (Guest)</Text>
        </TouchableOpacity>
      </Animated.View>
    </SafeAreaView>
  );
}
