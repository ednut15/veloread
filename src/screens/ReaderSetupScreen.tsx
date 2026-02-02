import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { estimatedSeconds } from '@/src/parsing/tokenize';
import {
  loadBooks,
  loadGlobalSettings,
  loadReadingState,
  saveGlobalSettings,
  saveReadingState,
  upsertBook,
} from '@/src/storage';
import { BookMeta, ReadingState } from '@/src/types';
import { getErrorMessage } from '@/src/utils/errors';
import { formatDuration, formatPercent } from '@/src/utils/format';

export default function ReaderSetupScreen() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const router = useRouter();

  const [book, setBook] = useState<BookMeta | null>(null);
  const [savedState, setSavedState] = useState<ReadingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [startFromBeginning, setStartFromBeginning] = useState(false);
  const [wpm, setWpm] = useState(320);
  const [orpEnabled, setOrpEnabled] = useState(true);
  const [punctuationPauses, setPunctuationPauses] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        const books = await loadBooks();
        const foundBook = books.find((item) => item.id === bookId) ?? null;
        if (!foundBook) {
          router.back();
          return;
        }

        const defaults = await loadGlobalSettings();
        const state = await loadReadingState(foundBook.id);
        if (!isMounted) return;

        setBook(foundBook);
        setSavedState(state);
        setWpm(state?.wpm ?? defaults.defaultWpm);
        setOrpEnabled(state?.orpEnabled ?? defaults.defaultOrpEnabled);
        setPunctuationPauses(state?.punctuationPauses ?? defaults.defaultPunctuationPauses);
      } catch (nextError) {
        if (!isMounted) return;
        setError(getErrorMessage(nextError, 'Failed to load reader setup.'));
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, [bookId, router]);

  const currentIndex = startFromBeginning ? 0 : savedState?.index ?? 0;

  const remainingTime = useMemo(() => {
    if (!book) return 0;
    return estimatedSeconds(Math.max(book.tokenCount - currentIndex, 0), wpm);
  }, [book, currentIndex, wpm]);

  const handleContinue = async () => {
    if (!book) return;

    const now = Date.now();
    const nextState: ReadingState = {
      bookId: book.id,
      index: currentIndex,
      wpm,
      orpEnabled,
      punctuationPauses,
      lastReadAt: now,
    };

    await saveReadingState(nextState);
    await saveGlobalSettings({
      defaultWpm: wpm,
      defaultOrpEnabled: orpEnabled,
      defaultPunctuationPauses: punctuationPauses,
    });

    await upsertBook({
      ...book,
      updatedAt: now,
      lastOpenedAt: now,
    });

    router.push({ pathname: '/reader/[bookId]', params: { bookId: book.id } });
  };

  if (loading) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator color="#5cc8ff" />
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.meta}>{error}</Text>
          <Pressable style={[styles.cta, { marginTop: 16 }]} onPress={() => router.back()}>
            <Text style={styles.ctaText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (!book) {
    return null;
  }

  const progress = formatPercent(savedState?.index ?? 0, book.tokenCount);
  const chapterCount = book.chapters?.length ?? 0;

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>{book.title}</Text>
        <Text style={styles.meta}>{book.tokenCount} tokens | Progress {progress}</Text>
        {chapterCount > 1 ? <Text style={styles.meta}>Chapters: {chapterCount}</Text> : null}

        <View style={styles.sectionRow}>
          <Text style={styles.label}>Start from beginning</Text>
          <Switch value={startFromBeginning} onValueChange={setStartFromBeginning} />
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>WPM: {Math.round(wpm)}</Text>
          <Slider
            value={wpm}
            minimumValue={120}
            maximumValue={900}
            step={5}
            onValueChange={setWpm}
            minimumTrackTintColor="#5cc8ff"
            maximumTrackTintColor="#2f3f59"
            thumbTintColor="#5cc8ff"
          />
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.label}>ORP Highlight</Text>
          <Switch value={orpEnabled} onValueChange={setOrpEnabled} />
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.label}>Punctuation pauses</Text>
          <Switch value={punctuationPauses} onValueChange={setPunctuationPauses} />
        </View>

        <Text style={styles.meta}>Estimated time remaining: {formatDuration(remainingTime)}</Text>

        <Pressable style={styles.cta} onPress={handleContinue}>
          <Text style={styles.ctaText}>{startFromBeginning ? 'Start Reading' : 'Resume Reading'}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0f18',
  },
  container: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: '#f5f7ff',
    fontSize: 28,
    fontWeight: '800',
  },
  meta: {
    color: '#a8b8d4',
    marginTop: 8,
  },
  section: {
    marginTop: 20,
  },
  sectionRow: {
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: '#f2f6fa',
    fontSize: 16,
    fontWeight: '600',
  },
  cta: {
    marginTop: 28,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#2f7df7',
  },
  ctaText: {
    color: '#f5f7ff',
    fontWeight: '800',
  },
});
