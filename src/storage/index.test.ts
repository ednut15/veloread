import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  loadBooks,
  loadTokenChunk,
  removeBook,
  saveReadingState,
  saveTokenChunks,
  tokenChunkKey,
  upsertBook,
} from '@/src/storage';
import { BOOK_LIST_KEY } from '@/src/storage/keys';
import { BookMeta } from '@/src/types';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const makeBook = (id: string, updatedAt: number): BookMeta => ({
  id,
  title: `Book ${id}`,
  sourceType: 'txt',
  createdAt: updatedAt,
  updatedAt,
  textLength: 120,
  tokenCount: 20,
  chunkSize: 10,
  chunkCount: 2,
  preview: 'Preview',
});

describe('storage', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('upserts and sorts books by updatedAt descending', async () => {
    await upsertBook(makeBook('a', 1000));
    await upsertBook(makeBook('b', 2000));

    const books = await loadBooks();
    expect(books.map((b) => b.id)).toEqual(['b', 'a']);
  });

  it('updates an existing book instead of duplicating', async () => {
    await upsertBook(makeBook('x', 1000));
    await upsertBook({ ...makeBook('x', 3000), title: 'Updated' });

    const books = await loadBooks();
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('Updated');
  });

  it('saves and loads token chunks', async () => {
    const tokens = ['a', 'b', 'c', 'd', 'e'];
    const result = await saveTokenChunks('book-1', tokens, 2);

    expect(result).toEqual({ chunkSize: 2, chunkCount: 3 });
    await expect(loadTokenChunk('book-1', 0)).resolves.toEqual(['a', 'b']);
    await expect(loadTokenChunk('book-1', 1)).resolves.toEqual(['c', 'd']);
    await expect(loadTokenChunk('book-1', 2)).resolves.toEqual(['e']);
  });

  it('removes a book with reading state and token chunks', async () => {
    await upsertBook(makeBook('remove-me', 1000));
    await saveReadingState({
      bookId: 'remove-me',
      index: 2,
      wpm: 320,
      orpEnabled: true,
      punctuationPauses: true,
      lastReadAt: 1,
    });
    await AsyncStorage.setItem(tokenChunkKey('remove-me', 0), JSON.stringify(['hello']));
    await AsyncStorage.setItem(tokenChunkKey('remove-me', 1), JSON.stringify(['world']));

    await removeBook('remove-me');

    const booksRaw = await AsyncStorage.getItem(BOOK_LIST_KEY);
    expect(booksRaw).toContain('[]');
    await expect(loadTokenChunk('remove-me', 0)).resolves.toBeNull();
    await expect(loadTokenChunk('remove-me', 1)).resolves.toBeNull();
  });
});
