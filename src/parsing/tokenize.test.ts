import { buildPreview, estimatedSeconds, tokenize, tokenizeLargeText } from '@/src/parsing/tokenize';

describe('tokenize', () => {
  it('splits words while keeping punctuation attached', () => {
    expect(tokenize('Hello, world!')).toEqual(['Hello,', 'world!']);
  });

  it('normalizes repeated whitespace and blank lines', () => {
    expect(tokenize('One   two\n\n\nthree')).toEqual(['One', 'two', 'three']);
  });
});

describe('tokenizeLargeText', () => {
  it('inserts a newline token between paragraphs', async () => {
    const tokens = await tokenizeLargeText('Alpha first.\n\nBeta second.');
    expect(tokens).toEqual(['Alpha', 'first.', '\n', 'Beta', 'second.']);
  });

  it('reports tokenization progress', async () => {
    const progress: number[] = [];
    await tokenizeLargeText('One.\n\nTwo.\n\nThree.', (state) => {
      if (state.phase === 'tokenizing') progress.push(state.progress);
    });

    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(1);
  });
});

describe('estimatedSeconds', () => {
  it('calculates reading duration from token count and wpm', () => {
    expect(estimatedSeconds(600, 300)).toBe(120);
  });
});

describe('buildPreview', () => {
  it('truncates long previews', () => {
    const tokens = new Array(100).fill('word');
    const preview = buildPreview(tokens, 100);

    expect(preview.length).toBe(180);
    expect(preview.endsWith('...')).toBe(true);
  });
});
