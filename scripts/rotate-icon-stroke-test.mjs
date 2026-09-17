/**
 * Guard: rotate-cw canvas stroke must stay zoom-stable (constant screen px).
 * Regression: multiplying camera `s` into viewBox lineWidth made world stroke ∝ s²
 * → bubbly / ghosted glyph when zoomed out.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  ROTATE_CW_ICON_RADIUS_SCALE,
  ROTATE_CW_STROKE,
  ROTATE_CW_VIEW,
  rotateCwScreenStrokePx,
} from '../src/core/rotateIcon.ts';

const iconSrc = readFileSync(
  fileURLToPath(new URL('../src/core/rotateIcon.ts', import.meta.url)),
  'utf8'
);
assert.match(iconSrc, /ROTATE_CW_STROKE\s*=\s*2/, 'fixed Lucide viewBox stroke');
assert.doesNotMatch(
  iconSrc,
  /lineWidth\s*=\s*Math\.max\(\s*1\.5\s*,\s*2\s*\*\s*/,
  'no camera-s lineWidth under path scale'
);

const hrScale = 4.25; // fine-pointer handleDrawRadiusScale()

function screenStrokeAtZoom(zoom) {
  const s = 1 / zoom;
  const radius = hrScale * s * ROTATE_CW_ICON_RADIUS_SCALE;
  return rotateCwScreenStrokePx(radius, s);
}

const near = screenStrokeAtZoom(1);
const mid = screenStrokeAtZoom(0.25);
const far = screenStrokeAtZoom(0.05);

assert.ok(near > 0, 'stroke at 100% zoom');
assert.ok(Math.abs(mid - near) < 1e-9, `mid zoom matches near (${mid} vs ${near})`);
assert.ok(Math.abs(far - near) < 1e-9, `far zoom matches near (${far} vs ${near})`);

// Expected Lucide geometry: stroke 2 in 24 viewBox over icon diameter 2*hr*scale
const expected = (ROTATE_CW_STROKE * (2 * hrScale * ROTATE_CW_ICON_RADIUS_SCALE)) / ROTATE_CW_VIEW;
assert.ok(Math.abs(near - expected) < 1e-9, `matches Lucide scale (${near} vs ${expected})`);

// Document the broken formula so we do not reintroduce it.
function brokenScreenStroke(zoom) {
  const s = 1 / zoom;
  const radius = hrScale * s * ROTATE_CW_ICON_RADIUS_SCALE;
  const pathScale = (radius * 2) / ROTATE_CW_VIEW;
  const worldStroke = Math.max(1.5, 2 * s) * pathScale; // old bug
  return worldStroke / s;
}
assert.ok(brokenScreenStroke(0.05) > brokenScreenStroke(1) * 5, 'old formula thickened at low zoom');

console.log('rotate-icon-stroke-test: ok', { screenPx: near, ROTATE_CW_STROKE, ROTATE_CW_VIEW });
