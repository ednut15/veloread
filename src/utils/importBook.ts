import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { buildPreview, tokenizeLargeText } from '@/src/parsing/tokenize';
import { saveTokenChunks } from '@/src/storage';
import { DEFAULT_CHUNK_SIZE } from '@/src/storage/keys';
import { BookMeta, ImportProgress, ReadingState } from '@/src/types';

export type ImportCallbacks = {
  onProgress?: (state: ImportProgress) => void;
};

export type ImportedBook = {
  meta: BookMeta;
  initialState: ReadingState;
};

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

export async function importTxtFromUri(
  uri: string,
  title: string,
  defaults: Pick<ReadingState, 'wpm' | 'orpEnabled' | 'punctuationPauses'>,
  callbacks?: ImportCallbacks
): Promise<ImportedBook> {
  callbacks?.onProgress?.({ phase: 'reading', progress: 0.1 });
  const text = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
  callbacks?.onProgress?.({ phase: 'reading', progress: 1 });

  if (!text.trim()) {
    throw new Error('This file is empty.');
  }

  const tokens = await tokenizeLargeText(text, callbacks?.onProgress);
  if (!tokens.length) {
    throw new Error('Could not parse readable text from this file.');
  }

  const bookId = makeId();
  callbacks?.onProgress?.({ phase: 'saving', progress: 0.2 });
  const { chunkCount, chunkSize } = await saveTokenChunks(bookId, tokens, DEFAULT_CHUNK_SIZE);
  callbacks?.onProgress?.({ phase: 'saving', progress: 1 });

  const now = Date.now();
  const cleanTitle = title.replace(/\.[^.]+$/, '').trim() || 'Untitled';

  const meta: BookMeta = {
    id: bookId,
    title: cleanTitle,
    sourceType: 'txt',
    createdAt: now,
    updatedAt: now,
    textLength: text.length,
    tokenCount: tokens.length,
    chunkSize,
    chunkCount,
    preview: buildPreview(tokens),
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

export function validateImportName(name: string): 'txt' | 'epub' | 'unsupported' {
  return inferType(name);
}
