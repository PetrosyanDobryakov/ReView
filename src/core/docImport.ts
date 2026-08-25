/** Convert PDF/TXT files into page images (data URLs) for the 'doc' shape. */

export const DOC_MAX_PAGES = 60;
const PAGE_W = 1240;
const PAGE_H = 1754;

export class DocImportTruncatedError extends Error {
  readonly pages: string[];
  readonly ratio: number;
  constructor(pages: string[], ratio: number) {
    super('document truncated');
    this.name = 'DocImportTruncatedError';
    this.pages = pages;
    this.ratio = ratio;
  }
}

function pageCanvas(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = PAGE_W;
  c.height = PAGE_H;
  return c;
}

async function pdfPages(file: File): Promise<{ pages: string[]; truncated: boolean }> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  try {
    const truncated = pdf.numPages > DOC_MAX_PAGES;
    const count = Math.min(pdf.numPages, DOC_MAX_PAGES);
    const pages: string[] = [];
    for (let i = 1; i <= count; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1 });
      const scale = Math.min(PAGE_W / viewport.width, PAGE_H / viewport.height);
      const vp = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width);
      canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      pages.push(canvas.toDataURL('image/jpeg', 0.82));
    }
    return { pages, truncated };
  } finally {
    try {
      await pdf.destroy();
    } catch {
      /* ignore */
    }
  }
}

export interface DocPages {
  pages: string[];
  ratio: number;
  truncated?: boolean;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    if (!raw) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of raw.split(' ')) {
      if (ctx.measureText(word).width > maxWidth) {
        if (line) {
          lines.push(line);
          line = '';
        }
        let chunk = '';
        for (const ch of word) {
          const next = chunk + ch;
          if (chunk && ctx.measureText(next).width > maxWidth) {
            lines.push(chunk);
            chunk = ch;
          } else {
            chunk = next;
          }
        }
        line = chunk;
        continue;
      }
      const next = line ? line + ' ' + word : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

async function txtPages(file: File): Promise<DocPages> {
  const text = await file.text();
  const canvas = pageCanvas();
  const ctx = canvas.getContext('2d');
  if (!ctx) return { pages: [], ratio: PAGE_W / PAGE_H };
  const margin = 96;
  const font = '28px "Space Grotesk", Onest, "Segoe UI", system-ui, sans-serif';
  ctx.font = font;
  const lineHeight = 42;
  const maxLines = Math.floor((PAGE_H - margin * 2) / lineHeight);
  const lines = wrapText(ctx, text, PAGE_W - margin * 2);
  const pages: string[] = [];
  let truncated = false;
  for (let start = 0; start < lines.length || pages.length === 0; start += maxLines) {
    if (pages.length >= DOC_MAX_PAGES) {
      truncated = start < lines.length;
      break;
    }
    const chunk = lines.slice(start, start + maxLines);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    ctx.fillStyle = '#1c1c1a';
    ctx.font = font;
    ctx.textBaseline = 'top';
    chunk.forEach((line, i) => ctx.fillText(line, margin, margin + i * lineHeight));
    pages.push(canvas.toDataURL('image/png'));
    if (start + maxLines >= lines.length) break;
  }
  return { pages, ratio: PAGE_W / PAGE_H, truncated };
}

export async function fileToDocPages(file: File): Promise<DocPages> {
  const name = file.name.toLowerCase();
  const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
  const isTxt =
    name.endsWith('.txt') || file.type === 'text/plain' || (file.type.startsWith('text/') && !isPdf);
  if (!isPdf && !isTxt) {
    throw new Error('unsupported document type');
  }
  let pages: string[];
  let ratio = PAGE_W / PAGE_H;
  let truncated = false;
  if (isPdf) {
    const result = await pdfPages(file);
    pages = result.pages;
    truncated = result.truncated;
    ratio = await firstPageRatio(pages);
  } else {
    const txt = await txtPages(file);
    pages = txt.pages;
    ratio = txt.ratio;
    truncated = Boolean(txt.truncated);
  }
  return { pages, ratio, truncated };
}

async function firstPageRatio(pages: string[]): Promise<number> {
  if (!pages.length) return PAGE_W / PAGE_H;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth / img.naturalHeight || PAGE_W / PAGE_H);
    img.onerror = () => resolve(PAGE_W / PAGE_H);
    img.src = pages[0];
  });
}
