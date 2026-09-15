export const MAX_ROOM_NAME: number;
export const MAX_WS_PAYLOAD: number;
export const ROOM_NAME_RE: RegExp;
export function formatHostForUrl(host: string): string;
export function pathnameOnly(urlPath: unknown): string;
export function normalizeRoomName(name: unknown): string;
export function isValidRoomName(name: unknown): boolean;
export function roomFromWebsocketPath(urlPath: unknown): string;
export function roomFromDeletePath(urlPath: unknown): string;
