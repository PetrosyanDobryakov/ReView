import pkg from '../../package.json';

export const APP_VERSION: string = pkg.version;

export const RELEASES_URL = 'https://github.com/PetrosyanDobryakov/ReView/releases/latest';

function parseVer(v: string): number[] {
  const m = v.trim().replace(/^v/i, '').match(/\d+(\.\d+)*/);
  if (!m) return [];
  return m[0].split('.').map(Number);
}

export function compareVersions(a: string, b: string): number {
  const pa = parseVer(a);
  const pb = parseVer(b);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

export type VersionStatus =
  | { kind: 'latest' }
  | { kind: 'outdated'; latest: string }
  | { kind: 'dev' }
  | { kind: 'unknown' };

/**
 * Compare the running app version with GitHub releases.
 * - older than the newest release → 'outdated'
 * - not among published releases (unreleased or newer) → 'dev'
 * - equals the newest release → 'latest'
 */
export async function checkAppVersion(): Promise<VersionStatus> {
  try {
    const res = await fetch('https://api.github.com/repos/PetrosyanDobryakov/ReView/releases?per_page=100', {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return { kind: 'unknown' };
    const list = (await res.json()) as Array<{ tag_name?: string }>;
    const versions = list.map((r) => r.tag_name ?? '').filter(Boolean);
    if (!versions.length) return { kind: 'unknown' };
    let latest = versions[0];
    for (const v of versions) if (compareVersions(v, latest) > 0) latest = v;
    if (compareVersions(APP_VERSION, latest) < 0) return { kind: 'outdated', latest };
    if (versions.some((v) => compareVersions(v, APP_VERSION) === 0)) return { kind: 'latest' };
    return { kind: 'dev' };
  } catch {
    return { kind: 'unknown' };
  }
}
