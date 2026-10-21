/** Media MIME / size helpers for board image + video + audio insert. */

export const MEDIA_MAX_BYTES = 8 * 1024 * 1024;
/**
 * Audio cap is higher: 128 kbps is ~1 MB/min, and a lesson recording needs
 * tens of minutes. Still well under the 64 MB P2P blob ceiling.
 */
export const AUDIO_MAX_BYTES = 32 * 1024 * 1024;

const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
]);

const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/vorbis',
  'audio/webm',
  'audio/mp4',
  'audio/x-m4a',
  'audio/aac',
  'audio/flac',
  'audio/x-flac',
]);

export function isGifMime(type: string): boolean {
  return type === 'image/gif';
}

export function isVideoMime(type: string): boolean {
  return VIDEO_TYPES.has(type) || type.startsWith('video/');
}

export function isAudioMime(type: string): boolean {
  return AUDIO_TYPES.has(type) || type.startsWith('audio/');
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
  if (n.endsWith('.mp3')) return 'audio/mpeg';
  if (n.endsWith('.wav')) return 'audio/wav';
  if (n.endsWith('.oga') || n.endsWith('.opus')) return 'audio/ogg';
  if (n.endsWith('.m4a')) return 'audio/mp4';
  if (n.endsWith('.flac')) return 'audio/flac';
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

export function audioDownloadExt(src: string): string {
  if (src.startsWith('data:audio/wav') || src.startsWith('data:audio/x-wav')) return 'wav';
  if (src.startsWith('data:audio/ogg') || src.startsWith('data:audio/vorbis')) return 'ogg';
  if (src.startsWith('data:audio/webm')) return 'webm';
  if (src.startsWith('data:audio/mp4') || src.startsWith('data:audio/x-m4a') || src.startsWith('data:audio/aac')) return 'm4a';
  if (src.startsWith('data:audio/flac') || src.startsWith('data:audio/x-flac')) return 'flac';
  return 'mp3';
}

export function imageDownloadExt(src: string): string {
  if (src.startsWith('data:image/gif')) return 'gif';
  if (src.startsWith('data:image/jpeg') || src.startsWith('data:image/jpg')) return 'jpg';
  if (src.startsWith('data:image/webp')) return 'webp';
  return 'png';
}
