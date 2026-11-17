import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { searchLocalTracks, getAllTracks } from '@/repositories/trackRepository';
import { Track } from '@/types/music';
import TrackItem from '@/components/TrackItem';
import { useThemeStore } from '@/store/themeStore';
import { createStyles } from '@/styles/search.styles';

export default function SearchScreen() {
  const theme = useThemeStore((state) => state.theme);
  const mode = useThemeStore((state) => state.mode);
  const styles = useMemo(() => createStyles(theme), [theme]);

  // Theme-adaptive logo
  const logoSource = useMemo(
    () =>
      mode === 'dark'
        ? require('@/assets/images/logo-dark.png')
        : require('@/assets/images/logo-light.png'),
    [mode]
  );

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    const performSearch = async () => {
      setIsSearching(true);
      try {
        if (!query.trim()) {
          const allTracks = await getAllTracks();
          if (!isCancelled) {
            setResults(allTracks);
          }
        } else {
          const matched = await searchLocalTracks(query);
          if (!isCancelled) {
            setResults(matched);
          }
        }
      } catch (error) {
        console.warn('Search query failed:', error);
      } finally {
        if (!isCancelled) {
          setIsSearching(false);
        }
      }
    };

    const debounceTimer = setTimeout(performSearch, 150);
    return () => {
      isCancelled = true;
      clearTimeout(debounceTimer);
    };
  }, [query]);

  const clearSearch = () => {
    setQuery('');
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Search</Text>

      {/* Search Input Bar */}
      <View style={styles.searchBar}>
        <Ionicons name="search" size={19} color={theme.textSecondary} style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search tracks, artists..."
          placeholderTextColor={theme.textMuted}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity
            onPress={clearSearch}
            style={styles.clearButton}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons name="close-circle" size={18} color={theme.textSecondary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          {query.trim()
            ? `${results.length} result${results.length === 1 ? '' : 's'} found`
            : `All Offline Tracks (${results.length})`}
        </Text>
        {isSearching && <ActivityIndicator size="small" color={theme.primary} />}
      </View>
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <Ionicons name="search-outline" size={52} color={theme.textMuted} />
      <Text style={styles.emptyTitle}>
        {query.trim() ? 'No matches found' : 'Your offline library is empty'}
      </Text>
      <Text style={styles.emptySubtitle}>
        {query.trim()
          ? `We couldn't find any songs or artists matching "${query}".`
          : 'Head to the Library tab and scan your device for local audio files.'}
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Subtle JS Monogram Background Watermark */}
      <View style={styles.watermarkContainer} pointerEvents="none">
        <Image
          source={logoSource}
          style={styles.watermarkImage}
          resizeMode="contain"
        />
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <TrackItem track={item} queue={results} />}
        ListHeaderComponent={renderHeader}
        ListEmptyComponent={renderEmptyState}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      />
    </SafeAreaView>
  );
}
