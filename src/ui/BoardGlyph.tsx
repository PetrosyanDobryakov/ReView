import { memo } from 'react';

// Procedural mini-board: dot-grid paper, a sticky, an ink squiggle and one doodle,
// all seeded from the board id so the same board always draws the same thumbnail.

function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const S = 40;
const f = (n: number) => Math.round(n * 10) / 10;

type Doodle = 'ring' | 'box' | 'arrow' | 'lines' | 'triangle';
const DOODLES: Doodle[] = ['ring', 'box', 'arrow', 'lines', 'triangle'];

function doodlePath(kind: Doodle, cx: number, cy: number, r: () => number): { d: string } {
  switch (kind) {
    case 'ring': {
      const rad = 4.5 + r() * 2;
      return { d: `M${f(cx - rad)} ${f(cy)}a${f(rad)} ${f(rad)} 0 1 0 ${f(rad * 2)} 0a${f(rad)} ${f(rad)} 0 1 0 ${f(-rad * 2)} 0` };
    }
    case 'box': {
      const w = 9 + r() * 3;
      const h = 7 + r() * 3;
      return { d: `M${f(cx - w / 2)} ${f(cy - h / 2)}h${f(w)}v${f(h)}h${f(-w)}z` };
    }
    case 'triangle': {
      const s = 6 + r() * 2;
      return { d: `M${f(cx)} ${f(cy - s)}L${f(cx + s)} ${f(cy + s * 0.7)}H${f(cx - s)}z` };
    }
    case 'arrow': {
      const dir = r() < 0.5 ? 1 : -1;
      const x0 = cx - 6 * dir;
      const x1 = cx + 6 * dir;
      const y0 = cy + 4;
      const y1 = cy - 4;
      return {
        d: `M${f(x0)} ${f(y0)}Q${f(cx - 2 * dir)} ${f(cy - 6)} ${f(x1)} ${f(y1)}M${f(x1 - 4.5 * dir)} ${f(y1 - 0.5)}L${f(x1)} ${f(y1)}L${f(x1 - 1.5 * dir)} ${f(y1 + 4.5)}`,
      };
    }
    case 'lines': {
      const w1 = 9 + r() * 4;
      const w2 = 5 + r() * 5;
      return { d: `M${f(cx - 6)} ${f(cy - 3)}h${f(w1)}M${f(cx - 6)} ${f(cy + 1.5)}h${f(w2)}M${f(cx - 6)} ${f(cy + 6)}h${f(w1 * 0.7)}` };
    }
  }
}

export const BoardGlyph = memo(function BoardGlyph({ id }: { id: string }) {
  const r = rng(seedOf(id));
  const hue = Math.floor(r() * 360);
  const hue2 = (hue + 140 + Math.floor(r() * 80)) % 360;

  // Sticky and doodle share one row, the ink squiggle runs across the other.
  const corner = Math.floor(r() * 4);
  const left = corner % 2 === 0;
  const top = corner < 2;
  const sw = 10 + r() * 3;
  const sx = left ? 5 + r() * 3 : S - 5 - sw - r() * 3;
  const sy = top ? 5 + r() * 3 : S - 5 - sw - r() * 3;
  const tilt = f((r() - 0.5) * 16);

  const dx = left ? 28 + r() * 2 : 12 - r() * 2;
  const dy = top ? 13 + r() * 2 : 27 - r() * 2;
  const doodle = doodlePath(DOODLES[Math.floor(r() * DOODLES.length)]!, dx, dy, r);

  // Squiggle: a smooth stroke that wanders from the free side of the sticky.
  const pts: Array<[number, number]> = [];
  const n = 3 + Math.floor(r() * 2);
  const startY = top ? S - 10 - r() * 2 : 10 + r() * 2;
  for (let i = 0; i <= n; i++) {
    const x = 7 + (i / n) * (S - 14);
    const y = startY + (r() - 0.5) * 8;
    pts.push([x, Math.max(6, Math.min(S - 6, y))]);
  }
  let ink = `M${f(pts[0]![0])} ${f(pts[0]![1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]!;
    const [x, y] = pts[i]!;
    const mx = (px + x) / 2;
    ink += `C${f(mx)} ${f(py)} ${f(mx)} ${f(y)} ${f(x)} ${f(y)}`;
  }

  const dots: string[] = [];
  for (let y = 5; y < S; y += 7.5) for (let x = 5; x < S; x += 7.5) dots.push(`M${f(x)} ${f(y)}h0`);

  return (
    <svg
      className="board-glyph"
      viewBox={`0 0 ${S} ${S}`}
      aria-hidden="true"
      style={{ '--g-h': hue, '--g-h2': hue2 } as React.CSSProperties}
    >
      <rect className="board-glyph-paper" x="0" y="0" width={S} height={S} rx="10" />
      <path className="board-glyph-dots" d={dots.join('')} />
      <g transform={`rotate(${tilt} ${f(sx + sw / 2)} ${f(sy + sw / 2)})`}>
        <rect className="board-glyph-sticky" x={f(sx)} y={f(sy)} width={f(sw)} height={f(sw)} rx="1.5" />
        <path className="board-glyph-sticky-fold" d={`M${f(sx + sw - 3.5)} ${f(sy + sw)}l3.5 -3.5v3.5z`} />
      </g>
      <path className="board-glyph-doodle" d={doodle.d} />
      <path className="board-glyph-ink" d={ink} />
    </svg>
  );
});
