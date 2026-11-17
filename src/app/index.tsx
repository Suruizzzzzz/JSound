import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useThemeStore } from '@/store/themeStore';
import { useAuthStore } from '@/services/authService';
import { setSetting } from '@/lib/database';
import { createStyles } from '@/styles/welcome.styles';

export default function WelcomeScreen() {
  const router = useRouter();
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

  useEffect(() => {
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

    return () => {
      l1.stop();
      l2.stop();
      l3.stop();
      l4.stop();
      l5.stop();
    };
  }, [
    textTranslate,
    textOpacity,
    actionsTranslate,
    actionsOpacity,
    bar1,
    bar2,
    bar3,
    bar4,
    bar5,
  ]);

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
