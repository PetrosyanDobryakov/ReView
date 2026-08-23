export const DEFAULT_BOARD_NAME = 'ReView';

const STORAGE_KEY = 'review-name';

let cached: string | null = null;
const listeners = new Set<(name: string) => void>();

function read(): string {
  if (cached === null) {
    try {
      cached = localStorage.getItem(STORAGE_KEY)?.trim() || DEFAULT_BOARD_NAME;
    } catch {
      cached = DEFAULT_BOARD_NAME;
    }
  }
  return cached;
}

export function getBoardName(): string {
  return read();
}

export function writeBoardName(raw: string): string {
  const next = raw.trim().slice(0, 40) || DEFAULT_BOARD_NAME;
  if (next !== cached) {
    cached = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* storage unavailable */
    }
    for (const l of [...listeners]) l(next);
  }
  return next;
}

export function onBoardNameChange(cb: (name: string) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
