import React, { useMemo, useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Platform,
  StatusBar,
  BackHandler,
  Animated,
  StyleSheet,
  Easing,
  useWindowDimensions,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import {
  useGuideStore,
  TOTAL_GUIDE_STEPS,
  GuideTargetKey,
  TargetRect,
  measureGuideTarget,
} from '@/store/guideStore';
import { useThemeStore } from '@/store/themeStore';
import { usePlayerStore } from '@/store/playerStore';
import { getAllTracks } from '@/repositories/trackRepository';
import { setSetting } from '@/lib/database';
import {
  createStyles,
} from '@/styles/NewcomerGuideModal.styles';

interface CoachStep {
  id: string;
  stepNumber: number;
  targetKey: GuideTargetKey;
  title: string;
  message: string | ((noTracks: boolean) => string);
  tabRoute: '/(tabs)' | '/(tabs)/search';
  fallbackRect: (w: number, h: number, yOff: number) => TargetRect;
  borderRadius: number;
}

const COACH_STEPS: CoachStep[] = [
  {
    id: 'step-1-add-music',
    stepNumber: 1,
    targetKey: 'add_music_button',
    title: 'Add Your Music',
    message: 'Tap + Add Music to open your import options.',
    tabRoute: '/(tabs)',
    borderRadius: 8,
    fallbackRect: (w, _h, yOff) => ({
      x: w - 120,
      y: yOff + 82,
      width: 100,
      height: 32,
      borderRadius: 8,
    }),
  },
  {
    id: 'step-2-scan-storage',
    stepNumber: 2,
    targetKey: 'scan_storage_button',
    title: 'Scan Your Storage',
    message: 'Tap Scan Device Storage to find audio files on your phone.',
    tabRoute: '/(tabs)',
    borderRadius: 12,
    fallbackRect: (w, h) => ({
      x: Math.max(16, (w - 320) / 2 + 16),
      y: (h - 320) / 2 + 104,
      width: Math.min(w - 32, 288),
      height: 58,
      borderRadius: 12,
    }),
  },
  {
    id: 'step-3-play-song',
    stepNumber: 3,
    targetKey: 'first_track_item',
    title: 'Play Instantly',
    message: 'Tap your first song to start offline playback!',
    tabRoute: '/(tabs)',
    borderRadius: 12,
    fallbackRect: (w, _h, yOff) => ({
      x: 16,
      y: yOff + 280,
      width: w - 32,
      height: 68,
      borderRadius: 12,
    }),
  },
  {
    id: 'step-4-search-nav',
    stepNumber: 4,
    targetKey: 'search_tab_icon',
    title: 'Discover Online',
    message: (noTracks: boolean) =>
      noTracks
        ? 'No local songs found—tap Search below to download your first track.'
        : 'Tap Search below to look up any song or artist.',
    tabRoute: '/(tabs)',
    borderRadius: 14,
    fallbackRect: (w, h) => {
      const tabHeight = Platform.OS === 'ios' ? 88 : 64;
      const tabWidth = Math.round(w / 3);
      return {
        x: Math.round((w - tabWidth) / 2),
        y: h - tabHeight,
        width: tabWidth,
        height: tabHeight,
        borderRadius: 14,
      };
    },
  },
  {
    id: 'step-5-search-input',
    stepNumber: 5,
    targetKey: 'search_input_bar',
    title: 'Search a Song',
    message: 'Type a song or artist name and press Search.',
    tabRoute: '/(tabs)/search',
    borderRadius: 12,
    fallbackRect: (w, _h, yOff) => ({
      x: 20,
      y: yOff + 54,
      width: w - 40,
      height: 48,
      borderRadius: 12,
    }),
  },
  {
    id: 'step-6-download-offline',
    stepNumber: 6,
    targetKey: 'first_search_download_btn',
    title: 'Download Offline',
    message: 'Tap the download button to save this song for offline listening.',
    tabRoute: '/(tabs)/search',
    borderRadius: 18,
    fallbackRect: (w, _h, yOff) => ({
      x: w - 56,
      y: yOff + 130,
      width: 36,
      height: 36,
      borderRadius: 18,
    }),
  },
  {
    id: 'step-7-saved-library',
    stepNumber: 7,
    targetKey: 'first_track_item',
    title: 'Saved to Your Library!',
    message:
      'Your downloaded track is right here and ready to play 100% offline.',
    tabRoute: '/(tabs)',
    borderRadius: 12,
    fallbackRect: (w, _h, yOff) => ({
      x: 16,
      y: yOff + 280,
      width: w - 32,
      height: 68,
      borderRadius: 12,
    }),
  },
];

const runAfterInteractions = (fn: () => void) => {
  if (typeof (globalThis as any).requestIdleCallback === 'function') {
    const handle = (globalThis as any).requestIdleCallback(fn);
    return () => (globalThis as any).cancelIdleCallback?.(handle);
  }
  const timer = setTimeout(fn, 16);
  return () => clearTimeout(timer);
};

export default function NewcomerGuideModal() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const containerRef = useRef<any>(null);
  const theme = useThemeStore((state) => state.theme);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Fallback status bar offset for pre-measurement geometry
  const yOffset =
    Platform.OS === 'android'
      ? insets.top || StatusBar.currentHeight || 0
      : 0;

  const isOpen = useGuideStore((state) => state.isOpen);
  const currentStep = useGuideStore((state) => state.currentStep);
  const noTracksFound = useGuideStore((state) => state.noTracksFound);
  const closeGuide = useGuideStore((state) => state.closeGuide);
  const setStep = useGuideStore((state) => state.setStep);
  const setNoTracksFound = useGuideStore((state) => state.setNoTracksFound);
  const requestOpenAddMusicModal = useGuideStore(
    (state) => state.requestOpenAddMusicModal
  );
  const requestCloseAddMusicModal = useGuideStore(
    (state) => state.requestCloseAddMusicModal
  );
  const isPlayerModalOpen = usePlayerStore((state) => state.isModalOpen);

  const stepData = COACH_STEPS[currentStep] || COACH_STEPS[0];
  const [measuredRectInfo, setMeasuredRectInfo] = useState<{
    step: number;
    rect: TargetRect;
  } | null>(null);

  // Derived readiness: only true once current step has been measured
  const [readyStep, setReadyStep] = useState<number | null>(null);
  const isReady = readyStep === currentStep && isOpen && !isPlayerModalOpen;

  const [fadeAnim] = useState(() => new Animated.Value(0));

  // Gentle breathing pulse animation for the focus ring (0.55 <-> 1.0)
  const [pulseAnim] = useState(() => new Animated.Value(1));

  // Combined ring opacity: pulseAnim * fadeAnim
  const ringOpacity = useMemo(
    () => Animated.multiply(pulseAnim, fadeAnim),
    [pulseAnim, fadeAnim]
  );

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.55,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulseAnim]);

  // Derive activeRect instantly with zero cascading render delay
  const activeRect = useMemo(() => {
    if (measuredRectInfo && measuredRectInfo.step === currentStep) {
      return measuredRectInfo.rect;
    }
    return stepData.fallbackRect(windowWidth, windowHeight, yOffset);
  }, [measuredRectInfo, currentStep, stepData, windowWidth, windowHeight, yOffset]);

  // Measure target ref and normalize strictly against modal container coordinates
  const measureTargetRelative = (targetKey: GuideTargetKey): Promise<TargetRect | null> => {
    return new Promise((resolve) => {
      requestAnimationFrame(async () => {
        const measured = await measureGuideTarget(targetKey);
        if (!measured || measured.width <= 0 || measured.height <= 0) {
          resolve(null);
          return;
        }

        if (containerRef.current && typeof containerRef.current.measureInWindow === 'function') {
          containerRef.current.measureInWindow((modalX: number, modalY: number) => {
            resolve({
              x: Math.round(measured.x - (modalX || 0)),
              y: Math.round(measured.y - (modalY || 0)),
              width: Math.round(measured.width),
              height: Math.round(measured.height),
            });
          });
        } else {
          resolve({
            x: Math.round(measured.x),
            y: Math.round(measured.y),
            width: Math.round(measured.width),
            height: Math.round(measured.height),
          });
        }
      });
    });
  };

  // Handle hardware back button on Android to dismiss the guide
  useEffect(() => {
    if (!isOpen) return;
    const backSub = BackHandler.addEventListener('hardwareBackPress', () => {
      requestCloseAddMusicModal?.();
      closeGuide();
      return true;
    });
    return () => backSub.remove();
  }, [isOpen, closeGuide, requestCloseAddMusicModal]);

  useEffect(() => {
    if (!isOpen || isPlayerModalOpen) {
      fadeAnim.setValue(0);
      return;
    }

    const current = COACH_STEPS[currentStep];
    if (!current) return;

    // Immediately hide spotlight & card while transitioning/measuring to avoid any jump or stale box
    fadeAnim.setValue(0);

    // Ensure we are on the step's corresponding tab
    if (current.tabRoute === '/(tabs)/search') {
      router.navigate('/(tabs)/search');
    } else if (current.tabRoute === '/(tabs)') {
      router.navigate('/(tabs)');
    }

    let isMounted = true;
    let settleTimer: ReturnType<typeof setTimeout> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const cancelInteractions = runAfterInteractions(() => {
      // 100ms settle check after navigation & interactions finish
      settleTimer = setTimeout(() => {
        const attemptMeasurement = async (attemptsLeft = 5) => {
          if (!isMounted) return;
          const measured = await measureTargetRelative(current.targetKey);
          if (!isMounted) return;

          if (measured && measured.width > 0 && measured.height > 0) {
            setMeasuredRectInfo({
              step: currentStep,
              rect: {
                ...measured,
                borderRadius: current.borderRadius,
              },
            });
            setReadyStep(currentStep);
            Animated.timing(fadeAnim, {
              toValue: 1,
              duration: 160,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }).start();
          } else if (attemptsLeft > 0) {
            retryTimer = setTimeout(() => attemptMeasurement(attemptsLeft - 1), 60);
          } else {
            // Graceful fallback if target not found within retries
            setReadyStep(currentStep);
            Animated.timing(fadeAnim, {
              toValue: 1,
              duration: 160,
              easing: Easing.out(Easing.ease),
              useNativeDriver: true,
            }).start();
          }
        };

        attemptMeasurement();
      }, 100);
    });

    return () => {
      isMounted = false;
      cancelInteractions();
      if (settleTimer) clearTimeout(settleTimer);
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [isOpen, currentStep, isPlayerModalOpen, router, windowWidth, windowHeight, fadeAnim]);

  // Pause and hide walkthrough overlay whenever the full-screen player is open
  if (!isOpen || isPlayerModalOpen) {
    return null;
  }

  const handleSkip = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    requestCloseAddMusicModal?.();
    await closeGuide();
    router.navigate('/(tabs)');
  };

  const handleNext = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fadeAnim.setValue(0);
    if (currentStep >= TOTAL_GUIDE_STEPS - 1) {
      await closeGuide();
      router.navigate('/(tabs)');
      return;
    }

    if (currentStep === 0) {
      // Step 1 -> Step 2: Open Add Music modal and advance to Scan Storage step
      requestOpenAddMusicModal?.();
      setStep(1);
    } else if (currentStep === 1) {
      // Step 2 -> Step 3 or Step 4: Close Add Music modal and check tracks for branching
      requestCloseAddMusicModal?.();
      const existingTracks = usePlayerStore.getState().tracks;
      if (existingTracks.length > 0) {
        setNoTracksFound(false);
        setStep(2);
      } else {
        setNoTracksFound(true);
        setStep(3);
      }
    } else if (currentStep === 2) {
      // Step 3 -> Step 4: Advance to Search Tab step
      setStep(3);
    } else if (currentStep === 3) {
      // Step 4 -> Step 5: Navigate to Search Tab and focus input
      router.navigate('/(tabs)/search');
      setStep(4);
    } else if (currentStep === 4) {
      // Step 5 -> Step 6: Advance to Download Offline step
      setStep(5);
    } else if (currentStep === 5) {
      // Step 6 -> Step 7: Navigate back to Library, ensure Last Download sort, and spotlight newly downloaded track
      try {
        const allTracks = await getAllTracks();
        const sorted = [...allTracks].sort((a, b) => {
          const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
          const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
          return timeB - timeA;
        });
        usePlayerStore.getState().setTracks(sorted);
        await setSetting('library_sort', 'last_download');
      } catch (err) {
        console.warn('Failed to sort tracks on guide step transition:', err);
      }
      router.navigate('/(tabs)');
      setStep(6);
    }
  };

  const handlePrev = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    fadeAnim.setValue(0);
    if (currentStep === 1) {
      // Step 2 -> Step 1: Close Add Music modal and return to + Add Music button
      requestCloseAddMusicModal?.();
      setStep(0);
    } else if (currentStep === 2) {
      // Step 3 -> Step 2: Re-open Add Music modal
      requestOpenAddMusicModal?.();
      setStep(1);
    } else if (currentStep === 3) {
      // Step 4 -> Step 3 (if tracks found) or Step 2 (if 0 tracks)
      if (noTracksFound) {
        requestOpenAddMusicModal?.();
        setStep(1);
      } else {
        setStep(2);
      }
    } else if (currentStep === 4) {
      // Step 5 -> Step 4: Back to bottom nav Search button on Library
      router.navigate('/(tabs)');
      setStep(3);
    } else if (currentStep === 5) {
      // Step 6 -> Step 5: Back to Search Input
      setStep(4);
    } else if (currentStep === 6) {
      // Step 7 -> Step 6: Back to Search Tab
      router.navigate('/(tabs)/search');
      setStep(5);
    }
  };

  // Calculate spotlight aperture geometry (with uniform 6px breathing padding around target)
  const pad = 6;
  const targetTop = Math.max(0, activeRect.y - pad);
  const targetBottom = activeRect.y + activeRect.height + pad;
  const targetLeft = Math.max(0, activeRect.x - pad);
  const targetWidth = Math.max(10, activeRect.width + pad * 2);
  const targetHeight = Math.max(10, activeRect.height + pad * 2);
  const borderRadius = activeRect.borderRadius || stepData.borderRadius || 14;

  const tabBarHeight = Platform.OS === 'ios' ? 88 : 64;

  // For Step 4 (Search Tab button in bottom bar), position tooltip strictly above the tab bar.
  // For Step 6 (Download button on search result), position tooltip strictly below the row so the result is visible.
  const isStep4 = currentStep === 3;
  const isStep6 = currentStep === 5;
  const spaceBelow = windowHeight - targetBottom;
  const isBelow = isStep6 || (!isStep4 && spaceBelow >= 210);

  const tooltipStyle = isBelow
    ? { top: Math.min(windowHeight - 210, targetBottom + 12) }
    : { bottom: Math.max(tabBarHeight + 16, windowHeight - targetTop + 16) };

  // Calculate arrow position pointing to target horizontal center
  const targetCenterX = activeRect.x + activeRect.width / 2;
  const arrowLeft = Math.max(28, Math.min(windowWidth - 48, targetCenterX - 7));

  const messageText =
    typeof stepData.message === 'function'
      ? stepData.message(noTracksFound)
      : stepData.message;

  return (
    <View ref={containerRef} style={styles.container} pointerEvents="box-none">
      {/* 1. Full-screen SVG overlay with crisp rounded-rectangle mask cutout */}
      <Animated.View
        pointerEvents="none"
        style={[styles.svgOverlay, { opacity: fadeAnim }]}
      >
        <Svg
          width={windowWidth}
          height={windowHeight}
          style={StyleSheet.absoluteFill}
        >
          <Defs>
            <Mask id="spotlightMask">
              {/* White fills the whole canvas so the backdrop is rendered */}
              <Rect
                x={0}
                y={0}
                width={windowWidth}
                height={windowHeight}
                fill="#FFFFFF"
              />
              {/* Black punches out a smooth, anti-aliased rounded-rectangle hole */}
              <Rect
                x={targetLeft}
                y={targetTop}
                width={targetWidth}
                height={targetHeight}
                rx={borderRadius}
                ry={borderRadius}
                fill="#000000"
              />
            </Mask>
          </Defs>

          {/* Backdrop rectangle with the mask applied */}
          <Rect
            x={0}
            y={0}
            width={windowWidth}
            height={windowHeight}
            fill="rgba(0, 0, 0, 0.82)"
            mask="url(#spotlightMask)"
          />
        </Svg>
      </Animated.View>

      {/* 2. Crisp Single-Line Focus Ring with Breathing Pulse */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.focusRing,
          {
            left: targetLeft,
            top: targetTop,
            width: targetWidth,
            height: targetHeight,
            borderRadius,
            opacity: ringOpacity,
          },
        ]}
      />

      {/* 3. Floating Tooltip Card */}
      <Animated.View
        style={[styles.tooltipCard, tooltipStyle, { opacity: fadeAnim }]}
        pointerEvents={isReady ? 'auto' : 'none'}
      >
        {/* Directional Arrow pointing at spotlight */}
        {isBelow ? (
          <View style={[styles.arrowUp, { left: arrowLeft }]} />
        ) : (
          <View style={[styles.arrowDown, { left: arrowLeft }]} />
        )}

        {/* Header Row: Subtle Step Counter on Left, Skip on Right */}
        <View style={styles.tooltipHeader}>
          <Text style={styles.stepCounterText}>
            {stepData.stepNumber} / {TOTAL_GUIDE_STEPS}
          </Text>

          <TouchableOpacity
            style={styles.skipBtn}
            onPress={handleSkip}
            activeOpacity={0.7}
            accessibilityLabel="Skip walkthrough tour"
          >
            <Text style={styles.skipBtnText}>Skip</Text>
          </TouchableOpacity>
        </View>

        {/* Clean Unnumbered Title & Message */}
        <Text style={styles.tooltipTitle}>{stepData.title}</Text>
        <Text style={styles.tooltipMessage}>{messageText}</Text>

        {/* Action Button Row */}
        <View style={styles.tooltipFooter}>
          {currentStep > 0 ? (
            <TouchableOpacity
              style={styles.prevButton}
              onPress={handlePrev}
              activeOpacity={0.7}
              accessibilityLabel="Previous tour step"
            >
              <Text style={styles.prevButtonText}>← Prev</Text>
            </TouchableOpacity>
          ) : (
            <View style={{ width: 0 }} />
          )}

          <TouchableOpacity
            style={styles.nextButton}
            onPress={handleNext}
            activeOpacity={0.8}
            accessibilityLabel={
              currentStep === TOTAL_GUIDE_STEPS - 1
                ? 'Finish tour'
                : 'Next tour step'
            }
          >
            <Text style={styles.nextButtonText}>
              {currentStep === TOTAL_GUIDE_STEPS - 1
                ? 'Finish Tour'
                : 'Next →'}
            </Text>
            {currentStep === TOTAL_GUIDE_STEPS - 1 && (
              <Ionicons
                name="checkmark-circle-outline"
                size={16}
                color={theme.onPrimary}
              />
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}
