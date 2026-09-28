import { useCallback, useEffect, useRef, useState } from 'react';
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
  ensureBoardWithId,
  saveBoardLocally,
  isBoardPersistedLocally,
  listRecentBoards,
  isOwnBoard,
  boardStorageKind,
} from '../core/boards';
import type { BoardMeta, Team } from '../core/boards';
import { estimateBoardBytes, formatBoardWeight } from '../core/boardSize';
import { cloneBoard } from '../core/boardClone';
import { exportBoardFile, importBoardFile, importErrorI18nKey, MAX_FILE_BYTES } from '../core/boardShare';
import { canRenameBoardOnHome } from '../core/boardTitle';
import { persistBoardIfOpen } from '../core/store';
import { readPrefs, writePrefs, onPrefsChange } from '../core/prefs';
import { isOrbitPaper } from '../core/orbit';
import { applyOrbitToolDefaults, PACKET_PAPER, restoreOrbitToolDefaults } from '../core/orbitDraw';
import { t } from './i18n';
import type { LocaleId } from '../core/locale';
import { Icon } from './icons';
import { BoardStorageBadge } from './BoardStorageBadge';
import { BoardGlyph } from './BoardGlyph';
import { readLocale } from '../core/locale';
import { SettingsSheet } from './SettingsSheet';
import { readChromeTheme, writeChromeTheme, type ChromeThemeId } from '../core/chromeTheme';
import { writeLocale } from '../core/locale';
import { loadUser, saveUser } from '../core/user';
import { APP_BUILD, checkAppVersion, RELEASES_URL, type VersionStatus } from '../core/version';
import { resolveInviteBoardUrl } from '../net';
import { navigateThemed } from './navTransition';

const REL_STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['second', 60],
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Infinity],
];

function relativeTime(ts: number, localeTag: string): string {
  try {
    const rtf = new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' });
    let v = (ts - Date.now()) / 1000;
    for (const [unit, step] of REL_STEPS) {
      if (Math.abs(v) < step) return rtf.format(Math.round(v), unit);
      v /= step;
    }
  } catch {
    /* fall through */
  }
  return new Date(ts).toLocaleDateString(localeTag);
}

export function Home({ locale: localeProp }: { locale: LocaleId }) {
  const navigate = useNavigate();
  const [locale, setLocale] = useState<LocaleId>(localeProp);
  const [chromeTheme, setChromeTheme] = useState<ChromeThemeId>(() => readChromeTheme());
  const [paperBg, setPaperBg] = useState(() => readPrefs().paperBg ?? PACKET_PAPER);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nick, setNick] = useState(() => loadUser().name);
  const [teams, setTeams] = useState<Team[]>(() => listTeams());
  const [boards, setBoards] = useState<BoardMeta[]>(() => listBoards());
  const [recent, setRecent] = useState<BoardMeta[]>(() => listRecentBoards());
  const [activeTeam, setActiveTeam] = useState<string>('default');
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [editingBoard, setEditingBoard] = useState<string | null>(null);
  const [boardName, setBoardName] = useState('');
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [joinLink, setJoinLink] = useState('');
  const [saveRemote, setSaveRemote] = useState(() => readPrefs().saveRemoteBoards);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [weightsReady, setWeightsReady] = useState(false);
  const weightsGen = useRef(0);
  const [verStatus, setVerStatus] = useState<VersionStatus | null>(null);

  useEffect(() => {
    let alive = true;
    checkAppVersion().then((s) => {
      if (alive) setVerStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

  const refresh = useCallback(() => {
    setTeams(listTeams());
    setBoards(listBoards());
    setRecent(listRecentBoards());
  }, []);

  const refreshWeights = useCallback(async (list: BoardMeta[]) => {
    const gen = ++weightsGen.current;
    try {
      const entries = await Promise.all(
        list.map(async (b) => {
          try {
            const bytes = await estimateBoardBytes(b.id);
            return [b.id, bytes] as const;
          } catch {
            return [b.id, 0] as const;
          }
        })
      );
      if (gen !== weightsGen.current) return;
      const next: Record<string, number> = {};
      for (const [id, bytes] of entries) next[id] = bytes;
      setWeights(next);
    } catch {
      // keep previous weights on unexpected failure
    } finally {
      if (gen === weightsGen.current) setWeightsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!boards.length) {
      const first = listBoards();
      if (!first.length) {
        const curTeams = listTeams();
        const def = curTeams[0]?.id ?? 'default';
        createBoard(t(locale, 'firstBoard'), def);
        refresh();
      }
    }
  }, []);

  useEffect(() => {
    void refreshWeights(boards).catch(() => {});
  }, [boards, refreshWeights]);

  useEffect(() => onPrefsChange((p) => setSaveRemote(p.saveRemoteBoards)), []);

  // ponytail: 'recent' is a pseudo-team — same board list, own + guest boards in visit order.
  const filtered =
    activeTeam === 'recent'
      ? recent
      : boards.filter((b) => b.teamId === activeTeam && isOwnBoard(b)).sort((a, b) => b.updatedAt - a.updatedAt);

  const handleCreateBoard = () => {
    const b = createBoard(t(locale, 'newBoard'), activeTeam === 'recent' ? 'default' : activeTeam);
    navigateThemed(navigate, boardUrl(b.id));
  };

  const handleCreateTeam = () => {
    const created = createTeam(t(locale, 'defaultTeamShort'));
    refresh();
    setActiveTeam(created.id);
  };

  const [copyToast, setCopyToast] = useState<string | null>(null);
  const showCopyToast = useCallback((msg: string) => {
    setCopyToast(msg);
    window.setTimeout(() => setCopyToast(null), 2000);
  }, []);
  const copyTextFallback = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (ok) return true;
    } catch {}
    return false;
  };
  const handleCopyLink = async (id: string) => {
    let url = `${window.location.origin}${boardUrl(id)}`;
    try {
      const invite = await resolveInviteBoardUrl(id);
      url = invite.url;
    } catch {
      /* keep origin URL */
    }
    const ok = await copyTextFallback(url);
    if (ok) showCopyToast(t(locale, 'membersInviteCopied'));
    else showCopyToast(t(locale, 'membersInviteFail'));
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
    navigateThemed(navigate, boardUrl(id));
  };

  const handleSaveBoard = (id: string) => {
    saveBoardLocally(id);
    persistBoardIfOpen(id);
    refresh();
    void refreshWeights(listBoards());
  };

  const handleDeleteBoard = async (id: string) => {
    if (!confirm(t(locale, 'deleteBoardConfirm'))) return;
    const ok = await deleteBoardData(id);
    refresh();
    if (!ok) {
      window.alert(t(locale, 'deleteBoardFailed'));
    }
  };

  const handleCloneBoard = async (id: string) => {
    try {
      const copy = await cloneBoard(id);
      if (!copy) {
        window.alert(t(locale, 'error'));
        return;
      }
      refresh();
      void refreshWeights(listBoards());
    } catch {
      window.alert(t(locale, 'error'));
    }
  };

  const toggleSaveRemote = () => {
    const next = !saveRemote;
    writePrefs({ saveRemoteBoards: next });
    setSaveRemote(next);
  };

  const importRef = useRef<HTMLInputElement>(null);
  const handleExportBoard = async (id: string) => {
    const res = await exportBoardFile(id);
    showCopyToast(res === 'ok' ? t(locale, 'shareCopied') : res === 'too_large' ? t(locale, 'exportTooLarge') : t(locale, 'error'));
  };
  const handleImportPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
      showCopyToast(t(locale, 'importErrorTooLarge'));
      return;
    }
    const res = await importBoardFile(file);
    if (res.ok) {
      refresh();
      void refreshWeights(listBoards());
      showCopyToast(t(locale, 'importSuccess'));
    } else {
      showCopyToast(t(locale, importErrorI18nKey(res.error)));
    }
  };

  const localeTag = readLocale();

  // Close overflow menu on outside click / Escape.
  useEffect(() => {
    if (!openMenuId) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null;
      if (target && target.closest('.board-row-menu-wrap')) return;
      setOpenMenuId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenuId(null);
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [openMenuId]);

  const activeTeamMeta = activeTeam === 'recent' ? null : teams.find((tm) => tm.id === activeTeam) ?? null;
  const teamCount = (id: string) => boards.filter((b) => b.teamId === id && isOwnBoard(b)).length;

  const renderMenu = (key: string, items: React.ReactNode) => (
    <span className="board-row-menu-wrap">
      <button
        type="button"
        className={`icon-btn board-row-menu-trigger${openMenuId === key ? ' is-open' : ''}`}
        title={t(locale, 'more')}
        aria-label={t(locale, 'more')}
        aria-expanded={openMenuId === key}
        aria-haspopup="menu"
        onClick={(e) => {
          e.stopPropagation();
          setOpenMenuId(openMenuId === key ? null : key);
        }}
      >
        <Icon name="dots" size={18} />
      </button>
      {openMenuId === key && (
        <div className="board-row-menu" role="menu" onClick={(e) => e.stopPropagation()}>
          {items}
        </div>
      )}
    </span>
  );

  const menuItem = (icon: Parameters<typeof Icon>[0]['name'], label: string, onClick: () => void, opts?: { danger?: boolean; disabled?: boolean; title?: string }) => (
    <button
      type="button"
      className={`board-row-menu-item${opts?.danger ? ' danger' : ''}`}
      role="menuitem"
      disabled={opts?.disabled}
      title={opts?.title}
      onClick={() => {
        if (opts?.disabled) return;
        setOpenMenuId(null);
        onClick();
      }}
    >
      <Icon name={icon} size={14} />
      {label}
    </button>
  );

  const commitTeamRename = (id: string) => {
    renameTeam(id, teamName);
    setEditingTeam(null);
    refresh();
  };

  return (
    <div className="home-root">
      <header className="file-bar">
        <div className="island file-island">
          <span className="brand">{t(locale, 'brand')}</span>
          <div className="island-sep" />
          {verStatus?.kind === 'outdated' ? (
            <a
              className="home-version warn"
              href={RELEASES_URL}
              target="_blank"
              rel="noreferrer"
              title={`${t(locale, 'updateAvailable')} (${APP_BUILD})`}
            >
              {t(locale, 'updateAvailable')} — v{verStatus.latest}
            </a>
          ) : (
            <span
              className={`home-version${verStatus?.kind === 'dev' ? ' dev' : ''}`}
              title={verStatus?.kind === 'dev' ? t(locale, 'devVersion') : APP_BUILD}
            >
              v{APP_BUILD}
            </span>
          )}
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

      <main className="home-shell">
        <div className="home-hero">
          <h1 className="home-h1">{t(locale, 'boardsTitle')}</h1>
          <div className="home-hero-actions">
            <input
              ref={importRef}
              type="file"
              accept=".json,.review,application/json"
              className="visually-hidden"
              aria-label={t(locale, 'importBoardAction')}
              onChange={handleImportPick}
            />
            <button
              type="button"
              className="home-btn"
              title={t(locale, 'importBoardHint')}
              onClick={() => importRef.current?.click()}
            >
              <Icon name="upload" size={16} />
              <span className="home-btn-label">{t(locale, 'importBoard')}</span>
            </button>
            <button type="button" className="home-btn home-btn-primary" onClick={handleCreateBoard}>
              <Icon name="plus" size={16} />
              {t(locale, 'newBoard')}
            </button>
          </div>
        </div>

        <form
          className="home-join"
          onSubmit={(e) => {
            e.preventDefault();
            handleJoin();
          }}
        >
          <Icon name="link" size={16} />
          <input
            value={joinLink}
            onChange={(e) => setJoinLink(e.target.value)}
            placeholder={t(locale, 'joinHint')}
            aria-label={t(locale, 'joinHint')}
            className="home-join-input"
            spellCheck={false}
            autoComplete="off"
          />
          <button type="submit" className="home-join-go" disabled={!joinLink.trim()}>
            {t(locale, 'join')}
            <Icon name="arrow" size={14} />
          </button>
        </form>

        <nav className="home-tabs" aria-label={t(locale, 'teams')}>
          <div className="home-tabs-scroll" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTeam === 'recent'}
              className={`home-tab${activeTeam === 'recent' ? ' on' : ''}`}
              onClick={() => setActiveTeam('recent')}
            >
              {t(locale, 'recent')}
            </button>
            <span className="home-tabs-sep" aria-hidden="true" />
            {teams.map((team) =>
              editingTeam === team.id ? (
                <input
                  key={team.id}
                  autoFocus
                  value={teamName}
                  onChange={(e) => setTeamName(e.target.value)}
                  onBlur={() => commitTeamRename(team.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTeamRename(team.id);
                    if (e.key === 'Escape') setEditingTeam(null);
                  }}
                  className="home-tab-input"
                  aria-label={t(locale, 'rename')}
                />
              ) : (
                <button
                  key={team.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTeam === team.id}
                  className={`home-tab${activeTeam === team.id ? ' on' : ''}`}
                  onClick={() => setActiveTeam(team.id)}
                  onDoubleClick={() => {
                    setEditingTeam(team.id);
                    setTeamName(team.name);
                  }}
                >
                  <span className="home-tab-name">{team.name}</span>
                  <span className="home-tab-count">{teamCount(team.id)}</span>
                </button>
              )
            )}
            <button
              type="button"
              className="home-tab home-tab-add"
              title={t(locale, 'teams')}
              aria-label={`${t(locale, 'teams')} +`}
              onClick={handleCreateTeam}
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
          {activeTeamMeta && editingTeam !== activeTeamMeta.id
            ? renderMenu(
                `team:${activeTeamMeta.id}`,
                <>
                  {menuItem('pen', t(locale, 'rename'), () => {
                    setEditingTeam(activeTeamMeta.id);
                    setTeamName(activeTeamMeta.name);
                  })}
                  {activeTeamMeta.id !== 'default' &&
                    menuItem(
                      'trash',
                      t(locale, 'ctxDelete'),
                      () => {
                        if (confirm(t(locale, 'deleteTeamConfirm'))) {
                          deleteTeam(activeTeamMeta.id);
                          setActiveTeam('default');
                          refresh();
                        }
                      },
                      { danger: true }
                    )}
                </>
              )
            : null}
        </nav>

        {filtered.length ? (
          <ul className="home-list" role="list">
            {filtered.map((b) => {
              const known = weightsReady && Object.prototype.hasOwnProperty.call(weights, b.id);
              const bytes = known ? weights[b.id]! : undefined;
              const weightLabel =
                bytes === undefined ? t(locale, 'boardWeightLoading') : bytes === 0 ? null : formatBoardWeight(bytes, localeTag);
              const needsSave =
                (b.status === 'remote' && !isBoardPersistedLocally(b)) || (Boolean(b.savedLocally) && known && bytes === 0);
              const sessionOnly = boardStorageKind(b) !== 'onDevice';
              const open = () => navigateThemed(navigate, boardUrl(b.id));
              return (
                <li
                  key={b.id}
                  className={`board-row${openMenuId === b.id ? ' has-menu' : ''}`}
                  role="button"
                  tabIndex={0}
                  title={b.id}
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open();
                    }
                  }}
                >
                  <BoardGlyph id={b.id} />
                  <span className="board-main">
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
                          e.stopPropagation();
                          if (e.key === 'Enter') {
                            renameBoard(b.id, boardName);
                            setEditingBoard(null);
                            refresh();
                          }
                          if (e.key === 'Escape') setEditingBoard(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="home-inline-input"
                      />
                    ) : (
                      <span className="board-name-text">{b.name}</span>
                    )}
                    <span className="board-meta-line">
                      <span title={new Date(b.updatedAt).toLocaleString(localeTag)}>{relativeTime(b.updatedAt, localeTag)}</span>
                      {weightLabel ? (
                        <>
                          <span className="board-meta-sep" aria-hidden="true">·</span>
                          <span className="board-meta-weight">{weightLabel}</span>
                        </>
                      ) : null}
                      {sessionOnly ? <BoardStorageBadge meta={b} locale={locale} /> : null}
                    </span>
                  </span>
                  <span className="board-actions" onClick={(e) => e.stopPropagation()}>
                    {needsSave && (
                      <button
                        type="button"
                        className="home-btn home-btn-sm"
                        title={t(locale, 'keepOnDeviceHint')}
                        onClick={() => handleSaveBoard(b.id)}
                      >
                        <Icon name="download" size={14} />
                        <span className="home-btn-label">{t(locale, 'keepOnDevice')}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      className="icon-btn board-hover-action"
                      title={t(locale, 'copyLink')}
                      aria-label={t(locale, 'copyLink')}
                      onClick={() => handleCopyLink(b.id)}
                    >
                      <Icon name="link" size={18} />
                    </button>
                    {renderMenu(
                      b.id,
                      <>
                        {menuItem('duplicate', t(locale, 'saveAsMyBoard'), () => void handleCloneBoard(b.id), {
                          title: t(locale, 'saveAsMyBoardHint'),
                        })}
                        {menuItem('download', t(locale, 'exportBoard'), () => void handleExportBoard(b.id))}
                        {menuItem(
                          'pen',
                          t(locale, 'rename'),
                          () => {
                            setEditingBoard(b.id);
                            setBoardName(b.name);
                          },
                          { disabled: !canRenameBoardOnHome(b) }
                        )}
                        <div className="board-row-menu-sep" role="separator" />
                        {menuItem('trash', t(locale, 'ctxDelete'), () => void handleDeleteBoard(b.id), { danger: true })}
                      </>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="home-empty">
            <p>{t(locale, activeTeam === 'recent' ? 'recentEmpty' : 'noBoards')}</p>
            {activeTeam !== 'recent' && (
              <button type="button" className="home-btn home-btn-primary" onClick={handleCreateBoard}>
                <Icon name="plus" size={16} />
                {t(locale, 'newBoard')}
              </button>
            )}
          </div>
        )}

        <footer className="home-foot">
          <p className="home-foot-note">
            <Icon name="warn" size={14} />
            <span>{t(locale, 'storageNotice')}</span>
          </p>
          <div className="home-foot-row">
            <button
              type="button"
              className={`sheet-switch home-foot-switch${saveRemote ? ' on' : ''}`}
              role="switch"
              aria-checked={saveRemote}
              title={t(locale, 'saveRemoteBoardsHint')}
              onClick={toggleSaveRemote}
            >
              <span className="switch" aria-hidden="true">
                <span className="switch-thumb" />
              </span>
              <span>{t(locale, 'saveRemoteBoards')}</span>
            </button>
            {/* ponytail: desktop download placeholder — no URL yet, wire to the installer link later */}
            <span className="home-foot-cta" role="link" aria-disabled="true" title={t(locale, 'desktopCta')}>
              {t(locale, 'desktopCta')}
            </span>
          </div>
        </footer>
      </main>

      <SettingsSheet
        open={settingsOpen}
        locale={locale}
        chromeTheme={chromeTheme}
        bg={paperBg}
        gridOn
        sync={{ online: false, users: 0, enabled: false }}
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
        onBg={(value) => {
          const wasOrbit = isOrbitPaper(paperBg);
          const nextOrbit = isOrbitPaper(value);
          writePrefs({ paperBg: value });
          setPaperBg(value);
          if (nextOrbit && !wasOrbit) applyOrbitToolDefaults();
          else if (!nextOrbit && wasOrbit) restoreOrbitToolDefaults();
        }}
        onGrid={() => {}}
        onClose={() => setSettingsOpen(false)}
      />
      {copyToast ? (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 72,
            transform: 'translateX(-50%)',
            background: 'var(--chrome-panel)',
            color: 'var(--chrome-text)',
            border: '1px solid var(--chrome-border)',
            borderRadius: 10,
            padding: '10px 16px',
            boxShadow: 'var(--chrome-shadow)',
            zIndex: 9999,
            fontSize: 13,
            maxWidth: 'min(420px, 90vw)',
            whiteSpace: 'normal',
            textAlign: 'center',
            wordBreak: 'break-word',
            lineHeight: 1.4,
          }}
        >
          {copyToast}
        </div>
      ) : null}
    </div>
  );
}
