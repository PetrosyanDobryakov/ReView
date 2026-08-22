import { useEffect, useState } from 'react';

export const MOTION = {
  press: 100,
  fast: 140,
  enter: 180,
  move: 220,
  sheet: 280,
  sheetOut: 160,
  overlay: 140,
} as const;

export function useExitPresence(open: boolean, durationMs: number) {
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const id = window.setTimeout(() => setMounted(false), durationMs);
    return () => window.clearTimeout(id);
  }, [open, durationMs]);

  return mounted;
}
