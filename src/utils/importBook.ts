import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { buildPreview, tokenize, tokenizeLargeText } from '@/src/parsing/tokenize';
import { saveTokenChunks } from '@/src/storage';
import { DEFAULT_CHUNK_SIZE } from '@/src/storage/keys';
import { BookMeta, ChapterMeta, ImportProgress, ReadingState } from '@/src/types';

export type ImportCallbacks = {
  onProgress?: (state: ImportProgress) => void;
};

export type ImportedBook = {
  meta: BookMeta;
  initialState: ReadingState;
};

type SpineSection = {
  path: string;
  titleHint: string | null;
};

type EpubSection = {
  title: string;
  text: string;
};

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  removeNSPrefix: true,
  trimValues: true,
});

const EPUB_TEXT_MEDIA_TYPES = new Set([
  'application/xhtml+xml',
  'application/xml',
  'text/html',
  'text/xml',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  apos: "'",
  copy: '©',
  gt: '>',
  hellip: '...',
  laquo: '<<',
  ldquo: '"',
  lsquo: "'",
  lt: '<',
  mdash: '--',
  nbsp: ' ',
  ndash: '-',
  quot: '"',
  raquo: '>>',
  rdquo: '"',
  rsquo: "'",
  trade: 'TM',
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

function toArray<T>(value: T | T[] | null | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }

  const record = asRecord(value);
  if (!record) return null;
  const fromText = readString(record['#text']);
  if (fromText) return fromText;
  return null;
}

function readAttribute(node: Record<string, unknown>, key: string): string | null {
  return readString(node[key]);
}

function decodeHtmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]+);/g, (_, entity: string) => {
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x';
      const raw = isHex ? entity.slice(2) : entity.slice(1);
      const code = Number.parseInt(raw, isHex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    }

    const named = NAMED_ENTITIES[entity.toLowerCase()];
    return named ?? `&${entity};`;
  });
}

function normalizeReadableText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function asInlineText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function htmlToText(markup: string): string {
  const stripped = markup
    .replace(/<\?xml[\s\S]*?\?>/gi, ' ')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<(br|hr)\b[^>]*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|blockquote|li|ul|ol|h[1-6]|table|tr|td|pre)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return normalizeReadableText(decodeHtmlEntities(stripped));
}

function extractMarkupTitle(markup: string): string | null {
  const patterns = [
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/i,
    /<title\b[^>]*>([\s\S]*?)<\/title>/i,
    /<h2\b[^>]*>([\s\S]*?)<\/h2>/i,
  ];

  for (const pattern of patterns) {
    const match = markup.match(pattern);
    if (!match?.[1]) continue;
    const stripped = decodeHtmlEntities(match[1].replace(/<[^>]+>/g, ' '));
    const title = asInlineText(stripped);
    if (title) return title.length > 120 ? `${title.slice(0, 117)}...` : title;
  }

  return null;
}

function fallbackChapterTitle(path: string, index: number): string {
  const fileName = path.split('/').pop() ?? '';
  const stem = fileName.replace(/\.[^.]+$/, '');
  const decoded = (() => {
    try {
      return decodeURIComponent(stem);
    } catch {
      return stem;
    }
  })();

  const readable = asInlineText(decoded.replace(/[_-]+/g, ' '));
  if (readable) return readable;
  return `Chapter ${index + 1}`;
}

function resolvePath(baseDir: string, relative: string): string {
  const withNoFragment = relative.split('#')[0]?.split('?')[0] ?? '';
  let raw = withNoFragment;
  try {
    raw = decodeURIComponent(withNoFragment);
  } catch {
    raw = withNoFragment;
  }
  const joined = baseDir ? `${baseDir}/${raw}` : raw;
  const parts = joined.replace(/\\/g, '/').split('/');
  const output: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      output.pop();
      continue;
    }
    output.push(part);
  }

  return output.join('/');
}

function getZipTextFile(zip: JSZip, path: string): Promise<string | null> {
  const normalized = path.replace(/\\/g, '/');
  const exact = zip.file(normalized);
  if (exact) {
    return exact.async('string');
  }

  const targetLower = normalized.toLowerCase();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir && name.toLowerCase() === targetLower) {
      return entry.async('string');
    }
  }

  return Promise.resolve(null);
}

async function loadPackagePath(zip: JSZip): Promise<string> {
  const containerXml = await getZipTextFile(zip, 'META-INF/container.xml');
  if (!containerXml) {
    throw new Error('Invalid EPUB: META-INF/container.xml is missing.');
  }

  const parsed = xmlParser.parse(containerXml) as Record<string, unknown>;
  const container = asRecord(parsed.container);
  const rootfiles = asRecord(container?.rootfiles);
  const rootfileList = toArray(rootfiles?.rootfile);

  for (const rootfile of rootfileList) {
    const node = asRecord(rootfile);
    if (!node) continue;
    const fullPath = readAttribute(node, 'full-path');
    if (fullPath) return fullPath;
  }

  throw new Error('Invalid EPUB: package document path not found.');
}

function isReadableManifestItem(mediaType: string | null): boolean {
  if (!mediaType) return false;
  return EPUB_TEXT_MEDIA_TYPES.has(mediaType.toLowerCase());
}

function extractSpineDocumentPaths(opfXml: string, opfPath: string): {
  title: string | null;
  sections: SpineSection[];
} {
  const parsed = xmlParser.parse(opfXml) as Record<string, unknown>;
  const pkg = asRecord(parsed.package);
  if (!pkg) {
    throw new Error('Invalid EPUB: malformed package document.');
  }

  const metadata = asRecord(pkg.metadata);
  const title =
    readString(metadata?.title) ??
    readString(metadata?.['dc:title']) ??
    toArray(metadata?.title).map(readString).find(Boolean) ??
    null;

  const manifestNode = asRecord(pkg.manifest);
  const manifestItems = toArray(manifestNode?.item);
  const manifestById = new Map<
    string,
    { href: string; mediaType: string | null; titleHint: string | null; isNav: boolean }
  >();

  for (const item of manifestItems) {
    const node = asRecord(item);
    if (!node) continue;
    const id = readAttribute(node, 'id');
    const href = readAttribute(node, 'href');
    const mediaType = readAttribute(node, 'media-type');
    const properties = readAttribute(node, 'properties');
    const titleHint = readAttribute(node, 'title');
    const isNav = Boolean(properties?.split(/\s+/).includes('nav'));
    if (!id || !href) continue;
    manifestById.set(id, { href, mediaType, titleHint, isNav });
  }

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/')) : '';
  const spineNode = asRecord(pkg.spine);
  const spineRefs = toArray(spineNode?.itemref);
  const orderedSections: SpineSection[] = [];
  const seen = new Set<string>();

  for (const itemref of spineRefs) {
    const node = asRecord(itemref);
    if (!node) continue;
    const idref = readAttribute(node, 'idref');
    if (!idref) continue;
    const manifestItem = manifestById.get(idref);
    if (!manifestItem || manifestItem.isNav || !isReadableManifestItem(manifestItem.mediaType)) continue;
    const resolved = resolvePath(opfDir, manifestItem.href);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    orderedSections.push({ path: resolved, titleHint: manifestItem.titleHint });
  }

  if (orderedSections.length > 0) {
    return { title, sections: orderedSections };
  }

  for (const manifestItem of manifestById.values()) {
    if (manifestItem.isNav || !isReadableManifestItem(manifestItem.mediaType)) continue;
    const resolved = resolvePath(opfDir, manifestItem.href);
    if (!resolved || seen.has(resolved)) continue;
    seen.add(resolved);
    orderedSections.push({ path: resolved, titleHint: manifestItem.titleHint });
  }

  return { title, sections: orderedSections };
}

async function extractEpubSections(
  base64Epub: string,
  onProgress?: (progress: number) => void
): Promise<{ title: string | null; sections: EpubSection[] }> {
  onProgress?.(0.2);
  const zip = await JSZip.loadAsync(base64Epub, { base64: true });
  onProgress?.(0.4);

  const packagePath = await loadPackagePath(zip);
  const opfXml = await getZipTextFile(zip, packagePath);
  if (!opfXml) {
    throw new Error('Invalid EPUB: package document could not be read.');
  }

  const { title, sections } = extractSpineDocumentPaths(opfXml, packagePath);
  if (!sections.length) {
    throw new Error('This EPUB does not contain readable chapter documents.');
  }

  const extractedSections: EpubSection[] = [];
  for (let i = 0; i < sections.length; i += 1) {
    const section = sections[i];
    const markup = await getZipTextFile(zip, section.path);
    if (!markup) continue;
    const sectionText = htmlToText(markup);
    const sectionTitle =
      extractMarkupTitle(markup) ??
      (section.titleHint ? asInlineText(section.titleHint) : null) ??
      fallbackChapterTitle(section.path, i);

    if (sectionText) {
      extractedSections.push({
        title: sectionTitle,
        text: sectionText,
      });
    }

    const progress = 0.4 + ((i + 1) / sections.length) * 0.6;
    onProgress?.(Math.min(1, progress));
  }

  return { title, sections: extractedSections };
}

function sanitizeTitle(title: string): string {
  return title.replace(/\.[^.]+$/, '').trim() || 'Untitled';
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
  const cleanTitle = sanitizeTitle(title);

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
    chapters: [
      {
        title: 'Full Text',
        startToken: 0,
        endToken: tokens.length,
      },
    ],
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

export async function importEpubFromUri(
  uri: string,
  title: string,
  defaults: Pick<ReadingState, 'wpm' | 'orpEnabled' | 'punctuationPauses'>,
  callbacks?: ImportCallbacks
): Promise<ImportedBook> {
  callbacks?.onProgress?.({ phase: 'reading', progress: 0.05 });
  const base64Epub = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const extracted = await extractEpubSections(base64Epub, (progress) => {
    callbacks?.onProgress?.({ phase: 'reading', progress });
  });

  if (!extracted.sections.length) {
    throw new Error('Could not extract readable text from this EPUB.');
  }

  const idle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
  const tokens: string[] = [];
  const chapters: ChapterMeta[] = [];
  let textLength = 0;

  for (let i = 0; i < extracted.sections.length; i += 1) {
    const section = extracted.sections[i];
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

      if (i < extracted.sections.length - 1) {
        tokens.push('\n');
        textLength += 2;
      }

      textLength += section.text.length;
    }
    callbacks?.onProgress?.({
      phase: 'tokenizing',
      progress: (i + 1) / extracted.sections.length,
    });

    if (i % 6 === 0) {
      await idle();
    }
  }

  if (!tokens.length) {
    throw new Error('Could not parse readable text from this EPUB.');
  }

  const bookId = makeId();
  callbacks?.onProgress?.({ phase: 'saving', progress: 0.2 });
  const { chunkCount, chunkSize } = await saveTokenChunks(bookId, tokens, DEFAULT_CHUNK_SIZE);
  callbacks?.onProgress?.({ phase: 'saving', progress: 1 });

  const now = Date.now();
  const cleanTitle = sanitizeTitle(extracted.title ?? title);

  const meta: BookMeta = {
    id: bookId,
    title: cleanTitle,
    sourceType: 'epub',
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

export function validateImportName(name: string): 'txt' | 'epub' | 'unsupported' {
  return inferType(name);
}
