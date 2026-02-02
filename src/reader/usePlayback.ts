import { useEffect, useRef } from 'react';

type Params = {
  isPlaying: boolean;
  index: number;
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

export function usePlayback({
  isPlaying,
  index,
  wpm,
  punctuationPauses,
  resolveToken,
  onAdvance,
  onFinished,
}: Params) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (!isPlaying) return;

    const token = resolveToken(index);
    if (!token) {
      onFinished();
      return;
    }

    timeoutRef.current = setTimeout(() => {
      onAdvance(index + 1);
    }, computeDelayMs(token, wpm, punctuationPauses));

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [index, isPlaying, onAdvance, onFinished, punctuationPauses, resolveToken, wpm]);
}
