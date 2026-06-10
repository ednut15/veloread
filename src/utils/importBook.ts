import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { buildPreview, tokenize, tokenizeLargeText } from '@/src/parsing/tokenize';
import { saveTokenChunks } from '@/src/storage';
import { DEFAULT_CHUNK_SIZE } from '@/src/storage/keys';
import { BookMeta, ChapterMeta, ImportProgress, ReadingState, SourceType } from '@/src/types';
import { EpubSection, extractEpubSections } from '@/src/utils/epub';
import { ImportError } from '@/src/utils/errors';

export type ImportCallbacks = {
  onProgress?: (state: ImportProgress) => void;
};

export type ImportedBook = {
  meta: BookMeta;
  initialState: ReadingState;
};

export type BookSection = {
  title: string;
  text: string;
};

// Guardrails to avoid memory pressure from very large files.
const MAX_EPUB_FILE_BYTES = 25 * 1024 * 1024;
const MAX_TXT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_TOKEN_COUNT = 1000000;

function makeId() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function inferType(name: string): 'txt' | 'epub' | 'unsupported' {
  const lower = name.toLowerCase();
  if (lower.endsWith('.txt')) return 'txt';
  if (lower.endsWith('.epub')) return 'epub';
  return 'unsupported';
}

export async function pickBookFile() {
  const result = await DocumentPicker.getDocumentAsync({
    multiple: false,
    copyToCacheDirectory: true,
    type: ['text/plain', 'application/epub+zip', 'application/octet-stream'],
  });

  if (result.canceled) return null;
  return result.assets?.[0] ?? null;
}

/**
 * Remove the temporary cache copy created by the document picker once the
 * import is over, so failed or repeated imports do not accumulate files.
 */
export async function discardImportCopy(uri: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {
    // Best effort only; the OS clears the cache directory eventually.
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sanitizeTitle(title: string): string {
  return title.replace(/\.[^.]+$/, '').trim() || 'Untitled';
}

type AssembleParams = {
  title: string;
  sourceType: SourceType;
  tokens: string[];
  textLength: number;
  chapters: ChapterMeta[];
  defaults: Pick<ReadingState, 'wpm' | 'orpEnabled' | 'punctuationPauses'>;
  callbacks?: ImportCallbacks;
};

async function assembleBook({
  title,
  sourceType,
  tokens,
  textLength,
  chapters,
  defaults,
  callbacks,
}: AssembleParams): Promise<ImportedBook> {
  const bookId = makeId();
  callbacks?.onProgress?.({ phase: 'saving', progress: 0.2 });
  const { chunkCount, chunkSize } = await saveTokenChunks(bookId, tokens, DEFAULT_CHUNK_SIZE);
  callbacks?.onProgress?.({ phase: 'saving', progress: 1 });

  const now = Date.now();

  const meta: BookMeta = {
    id: bookId,
    title: sanitizeTitle(title),
    sourceType,
    createdAt: now,
    updatedAt: now,
    textLength,
    tokenCount: tokens.length,
    chunkSize,
    chunkCount,
    preview: buildPreview(tokens),
    chapters,
    lastOpenedAt: now,
  };

  const initialState: ReadingState = {
    bookId,
    index: 0,
    wpm: defaults.wpm,
    orpEnabled: defaults.orpEnabled,
    punctuationPauses: defaults.punctuationPauses,
    lastReadAt: now,
  };

  return { meta, initialState };
}

export async function createBookFromSections(
  title: string,
  sections: BookSection[],
  sourceType: SourceType,
  defaults: Pick<ReadingState, 'wpm' | 'orpEnabled' | 'punctuationPauses'>,
  callbacks?: ImportCallbacks
): Promise<ImportedBook> {
  const idle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const tokens: string[] = [];
  const chapters: ChapterMeta[] = [];
  let textLength = 0;

  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    const sectionTokens = tokenize(section.text);
    if (sectionTokens.length) {
      const startToken = tokens.length;
      tokens.push(...sectionTokens);
      const endToken = tokens.length;
      chapters.push({
        title: section.title || `Chapter ${chapters.length + 1}`,
        startToken,
        endToken,
      });

      if (i < sections.length - 1) {
        tokens.push('\n');
        textLength += 2;
      }

      textLength += section.text.length;
    }

    if (tokens.length > MAX_IMPORT_TOKEN_COUNT) {
      throw new ImportError('This book contains too many words/tokens to import safely.');
    }

    callbacks?.onProgress?.({
      phase: 'tokenizing',
      progress: (i + 1) / sections.length,
    });

    if (i % 6 === 0) {
      await idle();
    }
  }

  if (!tokens.length) {
    throw new ImportError('Could not parse readable text from this book.');
  }

  return assembleBook({
    title,
    sourceType,
    tokens,
    textLength,
    chapters,
    defaults,
    callbacks,
  });
}

export async function createBookFromText(
  title: string,
  text: string,
  sourceType: SourceType,
  defaults: Pick<ReadingState, 'wpm' | 'orpEnabled' | 'punctuationPauses'>,
  callbacks?: ImportCallbacks
): Promise<ImportedBook> {
  if (!text.trim()) {
    throw new ImportError('This file is empty.');
  }

  const tokens = await tokenizeLargeText(text, callbacks?.onProgress);
  if (!tokens.length) {
    throw new ImportError('Could not parse readable text from this file.');
  }
  if (tokens.length > MAX_IMPORT_TOKEN_COUNT) {
    throw new ImportError('This file contains too many words/tokens to import safely.');
  }

  return assembleBook({
    title,
    sourceType,
    tokens,
    textLength: text.length,
    chapters: [
      {
        title: 'Full Text',
        startToken: 0,
        endToken: tokens.length,
      },
    ],
    defaults,
    callbacks,
  });
}

export async function importTxtFromUri(
  uri: string,
  title: string,
  defaults: Pick<ReadingState, 'wpm' | 'orpEnabled' | 'punctuationPauses'>,
  callbacks?: ImportCallbacks
): Promise<ImportedBook> {
  callbacks?.onProgress?.({ phase: 'reading', progress: 0.1 });
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || info.isDirectory) {
    throw new ImportError('Could not access the selected text file.');
  }
  if (typeof info.size === 'number' && info.size > MAX_TXT_FILE_BYTES) {
    throw new ImportError(
      `This file is ${formatBytes(info.size)}, above the ${formatBytes(MAX_TXT_FILE_BYTES)} import limit.`
    );
  }

  const text = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
  callbacks?.onProgress?.({ phase: 'reading', progress: 1 });

  return createBookFromText(title, text, 'txt', defaults, callbacks);
}

export async function importEpubFromUri(
  uri: string,
  title: string,
  defaults: Pick<ReadingState, 'wpm' | 'orpEnabled' | 'punctuationPauses'>,
  callbacks?: ImportCallbacks
): Promise<ImportedBook> {
  callbacks?.onProgress?.({ phase: 'reading', progress: 0.05 });
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    throw new ImportError('Could not access the selected EPUB file.');
  }
  if (info.isDirectory) {
    throw new ImportError('The selected file is not a valid EPUB document.');
  }
  if (typeof info.size === 'number' && info.size > MAX_EPUB_FILE_BYTES) {
    throw new ImportError(
      `This EPUB is ${formatBytes(info.size)}, above the ${formatBytes(MAX_EPUB_FILE_BYTES)} import limit.`
    );
  }

  let base64Epub = '';
  try {
    base64Epub = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch {
    throw new ImportError('Could not load this EPUB. It may be too large for available memory.');
  }
  const estimatedBytes = Math.floor((base64Epub.length * 3) / 4);
  if (estimatedBytes > MAX_EPUB_FILE_BYTES) {
    throw new ImportError(
      `This EPUB is ${formatBytes(estimatedBytes)}, above the ${formatBytes(MAX_EPUB_FILE_BYTES)} import limit.`
    );
  }

  let extracted: { title: string | null; sections: EpubSection[] };
  try {
    extracted = await extractEpubSections(base64Epub, (progress) => {
      callbacks?.onProgress?.({ phase: 'reading', progress });
    });
  } catch (error) {
    if (error instanceof ImportError) {
      throw error;
    }
    throw new ImportError('Could not parse this EPUB. It may be corrupted or use unsupported formatting.');
  }

  if (!extracted.sections.length) {
    throw new ImportError('Could not extract readable text from this EPUB.');
  }

  return createBookFromSections(extracted.title ?? title, extracted.sections, 'epub', defaults, callbacks);
}

export function validateImportName(name: string): 'txt' | 'epub' | 'unsupported' {
  return inferType(name);
}
