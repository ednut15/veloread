import AsyncStorage from '@react-native-async-storage/async-storage';
import { BookMeta, GlobalSettings, ReadingState } from '@/src/types';
import {
  BOOK_LIST_KEY,
  DEFAULT_CHUNK_SIZE,
  DEFAULT_WPM,
  GLOBAL_SETTINGS_KEY,
  READING_STATE_PREFIX,
  TOKEN_CHUNK_PREFIX,
} from './keys';

export const tokenChunkKey = (bookId: string, chunkIndex: number) =>
  `${TOKEN_CHUNK_PREFIX}${bookId}_${chunkIndex}`;

export const readingStateKey = (bookId: string) => `${READING_STATE_PREFIX}${bookId}`;

export async function loadBooks(): Promise<BookMeta[]> {
  const raw = await AsyncStorage.getItem(BOOK_LIST_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as BookMeta[];
    return parsed.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  } catch {
    return [];
  }
}

export async function saveBooks(books: BookMeta[]): Promise<void> {
  await AsyncStorage.setItem(BOOK_LIST_KEY, JSON.stringify(books));
}

export async function upsertBook(meta: BookMeta): Promise<void> {
  const books = await loadBooks();
  const index = books.findIndex((item) => item.id === meta.id);
  if (index >= 0) {
    books[index] = meta;
  } else {
    books.push(meta);
  }
  books.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  await saveBooks(books);
}

export async function removeBook(bookId: string): Promise<void> {
  const books = await loadBooks();
  await saveBooks(books.filter((item) => item.id !== bookId));
  await AsyncStorage.removeItem(readingStateKey(bookId));

  const keys = await AsyncStorage.getAllKeys();
  const chunkKeys = keys.filter((key) => key.startsWith(`${TOKEN_CHUNK_PREFIX}${bookId}_`));
  if (chunkKeys.length) {
    await AsyncStorage.multiRemove(chunkKeys);
  }
}

export async function saveTokenChunks(
  bookId: string,
  tokens: string[],
  chunkSize: number = DEFAULT_CHUNK_SIZE
): Promise<{ chunkSize: number; chunkCount: number }> {
  const totalChunks = Math.ceil(tokens.length / chunkSize);
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex += 1) {
    const start = chunkIndex * chunkSize;
    const chunk = tokens.slice(start, start + chunkSize);
    await AsyncStorage.setItem(tokenChunkKey(bookId, chunkIndex), JSON.stringify(chunk));
  }
  return {
    chunkSize,
    chunkCount: totalChunks,
  };
}

export async function loadTokenChunk(bookId: string, chunkIndex: number): Promise<string[] | null> {
  const raw = await AsyncStorage.getItem(tokenChunkKey(bookId, chunkIndex));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return null;
  }
}

export async function loadReadingState(bookId: string): Promise<ReadingState | null> {
  const raw = await AsyncStorage.getItem(readingStateKey(bookId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ReadingState;
  } catch {
    return null;
  }
}

export async function saveReadingState(state: ReadingState): Promise<void> {
  await AsyncStorage.setItem(readingStateKey(state.bookId), JSON.stringify(state));
}

export async function loadGlobalSettings(): Promise<GlobalSettings> {
  const raw = await AsyncStorage.getItem(GLOBAL_SETTINGS_KEY);
  if (!raw) {
    return {
      defaultWpm: DEFAULT_WPM,
      defaultOrpEnabled: true,
      defaultPunctuationPauses: true,
    };
  }
  try {
    return JSON.parse(raw) as GlobalSettings;
  } catch {
    return {
      defaultWpm: DEFAULT_WPM,
      defaultOrpEnabled: true,
      defaultPunctuationPauses: true,
    };
  }
}

export async function saveGlobalSettings(settings: GlobalSettings): Promise<void> {
  await AsyncStorage.setItem(GLOBAL_SETTINGS_KEY, JSON.stringify(settings));
}
