import type { ShapeView } from './shapes';
import { arrowBounds } from './shapes';
import { shapeRotation, rotatedAabb } from './transform';
import { spansToPlain, parseStoredRich } from './richText';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function boxOf(v: ShapeView): { x: number; y: number; w: number; h: number } {
  if (v.type === 'arrow') return arrowBounds(v);
  return rotatedAabb(v);
}

export function shapesToSvg(
  views: ShapeView[],
  opts: { background: string | null; pad?: number; clip?: { x: number; y: number; w: number; h: number } }
): { svg: string; width: number; height: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  if (opts.clip) {
    minX = opts.clip.x;
    minY = opts.clip.y;
    maxX = opts.clip.x + opts.clip.w;
    maxY = opts.clip.y + opts.clip.h;
  } else {
    for (const v of views) {
      const b = boxOf(v);
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
  }
  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }
  const pad = opts.pad ?? 8;
  const width = Math.max(1, Math.ceil(maxX - minX + pad * 2));
  const height = Math.max(1, Math.ceil(maxY - minY + pad * 2));
  const ox = -minX + pad;
  const oy = -minY + pad;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
  );
  if (opts.background) {
    parts.push(`<rect width="100%" height="100%" fill="${esc(opts.background)}"/>`);
  }
  for (const v of views) {
    const rot = shapeRotation(v);
    const cx = v.x + v.w / 2 + ox;
    const cy = v.y + v.h / 2 + oy;
    const xf = rot ? ` transform="rotate(${rot} ${cx} ${cy})"` : '';
    const x = v.x + ox;
    const y = v.y + oy;
    const opacity = v.alpha !== undefined && v.alpha < 1 ? ` opacity="${v.alpha}"` : '';
    if (v.type === 'pen' && v.points && v.points.length >= 2) {
      const d: string[] = [];
      for (let i = 0; i < v.points.length; i += 2) {
        d.push(`${i === 0 ? 'M' : 'L'}${v.points[i] + ox} ${v.points[i + 1] + oy}`);
      }
      parts.push(
        `<path d="${d.join(' ')}" fill="none" stroke="${esc(v.stroke)}" stroke-width="${v.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${opacity}/>`
      );
      continue;
    }
    if (v.type === 'arrow' && v.points && v.points.length >= 4) {
      const [ax, ay, bx, by] = v.points;
      parts.push(
        `<line x1="${ax + ox}" y1="${ay + oy}" x2="${bx + ox}" y2="${by + oy}" stroke="${esc(v.stroke)}" stroke-width="${v.strokeWidth}" stroke-linecap="round"${opacity}/>`
      );
      continue;
    }
    if (v.type === 'ellipse') {
      parts.push(
        `<ellipse cx="${x + v.w / 2}" cy="${y + v.h / 2}" rx="${v.w / 2}" ry="${v.h / 2}" fill="${esc(v.fill)}" stroke="${esc(v.stroke)}" stroke-width="${v.strokeWidth}"${opacity}${xf}/>`
      );
    } else if (v.type === 'image' && v.src) {
      parts.push(
        `<image href="${esc(v.src)}" x="${x}" y="${y}" width="${v.w}" height="${v.h}"${opacity}${xf}/>`
      );
    } else if (v.type === 'text' || v.type === 'sticky') {
      const spans = parseStoredRich(v.text, v.richHtml, {
        bold: v.bold,
        italic: v.italic,
        underline: v.underline,
        strike: v.strike,
        highlight: v.highlight,
      });
      const plain = spansToPlain(spans);
      const fill = v.type === 'sticky' ? esc(v.fill) : 'none';
      if (v.type === 'sticky') {
        parts.push(
          `<rect x="${x}" y="${y}" width="${v.w}" height="${v.h}" rx="8" fill="${fill}" stroke="${esc(v.stroke)}"${opacity}${xf}/>`
        );
      }
      parts.push(
        `<text x="${x + 8}" y="${y + (v.fontSize ?? 18)}" font-size="${v.fontSize ?? 18}" fill="${esc(v.textColor ?? '#eceae4')}"${opacity}${xf}>${esc(plain)}</text>`
      );
    } else {
      parts.push(
        `<rect x="${x}" y="${y}" width="${v.w}" height="${v.h}" rx="6" fill="${esc(v.fill)}" stroke="${esc(v.stroke)}" stroke-width="${v.strokeWidth}"${opacity}${xf}/>`
      );
      if (v.text) {
        parts.push(
          `<text x="${x + v.w / 2}" y="${y + v.h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${v.fontSize ?? 14}" fill="${esc(v.textColor ?? '#1c1c1a')}"${xf}>${esc(v.text.split('\n')[0] ?? '')}</text>`
        );
      }
    }
  }
  parts.push('</svg>');
  return { svg: parts.join(''), width, height };
}

/** Build a one-page PDF that embeds a JPEG (DCT) image. No external deps. */
export function jpegToPdf(jpeg: Uint8Array, width: number, height: number): Uint8Array {
  const encoder = new TextEncoder();
  const objects: string[] = [];
  const add = (body: string) => {
    objects.push(body);
    return objects.length;
  };
  const imgObj = add(
    `<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`
  );
  // stream bytes appended later
  const contents = add(
    `<< /Length ${`q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`.length} >>\nstream\nq ${width} 0 0 ${height} 0 0 cm /Im0 Do Q\nendstream`
  );
  const resources = add(`<< /ProcSet [/PDF /ImageC] /XObject << /Im0 ${imgObj} 0 R >> >>`);
  const page = add(
    `<< /Type /Page /Parent 0 0 R /MediaBox [0 0 ${width} ${height}] /Contents ${contents} 0 R /Resources ${resources} 0 R >>`
  );
  const pages = add(`<< /Type /Pages /Kids [${page} 0 R] /Count 1 >>`);
  // fix parent ref in page
  objects[page - 1] = objects[page - 1].replace('/Parent 0 0 R', `/Parent ${pages} 0 R`);
  const catalog = add(`<< /Type /Catalog /Pages ${pages} 0 R >>`);

  const chunks: Uint8Array[] = [];
  const pushStr = (s: string) => chunks.push(encoder.encode(s));
  pushStr('%PDF-1.4\n');
  const offsets: number[] = [0];
  let offset = chunks.reduce((n, c) => n + c.length, 0);
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset);
    const id = i + 1;
    if (id === imgObj) {
      const head = `${id} 0 obj\n${objects[i]}`;
      pushStr(head);
      offset += encoder.encode(head).length;
      chunks.push(jpeg);
      offset += jpeg.length;
      pushStr('\nendstream\nendobj\n');
      offset += encoder.encode('\nendstream\nendobj\n').length;
    } else {
      const body = `${id} 0 obj\n${objects[i]}\nendobj\n`;
      pushStr(body);
      offset += encoder.encode(body).length;
    }
  }
  const xrefStart = offset;
  pushStr(`xref\n0 ${objects.length + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i++) {
    pushStr(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  pushStr(`trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefStart}\n%%EOF`);
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
