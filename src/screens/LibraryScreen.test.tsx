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

jest.mock('@/src/storage', () => ({
  loadBooks: (...args: unknown[]) => mockLoadBooks(...args),
  loadGlobalSettings: (...args: unknown[]) => mockLoadGlobalSettings(...args),
  loadReadingState: (...args: unknown[]) => mockLoadReadingState(...args),
  removeBook: (...args: unknown[]) => mockRemoveBook(...args),
  saveReadingState: (...args: unknown[]) => mockSaveReadingState(...args),
  upsertBook: (...args: unknown[]) => mockUpsertBook(...args),
}));

const mockCreateBookFromSections = jest.fn();
const mockDiscardImportCopy = jest.fn();
const mockImportEpubFromUri = jest.fn();
const mockImportTxtFromUri = jest.fn();
const mockPickBookFile = jest.fn();
const mockValidateImportName = jest.fn();

jest.mock('@/src/utils/importBook', () => ({
  createBookFromSections: (...args: unknown[]) => mockCreateBookFromSections(...args),
  discardImportCopy: (...args: unknown[]) => mockDiscardImportCopy(...args),
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

    mockPickBookFile.mockResolvedValue(null);
    mockValidateImportName.mockReturnValue('txt');
    mockDiscardImportCopy.mockResolvedValue(undefined);
    mockCreateBookFromSections.mockResolvedValue({
      meta: baseBook,
      initialState: baseState,
    });
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
    expect(mockDiscardImportCopy).toHaveBeenCalledWith('file://book.pdf');
  });

  it('imports a picked file and discards the picker cache copy afterwards', async () => {
    mockPickBookFile.mockResolvedValue({
      uri: 'file://cache/book.txt',
      name: 'book.txt',
    });

    const screen = render(<LibraryScreen />);
    fireEvent.press(screen.getByText('Import Book'));

    await waitFor(() =>
      expect(mockImportTxtFromUri).toHaveBeenCalledWith(
        'file://cache/book.txt',
        'book.txt',
        expect.objectContaining({ wpm: 320 }),
        expect.anything()
      )
    );
    await waitFor(() => expect(mockUpsertBook).toHaveBeenCalledWith(baseBook));
    expect(mockSaveReadingState).toHaveBeenCalledWith(baseState);
    await waitFor(() => expect(mockDiscardImportCopy).toHaveBeenCalledWith('file://cache/book.txt'));
  });

  it('discards the picker cache copy even when the import fails', async () => {
    mockPickBookFile.mockResolvedValue({
      uri: 'file://cache/broken.txt',
      name: 'broken.txt',
    });
    mockImportTxtFromUri.mockRejectedValue(new Error('This file is empty.'));

    const screen = render(<LibraryScreen />);
    fireEvent.press(screen.getByText('Import Book'));

    expect(await screen.findByText('This file is empty.')).toBeTruthy();
    await waitFor(() => expect(mockDiscardImportCopy).toHaveBeenCalledWith('file://cache/broken.txt'));
    expect(mockUpsertBook).not.toHaveBeenCalled();
  });

  it('loads the multi-chapter sample through the shared import pipeline', async () => {
    const screen = render(<LibraryScreen />);
    fireEvent.press(screen.getByText('Load Sample'));

    await waitFor(() => expect(mockCreateBookFromSections).toHaveBeenCalled());
    const [title, sections, sourceType] = mockCreateBookFromSections.mock.calls[0];
    expect(title).toBe('Sample Text');
    expect(sourceType).toBe('txt');
    expect(sections.length).toBeGreaterThan(1);
    expect(sections[0]).toEqual(expect.objectContaining({ title: 'Welcome' }));
    await waitFor(() => expect(mockUpsertBook).toHaveBeenCalledWith(baseBook));
    expect(mockSaveReadingState).toHaveBeenCalledWith(baseState);
  });
});
