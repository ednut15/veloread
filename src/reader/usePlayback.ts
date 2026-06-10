import { useEffect, useRef } from 'react';

type Params = {
  isPlaying: boolean;
  index: number;
  tokenCount: number;
  wpm: number;
  punctuationPauses: boolean;
  resolveToken: (index: number) => string | null;
  onAdvance: (index: number) => void;
  onFinished: () => void;
};

export function computeDelayMs(token: string, wpm: number, punctuationPauses: boolean): number {
  const baseMs = 60000 / Math.max(1, wpm);
  if (!punctuationPauses) return baseMs;

  let multiplier = 1;
  const softPauseToken = /[;,:]+[)"'\]}”»]*$/u;
  const hardPauseToken = /[.!?]+[)"'\]}”»]*$/u;
  const coreWord = token.replace(/[^\p{L}\p{N}]+/gu, '');

  if (token === '\n') multiplier += 1;
  else if (hardPauseToken.test(token)) multiplier += 0.7;
  else if (softPauseToken.test(token)) multiplier += 0.3;

  if (coreWord.length > 12) multiplier += 0.1;

  return baseMs * multiplier;
}

// Never schedule below roughly one frame.
export const MIN_DELAY_MS = 16;
// Chase at most this much accumulated lateness before resetting the pacing clock,
// so a long main-thread hiccup does not flash a burst of tokens.
export const MAX_DRIFT_MS = 250;
// Poll interval while a token chunk is still loading from storage.
export const STALL_RETRY_MS = 40;
// Give up and pause if a chunk never arrives (e.g. corrupted storage).
export const STALL_TIMEOUT_MS = 4000;

export function usePlayback({
  isPlaying,
  index,
  tokenCount,
  wpm,
  punctuationPauses,
  resolveToken,
  onAdvance,
  onFinished,
}: Params) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ideal display timestamp of the current token; the next advance is scheduled
  // relative to it so render/effect overhead does not slow the effective WPM.
  const shownAtRef = useRef<number | null>(null);
  // Index we advanced to from our own timer; a mismatch means an external jump.
  const expectedIndexRef = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    clear();

    if (!isPlaying) {
      shownAtRef.current = null;
      expectedIndexRef.current = null;
      return;
    }

    if (tokenCount <= 0 || index >= tokenCount) {
      onFinished();
      return;
    }

    // Jumps from outside playback (tap zones, slider, chapter buttons) restart the clock.
    if (expectedIndexRef.current !== index) {
      shownAtRef.current = null;
      expectedIndexRef.current = index;
    }

    let stallStartedAt: number | null = null;

    const schedule = () => {
      const token = resolveToken(index);

      if (token == null) {
        // The token's chunk is not cached yet (loads are async): wait for it
        // instead of mistaking the gap for the end of the book.
        const now = Date.now();
        if (stallStartedAt === null) stallStartedAt = now;
        if (now - stallStartedAt >= STALL_TIMEOUT_MS) {
          onFinished();
          return;
        }
        shownAtRef.current = null;
        timeoutRef.current = setTimeout(schedule, STALL_RETRY_MS);
        return;
      }

      const now = Date.now();
      const delayMs = computeDelayMs(token, wpm, punctuationPauses);
      let shownAt = shownAtRef.current;
      if (shownAt === null || now - shownAt > delayMs + MAX_DRIFT_MS) {
        shownAt = now;
        shownAtRef.current = now;
      }
      const fireAt = shownAt + delayMs;

      timeoutRef.current = setTimeout(() => {
        timeoutRef.current = null;
        shownAtRef.current = fireAt;
        expectedIndexRef.current = index + 1;
        onAdvance(index + 1);
      }, Math.max(MIN_DELAY_MS, fireAt - now));
    };

    schedule();
    return clear;
  }, [index, isPlaying, tokenCount, onAdvance, onFinished, punctuationPauses, resolveToken, wpm]);
}
