import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import {
  View,
  Animated,
  Image,
  Easing,
} from 'react-native';
import { useThemeStore } from '@/store/themeStore';
import { createStyles } from '@/styles/DotMatrixVisualizer.styles';

const NUM_COLUMNS = 30;
const UPPER_DOT_COUNT = 14;
const LOWER_DOT_COUNT = 8;

// Precomputed opacities: upper fades from 1.0 down to 0.20, reflection from 0.35 down to 0.05
const UPPER_OPACITIES = Array.from({ length: UPPER_DOT_COUNT }, (_, d) =>
  Number((1.0 - (d / 13) * 0.8).toFixed(3))
);

const LOWER_OPACITIES = Array.from({ length: LOWER_DOT_COUNT }, (_, r) =>
  Number((0.35 - (r / 7) * 0.30).toFixed(3))
);

function getRestingHeight(index: number): number {
  // Minimal 1–2 dot resting line across the baseline
  const normalized = index / (NUM_COLUMNS - 1);
  return 0.09 + 0.03 * Math.sin(normalized * Math.PI);
}

function getColumnPeak(index: number, position: number): { peak1: number; peak2: number; low: number; dur1: number; dur2: number } {
  // Modulate phase with position to create organic, shifting spectral waves
  const phase = (position * 3.2 + (index / NUM_COLUMNS) * Math.PI * 3) % (2 * Math.PI);
  const posMod = Math.sin(phase);

  if (index < 6) {
    // Bass / Kick columns: deep punchy 120–135 BPM rhythm, reaching 12–14 dots (0.86 – 0.98)
    const peak = Math.min(0.98, Math.max(0.82, 0.90 + 0.08 * posMod));
    return {
      peak1: peak,
      peak2: Math.max(0.68, peak * 0.8),
      low: 0.18 + (index % 3) * 0.04,
      dur1: 95 + (index % 3) * 15,
      dur2: 150 + (index % 4) * 20,
    };
  } else if (index < 15) {
    // Low-mids / Snare & Vocal body: rolling waves, reaching 11–13 dots (0.80 – 0.95)
    const peak = Math.min(0.96, Math.max(0.78, 0.86 + 0.10 * posMod));
    return {
      peak1: peak,
      peak2: Math.max(0.62, peak * 0.76),
      low: 0.16 + (index % 4) * 0.03,
      dur1: 105 + (index % 4) * 15,
      dur2: 140 + (index % 5) * 15,
    };
  } else if (index < 23) {
    // High-mids / Lead instruments: snappy ripples, reaching 10–13 dots (0.75 – 0.94)
    const peak = Math.min(0.94, Math.max(0.74, 0.84 + 0.10 * Math.cos(phase)));
    return {
      peak1: peak,
      peak2: Math.max(0.58, peak * 0.72),
      low: 0.14 + (index % 3) * 0.03,
      dur1: 85 + (index % 4) * 12,
      dur2: 120 + (index % 4) * 15,
    };
  } else {
    // Treble / Hi-hats: rapid 16th-note ticks, reaching 9–13 dots (0.70 – 0.92)
    const peak = Math.min(0.92, Math.max(0.68, 0.80 + 0.12 * posMod));
    return {
      peak1: peak,
      peak2: Math.max(0.52, peak * 0.68),
      low: 0.12 + (index % 3) * 0.03,
      dur1: 70 + (index % 4) * 10,
      dur2: 95 + (index % 3) * 12,
    };
  }
}

interface DotMatrixVisualizerProps {
  isPlaying: boolean;
  position?: number;
}

export default function DotMatrixVisualizer({ isPlaying, position = 0 }: DotMatrixVisualizerProps) {
  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Theme-adaptive monogram watermark
  const logoSource = useMemo(
    () =>
      mode === 'dark'
        ? require('@/assets/images/logo-dark.png')
        : require('@/assets/images/logo-light.png'),
    [mode]
  );

  // Initialize 30 animated values once without render-time ref access
  const [animValues] = useState(() =>
    Array.from(
      { length: NUM_COLUMNS },
      (_, i) => new Animated.Value(getRestingHeight(i))
    )
  );

  // Keep track of active composite animations and latest position
  const animationsRef = useRef<Animated.CompositeAnimation[]>([]);
  const lastPositionRef = useRef<number>(position);
  const positionRef = useRef<number>(position);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // Start continuous rhythmic beat-pulse loop on each column
  const startBeatLoop = useCallback(
    (colIdx: number) => {
      const val = animValues[colIdx];
      const cfg = getColumnPeak(colIdx, positionRef.current);

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
            toValue: getRestingHeight(colIdx),
            duration: cfg.dur2 * 0.9,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ])
      );

      animationsRef.current[colIdx] = loop;
      loop.start();
    },
    [animValues]
  );

  // Main playback state coordinator
  useEffect(() => {
    // Clear any previous animations
    animationsRef.current.forEach((anim) => anim?.stop());
    animationsRef.current = [];

    if (isPlaying) {
      animValues.forEach((_, colIdx) => {
        startBeatLoop(colIdx);
      });
    } else {
      // Smoothly settle all columns to a minimal 1–2 dot resting baseline
      animValues.forEach((val, i) => {
        Animated.timing(val, {
          toValue: getRestingHeight(i),
          duration: 380,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });
    }

    return () => {
      animationsRef.current.forEach((anim) => anim?.stop());
    };
  }, [isPlaying, animValues, startBeatLoop]);

  // Real-time scrubbing / position phase response
  useEffect(() => {
    if (!isPlaying) return;

    // Detect if position jumped significantly (e.g. user dragged the seek slider)
    const posDelta = Math.abs(position - lastPositionRef.current);
    lastPositionRef.current = position;

    if (posDelta > 0.8) {
      // User scrubbed the slider: fire an energetic reactive spike across the spectrum
      animValues.forEach((val, colIdx) => {
        const cfg = getColumnPeak(colIdx, position);
        Animated.sequence([
          Animated.timing(val, {
            toValue: cfg.peak1,
            duration: 85,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start(() => {
          if (isPlaying) {
            startBeatLoop(colIdx);
          }
        });
      });
    }
  }, [position, isPlaying, animValues, startBeatLoop]);

  return (
    <View style={styles.stage}>
      {/* Subtle Centered Monogram Watermark behind the dot matrix */}
      <View style={styles.watermarkWrapper} pointerEvents="none">
        <Image
          source={logoSource}
          style={styles.watermarkImage}
          resizeMode="contain"
        />
      </View>

      {/* Main Visualizer Content */}
      <View style={styles.visualizerContent}>
        {/* Upper Active Spectrum Bars (up to 14 dots high) */}
        <View style={styles.matrixRow}>
          {animValues.map((animVal, colIdx) => (
            <View key={`col-up-${colIdx}`} style={styles.column}>
              <Animated.View
                style={[
                  styles.upperBar,
                  {
                    transform: [{ scaleY: animVal }],
                  },
                ]}
              >
                {UPPER_OPACITIES.map((opacity, dotIdx) => (
                  <View
                    key={`dot-up-${colIdx}-${dotIdx}`}
                    style={[styles.dot, { opacity }]}
                  />
                ))}
              </Animated.View>
            </View>
          ))}
        </View>

        {/* Center Horizon Baseline */}
        <View style={styles.horizonLine} />

        {/* Lower Mirrored Reflection Bars (up to 8 dots deep) */}
        <View style={styles.matrixRow}>
          {animValues.map((animVal, colIdx) => (
            <View key={`col-low-${colIdx}`} style={styles.column}>
              <Animated.View
                style={[
                  styles.lowerBar,
                  {
                    transform: [{ scaleY: animVal }],
                  },
                ]}
              >
                {LOWER_OPACITIES.map((opacity, dotIdx) => (
                  <View
                    key={`dot-low-${colIdx}-${dotIdx}`}
                    style={[styles.dot, { opacity }]}
                  />
                ))}
              </Animated.View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}
