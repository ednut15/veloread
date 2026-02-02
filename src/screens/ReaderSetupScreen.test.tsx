import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ReaderSetupScreen from '@/src/screens/ReaderSetupScreen';
import { BookMeta, ReadingState } from '@/src/types';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockUseLocalSearchParams = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  useRouter: () => ({ push: mockPush, back: mockBack }),
}));

const mockLoadBooks = jest.fn();
const mockLoadGlobalSettings = jest.fn();
const mockLoadReadingState = jest.fn();
const mockSaveGlobalSettings = jest.fn();
const mockSaveReadingState = jest.fn();
const mockUpsertBook = jest.fn();

jest.mock('@/src/storage', () => ({
  loadBooks: (...args: unknown[]) => mockLoadBooks(...args),
  loadGlobalSettings: (...args: unknown[]) => mockLoadGlobalSettings(...args),
  loadReadingState: (...args: unknown[]) => mockLoadReadingState(...args),
  saveGlobalSettings: (...args: unknown[]) => mockSaveGlobalSettings(...args),
  saveReadingState: (...args: unknown[]) => mockSaveReadingState(...args),
  upsertBook: (...args: unknown[]) => mockUpsertBook(...args),
}));

const baseBook: BookMeta = {
  id: 'book-1',
  title: 'My Book',
  sourceType: 'epub',
  createdAt: 1,
  updatedAt: 10,
  textLength: 220,
  tokenCount: 120,
  chunkSize: 50,
  chunkCount: 3,
  preview: 'Preview',
  chapters: [
    { title: 'One', startToken: 0, endToken: 60 },
    { title: 'Two', startToken: 60, endToken: 120 },
  ],
  lastOpenedAt: 10,
};

const baseState: ReadingState = {
  bookId: 'book-1',
  index: 20,
  wpm: 320,
  orpEnabled: true,
  punctuationPauses: true,
  lastReadAt: 10,
};

describe('ReaderSetupScreen', () => {
  let consoleErrorSpy: jest.SpyInstance;
  const originalConsoleError = console.error;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const first = args[0];
      if (typeof first === 'string' && first.includes('not wrapped in act')) {
        return;
      }
      originalConsoleError(...args);
    });
    mockUseLocalSearchParams.mockReturnValue({ bookId: 'book-1' });

    mockLoadBooks.mockResolvedValue([baseBook]);
    mockLoadGlobalSettings.mockResolvedValue({
      defaultWpm: 300,
      defaultOrpEnabled: true,
      defaultPunctuationPauses: true,
    });
    mockLoadReadingState.mockResolvedValue(baseState);
    mockSaveGlobalSettings.mockResolvedValue(undefined);
    mockSaveReadingState.mockResolvedValue(undefined);
    mockUpsertBook.mockResolvedValue(undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  async function renderScreen() {
    const screen = render(<ReaderSetupScreen />);
    await act(async () => {
      for (let i = 0; i < 5; i += 1) {
        await Promise.resolve();
      }
    });
    return screen;
  }

  it('renders chapter count and resume action by default', async () => {
    const screen = await renderScreen();
    expect(await screen.findByText('My Book')).toBeTruthy();
    expect(screen.getByText('Chapters: 2')).toBeTruthy();
    expect(screen.getByText('Resume Reading')).toBeTruthy();
  });

  it('switches CTA text when starting from beginning', async () => {
    const screen = await renderScreen();
    await screen.findByText('Resume Reading');

    const switches = screen.getAllByRole('switch');
    fireEvent(switches[0], 'valueChange', true);

    expect(screen.getByText('Start Reading')).toBeTruthy();
  });

  it('navigates back when the book cannot be found', async () => {
    mockLoadBooks.mockResolvedValue([]);
    await renderScreen();
    await waitFor(() => {
      expect(mockBack).toHaveBeenCalled();
    });
  });
});
