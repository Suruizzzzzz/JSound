import React, { useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  TouchableWithoutFeedback,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
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
  placement: 'top' | 'bottom';
}

const GUIDE_STEPS: GuideStep[] = [
  {
    id: 'step-library',
    stepNumber: 1,
    icon: 'musical-notes',
    title: 'Library & Offline Downloads',
    description:
      'Store and organize your music collection directly on your device. Scan local storage or download any track for high-quality offline listening without using mobile data.',
    placement: 'bottom',
  },
  {
    id: 'step-search',
    stepNumber: 2,
    icon: 'search',
    title: 'Search & Stream',
    description:
      'Discover millions of songs and artists online. Stream music instantly with zero delay, or save any song to your local offline library with a single tap.',
    placement: 'top',
  },
  {
    id: 'step-cloud',
    stepNumber: 3,
    icon: 'cloud-done',
    title: 'Cloud Sync & Playlists',
    description:
      'Create personalized playlists and synchronize your favorites across all your devices with your account. Your library remains securely backed up in the cloud.',
    placement: 'top',
  },
  {
    id: 'step-playback',
    stepNumber: 4,
    icon: 'play-circle',
    title: 'MiniPlayer & Background Audio',
    description:
      'Enjoy uninterrupted audio playback even when your screen is locked or while multitasking in other apps. Control your music quickly via the floating MiniPlayer.',
    placement: 'bottom',
  },
];

export default function NewcomerGuideModal() {
  const isOpen = useGuideStore((state) => state.isOpen);
  const currentStep = useGuideStore((state) => state.currentStep);
  const closeGuide = useGuideStore((state) => state.closeGuide);
  const nextStep = useGuideStore((state) => state.nextStep);
  const prevStep = useGuideStore((state) => state.prevStep);

  const insets = useSafeAreaInsets();
  const theme = useThemeStore((state) => state.theme);
  const styles = useMemo(() => createStyles(theme), [theme]);

  if (!isOpen) {
    return null;
  }

  const step = GUIDE_STEPS[currentStep] || GUIDE_STEPS[0];
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === TOTAL_GUIDE_STEPS - 1;

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
      onRequestClose={closeGuide}
    >
      <TouchableWithoutFeedback onPress={closeGuide}>
        <View
          style={[
            styles.backdrop,
            isTop
              ? { justifyContent: 'flex-start', paddingTop: insets.top + 20 }
              : { justifyContent: 'flex-end', paddingBottom: tabBarHeight + 16 },
          ]}
        >
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <View style={styles.card}>
              {/* Header: Step Badge & Skip Button */}
              <View style={styles.headerRow}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>
                    Step {step.stepNumber} of {TOTAL_GUIDE_STEPS}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.skipButton}
                  onPress={closeGuide}
                  activeOpacity={0.7}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Text style={styles.skipButtonText}>Skip</Text>
                </TouchableOpacity>
              </View>

              {/* Icon Badge */}
              <View style={styles.iconContainer}>
                <Ionicons name={step.icon} size={28} color={theme.primary} />
              </View>

              {/* Title & Description */}
              <Text style={styles.title}>{step.title}</Text>
              <Text style={styles.description}>{step.description}</Text>

              {/* Progress Dots */}
              <View style={styles.dotsRow}>
                {GUIDE_STEPS.map((_, index) => (
                  <View
                    key={index}
                    style={[styles.dot, index === currentStep && styles.dotActive]}
                  />
                ))}
              </View>

              {/* Footer Buttons */}
              <View style={styles.footerRow}>
                {!isFirstStep && (
                  <TouchableOpacity
                    style={styles.prevButton}
                    onPress={prevStep}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.prevButtonText}>Back</Text>
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={styles.nextButton}
                  onPress={isLastStep ? closeGuide : nextStep}
                  activeOpacity={0.8}
                >
                  <Text style={styles.nextButtonText}>
                    {isLastStep ? 'Get Started' : 'Next'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}
