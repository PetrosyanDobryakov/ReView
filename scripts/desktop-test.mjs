/**
 * Desktop detection checks (browser-safe behavior).
 * Run: node --experimental-strip-types scripts/desktop-test.mjs
 */
import assert from 'node:assert/strict';
import { desktopBoardsDir, desktopDataDir, isDesktop } from '../src/core/desktop.ts';

// Outside Tauri everything degrades to false/null without throwing.
assert.equal(isDesktop(), false);
assert.equal(await desktopDataDir(), null);
assert.equal(await desktopBoardsDir(), null);

console.log('desktop-test: ok');
