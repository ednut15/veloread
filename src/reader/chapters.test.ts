import { findChapterIndex, normalizeChapters } from '@/src/reader/chapters';

describe('normalizeChapters', () => {
  it('returns empty for missing chapter data', () => {
    expect(normalizeChapters(undefined, 100)).toEqual([]);
    expect(normalizeChapters([], 100)).toEqual([]);
  });

  it('normalizes, sorts, and clamps invalid ranges', () => {
    const chapters = normalizeChapters(
      [
        { title: 'B', startToken: 50, endToken: 200 },
        { title: 'A', startToken: -4, endToken: 25 },
      ],
      100
    );

    expect(chapters).toEqual([
      { title: 'A', startToken: 0, endToken: 25 },
      { title: 'B', startToken: 50, endToken: 100 },
    ]);
  });

  it('deduplicates same start token and auto-fills title', () => {
    const chapters = normalizeChapters(
      [
        { title: '', startToken: 10, endToken: 15 },
        { title: 'Duplicate', startToken: 10, endToken: 17 },
      ],
      80
    );

    expect(chapters).toHaveLength(1);
    expect(chapters[0]).toEqual({ title: 'Chapter 1', startToken: 10, endToken: 15 });
  });
});

describe('findChapterIndex', () => {
  const chapters = [
    { title: 'Chapter 1', startToken: 0, endToken: 10 },
    { title: 'Chapter 2', startToken: 10, endToken: 20 },
    { title: 'Chapter 3', startToken: 20, endToken: 30 },
  ];

  it('returns -1 for empty chapter list', () => {
    expect(findChapterIndex([], 15)).toBe(-1);
  });

  it('returns nearest chapter index for token positions', () => {
    expect(findChapterIndex(chapters, 0)).toBe(0);
    expect(findChapterIndex(chapters, 9)).toBe(0);
    expect(findChapterIndex(chapters, 10)).toBe(1);
    expect(findChapterIndex(chapters, 25)).toBe(2);
  });
});
