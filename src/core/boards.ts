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
}

const TEAMS_KEY = 'review-teams';
const BOARDS_KEY = 'review-boards';

function readTeams(): Team[] {
  try {
    const raw = localStorage.getItem(TEAMS_KEY);
    if (raw) return JSON.parse(raw) as Team[];
  } catch {}
  return [];
}

function writeTeams(teams: Team[]): void {
  try {
    localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
  } catch {}
}

function readBoards(): BoardMeta[] {
  try {
    const raw = localStorage.getItem(BOARDS_KEY);
    if (raw) return JSON.parse(raw) as BoardMeta[];
  } catch {}
  return [];
}

function writeBoards(boards: BoardMeta[]): void {
  try {
    localStorage.setItem(BOARDS_KEY, JSON.stringify(boards));
  } catch {}
}

export function listTeams(): Team[] {
  let teams = readTeams();
  if (!teams.length) {
    teams = [{ id: 'default', name: 'Моя команда', createdAt: Date.now() }];
    writeTeams(teams);
  }
  return teams;
}

export function createTeam(name: string): Team {
  const t: Team = { id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4), name: name.trim() || 'Команда', createdAt: Date.now() };
  const teams = listTeams();
  teams.push(t);
  writeTeams(teams);
  return t;
}

export function renameTeam(id: string, name: string): void {
  const teams = listTeams().map((t) => (t.id === id ? { ...t, name: name.trim() || t.name } : t));
  writeTeams(teams);
}

export function deleteTeam(id: string): void {
  if (id === 'default') return;
  let teams = listTeams().filter((t) => t.id !== id);
  if (!teams.length) teams = [{ id: 'default', name: 'Моя команда', createdAt: Date.now() }];
  writeTeams(teams);
  // move boards of deleted team to default
  const boards = listBoards().map((b) => (b.teamId === id ? { ...b, teamId: 'default' } : b));
  writeBoards(boards);
}

export function listBoards(): BoardMeta[] {
  const boards = readBoards();
  // migrate old boards without status
  let changed = false;
  for (const b of boards) if (!(b as unknown as { status?: string }).status) { (b as unknown as BoardMeta).status = 'local'; changed = true; }
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

export function createBoard(name: string, teamId = 'default', status: BoardStatus = 'local'): BoardMeta {
  const teams = listTeams();
  if (!teams.find((t) => t.id === teamId)) teamId = 'default';
  const b: BoardMeta = {
    id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim() || 'Новая доска',
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
    // also clean per-board page pointer
    localStorage.removeItem(`review-page-${id}`);
  } catch {}
  // NOTE: IndexedDB review-v1-${id} is left for manual recovery; could delete via indexedDB.deleteDatabase
}

export function moveBoard(id: string, teamId: string): void {
  const boards = readBoards().map((b) => (b.id === id ? { ...b, teamId, updatedAt: Date.now() } : b));
  writeBoards(boards);
}

export function setBoardStatus(id: string, status: BoardStatus): void {
  const boards = readBoards().map((b) => (b.id === id ? { ...b, status, updatedAt: Date.now() } : b));
  writeBoards(boards);
}

export function ensureDefaultBoard(): BoardMeta {
  let boards = listBoards();
  if (boards.length) return boards[0];
  // try to reuse old board name
  let oldName = 'Моя первая доска';
  try {
    const v = localStorage.getItem('review-name');
    if (v && v.trim()) oldName = v.trim().slice(0, 40);
  } catch {}
  const b = createBoard(oldName, 'default');
  return b;
}

export function boardUrl(id: string): string {
  return `/board/${id}`;
}

export function parseBoardIdFromPath(path: string): string | null {
  const m = path.match(/^\/board\/([^/]+)/);
  return m ? m[1] : null;
}

export function ensureBoardWithId(id: string, name = 'Чужая доска', teamId = 'default', status: BoardStatus = 'remote'): BoardMeta {
  const existing = getBoard(id);
  if (existing) return existing;
  const teams = listTeams();
  if (!teams.find((t) => t.id === teamId)) teamId = 'default';
  const b: BoardMeta = { id, name, teamId, createdAt: Date.now(), updatedAt: Date.now(), status };
  const boards = readBoards();
  boards.push(b);
  writeBoards(boards);
  return b;
}

// call on every shape change to bump updatedAt
export function bumpBoardUpdated(id: string): void {
  touchBoard(id);
}
