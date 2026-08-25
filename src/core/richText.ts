/** Minimal rich-text helpers: HTML <-> plain, and canvas drawing of styled runs. */

export type RichStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  highlight?: boolean;
};

export type RichSpan = RichStyle & { text: string };

const BLOCK_TAGS = new Set(['DIV', 'P', 'BR', 'LI']);

/** Flatten contentEditable HTML into styled spans (newlines preserved). */
export function htmlToSpans(html: string): RichSpan[] {
  const root = document.createElement('div');
  root.innerHTML = html;
  const spans: RichSpan[] = [];
  const walk = (node: Node, style: RichStyle) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? '';
      if (text) spans.push({ ...style, text });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName;
    if (tag === 'BR') {
      spans.push({ ...style, text: '\n' });
      return;
    }
    const next: RichStyle = { ...style };
    if (tag === 'B' || tag === 'STRONG' || el.style.fontWeight === 'bold' || Number(el.style.fontWeight) >= 600) {
      next.bold = true;
    }
    if (tag === 'I' || tag === 'EM' || el.style.fontStyle === 'italic') next.italic = true;
    if (tag === 'U' || el.style.textDecoration.includes('underline')) next.underline = true;
    if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || el.style.textDecoration.includes('line-through')) {
      next.strike = true;
    }
    if (tag === 'MARK' || el.style.backgroundColor) next.highlight = true;
    if (BLOCK_TAGS.has(tag) && spans.length && !spans[spans.length - 1].text.endsWith('\n')) {
      // block boundary
    }
    for (const child of Array.from(el.childNodes)) walk(child, next);
    if (tag === 'DIV' || tag === 'P' || tag === 'LI') {
      if (!spans.length || !spans[spans.length - 1].text.endsWith('\n')) spans.push({ ...style, text: '\n' });
    }
  };
  for (const child of Array.from(root.childNodes)) walk(child, {});
  // trim trailing newline from final block
  while (spans.length && spans[spans.length - 1].text === '\n') spans.pop();
  if (spans.length && spans[spans.length - 1].text.endsWith('\n')) {
    spans[spans.length - 1] = {
      ...spans[spans.length - 1],
      text: spans[spans.length - 1].text.replace(/\n$/, ''),
    };
  }
  return spans.length ? spans : [{ text: '' }];
}

export function spansToPlain(spans: RichSpan[]): string {
  return spans.map((s) => s.text).join('');
}

export function plainToSpans(text: string, base: RichStyle = {}): RichSpan[] {
  return [{ ...base, text }];
}

export function spansToHtml(spans: RichSpan[]): string {
  return spans
    .map((s) => {
      let t = s.text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      if (s.bold) t = `<b>${t}</b>`;
      if (s.italic) t = `<i>${t}</i>`;
      if (s.underline) t = `<u>${t}</u>`;
      if (s.strike) t = `<s>${t}</s>`;
      if (s.highlight) t = `<mark>${t}</mark>`;
      return t;
    })
    .join('');
}

/** True when any span differs from the object-level style (needs rich path). */
export function spansAreRich(spans: RichSpan[], base: RichStyle): boolean {
  for (const s of spans) {
    if (Boolean(s.bold) !== Boolean(base.bold)) return true;
    if (Boolean(s.italic) !== Boolean(base.italic)) return true;
    if (Boolean(s.underline) !== Boolean(base.underline)) return true;
    if (Boolean(s.strike) !== Boolean(base.strike)) return true;
    if (Boolean(s.highlight) !== Boolean(base.highlight)) return true;
  }
  return spans.length > 1;
}

export function parseStoredRich(text: string | undefined, html: string | undefined, base: RichStyle): RichSpan[] {
  if (html && html.includes('<')) return htmlToSpans(html);
  return plainToSpans(text ?? '', base);
}

/** Draw wrapped rich spans. `fontFn` builds a CSS font string for a run. */
export function drawRichBlock(
  ctx: CanvasRenderingContext2D,
  spans: RichSpan[],
  originX: number,
  originY: number,
  maxWidth: number,
  opts: {
    fontSize: number;
    color: string;
    align: 'left' | 'center' | 'right';
    lineHeight: number;
    fontFn: (size: number, style: RichStyle) => string;
    highlightFill?: string;
    maxBottom?: number;
  }
): void {
  type Run = RichSpan;
  const paragraphs: Run[][] = [[]];
  for (const s of spans) {
    const parts = s.text.split('\n');
    for (let pi = 0; pi < parts.length; pi++) {
      if (pi > 0) paragraphs.push([]);
      if (parts[pi].length) paragraphs[paragraphs.length - 1].push({ ...s, text: parts[pi] });
    }
  }

  const measureRun = (run: Run) => {
    ctx.font = opts.fontFn(opts.fontSize, run);
    return ctx.measureText(run.text).width;
  };

  let y = originY;
  for (const para of paragraphs) {
    if (opts.maxBottom !== undefined && y > opts.maxBottom) break;
    const lines: Run[][] = [[]];
    let lineW = 0;
    const pushLine = () => {
      lines.push([]);
      lineW = 0;
    };
    for (const run of para) {
      const words = run.text.split(/(\s+)/);
      for (const word of words) {
        if (!word) continue;
        const piece: Run = { ...run, text: word };
        const w = measureRun(piece);
        if (lineW && lineW + w > maxWidth && !/^\s+$/.test(word)) {
          pushLine();
        }
        lines[lines.length - 1].push(piece);
        lineW += w;
      }
    }
    for (const line of lines) {
      if (opts.maxBottom !== undefined && y > opts.maxBottom) return;
      let w = 0;
      for (const r of line) w += measureRun(r);
      let x =
        opts.align === 'center'
          ? originX + (maxWidth - w) / 2
          : opts.align === 'right'
            ? originX + maxWidth - w
            : originX;
      for (const r of line) {
        ctx.font = opts.fontFn(opts.fontSize, r);
        const rw = ctx.measureText(r.text).width;
        if (r.highlight && opts.highlightFill) {
          ctx.fillStyle = opts.highlightFill;
          ctx.fillRect(x - 1, y - 1, rw + 2, opts.fontSize * 1.15);
        }
        ctx.fillStyle = opts.color;
        ctx.textBaseline = 'top';
        ctx.fillText(r.text, x, y);
        if (r.underline || r.strike) {
          ctx.strokeStyle = opts.color;
          ctx.lineWidth = Math.max(1, opts.fontSize / 16);
          if (r.underline) {
            const uy = y + opts.fontSize * 0.95;
            ctx.beginPath();
            ctx.moveTo(x, uy);
            ctx.lineTo(x + rw, uy);
            ctx.stroke();
          }
          if (r.strike) {
            const sy = y + opts.fontSize * 0.55;
            ctx.beginPath();
            ctx.moveTo(x, sy);
            ctx.lineTo(x + rw, sy);
            ctx.stroke();
          }
        }
        x += rw;
      }
      y += opts.lineHeight;
    }
  }
}
