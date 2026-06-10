import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ReaderScreen from '@/src/screens/ReaderScreen';
import { BookMeta, ReadingState } from '@/src/types';

const mockUseLocalSearchParams = jest.fn();

// The router and navigation objects must be stable across renders, like the
// real expo-router hooks, because ReaderScreen effects list them as deps.
jest.mock('expo-router', () => {
  const router = { back: jest.fn(), push: jest.fn() };
  const navigation = { setOptions: jest.fn() };
  return {
    useLocalSearchParams: () => mockUseLocalSearchParams(),
    useRouter: () => router,
    useNavigation: () => navigation,
  };
});

jest.mock('@react-navigation/native', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ReactActual = require('react');
    ReactActual.useEffect(callback, [callback]);
  },
}));

jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(async () => undefined),
  deactivateKeepAwake: jest.fn(),
}));

const mockLoadBooks = jest.fn();
const mockLoadReadingState = jest.fn();
const mockLoadTokenChunk = jest.fn();
const mockSaveReadingState = jest.fn();

jest.mock('@/src/storage', () => ({
  loadBooks: (...args: unknown[]) => mockLoadBooks(...args),
  loadReadingState: (...args: unknown[]) => mockLoadReadingState(...args),
  loadTokenChunk: (...args: unknown[]) => mockLoadTokenChunk(...args),
  saveReadingState: (...args: unknown[]) => mockSaveReadingState(...args),
}));

const CHUNK_SIZE = 500;
const TOKEN_COUNT = 1500;

const baseBook: BookMeta = {
  id: 'book-1',
  title: 'My Book',
  sourceType: 'txt',
  createdAt: 1,
  updatedAt: 10,
  textLength: 9000,
  tokenCount: TOKEN_COUNT,
  chunkSize: CHUNK_SIZE,
  chunkCount: 3,
  preview: 'Preview',
  lastOpenedAt: 10,
};

// Pauses and ORP disabled so each token renders as plain text on a flat 200ms cadence.
const baseState: ReadingState = {
  bookId: 'book-1',
  index: 0,
  wpm: 300,
  orpEnabled: false,
  punctuationPauses: false,
  lastReadAt: 10,
};

const makeChunk = (chunkIndex: number) =>
  Array.from({ length: CHUNK_SIZE }, (_, i) => `w${chunkIndex * CHUNK_SIZE + i}`);

describe('ReaderScreen', () => {
  let consoleErrorSpy: jest.SpyInstance;
  const originalConsoleError = console.error;
  let resolveChunk2: ((chunk: string[] | null) => void) | null;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'string' && first.includes('not wrapped in act')) {
        return;
      }
      originalConsoleError(...args);
    });

    resolveChunk2 = null;
    mockUseLocalSearchParams.mockReturnValue({ bookId: 'book-1' });
    mockLoadBooks.mockResolvedValue([baseBook]);
    mockLoadReadingState.mockResolvedValue(baseState);
    mockSaveReadingState.mockResolvedValue(undefined);
    // Chunks 0 and 1 are available immediately; chunk 2 stays pending until the
    // test resolves it, emulating a slow AsyncStorage read.
    mockLoadTokenChunk.mockImplementation((_bookId: string, chunkIndex: number) => {
      if (chunkIndex === 2) {
        return new Promise<string[] | null>((resolve) => {
          resolveChunk2 = resolve;
        });
      }
      return Promise.resolve(makeChunk(chunkIndex));
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    consoleErrorSpy.mockRestore();
  });

  it('resumes from the persisted reading position', async () => {
    mockLoadReadingState.mockResolvedValue({ ...baseState, index: 10 });

    const screen = render(<ReaderScreen />);

    expect(await screen.findByText('w10')).toBeTruthy();
    expect(screen.getByText('11 / 1500')).toBeTruthy();
  });

  it('keeps playing across a jump into a not-yet-loaded chunk', async () => {
    const screen = render(<ReaderScreen />);
    await screen.findByText('w0');

    fireEvent.press(screen.getByText('Play'));
    expect(screen.getByText('Pause')).toBeTruthy();

    // Jump into chunk 2, which has not loaded yet.
    fireEvent(screen.getByLabelText('Reading position'), 'slidingComplete', 1100);
    expect(screen.getByText('1101 / 1500')).toBeTruthy();

    // While the chunk is still loading, playback must wait — not silently pause.
    await act(async () => {
      jest.advanceTimersByTime(120);
    });
    expect(screen.getByText('Pause')).toBeTruthy();

    // The chunk arrives; the pending retry picks it up and playback advances.
    await act(async () => {
      resolveChunk2?.(makeChunk(2));
    });
    await act(async () => {
      jest.advanceTimersByTime(40); // stall retry tick
    });
    expect(screen.getByText('w1100')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(200); // one full token delay
    });

    expect(screen.getByText('Pause')).toBeTruthy();
    expect(screen.getByText('1102 / 1500')).toBeTruthy();
  });

  it('jumps to a chapter picked from the chapter list', async () => {
    mockLoadBooks.mockResolvedValue([
      {
        ...baseBook,
        chapters: [
          { title: 'One', startToken: 0, endToken: 500 },
          { title: 'Two', startToken: 500, endToken: 1000 },
          { title: 'Three', startToken: 1000, endToken: 1500 },
        ],
      },
    ]);

    const screen = render(<ReaderScreen />);
    await screen.findByText('w0');
    expect(screen.getByText('Chapter 1/3: One')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Open chapter list'));
    expect(screen.getByText('Chapters')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Go to chapter 2: Two'));

    expect(screen.queryByText('Chapters')).toBeNull();
    expect(screen.getByText('501 / 1500')).toBeTruthy();
    expect(screen.getByText('Chapter 2/3: Two')).toBeTruthy();
    expect(await screen.findByText('w500')).toBeTruthy();
  });

  it('persists the reading state when the position jumps', async () => {
    const screen = render(<ReaderScreen />);
    await screen.findByText('w0');

    fireEvent(screen.getByLabelText('Reading position'), 'slidingComplete', 600);

    await waitFor(() =>
      expect(mockSaveReadingState).toHaveBeenCalledWith(
        expect.objectContaining({ bookId: 'book-1', index: 600, wpm: 300 })
      )
    );
  });
});
