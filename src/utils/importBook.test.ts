import JSZip from 'jszip';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { loadTokenChunk } from '@/src/storage';
import { ImportProgress } from '@/src/types';
import { ImportError } from '@/src/utils/errors';
import {
  createBookFromSections,
  createBookFromText,
  discardImportCopy,
  importEpubFromUri,
  importTxtFromUri,
  validateImportName,
} from '@/src/utils/importBook';

jest.mock('@react-native-async-storage/async-storage', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

jest.mock('expo-file-system/legacy', () => ({
  getInfoAsync: jest.fn(),
  readAsStringAsync: jest.fn(),
  deleteAsync: jest.fn(),
  EncodingType: { UTF8: 'utf8', Base64: 'base64' },
}));

const mockGetInfoAsync = FileSystem.getInfoAsync as jest.Mock;
const mockReadAsStringAsync = FileSystem.readAsStringAsync as jest.Mock;
const mockDeleteAsync = FileSystem.deleteAsync as jest.Mock;

const defaults = { wpm: 320, orpEnabled: true, punctuationPauses: true };

async function buildEpubBase64(files: Record<string, string>): Promise<string> {
  const zip = new JSZip();
  for (const [path, content] of Object.entries(files)) {
    zip.file(path, content);
  }
  return zip.generateAsync({ type: 'base64', compression: 'STORE' });
}

function simpleEpubFiles(): Record<string, string> {
  return {
    mimetype: 'application/epub+zip',
    'META-INF/container.xml': `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`,
    'OEBPS/content.opf': `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Fixture Book</dc:title></metadata>
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="ch2" href="chapter2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/><itemref idref="ch2"/></spine>
</package>`,
    'OEBPS/chapter1.xhtml':
      '<html><head><title>One</title></head><body><h1>One</h1><p>Alpha beta gamma.</p></body></html>',
    'OEBPS/chapter2.xhtml':
      '<html><head><title>Two</title></head><body><h1>Two</h1><p>Delta epsilon.</p></body></html>',
  };
}

describe('importTxtFromUri', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockGetInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 64 });
  });

  it('imports a text file and persists token chunks', async () => {
    mockReadAsStringAsync.mockResolvedValue('Alpha first.\n\nBeta second.');
    const progress: ImportProgress[] = [];

    const { meta, initialState } = await importTxtFromUri('file://b.txt', 'My Book.txt', defaults, {
      onProgress: (state) => progress.push(state),
    });

    expect(meta.title).toBe('My Book');
    expect(meta.sourceType).toBe('txt');
    expect(meta.tokenCount).toBe(5);
    expect(meta.chapters).toEqual([{ title: 'Full Text', startToken: 0, endToken: 5 }]);
    expect(initialState).toMatchObject({ bookId: meta.id, index: 0, wpm: 320 });

    await expect(loadTokenChunk(meta.id, 0)).resolves.toEqual([
      'Alpha',
      'first.',
      '\n',
      'Beta',
      'second.',
    ]);

    expect(progress.some((state) => state.phase === 'tokenizing')).toBe(true);
    expect(progress.at(-1)).toEqual({ phase: 'saving', progress: 1 });
  });

  it('rejects files above the size limit without reading them', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 11 * 1024 * 1024 });

    await expect(importTxtFromUri('file://big.txt', 'big.txt', defaults)).rejects.toThrow(
      'above the 10.0 MB import limit'
    );
    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
  });

  it('rejects unreadable or empty files with ImportError', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: false });
    await expect(importTxtFromUri('file://gone.txt', 'gone.txt', defaults)).rejects.toThrow(
      'Could not access the selected text file.'
    );

    mockGetInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 4 });
    mockReadAsStringAsync.mockResolvedValue('   \n ');
    const emptyImport = importTxtFromUri('file://empty.txt', 'empty.txt', defaults);
    await expect(emptyImport).rejects.toThrow('This file is empty.');
    await expect(
      importTxtFromUri('file://empty.txt', 'empty.txt', defaults).catch((error) => error)
    ).resolves.toBeInstanceOf(ImportError);
  });
});

describe('importEpubFromUri', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    mockGetInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 4096 });
  });

  it('imports an EPUB with chapter boundaries and the package title', async () => {
    mockReadAsStringAsync.mockResolvedValue(await buildEpubBase64(simpleEpubFiles()));

    const { meta } = await importEpubFromUri('file://b.epub', 'fallback.epub', defaults);

    expect(meta.title).toBe('Fixture Book');
    expect(meta.sourceType).toBe('epub');
    expect(meta.chapters).toHaveLength(2);

    const [first, second] = meta.chapters!;
    expect(first.title).toBe('One');
    expect(second.title).toBe('Two');
    expect(first.startToken).toBe(0);
    // A paragraph-break token separates the two chapters.
    expect(second.startToken).toBe(first.endToken + 1);
    expect(meta.tokenCount).toBe(second.endToken);

    const chunk = await loadTokenChunk(meta.id, 0);
    expect(chunk).toContain('Alpha');
    expect(chunk).toContain('epsilon.');
  });

  it('propagates known validation errors verbatim', async () => {
    mockReadAsStringAsync.mockResolvedValue(
      await buildEpubBase64({ mimetype: 'application/epub+zip' })
    );

    const attempt = importEpubFromUri('file://b.epub', 'b.epub', defaults);
    await expect(attempt).rejects.toThrow('Invalid EPUB: META-INF/container.xml is missing.');
  });

  it('wraps unexpected parser failures in a friendly ImportError', async () => {
    mockReadAsStringAsync.mockResolvedValue('!!!definitely-not-a-zip!!!');

    const attempt = importEpubFromUri('file://b.epub', 'b.epub', defaults).catch((error) => error);
    const error = await attempt;
    expect(error).toBeInstanceOf(ImportError);
    expect(error.message).toBe(
      'Could not parse this EPUB. It may be corrupted or use unsupported formatting.'
    );
  });

  it('rejects EPUB files above the size limit without reading them', async () => {
    mockGetInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 26 * 1024 * 1024 });

    await expect(importEpubFromUri('file://big.epub', 'big.epub', defaults)).rejects.toThrow(
      'above the 25.0 MB import limit'
    );
    expect(mockReadAsStringAsync).not.toHaveBeenCalled();
  });
});

describe('createBookFromText', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('builds a book with a single full-text chapter', async () => {
    const { meta } = await createBookFromText('Sample Text', 'One two three.', 'txt', defaults);

    expect(meta.title).toBe('Sample Text');
    expect(meta.tokenCount).toBe(3);
    expect(meta.chapters).toEqual([{ title: 'Full Text', startToken: 0, endToken: 3 }]);
    expect(meta.preview).toBe('One two three.');
  });
});

describe('createBookFromSections', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
  });

  it('builds chapter boundaries from sections and skips empty ones', async () => {
    const { meta } = await createBookFromSections(
      'Sectioned',
      [
        { title: 'Intro', text: 'Hello there reader.' },
        { title: 'Empty', text: '   ' },
        { title: 'Body', text: 'Main content words.' },
      ],
      'txt',
      defaults
    );

    expect(meta.chapters?.map((chapter) => chapter.title)).toEqual(['Intro', 'Body']);
    const [intro, body] = meta.chapters!;
    expect(intro.startToken).toBe(0);
    // A paragraph-break token separates consecutive sections.
    expect(body.startToken).toBe(intro.endToken + 1);
    expect(meta.tokenCount).toBe(body.endToken);

    const chunk = await loadTokenChunk(meta.id, 0);
    expect(chunk).toEqual(['Hello', 'there', 'reader.', '\n', 'Main', 'content', 'words.']);
  });

  it('rejects when no section yields tokens', async () => {
    const attempt = createBookFromSections('Empty', [{ title: 'A', text: ' ' }], 'txt', defaults);
    await expect(attempt).rejects.toThrow('Could not parse readable text from this book.');
  });
});

describe('discardImportCopy', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deletes the picker cache copy idempotently', async () => {
    mockDeleteAsync.mockResolvedValue(undefined);
    await discardImportCopy('file://cache/book.epub');
    expect(mockDeleteAsync).toHaveBeenCalledWith('file://cache/book.epub', { idempotent: true });
  });

  it('swallows deletion failures', async () => {
    mockDeleteAsync.mockRejectedValue(new Error('locked'));
    await expect(discardImportCopy('file://cache/book.epub')).resolves.toBeUndefined();
  });
});

describe('validateImportName', () => {
  it('detects supported formats case-insensitively', () => {
    expect(validateImportName('book.TXT')).toBe('txt');
    expect(validateImportName('book.Epub')).toBe('epub');
    expect(validateImportName('book.pdf')).toBe('unsupported');
    expect(validateImportName('')).toBe('unsupported');
  });
});
