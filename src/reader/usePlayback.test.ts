import { computeDelayMs } from '@/src/reader/usePlayback';

describe('computeDelayMs', () => {
  it('returns the base delay when punctuation pauses are disabled', () => {
    expect(computeDelayMs('word.', 300, false)).toBe(200);
  });

  it('adds a soft pause for commas/semicolons/colons', () => {
    expect(computeDelayMs('word,', 300, true)).toBeCloseTo(260, 3);
  });

  it('adds a hard pause for sentence-ending punctuation', () => {
    expect(computeDelayMs('word!', 300, true)).toBeCloseTo(340, 3);
  });

  it('adds an extra pause for newline tokens', () => {
    expect(computeDelayMs('\n', 300, true)).toBe(400);
  });

  it('adds extra time for long words', () => {
    expect(computeDelayMs('characteristically', 300, true)).toBeCloseTo(220, 3);
  });
});
