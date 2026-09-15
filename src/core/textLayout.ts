/** Shared wrap / measure used by canvas `wrapText` and SVG export. */

export type MixedRun = { kind: 'text'; value: string } | { kind: 'formula'; value: string };

export function splitMixedRuns(text: string): MixedRun[] {
  const runs: MixedRun[] = [];
  const re = /\$([^$]+)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) runs.push({ kind: 'text', value: text.slice(last, m.index) });
    runs.push({ kind: 'formula', value: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ kind: 'text', value: text.slice(last) });
  return runs;
}

const WRAP_TOKEN = /(\$[^$]+\$|\s+)/;

function isAtomicFormula(text: string): boolean {
  return text.length >= 3 && text.startsWith('$') && text.endsWith('$') && !text.slice(1, -1).includes('$');
}

/** Words plus `$...$` formulas, keeping whether a space separated them. */
function wrapTokens(raw: string): Array<{ text: string; spaceBefore: boolean }> {
  const tokens: Array<{ text: string; spaceBefore: boolean }> = [];
  let spaceBefore = false;
  for (const part of raw.split(WRAP_TOKEN)) {
    if (!part) continue;
    if (/^\s+$/.test(part)) {
      spaceBefore = true;
      continue;
    }
    tokens.push({ text: part, spaceBefore });
    spaceBefore = false;
  }
  return tokens;
}

/** Wrap plain text to `maxWidth` using a width measure (canvas or estimate). */
export function wrapLinesByWidth(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  const splitOverlong = (word: string): string[] => {
    const chunks: string[] = [];
    let chunk = '';
    for (const char of word) {
      const next = chunk + char;
      if (chunk && measure(next) > maxWidth) {
        chunks.push(chunk);
        chunk = char;
      } else {
        chunk = next;
      }
    }
    if (chunk) chunks.push(chunk);
    return chunks;
  };
  const placeWord = (word: string): string => {
    if (measure(word) > maxWidth && !isAtomicFormula(word)) {
      const chunks = splitOverlong(word);
      lines.push(...chunks.slice(0, -1));
      return chunks.at(-1) ?? '';
    }
    return word;
  };
  for (const raw of text.split('\n')) {
    if (!raw) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const token of wrapTokens(raw)) {
      if (!line) {
        line = placeWord(token.text);
        continue;
      }
      const glue = token.spaceBefore ? ' ' : '';
      const test = `${line}${glue}${token.text}`;
      if (measure(test) > maxWidth) {
        lines.push(line);
        line = placeWord(token.text);
      } else {
        line = test;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function estimateTextWidth(
  text: string,
  fontSize: number,
  style?: { bold?: boolean; italic?: boolean }
): number {
  let w = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 32;
    if (ch === ' ') w += fontSize * 0.28;
    else if (code < 128) w += fontSize * 0.56;
    else w += fontSize;
  }
  if (style?.bold) w *= 1.06;
  void style?.italic;
  return w;
}

let measureCanvas: CanvasRenderingContext2D | null | undefined;

export function measureTextWidth(
  text: string,
  fontSize: number,
  style?: { bold?: boolean; italic?: boolean },
  fontFn?: (size: number, style: { bold?: boolean; italic?: boolean }) => string
): number {
  if (!text) return 0;
  try {
    if (typeof document !== 'undefined') {
      if (measureCanvas === undefined) {
        const c = document.createElement('canvas');
        measureCanvas = c.getContext('2d');
      }
      if (measureCanvas) {
        const font = fontFn
          ? fontFn(fontSize, style ?? {})
          : `${style?.italic ? 'italic' : 'normal'} ${style?.bold ? 700 : 400} ${fontSize}px sans-serif`;
        measureCanvas.font = font;
        return measureCanvas.measureText(text).width;
      }
    }
  } catch {
    /* node / private mode */
  }
  return estimateTextWidth(text, fontSize, style);
}

export function measureMixedWidth(
  text: string,
  measurePlain: (s: string) => number,
  formulaWidth?: (latex: string) => number | null
): number {
  let total = 0;
  const runs = splitMixedRuns(text);
  if (!runs.length) return measurePlain(text);
  for (const run of runs) {
    if (run.kind === 'formula') {
      const w = formulaWidth?.(run.value);
      total += w != null && w > 0 ? w : measurePlain(`$${run.value}$`);
    } else {
      total += measurePlain(run.value);
    }
  }
  return total;
}
