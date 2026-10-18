import pkg from '../../package.json';

declare const __REVIEW_COMMIT__: string | undefined;
declare const __REVIEW_BUILD__: string | undefined;

export const APP_VERSION: string = pkg.version;

/** Short git SHA baked at build time (Workers CI / local git). */
export const APP_COMMIT: string =
  typeof __REVIEW_COMMIT__ !== 'undefined' && __REVIEW_COMMIT__ ? __REVIEW_COMMIT__ : 'dev';

/** `0.14.35+abc1234` — also in `<meta name="review-build">` for curl checks. */
export const APP_BUILD: string =
  typeof __REVIEW_BUILD__ !== 'undefined' && __REVIEW_BUILD__
    ? __REVIEW_BUILD__
    : `${APP_VERSION}+dev`;

/**
 * This line (the P2P desktop build) only follows its own releases, tagged
 * `p2p-desktop-v<version>` by .github/workflows/desktop-release.yml.
 */
export const RELEASE_TAG_PREFIX = 'p2p-desktop-v';
export const RELEASES_URL = 'https://github.com/PetrosyanDobryakov/ReView/releases?q=p2p-desktop&expanded=true';

/** Dotted numbers only, so a tag like `p2p-desktop-v0.16.0` reads as 0.16.0, not 2. */
function parseVer(v: string): number[] {
  const m = v.trim().match(/\d+(?:\.\d+)+/) ?? v.trim().match(/^v?(\d+)$/i);
  if (!m) return [];
  return (m[1] ?? m[0]).split('.').map(Number);
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
  | { kind: 'outdated'; latest: string; url: string }
  | { kind: 'dev' }
  | { kind: 'unknown' };

/**
 * Compare the running app version with this line's GitHub releases
 * (tags starting with RELEASE_TAG_PREFIX; drafts ignored).
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
    const list = (await res.json()) as Array<{ tag_name?: string; html_url?: string; draft?: boolean }>;
    const ours = list.filter((r) => !r.draft && r.tag_name?.startsWith(RELEASE_TAG_PREFIX));
    if (!ours.length) return { kind: 'unknown' };
    const versions = ours.map((r) => r.tag_name!.slice(RELEASE_TAG_PREFIX.length));
    let newest = 0;
    for (let i = 1; i < versions.length; i++) if (compareVersions(versions[i]!, versions[newest]!) > 0) newest = i;
    const latest = versions[newest]!;
    if (compareVersions(APP_VERSION, latest) < 0) {
      return { kind: 'outdated', latest, url: ours[newest]!.html_url ?? RELEASES_URL };
    }
    if (versions.some((v) => compareVersions(v, APP_VERSION) === 0)) {
      return { kind: 'latest' };
    }
    return { kind: 'dev' };
  } catch {
    return { kind: 'unknown' };
  }
}
