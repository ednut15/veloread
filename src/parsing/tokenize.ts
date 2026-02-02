import { ImportProgress } from '@/src/types';

const TOKEN_REGEX =
  /[\p{L}\p{N}]+(?:[\-’'][\p{L}\p{N}]+)*(?:[.,!?;:…]+)?(?:[”"')\]}»]+)?|[([{“"«]+|[^\s]/gu;

const idle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tokenizeSegment(segment: string): string[] {
  const prepared = segment
    .replace(/\n{2,}/g, ' \n ')
    .replace(/\n/g, ' ')
    .trim();
  if (!prepared) return [];
  return prepared.match(TOKEN_REGEX) ?? [];
}

export function tokenize(text: string): string[] {
  return tokenizeSegment(normalizeText(text));
}

export async function tokenizeLargeText(
  text: string,
  onProgress?: (state: ImportProgress) => void
): Promise<string[]> {
  const normalized = normalizeText(text);
  if (!normalized) return [];

  const paragraphs = normalized.split(/\n\n+/);
  const tokens: string[] = [];

  for (let i = 0; i < paragraphs.length; i += 1) {
    const sectionTokens = tokenizeSegment(paragraphs[i]);
    tokens.push(...sectionTokens);

    if (i < paragraphs.length - 1) {
      tokens.push('\n');
    }

    if (i % 8 === 0) {
      onProgress?.({ phase: 'tokenizing', progress: (i + 1) / paragraphs.length });
      await idle();
    }
  }

  onProgress?.({ phase: 'tokenizing', progress: 1 });
  return tokens;
}

export function estimatedSeconds(tokenCount: number, wpm: number): number {
  return (tokenCount / Math.max(1, wpm)) * 60;
}

export function buildPreview(tokens: string[], maxTokens = 18): string {
  const preview = tokens.slice(0, maxTokens).join(' ');
  return preview.length > 180 ? `${preview.slice(0, 177)}...` : preview;
}
