import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import LibraryScreen from '@/src/screens/LibraryScreen';
import { BookMeta, ReadingState } from '@/src/types';

const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockLoadBooks = jest.fn();
const mockLoadGlobalSettings = jest.fn();
const mockLoadReadingState = jest.fn();
const mockRemoveBook = jest.fn();
const mockSaveReadingState = jest.fn();
const mockUpsertBook = jest.fn();
const mockSaveTokenChunks = jest.fn();

jest.mock('@/src/storage', () => ({
  loadBooks: (...args: unknown[]) => mockLoadBooks(...args),
  loadGlobalSettings: (...args: unknown[]) => mockLoadGlobalSettings(...args),
  loadReadingState: (...args: unknown[]) => mockLoadReadingState(...args),
  removeBook: (...args: unknown[]) => mockRemoveBook(...args),
  saveReadingState: (...args: unknown[]) => mockSaveReadingState(...args),
  upsertBook: (...args: unknown[]) => mockUpsertBook(...args),
  saveTokenChunks: (...args: unknown[]) => mockSaveTokenChunks(...args),
}));

const mockImportEpubFromUri = jest.fn();
const mockImportTxtFromUri = jest.fn();
const mockPickBookFile = jest.fn();
const mockValidateImportName = jest.fn();

jest.mock('@/src/utils/importBook', () => ({
  importEpubFromUri: (...args: unknown[]) => mockImportEpubFromUri(...args),
  importTxtFromUri: (...args: unknown[]) => mockImportTxtFromUri(...args),
  pickBookFile: (...args: unknown[]) => mockPickBookFile(...args),
  validateImportName: (...args: unknown[]) => mockValidateImportName(...args),
}));

const baseBook: BookMeta = {
  id: 'book-1',
  title: 'Imported Book',
  sourceType: 'epub',
  createdAt: 1,
  updatedAt: 10,
  textLength: 200,
  tokenCount: 100,
  chunkSize: 50,
  chunkCount: 2,
  preview: 'Preview',
  chapters: [
    { title: 'One', startToken: 0, endToken: 50 },
    { title: 'Two', startToken: 50, endToken: 100 },
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

describe('LibraryScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockLoadBooks.mockResolvedValue([]);
    mockLoadGlobalSettings.mockResolvedValue({
      defaultWpm: 320,
      defaultOrpEnabled: true,
      defaultPunctuationPauses: true,
    });
    mockLoadReadingState.mockResolvedValue(null);
    mockRemoveBook.mockResolvedValue(undefined);
    mockSaveReadingState.mockResolvedValue(undefined);
    mockUpsertBook.mockResolvedValue(undefined);
    mockSaveTokenChunks.mockResolvedValue({ chunkCount: 1, chunkSize: 500 });

    mockPickBookFile.mockResolvedValue(null);
    mockValidateImportName.mockReturnValue('txt');
    mockImportTxtFromUri.mockResolvedValue({
      meta: baseBook,
      initialState: baseState,
    });
    mockImportEpubFromUri.mockResolvedValue({
      meta: baseBook,
      initialState: baseState,
    });
  });

  it('renders empty state when there are no books', async () => {
    const screen = render(<LibraryScreen />);
    expect(await screen.findByText('No books yet. Import a .txt or .epub file to begin.')).toBeTruthy();
  });

  it('renders chapter count for imported books', async () => {
    mockLoadBooks.mockResolvedValue([baseBook]);
    mockLoadReadingState.mockResolvedValue(baseState);

    const screen = render(<LibraryScreen />);
    expect(await screen.findByText('2 chapters')).toBeTruthy();
    expect(screen.getByText('Imported Book')).toBeTruthy();
  });

  it('shows an unsupported format error during import', async () => {
    mockPickBookFile.mockResolvedValue({
      uri: 'file://book.pdf',
      name: 'book.pdf',
    });
    mockValidateImportName.mockReturnValue('unsupported');

    const screen = render(<LibraryScreen />);
    fireEvent.press(screen.getByText('Import Book'));

    expect(await screen.findByText('Unsupported format. Please import a .txt or .epub file.')).toBeTruthy();
    await waitFor(() => expect(mockImportTxtFromUri).not.toHaveBeenCalled());
  });
});
