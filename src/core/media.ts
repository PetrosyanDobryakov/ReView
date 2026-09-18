/** Media MIME / size helpers for board image + video insert. */

export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;

const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
]);

export function isGifMime(type: string): boolean {
  return type === 'image/gif';
}

export function isVideoMime(type: string): boolean {
  return VIDEO_TYPES.has(type) || type.startsWith('video/');
}

/** Infer MIME from filename when `File.type` is empty (some OS drops). */
export function mimeFromFileName(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith('.gif')) return 'image/gif';
  if (n.endsWith('.png')) return 'image/png';
  if (n.endsWith('.jpg') || n.endsWith('.jpeg')) return 'image/jpeg';
  if (n.endsWith('.webp')) return 'image/webp';
  if (n.endsWith('.mp4')) return 'video/mp4';
  if (n.endsWith('.webm')) return 'video/webm';
  if (n.endsWith('.mov')) return 'video/quicktime';
  if (n.endsWith('.ogv') || n.endsWith('.ogg')) return 'video/ogg';
  return '';
}

export function resolveFileMime(file: File): string {
  return file.type || mimeFromFileName(file.name);
}

/** True when stored src should keep animating via repeated canvas drawImage. */
export function isAnimatedImageSrc(src: string | undefined): boolean {
  if (!src) return false;
  return src.startsWith('data:image/gif');
}

export function isVideoSrc(src: string | undefined): boolean {
  if (!src) return false;
  return src.startsWith('data:video/');
}

export function videoDownloadExt(src: string): string {
  if (src.startsWith('data:video/webm')) return 'webm';
  if (src.startsWith('data:video/ogg')) return 'ogv';
  if (src.startsWith('data:video/quicktime')) return 'mov';
  return 'mp4';
}

export function imageDownloadExt(src: string): string {
  if (src.startsWith('data:image/gif')) return 'gif';
  if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) return 'jpg';
  if (src.startsWith('data:image/webp')) return 'webp';
  return 'png';
}
