import assert from 'node:assert/strict';

/** Mirror of contrast helpers in src/core/shapes.ts — keep in sync. */
function relativeLuminance(hex) {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = lin(parseInt(hex.slice(1, 3), 16));
  const g = lin(parseInt(hex.slice(3, 5), 16));
  const b = lin(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la == null || lb == null) return null;
  const light = Math.max(la, lb);
  const dark = Math.min(la, lb);
  return (light + 0.05) / (dark + 0.05);
}

function themeFor(bg) {
  if (!/^#[0-9a-fA-F]{6}$/.test(bg)) return { text: '#eceae4' };
  const r = parseInt(bg.slice(1, 3), 16);
  const g = parseInt(bg.slice(3, 5), 16);
  const b = parseInt(bg.slice(5, 7), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5 ? { text: '#1c1c1a' } : { text: '#eceae4' };
}

const MIN_BOARD_TEXT_CONTRAST = 4.5;

function readableTextOn(fg, bg) {
  const ratio = contrastRatio(fg, bg);
  if (ratio == null || ratio >= MIN_BOARD_TEXT_CONTRAST) return fg;
  return themeFor(bg).text;
}

const DARK_BG = '#1c1c1a';
const LIGHT_BG = '#f4f4f5';
const PACKET_BG = '#242422';

assert.ok((contrastRatio('#6b6b66', DARK_BG) ?? 99) < MIN_BOARD_TEXT_CONTRAST);
assert.ok((contrastRatio('#1c1c1a', DARK_BG) ?? 99) < MIN_BOARD_TEXT_CONTRAST);
assert.equal(readableTextOn('#6b6b66', DARK_BG), '#eceae4');
assert.equal(readableTextOn('#1c1c1a', DARK_BG), '#eceae4');
assert.equal(readableTextOn('#6b6b66', PACKET_BG), '#eceae4');
assert.equal(readableTextOn('#eceae4', DARK_BG), '#eceae4');
assert.equal(readableTextOn('#ffe27a', DARK_BG), '#ffe27a');

assert.ok((contrastRatio('#eceae4', LIGHT_BG) ?? 99) < MIN_BOARD_TEXT_CONTRAST);
assert.equal(readableTextOn('#eceae4', LIGHT_BG), '#1c1c1a');
assert.equal(readableTextOn('#1c1c1a', LIGHT_BG), '#1c1c1a');
assert.ok((contrastRatio('#6b6b66', LIGHT_BG) ?? 0) >= MIN_BOARD_TEXT_CONTRAST);
assert.equal(readableTextOn('#6b6b66', LIGHT_BG), '#6b6b66');

assert.ok((contrastRatio('#3a2f00', '#ffe27a') ?? 0) >= MIN_BOARD_TEXT_CONTRAST);

console.log('textContrast: all checks passed');
