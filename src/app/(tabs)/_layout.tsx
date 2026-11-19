import React, { useMemo, useEffect } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '@/store/themeStore';
import { useGuideStore, registerGuideTarget } from '@/store/guideStore';
import MiniPlayer from '@/components/MiniPlayer';
import NowPlayingModal from '@/components/NowPlayingModal';
import NewcomerGuideModal from '@/components/NewcomerGuideModal';
import { createStyles } from '@/styles/_layout.styles';

export default function TabsLayout() {
  const theme = useThemeStore((state) => state.theme);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Check and trigger the one-time interactive newcomer guide for first-time visitors
  useEffect(() => {
    useGuideStore.getState().checkAndTriggerGuide();
  }, []);

  return (
    <View style={styles.container}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarActiveTintColor: theme.primary,
          tabBarInactiveTintColor: theme.textSecondary,
          tabBarLabelStyle: styles.tabBarLabel,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Library',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'musical-notes' : 'musical-notes-outline'}
                size={size}
                color={color as string}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="search"
          listeners={{
            tabPress: () => {
              const guideState = useGuideStore.getState();
              if (guideState.isOpen && guideState.currentStep === 3) {
                guideState.setStep(4);
              }
            },
          }}
          options={{
            title: 'Search',
            tabBarButton: (props) => (
              <View
                ref={(r) => registerGuideTarget('search_tab_icon', r)}
                collapsable={false}
                style={{ flex: 1 }}
              >
                <TouchableOpacity {...(props as any)} style={[props.style, { flex: 1 }]} />
              </View>
            ),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'search' : 'search-outline'}
                size={size}
                color={color as string}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons
                name={focused ? 'person' : 'person-outline'}
                size={size}
                color={color as string}
              />
            ),
          }}
        />
      </Tabs>

      {/* Persistent Mini Player */}
      <MiniPlayer />

      {/* Full-screen Now Playing Modal */}
      <NowPlayingModal />

      {/* One-time Newcomer Interactive Walkthrough Tour */}
      <NewcomerGuideModal />
    </View>
  );
}
