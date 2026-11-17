import React, { useMemo } from 'react';
import { View } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useThemeStore } from '@/store/themeStore';
import MiniPlayer from '@/components/MiniPlayer';
import NowPlayingModal from '@/components/NowPlayingModal';
import { createStyles } from '@/styles/_layout.styles';

export default function TabsLayout() {
  const theme = useThemeStore((state) => state.theme);
  const styles = useMemo(() => createStyles(theme), [theme]);

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
          options={{
            title: 'Search',
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
    </View>
  );
}
