import React, { useMemo, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGuideStore, TOTAL_GUIDE_STEPS } from '@/store/guideStore';
import { useThemeStore } from '@/store/themeStore';
import { createStyles } from '@/styles/NewcomerGuideModal.styles';

interface GuideStep {
  id: string;
  stepNumber: number;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  route: string;
  placement: 'top' | 'bottom';
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'step-library',
    stepNumber: 1,
    icon: 'musical-notes',
    title: 'Your Offline Library',
    description:
      'Welcome to JSound. Every song you save lives right here—ready to play anytime without mobile data or buffering.',
    route: '/(tabs)',
    placement: 'bottom',
  },
  {
    id: 'step-skip-converter',
    stepNumber: 2,
    icon: 'flash',
    title: 'No More Copy-Paste Converter Sites',
    description:
      'Forget copying URLs into sketchy third-party MP3 converter websites. Tap Search to find any track directly inside the app.',
    route: '/(tabs)/search',
    placement: 'bottom',
  },
  {
    id: 'step-search-instant',
    stepNumber: 3,
    icon: 'search',
    title: 'Search Any Song Instantly',
    description:
      "We just searched 'About You' by The 1975 for you—no browser tabs or external links needed.",
    route: '/(tabs)/search',
    placement: 'bottom',
  },
  {
    id: 'step-one-tap-download',
    stepNumber: 4,
    icon: 'cloud-download',
    title: 'One-Tap Offline Download',
    description:
      'Tap the download icon on any result. Watch the full-card progress sweep to 100%—when it finishes, the checkmark button marks it saved.',
    route: '/(tabs)/search',
    placement: 'bottom',
  },
  {
    id: 'step-saved-ready',
    stepNumber: 5,
    icon: 'checkmark-circle',
    title: 'Saved & Ready to Play',
    description:
      'Your downloaded song is automatically stored in your Library for instant offline playback, playlists, and cloud sync.',
    route: '/(tabs)',
    placement: 'bottom',
  },
];

export default function NewcomerGuideModal() {
  const router = useRouter();
  const isOpen = useGuideStore((state) => state.isOpen);
  const currentStep = useGuideStore((state) => state.currentStep);
  const setDemoAction = useGuideStore((state) => state.setDemoAction);
  const demoDownloadStatus = useGuideStore((state) => state.demoDownloadStatus);
  const demoDownloadProgress = useGuideStore((state) => state.demoDownloadProgress);
  const closeGuide = useGuideStore((state) => state.closeGuide);
  const nextStep = useGuideStore((state) => state.nextStep);
  const prevStep = useGuideStore((state) => state.prevStep);

  const insets = useSafeAreaInsets();
  const theme = useThemeStore((state) => state.theme);
  const styles = useMemo(() => createStyles(theme), [theme]);

  const step = GUIDE_STEPS[currentStep] || GUIDE_STEPS[0];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === TOTAL_GUIDE_STEPS - 1;
  const isStep4Downloading =
    currentStep === 3 &&
    (demoDownloadStatus === 'downloading' || demoDownloadStatus === 'searching');

  // Auto-navigate between tabs corresponding to each guide step
  useEffect(() => {
    if (!isOpen) return;
    const targetRoute = GUIDE_STEPS[currentStep]?.route;
    if (targetRoute) {
      router.navigate(targetRoute as any);
    }
  }, [isOpen, currentStep, router]);

  // Trigger demo automated action corresponding to walkthrough step
  useEffect(() => {
    if (!isOpen) {
      setDemoAction('idle');
      return;
    }
    if (currentStep === 2) {
      setDemoAction('autofill_search');
    } else if (currentStep === 3) {
      setDemoAction('trigger_download');
    } else if (currentStep === 4) {
      setDemoAction('highlight_saved_library');
    } else {
      setDemoAction('idle');
    }
  }, [isOpen, currentStep, setDemoAction]);

  if (!isOpen) {
    return null;
  }

  const handleCloseGuide = async () => {
    router.navigate('/(tabs)');
    await closeGuide();
  };

  // Compute tab bar height to position card flush above bottom navigation
  const bottomInset =
    Platform.OS === 'ios'
      ? Math.max(insets.bottom, 28)
      : Math.max(insets.bottom, 10);
  const tabBarHeight = (Platform.OS === 'ios' ? 60 : 54) + bottomInset;

  const isTop = step.placement === 'top';

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleCloseGuide}
    >
      <TouchableWithoutFeedback onPress={handleCloseGuide}>
        <View
          style={[
            styles.backdrop,
            isTop
              ? { justifyContent: 'flex-start', paddingTop: insets.top + 16 }
              : { justifyContent: 'flex-end', paddingBottom: tabBarHeight + 14 },
          ]}
        >
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <View style={styles.card}>
              {/* Top row: small icon badge + Title & Step counter on left, Skip on right */}
              <View style={styles.topRow}>
                <View style={styles.topRowLeft}>
                  <View style={styles.iconBadge}>
                    <Ionicons name={step.icon} size={18} color={theme.primary} />
                  </View>
                  <View style={styles.titleColumn}>
                    <Text style={styles.title} numberOfLines={1}>
                      {step.title}
                    </Text>
                    <Text style={styles.stepCounterText}>
                      Step {step.stepNumber} of {TOTAL_GUIDE_STEPS}
                    </Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.skipButton}
                  onPress={handleCloseGuide}
                  activeOpacity={0.7}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.skipButtonText}>Skip</Text>
                </TouchableOpacity>
              </View>

              {/* Middle: concise description */}
              <Text style={styles.description} numberOfLines={3}>
                {step.description}
              </Text>

              {/* Bottom row: compact 5-dot step indicator on left, inline Back + Next/Done on right */}
              <View style={styles.bottomRow}>
                <View style={styles.dotsRow}>
                  {GUIDE_STEPS.map((_, index) => (
                    <View
                      key={index}
                      style={[styles.dot, index === currentStep && styles.dotActive]}
                    />
                  ))}
                </View>

                <View style={styles.buttonsRow}>
                  {!isFirstStep && (
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={prevStep}
                      activeOpacity={0.7}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                    >
                      <Text style={styles.backButtonText}>Back</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity
                    style={[styles.nextButton, isStep4Downloading && { opacity: 0.6 }]}
                    onPress={isLastStep ? handleCloseGuide : nextStep}
                    disabled={isStep4Downloading}
                    activeOpacity={0.8}
                    hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                  >
                    <Text style={styles.nextButtonText}>
                      {isLastStep
                        ? 'Done'
                        : isStep4Downloading
                        ? `Downloading... ${demoDownloadProgress}%`
                        : 'Next'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
