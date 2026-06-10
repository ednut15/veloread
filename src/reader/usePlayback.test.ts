import { act, renderHook } from '@testing-library/react-native';
import {
  STALL_RETRY_MS,
  STALL_TIMEOUT_MS,
  computeDelayMs,
  usePlayback,
} from '@/src/reader/usePlayback';

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

describe('usePlayback', () => {
  type HookProps = Parameters<typeof usePlayback>[0];

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // wpm 300 with pauses disabled => a flat 200ms per token.
  const makeProps = (overrides: Partial<HookProps> = {}): HookProps => ({
    isPlaying: true,
    index: 0,
    tokenCount: 100,
    wpm: 300,
    punctuationPauses: false,
    resolveToken: (index: number) => (index < 100 ? `word${index}` : null),
    onAdvance: jest.fn(),
    onFinished: jest.fn(),
    ...overrides,
  });

  it('advances after the computed delay', () => {
    const props = makeProps();
    renderHook((p: HookProps) => usePlayback(p), { initialProps: props });

    act(() => {
      jest.advanceTimersByTime(199);
    });
    expect(props.onAdvance).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(props.onAdvance).toHaveBeenCalledWith(1);
  });

  it('schedules against the ideal timeline so render overhead does not slow the pace', () => {
    const props = makeProps();
    const { rerender } = renderHook((p: HookProps) => usePlayback(p), { initialProps: props });

    act(() => {
      jest.advanceTimersByTime(200); // token 0 fires, onAdvance(1)
    });
    act(() => {
      jest.advanceTimersByTime(60); // simulate 60ms of re-render overhead
    });
    rerender({ ...props, index: 1 });

    // The next advance is due 200ms after the ideal display time, i.e. 140ms from now.
    act(() => {
      jest.advanceTimersByTime(139);
    });
    expect(props.onAdvance).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(props.onAdvance).toHaveBeenLastCalledWith(2);
  });

  it('keeps the remaining delay when unrelated re-renders happen mid-token', () => {
    const props = makeProps();
    const { rerender } = renderHook((p: HookProps) => usePlayback(p), { initialProps: props });

    act(() => {
      jest.advanceTimersByTime(120);
    });
    // New callback identities (as a screen re-render produces) re-run the effect.
    rerender({ ...props, resolveToken: (index: number) => (index < 100 ? `word${index}` : null) });

    act(() => {
      jest.advanceTimersByTime(79);
    });
    expect(props.onAdvance).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(props.onAdvance).toHaveBeenCalledWith(1);
  });

  it('restarts the pacing clock after an external jump', () => {
    const props = makeProps();
    const { rerender } = renderHook((p: HookProps) => usePlayback(p), { initialProps: props });

    act(() => {
      jest.advanceTimersByTime(200); // playback advanced to index 1
    });
    act(() => {
      jest.advanceTimersByTime(150);
    });
    rerender({ ...props, index: 50 }); // slider/tap jump, not the playback advance

    act(() => {
      jest.advanceTimersByTime(199);
    });
    expect(props.onAdvance).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(props.onAdvance).toHaveBeenLastCalledWith(51);
  });

  it('waits for a missing chunk instead of finishing', () => {
    let loaded = false;
    const props = makeProps({
      resolveToken: (index: number) => (loaded ? `word${index}` : null),
    });
    renderHook((p: HookProps) => usePlayback(p), { initialProps: props });

    act(() => {
      jest.advanceTimersByTime(STALL_RETRY_MS * 5);
    });
    expect(props.onFinished).not.toHaveBeenCalled();
    expect(props.onAdvance).not.toHaveBeenCalled();

    loaded = true;
    act(() => {
      jest.advanceTimersByTime(STALL_RETRY_MS); // retry finds the token
    });
    act(() => {
      jest.advanceTimersByTime(200); // then a normal delay
    });
    expect(props.onAdvance).toHaveBeenCalledWith(1);
    expect(props.onFinished).not.toHaveBeenCalled();
  });

  it('gives up and finishes if a chunk never arrives', () => {
    const props = makeProps({ resolveToken: () => null });
    renderHook((p: HookProps) => usePlayback(p), { initialProps: props });

    act(() => {
      jest.advanceTimersByTime(STALL_TIMEOUT_MS + STALL_RETRY_MS * 2);
    });
    expect(props.onFinished).toHaveBeenCalledTimes(1);
    expect(props.onAdvance).not.toHaveBeenCalled();
  });

  it('finishes when the index reaches the end of the book', () => {
    const props = makeProps({ index: 100 });
    renderHook((p: HookProps) => usePlayback(p), { initialProps: props });
    expect(props.onFinished).toHaveBeenCalledTimes(1);
  });

  it('does nothing while paused', () => {
    const props = makeProps({ isPlaying: false });
    renderHook((p: HookProps) => usePlayback(p), { initialProps: props });

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(props.onAdvance).not.toHaveBeenCalled();
    expect(props.onFinished).not.toHaveBeenCalled();
  });
});
