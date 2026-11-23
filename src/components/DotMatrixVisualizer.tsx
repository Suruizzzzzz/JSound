import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  View,
  Animated,
  Image,
  Easing,
} from 'react-native';
import { useThemeStore } from '@/store/themeStore';
import { usePlayerStore } from '@/store/playerStore';
import { createStyles } from '@/styles/DotMatrixVisualizer.styles';

const NUM_BARS = 24;
const RESTING_SCALE = 0.1; // Minimal resting pill height (~5px)

interface BarConfig {
  peak1: number;
  peak2: number;
  low: number;
  dur1: number;
  dur2: number;
}

function getBarConfig(index: number, position: number): BarConfig {
  const phase = (position * 2.8 + (index / NUM_BARS) * Math.PI * 2) % (2 * Math.PI);
  const posMod = Math.sin(phase);

  if (index < 6) {
    // Bass / Kick columns: punchy rhythmic pulse (0.82 - 0.98)
    const peak = Math.min(0.98, Math.max(0.78, 0.88 + 0.10 * posMod));
    return {
      peak1: peak,
      peak2: Math.max(0.60, peak * 0.78),
      low: 0.18 + (index % 3) * 0.04,
      dur1: 100 + (index % 3) * 15,
      dur2: 150 + (index % 4) * 20,
    };
  } else if (index < 14) {
    // Low-mids / vocal body: rolling fluid waves (0.72 - 0.94)
    const peak = Math.min(0.94, Math.max(0.70, 0.82 + 0.12 * posMod));
    return {
      peak1: peak,
      peak2: Math.max(0.55, peak * 0.74),
      low: 0.16 + (index % 4) * 0.03,
      dur1: 110 + (index % 4) * 15,
      dur2: 140 + (index % 5) * 15,
    };
  } else if (index < 20) {
    // High-mids / Lead instruments: dynamic ripples (0.65 - 0.88)
    const peak = Math.min(0.88, Math.max(0.62, 0.76 + 0.12 * Math.cos(phase)));
    return {
      peak1: peak,
      peak2: Math.max(0.50, peak * 0.70),
      low: 0.14 + (index % 3) * 0.03,
      dur1: 90 + (index % 4) * 12,
      dur2: 125 + (index % 4) * 15,
    };
  } else {
    // Treble / Hi-hats: rapid crisp ticks (0.50 - 0.78)
    const peak = Math.min(0.78, Math.max(0.48, 0.65 + 0.13 * posMod));
    return {
      peak1: peak,
      peak2: Math.max(0.40, peak * 0.65),
      low: 0.12 + (index % 3) * 0.03,
      dur1: 75 + (index % 4) * 10,
      dur2: 105 + (index % 3) * 12,
    };
  }
}

interface DotMatrixVisualizerProps {
  isPlaying: boolean;
  isBuffering?: boolean;
  isVisible?: boolean;
  position?: number;
}

export default function DotMatrixVisualizer({
  isPlaying,
  isBuffering = false,
  isVisible,
  position = 0,
}: DotMatrixVisualizerProps) {
  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);
  const isModalOpen = usePlayerStore((state) => state.isModalOpen);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Visualizer is strictly active ONLY when isPlaying && !isBuffering and modal is open
  const modalActive = isVisible !== undefined ? isVisible : isModalOpen;
  const isAnimating = isPlaying && !isBuffering && modalActive;

  // Crisp monochrome white/silver in Dark Mode and dark charcoal in Light Mode
  const barColor = useMemo(
    () => (mode === 'dark' ? '#E4E4E7' : '#27272A'),
    [mode]
  );

  // Theme-adaptive monogram watermark
  const logoSource = useMemo(
    () =>
      mode === 'dark'
        ? require('@/assets/images/logo-dark.png')
        : require('@/assets/images/logo-light.png'),
    [mode]
  );

  // Initialize 24 animated values once with RESTING_SCALE
  const [animValues] = useState(() =>
    Array.from({ length: NUM_BARS }, () => new Animated.Value(RESTING_SCALE))
  );

  const animationsRef = useRef<Animated.CompositeAnimation[]>([]);
  const lastPositionRef = useRef<number>(position);
  const positionRef = useRef<number>(position);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // Start continuous rhythmic beat loop for a single bar
  const startBarLoop = useCallback(
    (barIdx: number) => {
      const val = animValues[barIdx];
      const cfg = getBarConfig(barIdx, positionRef.current);

      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(val, {
            toValue: cfg.peak1,
            duration: cfg.dur1,
            easing: Easing.bezier(0.15, 0.8, 0.25, 1),
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: cfg.low,
            duration: cfg.dur2,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: cfg.peak2,
            duration: cfg.dur1 * 1.1,
            easing: Easing.out(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(val, {
            toValue: RESTING_SCALE,
            duration: cfg.dur2 * 0.9,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );

      animationsRef.current[barIdx] = loop;
      loop.start();
    },
    [animValues]
  );

  // Main playback state coordinator
  useEffect(() => {
    // Clear any previous running animations
    animationsRef.current.forEach((anim) => anim?.stop());
    animationsRef.current = [];

    if (isAnimating) {
      animValues.forEach((_, barIdx) => {
        startBarLoop(barIdx);
      });
    } else {
      // Smoothly reset bars to resting height when paused, buffering, or modal closed
      animValues.forEach((val) => {
        Animated.timing(val, {
          toValue: RESTING_SCALE,
          duration: 250,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    }

    return () => {
      animationsRef.current.forEach((anim) => anim?.stop());
    };
  }, [isAnimating, animValues, startBarLoop]);

  // Real-time scrubbing response: trigger energetic ripple on seek
  useEffect(() => {
    if (!isAnimating) return;

    const posDelta = Math.abs(position - lastPositionRef.current);
    lastPositionRef.current = position;

    if (posDelta > 0.8) {
      animValues.forEach((val, barIdx) => {
        const cfg = getBarConfig(barIdx, position);
        Animated.sequence([
          Animated.timing(val, {
            toValue: cfg.peak1,
            duration: 80,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(() => {
          if (isAnimating) {
            startBarLoop(barIdx);
          }
        });
      });
    }
  }, [position, isAnimating, animValues, startBarLoop]);

  return (
    <View style={styles.stage}>
      {/* Subtle Centered Monogram Watermark behind the bars */}
      <View style={styles.watermarkWrapper} pointerEvents="none">
        <Image
          source={logoSource}
          style={styles.watermarkImage}
          resizeMode="contain"
        />
      </View>

      {/* Lightweight 24-Bar Monochrome Spectrum Visualizer */}
      <View style={styles.visualizerContent}>
        <View style={styles.barsContainer}>
          {animValues.map((animVal, barIdx) => (
            <View key={`bar-wrap-${barIdx}`} style={styles.barWrapper}>
              <Animated.View
                style={[
                  styles.bar,
                  {
                    backgroundColor: barColor,
                    transform: [{ scaleY: animVal }],
                  },
                ]}
              />
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
