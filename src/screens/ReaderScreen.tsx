import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { useFocusEffect } from '@react-navigation/native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OrpWord } from '@/src/components/OrpWord';
import { estimatedSeconds } from '@/src/parsing/tokenize';
import { usePlayback } from '@/src/reader/usePlayback';
import { loadBooks, loadReadingState, loadTokenChunk, saveReadingState, upsertBook } from '@/src/storage';
import { DEFAULT_WPM } from '@/src/storage/keys';
import { BookMeta, ReadingState } from '@/src/types';
import { formatDuration, formatPercent } from '@/src/utils/format';

export default function ReaderScreen() {
  const { bookId } = useLocalSearchParams<{ bookId: string }>();
  const router = useRouter();

  const [book, setBook] = useState<BookMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [currentToken, setCurrentToken] = useState('...');
  const [isPlaying, setIsPlaying] = useState(false);
  const [wpm, setWpm] = useState(DEFAULT_WPM);
  const [orpEnabled, setOrpEnabled] = useState(true);
  const [punctuationPauses, setPunctuationPauses] = useState(true);
  const [tapWidth, setTapWidth] = useState(0);

  const chunkCacheRef = useRef(new Map<number, string[]>());
  const lastPersistRef = useRef({ at: 0, index: 0 });
  const bookRef = useRef<BookMeta | null>(null);
  const indexRef = useRef(0);
  const wpmRef = useRef(DEFAULT_WPM);
  const orpRef = useRef(true);
  const punctuationRef = useRef(true);
  const wpmRafRef = useRef<number | null>(null);
  const pendingWpmRef = useRef(DEFAULT_WPM);

  const ensureChunk = useCallback(
    async (chunkIndex: number): Promise<string[] | null> => {
      const activeBook = bookRef.current;
      if (!activeBook) return null;
      if (chunkIndex < 0 || chunkIndex >= activeBook.chunkCount) return null;
      const cached = chunkCacheRef.current.get(chunkIndex);
      if (cached) return cached;

      const loaded = await loadTokenChunk(activeBook.id, chunkIndex);
      if (loaded) {
        chunkCacheRef.current.set(chunkIndex, loaded);
      }

      // Keep cache tiny for large books.
      if (chunkCacheRef.current.size > 4) {
        const oldest = chunkCacheRef.current.keys().next().value;
        if (typeof oldest === 'number') {
          chunkCacheRef.current.delete(oldest);
        }
      }
      return loaded;
    },
    []
  );

  const resolveToken = useCallback(
    (tokenIndex: number): string | null => {
      const activeBook = bookRef.current;
      if (!activeBook || tokenIndex < 0 || tokenIndex >= activeBook.tokenCount) return null;
      const chunkIndex = Math.floor(tokenIndex / activeBook.chunkSize);
      const chunk = chunkCacheRef.current.get(chunkIndex);
      if (!chunk) return null;
      return chunk[tokenIndex % activeBook.chunkSize] ?? null;
    },
    []
  );

  const syncCurrentToken = useCallback(
    (tokenIndex: number) => {
      const token = resolveToken(tokenIndex);
      if (token) {
        setCurrentToken((prev) => (prev === token ? prev : token));
      }
    },
    [resolveToken]
  );

  const primeAroundIndex = useCallback(
    async (tokenIndex: number) => {
      const activeBook = bookRef.current;
      if (!activeBook) return;
      const chunkIndex = Math.floor(tokenIndex / activeBook.chunkSize);
      await ensureChunk(chunkIndex);
      await ensureChunk(chunkIndex + 1);
      syncCurrentToken(tokenIndex);
    },
    [ensureChunk, syncCurrentToken]
  );

  const persistNow = useCallback(
    async (forcedIndex?: number) => {
      const activeBook = bookRef.current;
      if (!activeBook) return;
      const nextIndex = forcedIndex ?? indexRef.current;
      const now = Date.now();

      const state: ReadingState = {
        bookId: activeBook.id,
        index: nextIndex,
        wpm: wpmRef.current,
        orpEnabled: orpRef.current,
        punctuationPauses: punctuationRef.current,
        lastReadAt: now,
      };

      await saveReadingState(state);
      await upsertBook({
        ...activeBook,
        updatedAt: now,
        lastOpenedAt: now,
      });
    },
    []
  );

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    wpmRef.current = wpm;
  }, [wpm]);

  useEffect(() => {
    orpRef.current = orpEnabled;
  }, [orpEnabled]);

  useEffect(() => {
    punctuationRef.current = punctuationPauses;
  }, [punctuationPauses]);

  useEffect(() => {
    async function bootstrap() {
      const books = await loadBooks();
      const found = books.find((item) => item.id === bookId) ?? null;
      if (!found) {
        router.back();
        return;
      }

      const state = await loadReadingState(found.id);
      chunkCacheRef.current.clear();
      bookRef.current = found;
      setBook(found);
      setIndex(state?.index ?? 0);
      setWpm(state?.wpm ?? DEFAULT_WPM);
      setOrpEnabled(state?.orpEnabled ?? true);
      setPunctuationPauses(state?.punctuationPauses ?? true);
      setLoading(false);

      await ensureChunk(0);
      await primeAroundIndex(state?.index ?? 0);
    }

    bootstrap();
  }, [bookId, ensureChunk, primeAroundIndex, router]);

  useEffect(() => {
    if (!bookRef.current) return;
    primeAroundIndex(index);
  }, [index, primeAroundIndex]);

  usePlayback({
    isPlaying,
    index,
    wpm,
    punctuationPauses,
    resolveToken,
    onAdvance: (nextIndex) => {
      if (!book) return;
      if (nextIndex >= book.tokenCount) {
        setIsPlaying(false);
        setIndex(Math.max(0, book.tokenCount - 1));
        return;
      }
      setIndex(nextIndex);
    },
    onFinished: () => setIsPlaying(false),
  });

  useEffect(() => {
    if (isPlaying) {
      activateKeepAwakeAsync().catch(() => undefined);
    } else {
      deactivateKeepAwake();
    }
  }, [isPlaying]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        setIsPlaying(false);
        persistNow().catch(() => undefined);
      }
    });

    return () => {
      sub.remove();
    };
  }, [persistNow]);

  useFocusEffect(
    useCallback(() => {
      return () => {
        setIsPlaying(false);
        persistNow().catch(() => undefined);
      };
    }, [persistNow])
  );

  useEffect(() => {
    const now = Date.now();
    const shouldPersistByTime = now - lastPersistRef.current.at > 3000;
    const shouldPersistByJump = Math.abs(index - lastPersistRef.current.index) >= 15;

    if (shouldPersistByTime || shouldPersistByJump) {
      lastPersistRef.current = { at: now, index };
      persistNow().catch(() => undefined);
    }
  }, [index, persistNow]);

  useEffect(() => {
    return () => {
      deactivateKeepAwake();
      persistNow().catch(() => undefined);
    };
  }, [persistNow]);

  const jump = useCallback(
    (delta: number) => {
      if (!book) return;
      const next = Math.max(0, Math.min(book.tokenCount - 1, index + delta));
      setIndex(next);
      primeAroundIndex(next).catch(() => undefined);
    },
    [book, index, primeAroundIndex]
  );

  const handlePlayPause = useCallback(() => {
    if (!book) return;

    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    if (index >= book.tokenCount - 1) {
      setIndex(0);
      primeAroundIndex(0).catch(() => undefined);
    }

    setIsPlaying(true);
  }, [book, index, isPlaying, primeAroundIndex]);

  const onReaderTap = (locationX: number) => {
    if (!tapWidth) {
      handlePlayPause();
      return;
    }

    if (locationX < tapWidth * 0.33) {
      jump(-10);
    } else if (locationX > tapWidth * 0.66) {
      jump(10);
    } else {
      handlePlayPause();
    }
  };

  const onReaderLayout = (event: LayoutChangeEvent) => {
    const nextWidth = event.nativeEvent.layout.width;
    setTapWidth((prev) => (prev === nextWidth ? prev : nextWidth));
  };

  const onWpmSliderChange = useCallback((value: number) => {
    pendingWpmRef.current = value;
    if (wpmRafRef.current !== null) return;
    wpmRafRef.current = requestAnimationFrame(() => {
      wpmRafRef.current = null;
      setWpm(Math.round(pendingWpmRef.current));
    });
  }, []);

  useEffect(() => {
    return () => {
      if (wpmRafRef.current !== null) {
        cancelAnimationFrame(wpmRafRef.current);
      }
    };
  }, []);

  const effectiveToken = useMemo(() => {
    const token = resolveToken(index);
    return token ?? currentToken;
  }, [currentToken, index, resolveToken]);

  if (loading || !book) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <ActivityIndicator color="#5cc8ff" />
        </View>
      </SafeAreaView>
    );
  }

  if (book.tokenCount === 0) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.centered}>
          <Text style={styles.meta}>This book has no tokens.</Text>
          <Pressable style={[styles.smallButton, { marginTop: 12 }]} onPress={() => router.back()}>
            <Text style={styles.smallButtonText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const consumedCount = Math.min(index + 1, book.tokenCount);
  const remaining = Math.max(book.tokenCount - consumedCount, 0);
  const progress = formatPercent(consumedCount, book.tokenCount);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={[styles.meta, styles.progressMeta]}>{progress}</Text>

        <View style={styles.readerPanel} onLayout={onReaderLayout}>
          <Pressable style={styles.readerPressable} onPress={(event) => onReaderTap(event.nativeEvent.locationX)}>
            <OrpWord token={effectiveToken || '...'} enabled={orpEnabled} maxWidth={tapWidth > 0 ? tapWidth - 40 : undefined} />
            <Text style={styles.meta}>
              {index + 1} / {book.tokenCount}
            </Text>
          </Pressable>
        </View>

        <View style={styles.controls}>
          <View style={styles.rowButtons}>
            <Pressable style={styles.smallButton} onPress={() => jump(-10)}>
              <Text style={styles.smallButtonText}>-10</Text>
            </Pressable>
            <Pressable
              style={[styles.smallButton, isPlaying ? styles.pauseButton : styles.playButton]}
              onPress={handlePlayPause}>
              <Text style={styles.smallButtonText}>{isPlaying ? 'Pause' : 'Play'}</Text>
            </Pressable>
            <Pressable style={styles.smallButton} onPress={() => jump(10)}>
              <Text style={styles.smallButtonText}>+10</Text>
            </Pressable>
          </View>

          <Text style={styles.controlLabel}>Progress</Text>
          <Slider
            value={index}
            minimumValue={0}
            maximumValue={Math.max(1, book.tokenCount - 1)}
            onSlidingComplete={(value) => {
              const nextIndex = Math.floor(value);
              setIndex(nextIndex);
              primeAroundIndex(nextIndex).catch(() => undefined);
            }}
            minimumTrackTintColor="#5cc8ff"
            maximumTrackTintColor="#2f3f59"
            thumbTintColor="#5cc8ff"
          />

          <View style={styles.rowSpaceBetween}>
            <Text style={styles.controlLabel}>WPM</Text>
            <Text style={styles.meta}>{Math.round(wpm)}</Text>
          </View>
          <Slider
            value={wpm}
            minimumValue={120}
            maximumValue={900}
            step={5}
            onValueChange={onWpmSliderChange}
            minimumTrackTintColor="#5cc8ff"
            maximumTrackTintColor="#2f3f59"
            thumbTintColor="#5cc8ff"
          />

          <View style={styles.rowSpaceBetween}>
            <Text style={styles.controlLabel}>ORP highlight</Text>
            <Pressable
              style={[styles.toggle, orpEnabled && styles.toggleEnabled]}
              onPress={() => setOrpEnabled((prev) => !prev)}>
              <Text style={styles.smallButtonText}>{orpEnabled ? 'On' : 'Off'}</Text>
            </Pressable>
          </View>

          <View style={styles.rowSpaceBetween}>
            <Text style={styles.controlLabel}>Punctuation pauses</Text>
            <Pressable
              style={[styles.toggle, punctuationPauses && styles.toggleEnabled]}
              onPress={() => setPunctuationPauses((prev) => !prev)}>
              <Text style={styles.smallButtonText}>{punctuationPauses ? 'On' : 'Off'}</Text>
            </Pressable>
          </View>

          <Text style={styles.meta}>Estimated remaining: {formatDuration(estimatedSeconds(remaining, wpm))}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0a0f18',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    paddingHorizontal: 14,
    paddingTop: 10,
  },
  readerPanel: {
    flex: 1,
    backgroundColor: '#101827',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#1b2535',
    marginBottom: 12,
  },
  readerPressable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  controls: {
    paddingBottom: 10,
  },
  rowButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  smallButton: {
    minWidth: 94,
    borderRadius: 999,
    paddingVertical: 11,
    paddingHorizontal: 18,
    alignItems: 'center',
    backgroundColor: '#2a364c',
  },
  playButton: {
    backgroundColor: '#2f7df7',
  },
  pauseButton: {
    backgroundColor: '#e19f3d',
  },
  smallButtonText: {
    color: '#f5f7ff',
    fontWeight: '700',
  },
  controlLabel: {
    color: '#f5f7ff',
    fontWeight: '700',
  },
  rowSpaceBetween: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  toggle: {
    minWidth: 75,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
    alignItems: 'center',
    backgroundColor: '#2a364c',
  },
  toggleEnabled: {
    backgroundColor: '#2f7df7',
  },
  meta: {
    color: '#9fb1ce',
    marginTop: 6,
  },
  progressMeta: {
    textAlign: 'right',
    marginBottom: 8,
  },
});
