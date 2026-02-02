import { ChapterMeta } from '@/src/types';

export function normalizeChapters(chapters: ChapterMeta[] | undefined, tokenCount: number): ChapterMeta[] {
  if (!chapters?.length || tokenCount <= 0) return [];

  const sorted = chapters
    .map((chapter) => {
      const rawStart = Number(chapter.startToken);
      if (!Number.isFinite(rawStart)) return null;

      const rawEnd = Number(chapter.endToken);
      return {
        title: chapter.title,
        startToken: Math.max(0, Math.min(tokenCount - 1, Math.floor(rawStart))),
        endToken: Number.isFinite(rawEnd)
          ? Math.max(0, Math.min(tokenCount, Math.floor(rawEnd)))
          : tokenCount,
      };
    })
    .filter((chapter): chapter is { title: string; startToken: number; endToken: number } => Boolean(chapter))
    .sort((a, b) => a.startToken - b.startToken);

  const normalized: ChapterMeta[] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const chapter = sorted[i];
    const next = sorted[i + 1];
    if (normalized.length > 0 && normalized[normalized.length - 1].startToken === chapter.startToken) {
      continue;
    }

    const fallbackEnd = next ? next.startToken : tokenCount;
    const safeEnd = Math.max(chapter.startToken + 1, Math.min(tokenCount, chapter.endToken || fallbackEnd));
    const title = chapter.title?.trim() || `Chapter ${normalized.length + 1}`;
    normalized.push({
      title,
      startToken: chapter.startToken,
      endToken: safeEnd,
    });
  }

  return normalized;
}

export function findChapterIndex(chapters: ChapterMeta[], tokenIndex: number): number {
  if (!chapters.length) return -1;

  let low = 0;
  let high = chapters.length - 1;
  let best = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (chapters[mid].startToken <= tokenIndex) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}
