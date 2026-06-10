import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  loadBooks,
  loadGlobalSettings,
  loadReadingState,
  removeBook,
  saveReadingState,
  upsertBook,
} from '@/src/storage';
import { BookMeta, ImportProgress, ReadingState } from '@/src/types';
import { getErrorMessage } from '@/src/utils/errors';
import { formatDate, formatPercent } from '@/src/utils/format';
import {
  BookSection,
  createBookFromSections,
  discardImportCopy,
  importEpubFromUri,
  importTxtFromUri,
  pickBookFile,
  validateImportName,
} from '@/src/utils/importBook';

const SAMPLE_SECTIONS: BookSection[] = [
  {
    title: 'Welcome',
    text: 'VeloRead sample text. Use the chapter list to jump between sections while you practice.',
  },
  {
    title: 'One Word at a Time',
    text: 'The room was quiet, and the clock on the wall ticked in a patient rhythm. A reader opened a notebook, set a goal for the evening, and decided to focus on flow rather than perfection. One word, then the next, then the next: that was the only job.',
  },
  {
    title: 'Finding the Pace',
    text: 'At first, the pace felt unusual. Short words flashed by quickly; longer words asked for slightly more attention. Commas introduced small pauses, while full stops created a deeper breath. Instead of sounding every syllable in their head, the reader practiced recognition and trust.',
  },
  {
    title: 'Comprehension Returns',
    text: 'After a few minutes, comprehension improved. Ideas began to connect across sentences, and paragraphs felt like complete units. Questions still appeared—What does this phrase imply? Why did the author choose this example?—but the reader learned to mark those moments and keep moving.',
  },
  {
    title: 'Push and Recover',
    text: 'When fatigue appeared, the reader lowered the speed from 360 to 280 words per minute. Accuracy returned. Then, with confidence restored, the speed climbed again. This gentle adjustment became a habit: push when focused, ease back when overloaded, recover, and continue.',
  },
  {
    title: 'Consistency Wins',
    text: 'By the end of the session, the reader had finished more pages than usual and remembered key details: names, transitions, and arguments. Progress was not magic; it was consistency. Tomorrow, the plan was simple—sit down, start the timer, and read one token at a time.',
  },
];

type BookListItem = {
  meta: BookMeta;
  state: ReadingState | null;
};

function progressLabel(progress?: ImportProgress | null): string {
  if (!progress) return '';
  const pct = Math.round(progress.progress * 100);
  if (progress.phase === 'reading') return `Reading file... ${pct}%`;
  if (progress.phase === 'tokenizing') return `Tokenizing... ${pct}%`;
  return `Saving... ${pct}%`;
}

export default function LibraryScreen() {
  const router = useRouter();
  const [books, setBooks] = useState<BookListItem[]>([]);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importStatus, setImportStatus] = useState<ImportProgress | null>(null);
  const [lastPreview, setLastPreview] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const bookMetas = await loadBooks();
      const states = await Promise.all(
        bookMetas.map(async (meta) => ({ meta, state: await loadReadingState(meta.id) }))
      );
      setBooks(states);
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to load your library.'));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const ingestSample = useCallback(async () => {
    if (isBusy) return;
    setError(null);
    setIsBusy(true);
    setImportStatus({ phase: 'reading', progress: 0.2 });

    try {
      const settings = await loadGlobalSettings();
      const imported = await createBookFromSections(
        'Sample Text',
        SAMPLE_SECTIONS,
        'txt',
        {
          wpm: settings.defaultWpm,
          orpEnabled: settings.defaultOrpEnabled,
          punctuationPauses: settings.defaultPunctuationPauses,
        },
        { onProgress: setImportStatus }
      );

      await upsertBook(imported.meta);
      await saveReadingState(imported.initialState);
      await refresh();
      setLastPreview(imported.meta.preview);
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to load sample.'));
    } finally {
      setImportStatus(null);
      setIsBusy(false);
    }
  }, [isBusy, refresh]);

  const handleImport = useCallback(async () => {
    if (isBusy) return;
    setError(null);
    const file = await pickBookFile();
    if (!file) return;

    const fileType = validateImportName(file.name ?? '');
    if (fileType === 'unsupported') {
      await discardImportCopy(file.uri);
      setError('Unsupported format. Please import a .txt or .epub file.');
      return;
    }

    setIsBusy(true);
    setImportStatus({ phase: 'reading', progress: 0 });

    try {
      const defaults = await loadGlobalSettings();
      const importer = fileType === 'epub' ? importEpubFromUri : importTxtFromUri;
      const imported = await importer(
        file.uri,
        file.name || 'Imported Book',
        {
          wpm: defaults.defaultWpm,
          orpEnabled: defaults.defaultOrpEnabled,
          punctuationPauses: defaults.defaultPunctuationPauses,
        },
        { onProgress: setImportStatus }
      );

      await upsertBook(imported.meta);
      await saveReadingState(imported.initialState);
      setLastPreview(imported.meta.preview);
      await refresh();
    } catch (error) {
      setError(getErrorMessage(error, 'Failed to import book.'));
    } finally {
      await discardImportCopy(file.uri);
      setIsBusy(false);
      setImportStatus(null);
    }
  }, [isBusy, refresh]);

  const handleDelete = useCallback(
    (bookId: string) => {
      Alert.alert('Delete this book?', 'This removes the book and its progress.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await removeBook(bookId);
              await refresh();
            } catch (error) {
              setError(getErrorMessage(error, 'Failed to delete the book.'));
            }
          },
        },
      ]);
    },
    [refresh]
  );

  const importProgressText = useMemo(() => progressLabel(importStatus), [importStatus]);

  const renderBook = ({ item }: { item: BookListItem }) => {
    const index = item.state?.index ?? 0;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.meta.title}`}
        style={styles.card}
        onPress={() => router.push({ pathname: '/setup/[bookId]', params: { bookId: item.meta.id } })}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{item.meta.title}</Text>
          <Text style={styles.cardMeta}>
            {item.meta.tokenCount} tokens | {formatPercent(index, item.meta.tokenCount)}
          </Text>
          {item.meta.chapters && item.meta.chapters.length > 1 ? (
            <Text style={styles.cardMeta}>{item.meta.chapters.length} chapters</Text>
          ) : null}
          <Text style={styles.cardMeta}>Last opened: {formatDate(item.meta.lastOpenedAt)}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Delete ${item.meta.title}`}
          onPress={(event) => {
            event.stopPropagation();
            handleDelete(item.meta.id);
          }}>
          <Text style={styles.delete}>Delete</Text>
        </Pressable>
      </Pressable>
    );
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>VeloRead</Text>
        <Text style={styles.subtitle}>RSVP reading with ORP focus</Text>

        <View style={styles.buttonRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Load sample text"
            style={[styles.button, styles.secondaryButton]}
            onPress={ingestSample}
            disabled={isBusy}>
            <Text style={styles.buttonText}>Load Sample</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Import a book"
            style={styles.button}
            onPress={handleImport}
            disabled={isBusy}>
            <Text style={styles.buttonText}>Import Book</Text>
          </Pressable>
        </View>

        {isBusy ? (
          <View style={styles.statusRow}>
            <ActivityIndicator color="#5cc8ff" />
            <Text style={styles.statusText}>{importProgressText}</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {lastPreview ? <Text style={styles.preview}>Preview: {lastPreview}</Text> : null}

        <FlatList
          data={books}
          keyExtractor={(item) => item.meta.id}
          renderItem={renderBook}
          contentContainerStyle={{ paddingBottom: 32 }}
          ListEmptyComponent={<Text style={styles.empty}>No books yet. Import a .txt or .epub file to begin.</Text>}
        />
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
  title: {
    color: '#f5f7ff',
    fontSize: 31,
    fontWeight: '800',
  },
  subtitle: {
    color: '#9faec6',
    marginTop: 4,
    marginBottom: 16,
  },
  buttonRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 14,
  },
  button: {
    flex: 1,
    backgroundColor: '#2f7df7',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  secondaryButton: {
    backgroundColor: '#273142',
  },
  buttonText: {
    color: '#f5f7ff',
    fontWeight: '700',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  statusText: {
    color: '#c6d1e3',
  },
  error: {
    color: '#ff8e8e',
    marginBottom: 8,
  },
  preview: {
    color: '#8ea0bd',
    marginBottom: 10,
    fontStyle: 'italic',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1b2535',
    backgroundColor: '#121a28',
    marginBottom: 10,
  },
  cardTitle: {
    color: '#f5f7ff',
    fontSize: 16,
    fontWeight: '700',
  },
  cardMeta: {
    color: '#a3b2ca',
    marginTop: 3,
  },
  delete: {
    color: '#ff7979',
    fontWeight: '700',
    padding: 6,
  },
  empty: {
    marginTop: 24,
    textAlign: 'center',
    color: '#7f90ad',
  },
});
