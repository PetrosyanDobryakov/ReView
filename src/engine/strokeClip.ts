/** Split a flat `[x,y,...]` stroke around erased vertex indices. */

export type StrokeSegment = {
  points: number[];
  pressures?: number[];
};

/** Keep runs of one or more vertices. A single leftover point is a valid ink dot. */
export function splitStrokeByErasedIndices(
  pts: number[],
  pressures: number[] | undefined,
  indices: Set<number>
): StrokeSegment[] {
  const segments: StrokeSegment[] = [];
  let cur: number[] = [];
  let curP: number[] = [];
  const vertexCount = Math.floor(pts.length / 2);

  const push = () => {
    if (cur.length < 2) return;
    const seg: StrokeSegment = { points: cur.slice() };
    if (curP.length) seg.pressures = curP.slice();
    segments.push(seg);
  };

  for (let i = 0; i < vertexCount; i++) {
    if (indices.has(i)) {
      push();
      cur = [];
      curP = [];
      continue;
    }
    cur.push(pts[i * 2]!, pts[i * 2 + 1]!);
    if (pressures?.length) curP.push(pressures[i] ?? 0.5);
  }
  push();
  return segments;
}
