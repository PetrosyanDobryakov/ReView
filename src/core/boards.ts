import { readPrefs } from './prefs';
import { deleteBoardDatabase } from './boardSize';
import { readLocale } from './locale';
import { t } from '../ui/i18n';

export interface Team {
  id: string;
  name: string;
  createdAt: number;
}

export type BoardStatus = 'local' | 'shared' | 'remote';

export interface BoardMeta {
  id: string;
  name: string;
  teamId: string;
  createdAt: number;
  updatedAt: number;
  status: BoardStatus;
  /** Explicit local keep for a remote board (save board). */
  savedLocally?: boolean;
}

const TEAMS_KEY = 'review-teams';
const BOARDS_KEY = 'review-boards';

function isBoardStatus(value: unknown): value is BoardStatus {
  return value === 'local' || value === 'shared' || value === 'remote';
}

function parseTeam(raw: unknown): Team | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== 'string' || !t.id) return null;
  if (typeof t.name !== 'string') return null;
  return {
    id: t.id,
    name: t.name,
    createdAt: typeof t.createdAt === 'number' ? t.createdAt : Date.now(),
  };
}

function parseBoard(raw: unknown): BoardMeta | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== 'string' || !b.id) return null;
  if (typeof b.name !== 'string') return null;
  return {
    id: b.id,
    name: b.name,
    teamId: typeof b.teamId === 'string' && b.teamId ? b.teamId : 'default',
    createdAt: typeof b.createdAt === 'number' ? b.createdAt : Date.now(),
    updatedAt: typeof b.updatedAt === 'number' ? b.updatedAt : Date.now(),
    status: isBoardStatus(b.status) ? b.status : 'local',
    savedLocally: b.savedLocally === true ? true : undefined,
  };
}

function readTeams(): Team[] {
  try {
    const raw = localStorage.getItem(TEAMS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseTeam).filter((x): x is Team => x !== null);
  } catch {
    return [];
  }
}

function writeTeams(teams: Team[]): void {
  try {
    localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
  } catch {}
}

function readBoards(): BoardMeta[] {
  try {
    const raw = localStorage.getItem(BOARDS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(parseBoard).filter((x): x is BoardMeta => x !== null);
  } catch {
    return [];
  }
}

function writeBoards(boards: BoardMeta[]): void {
  try {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(boards));
  } catch {}
}

export function listTeams(): Team[] {
  let teams = readTeams();
  if (!teams.length) {
    teams = [{ id: 'default', name: t(readLocale(), 'defaultTeam'), createdAt: Date.now() }];
    writeTeams(teams);
  }
  return teams;
}

export function createTeam(name: string): Team {
  const team: Team = {
    id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4),
    name: name.trim() || t(readLocale(), 'defaultTeamShort'),
    createdAt: Date.now(),
  };
  const teams = listTeams();
  teams.push(team);
  writeTeams(teams);
  return team;
}

export function renameTeam(id: string, name: string): void {
  const teams = listTeams().map((team) => (team.id === id ? { ...team, name: name.trim() || team.name } : team));
  writeTeams(teams);
}

export function deleteTeam(id: string): void {
  if (id === 'default') return;
  let teams = listTeams().filter((team) => team.id !== id);
  if (!teams.length) teams = [{ id: 'default', name: t(readLocale(), 'defaultTeam'), createdAt: Date.now() }];
  writeTeams(teams);
  const boards = listBoards().map((b) => (b.teamId === id ? { ...b, teamId: 'default' } : b));
  writeBoards(boards);
}

export function listBoards(): BoardMeta[] {
  const boards = readBoards();
  let changed = false;
  for (const b of boards) {
    if (!isBoardStatus((b as BoardMeta).status)) {
      (b as BoardMeta).status = 'local';
      changed = true;
    }
  }
  if (changed) writeBoards(boards);
  return boards;
}

export function listBoardsByTeam(teamId: string): BoardMeta[] {
  return readBoards().filter((b) => b.teamId === teamId);
}

export function getBoard(id: string): BoardMeta | undefined {
  return readBoards().find((b) => b.id === id);
}

function touchBoard(id: string): void {
  const boards = readBoards();
  const idx = boards.findIndex((b) => b.id === id);
  if (idx >= 0) {
    boards[idx] = { ...boards[idx], updatedAt: Date.now() };
    writeBoards(boards);
  }
}

/** Debounce meta bumps — drag/patch floods used to rewrite localStorage every frame. */
let bumpTimer: ReturnType<typeof setTimeout> | null = null;
let bumpPendingId: string | null = null;

export function bumpBoardUpdated(id: string): void {
  bumpPendingId = id;
  if (bumpTimer) return;
  bumpTimer = setTimeout(() => {
    bumpTimer = null;
    const pending = bumpPendingId;
    bumpPendingId = null;
    if (pending) touchBoard(pending);
  }, 400);
}

/** Flush a pending bump immediately (board leave / rename / delete). */
export function flushBoardUpdated(): void {
  if (bumpTimer) {
    clearTimeout(bumpTimer);
    bumpTimer = null;
  }
  const pending = bumpPendingId;
  bumpPendingId = null;
  if (pending) touchBoard(pending);
}

export function createBoard(name: string, teamId = 'default', status: BoardStatus = 'local'): BoardMeta {
  const teams = listTeams();
  if (!teams.find((team) => team.id === teamId)) teamId = 'default';
  const b: BoardMeta = {
    id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim() || t(readLocale(), 'newBoard'),
    teamId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status,
  };
  const boards = readBoards();
  boards.push(b);
  writeBoards(boards);
  return b;
}

export function renameBoard(id: string, name: string): void {
  const boards = readBoards().map((b) => (b.id === id ? { ...b, name: name.trim() || b.name, updatedAt: Date.now() } : b));
  writeBoards(boards);
}

export function deleteBoard(id: string): void {
  const boards = readBoards().filter((b) => b.id !== id);
  writeBoards(boards);
  try {
    localStorage.removeItem(`review-page-${id}`);
  } catch {}
}

export async function deleteBoardData(id: string): Promise<boolean> {
  deleteBoard(id);
  return deleteBoardDatabase(id);
}

/** Mark a remote board as kept on this device (local copy). */
export function saveBoardLocally(id: string): BoardMeta | undefined {
  const boards = readBoards();
  const idx = boards.findIndex((b) => b.id === id);
  if (idx < 0) return undefined;
  const prev = boards[idx];
  const next: BoardMeta = {
    ...prev,
    savedLocally: true,
    status: prev.status === 'remote' ? 'local' : prev.status,
    updatedAt: Date.now(),
  };
  boards[idx] = next;
  writeBoards(boards);
  return next;
}

export function isBoardPersistedLocally(meta: BoardMeta | undefined): boolean {
  if (!meta) return true;
  if (meta.status !== 'remote') return true;
  if (meta.savedLocally) return true;
  return readPrefs().saveRemoteBoards;
}

export function moveBoard(id: string, teamId: string): void {
  const boards = readBoards().map((b) => (b.id === id ? { ...b, teamId, updatedAt: Date.now() } : b));
  writeBoards(boards);
}

export function setBoardStatus(id: string, status: BoardStatus): void {
  const boards = readBoards().map((b) => {
    if (b.id !== id) return b;
    // Switching away from remote keeps any local copy flag so content is not lost.
    const savedLocally = status === 'remote' ? b.savedLocally : b.savedLocally;
    return { ...b, status, savedLocally, updatedAt: Date.now() };
  });
  writeBoards(boards);
}

export function ensureDefaultBoard(): BoardMeta {
  const boards = listBoards();
  if (boards.length) return boards[0];
  let oldName = t(readLocale(), 'firstBoard');
  try {
    const v = localStorage.getItem('review-name');
    if (v && v.trim()) oldName = v.trim().slice(0, 40);
  } catch {}
  return createBoard(oldName, 'default');
}

export function boardUrl(id: string): string {
  return `/board/${id}`;
}

export function parseBoardIdFromPath(path: string): string | null {
  const m = path.match(/^\/board\/([^/]+)/);
  return m ? m[1] : null;
}

export function ensureBoardWithId(
  id: string,
  name = t(readLocale(), 'remoteBoardName'),
  teamId = 'default',
  status: BoardStatus = 'remote'
): BoardMeta {
  const existing = getBoard(id);
  if (existing) return existing;
  const teams = listTeams();
  if (!teams.find((team) => team.id === teamId)) teamId = 'default';
  const b: BoardMeta = { id, name, teamId, createdAt: Date.now(), updatedAt: Date.now(), status };
  const boards = readBoards();
  boards.push(b);
  writeBoards(boards);
  return b;
}
