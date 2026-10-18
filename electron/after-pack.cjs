// electron-builder afterPack: unsigned macOS builds still need an ad-hoc
// signature, or Apple Silicon refuses to start the renamed Electron binary
// ("damaged"). Users then only clear quarantine (`xattr -cr`).

'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'darwin') return;
  const appPath = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
};
