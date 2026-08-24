import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  listBoards,
  listTeams,
  createBoard,
  deleteBoardData,
  renameBoard,
  createTeam,
  deleteTeam,
  renameTeam,
  boardUrl,
  getBoard,
  setBoardStatus,
  ensureBoardWithId,
  saveBoardLocally,
  isBoardPersistedLocally,
} from '../core/boards';
import type { BoardMeta, Team, BoardStatus } from '../core/boards';
import { estimateBoardBytes, formatBoardWeight } from '../core/boardSize';
import { readPrefs, writePrefs, onPrefsChange } from '../core/prefs';
import { t } from './i18n';
import type { LocaleId } from '../core/locale';
import { Icon } from './icons';
import { readLocale } from '../core/locale';
import { SettingsSheet } from './SettingsSheet';
import { readChromeTheme, writeChromeTheme, type ChromeThemeId } from '../core/chromeTheme';
import { writeLocale } from '../core/locale';
import { loadUser, saveUser } from '../core/user';

export function Home({ locale: localeProp }: { locale: LocaleId }) {
  const navigate = useNavigate();
  const [locale, setLocale] = useState<LocaleId>(localeProp);
  const [chromeTheme, setChromeTheme] = useState<ChromeThemeId>(() => readChromeTheme());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nick, setNick] = useState(() => loadUser().name);
  const [teams, setTeams] = useState<Team[]>(() => listTeams());
  const [boards, setBoards] = useState<BoardMeta[]>(() => listBoards());
  const [activeTeam, setActiveTeam] = useState<string>('default');
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [editingBoard, setEditingBoard] = useState<string | null>(null);
  const [boardName, setBoardName] = useState('');
  const [joinLink, setJoinLink] = useState('');
  const [saveRemote, setSaveRemote] = useState(() => readPrefs().saveRemoteBoards);
  const [weights, setWeights] = useState<Record<string, number>>({});

  const refresh = useCallback(() => {
    setTeams(listTeams());
    setBoards(listBoards());
  }, []);

  const refreshWeights = useCallback(async (list: BoardMeta[]) => {
    const entries = await Promise.all(
      list.map(async (b) => {
        const bytes = await estimateBoardBytes(b.id);
        return [b.id, bytes] as const;
      })
    );
    const next: Record<string, number> = {};
    for (const [id, bytes] of entries) next[id] = bytes;
    setWeights(next);
  }, []);

  useEffect(() => {
    if (!boards.length) {
      const first = listBoards();
      if (!first.length) {
        const curTeams = listTeams();
        const def = curTeams[0]?.id ?? 'default';
        createBoard('Моя первая доска', def);
        refresh();
      }
    }
  }, []);

  useEffect(() => {
    void refreshWeights(boards);
  }, [boards, refreshWeights]);

  useEffect(() => onPrefsChange((p) => setSaveRemote(p.saveRemoteBoards)), []);

  const filtered = boards.filter((b) => b.teamId === activeTeam).sort((a, b) => b.updatedAt - a.updatedAt);

  const handleCreateBoard = () => {
    const b = createBoard(t(locale, 'newBoard'), activeTeam);
    navigate(boardUrl(b.id));
  };

  const handleCreateTeam = () => {
    const created = createTeam(locale === 'zh' ? '新团队' : locale === 'en' ? 'New team' : 'Новая команда');
    refresh();
    setActiveTeam(created.id);
  };

  const handleCopyLink = async (id: string) => {
    const url = `${window.location.origin}${boardUrl(id)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      prompt(t(locale, 'copyLink'), url);
    }
  };

  const handleJoin = () => {
    const v = joinLink.trim();
    if (!v) return;
    let id = v;
    try {
      const u = new URL(v, window.location.origin);
      const m = u.pathname.match(/\/board\/([^/]+)/);
      if (m) id = m[1];
    } catch {
      /* use raw */
    }
    id = id.trim();
    if (!id) return;
    if (!getBoard(id)) {
      const curTeams = listTeams();
      const def = curTeams[0]?.id ?? 'default';
      ensureBoardWithId(id, t(locale, 'remoteBoardName'), def, 'remote');
    }
    navigate(boardUrl(id));
  };

  const handleSaveBoard = (id: string) => {
    saveBoardLocally(id);
    refresh();
    void refreshWeights(listBoards());
  };

  const handleDeleteBoard = async (id: string) => {
    if (!confirm(t(locale, 'deleteBoardConfirm'))) return;
    await deleteBoardData(id);
    refresh();
  };

  const toggleSaveRemote = () => {
    const next = !saveRemote;
    writePrefs({ saveRemoteBoards: next });
    setSaveRemote(next);
  };

  const localeTag = readLocale();

  return (
    <div className="home-root">
      <header className="file-bar">
        <div className="island file-island">
          <span className="brand">{t(locale, 'brand')}</span>
          <div className="island-sep" />
          <span className="home-title">{t(locale, 'home')}</span>
        </div>
        <div className="island meta-island">
          <button
            type="button"
            className={`icon-btn${settingsOpen ? ' is-open' : ''}`}
            title={t(locale, 'settings')}
            aria-label={t(locale, 'settings')}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <div className="home-body">
        <div className="island home-side">
          <div className="home-side-head">
            <span className="panel-label">{t(locale, 'teams')}</span>
            <button type="button" className="icon-btn" title="+" aria-label="+" onClick={handleCreateTeam}>
              <Icon name="plus" size={16} />
            </button>
          </div>
          <div className="home-teams">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                className={`home-team-btn${activeTeam === team.id ? ' on' : ''}`}
                onClick={() => setActiveTeam(team.id)}
              >
                {editingTeam === team.id ? (
                  <input
                    autoFocus
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    onBlur={() => {
                      renameTeam(team.id, teamName);
                      setEditingTeam(null);
                      refresh();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        renameTeam(team.id, teamName);
                        setEditingTeam(null);
                        refresh();
                      }
                      if (e.key === 'Escape') setEditingTeam(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="home-inline-input"
                  />
                ) : (
                  <span className="home-team-name">{team.name}</span>
                )}
                <span className="home-team-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ width: 24, height: 24 }}
                    title={t(locale, 'rename')}
                    aria-label={t(locale, 'rename')}
                    onClick={() => {
                      setEditingTeam(team.id);
                      setTeamName(team.name);
                    }}
                  >
                    <Icon name="pen" size={14} />
                  </button>
                  {team.id !== 'default' && (
                    <button
                      type="button"
                      className="icon-btn"
                      style={{ width: 24, height: 24 }}
                      title={t(locale, 'ctxDelete')}
                      aria-label={t(locale, 'ctxDelete')}
                      onClick={() => {
                        if (confirm(t(locale, 'deleteTeamConfirm'))) {
                          deleteTeam(team.id);
                          setActiveTeam('default');
                          refresh();
                        }
                      }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  )}
                </span>
              </button>
            ))}
          </div>

          <div className="sheet-section home-storage">
            <h3>{t(locale, 'storage')}</h3>
            <p className="sheet-hint">{t(locale, 'saveRemoteBoardsHint')}</p>
            <button
              type="button"
              className={`sheet-switch${saveRemote ? ' on' : ''}`}
              role="switch"
              aria-checked={saveRemote}
              onClick={toggleSaveRemote}
            >
              <span>{t(locale, 'saveRemoteBoards')}</span>
              <span className="switch" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
            </button>
          </div>

          <div className="sheet-section">
            <h3>{t(locale, 'join')}</h3>
            <p className="sheet-hint">{t(locale, 'joinHint')}</p>
            <div className="home-join-row">
              <input
                value={joinLink}
                onChange={(e) => setJoinLink(e.target.value)}
                placeholder="https://…/board/…"
                className="home-inline-input home-join-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleJoin();
                }}
              />
              <button type="button" className="style-btn active" onClick={handleJoin} aria-label={t(locale, 'join')}>
                →
              </button>
            </div>
          </div>
        </div>

        <div className="island home-main">
          <div className="home-main-head">
            <h2>{teams.find((tm) => tm.id === activeTeam)?.name ?? ''}</h2>
            <button type="button" className="style-btn active" onClick={handleCreateBoard}>
              <Icon name="plus" size={14} /> {t(locale, 'newBoard')}
            </button>
          </div>
          <div className="home-list">
            <div className="board-row board-row-head">
              <span className="board-col-idx">#</span>
              <span className="board-col-name">{t(locale, 'boardNameCol')}</span>
              <span className="board-col-team">{t(locale, 'boardTeamCol')}</span>
              <span className="board-col-status">{t(locale, 'boardStatusCol')}</span>
              <span className="board-col-weight">{t(locale, 'boardWeightCol')}</span>
              <span className="board-col-date">{t(locale, 'boardDateCol')}</span>
              <span className="board-col-actions">{t(locale, 'boardActionsCol')}</span>
            </div>
            {filtered.length ? (
              filtered.map((b, idx) => {
                const bytes = weights[b.id] ?? 0;
                const weightLabel = formatBoardWeight(bytes, localeTag);
                const needsSave = b.status === 'remote' && !isBoardPersistedLocally(b);
                return (
                  <div key={b.id} className="island board-row" onClick={() => navigate(boardUrl(b.id))}>
                    <span className="board-col-idx">{idx + 1}</span>
                    <span className="board-col-name">
                      {editingBoard === b.id ? (
                        <input
                          autoFocus
                          value={boardName}
                          onChange={(e) => setBoardName(e.target.value)}
                          onBlur={() => {
                            renameBoard(b.id, boardName);
                            setEditingBoard(null);
                            refresh();
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              renameBoard(b.id, boardName);
                              setEditingBoard(null);
                              refresh();
                            }
                            if (e.key === 'Escape') setEditingBoard(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="home-inline-input"
                          style={{ minWidth: 120 }}
                        />
                      ) : (
                        <b className="board-name-text">{b.name}</b>
                      )}
                      <span className="panel-label board-id-label">{b.id}</span>
                    </span>
                    <span className="board-col-team panel-label">{teams.find((tm) => tm.id === b.teamId)?.name ?? b.teamId}</span>
                    <span className="board-col-status" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={b.status}
                        onChange={(e) => {
                          setBoardStatus(b.id, e.target.value as BoardStatus);
                          refresh();
                        }}
                        className="size-select home-status-select"
                        aria-label={t(locale, 'boardStatusCol')}
                      >
                        <option value="local">{t(locale, 'statusLocal')}</option>
                        <option value="shared">{t(locale, 'statusShared')}</option>
                        <option value="remote">{t(locale, 'statusRemote')}</option>
                      </select>
                    </span>
                    <span
                      className="board-col-weight panel-label"
                      title={bytes > 0 ? weightLabel : t(locale, 'boardWeightEmpty')}
                    >
                      {weightLabel}
                    </span>
                    <span className="board-col-date panel-label">{new Date(b.updatedAt).toLocaleString(localeTag)}</span>
                    <span className="board-col-actions" onClick={(e) => e.stopPropagation()}>
                      {needsSave && (
                        <button
                          type="button"
                          className="style-btn"
                          title={t(locale, 'saveBoardHint')}
                          onClick={() => handleSaveBoard(b.id)}
                        >
                          {t(locale, 'saveBoard')}
                        </button>
                      )}
                      <button type="button" className="style-btn" onClick={() => navigate(boardUrl(b.id))}>
                        {t(locale, 'openBoard')}
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 28, height: 28 }}
                        title={t(locale, 'copyLink')}
                        aria-label={t(locale, 'copyLink')}
                        onClick={() => handleCopyLink(b.id)}
                      >
                        <Icon name="copy" size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 28, height: 28 }}
                        title={t(locale, 'rename')}
                        aria-label={t(locale, 'rename')}
                        onClick={() => {
                          setEditingBoard(b.id);
                          setBoardName(b.name);
                        }}
                      >
                        <Icon name="pen" size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 28, height: 28 }}
                        title={t(locale, 'ctxDelete')}
                        aria-label={t(locale, 'ctxDelete')}
                        onClick={() => void handleDeleteBoard(b.id)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="sheet-hint home-empty">{t(locale, 'noBoards')}</div>
            )}
          </div>
        </div>
      </div>

      <SettingsSheet
        open={settingsOpen}
        locale={locale}
        chromeTheme={chromeTheme}
        bg="#1c1c1a"
        gridOn
        sync={{ online: false, users: 0 }}
        saved
        nick={nick}
        hideBoardSection
        onNick={(value) => {
          saveUser(value);
          setNick(value);
        }}
        onLocale={(id) => {
          writeLocale(id);
          setLocale(id);
        }}
        onChromeTheme={(id) => {
          writeChromeTheme(id);
          setChromeTheme(id);
        }}
        onBg={() => {}}
        onGrid={() => {}}
        onClose={() => setSettingsOpen(false)}
      />
    </div>
  );
}
