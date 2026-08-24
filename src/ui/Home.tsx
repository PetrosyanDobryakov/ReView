import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listBoards, listTeams, createBoard, deleteBoard, renameBoard, createTeam, deleteTeam, renameTeam, boardUrl, getBoard, setBoardStatus } from '../core/boards';
import type { BoardMeta, Team, BoardStatus } from '../core/boards';
import { t } from './i18n';
import type { LocaleId } from '../core/locale';
import { Icon } from './icons';
import { readLocale } from '../core/locale';

export function Home({ locale }: { locale: LocaleId }) {
  const navigate = useNavigate();
  const [teams, setTeams] = useState<Team[]>(() => listTeams());
  const [boards, setBoards] = useState<BoardMeta[]>(() => listBoards());
  const [activeTeam, setActiveTeam] = useState<string>('default');
  const [editingTeam, setEditingTeam] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [editingBoard, setEditingBoard] = useState<string | null>(null);
  const [boardName, setBoardName] = useState('');
  const [joinLink, setJoinLink] = useState('');

  const refresh = () => {
    setTeams(listTeams());
    setBoards(listBoards());
  };

  useEffect(() => {
    // ensure default board exists
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

  const filtered = boards.filter((b) => b.teamId === activeTeam).sort((a, b) => b.updatedAt - a.updatedAt);

  const handleCreateBoard = () => {
    const b = createBoard('Новая доска', activeTeam);
    navigate(boardUrl(b.id));
  };

  const handleCreateTeam = () => {
    const t = createTeam('Новая команда');
    refresh();
    setActiveTeam(t.id);
  };

  const handleCopyLink = async (id: string) => {
    const url = `${window.location.origin}${boardUrl(id)}`;
    try { await navigator.clipboard.writeText(url); } catch { prompt('Скопируй ссылку', url); }
  };

  const handleJoin = () => {
    const v = joinLink.trim();
    if (!v) return;
    try {
      const u = new URL(v, window.location.origin);
      const m = u.pathname.match(/\/board\/([^/]+)/);
      const id = m ? m[1] : v.trim();
      if (!id) return;
      if (!getBoard(id)) {
        // чужую доску добавляем как гостевую
        const teams = listTeams();
        const def = teams[0]?.id ?? 'default';
        // create entry if not exists
        const exists = listBoards().find((b) => b.id === id);
        if (!exists) {
          // we don't have name, so create placeholder then navigate
          const b = createBoard('Чужая доска', def);
          // override id to match link? we need to keep original id
          // instead, just navigate to that id; boards.ts will create on demand
          // For now, create with that id via direct storage hack
          const all = listBoards();
          const idx = all.findIndex((x) => x.id === b.id);
          if (idx >= 0) {
            all[idx].id = id;
            localStorage.setItem('review-boards', JSON.stringify(all));
          }
        }
      }
      navigate(boardUrl(id));
    } catch {
      const id = v;
      navigate(boardUrl(id));
    }
  };

  return (
    <div className="home-root">
      <header className="file-bar">
        <div className="island file-island">
          <span className="brand">{t(locale, 'brand')}</span>
          <div className="island-sep" />
          <span className="home-title">{t(locale, 'home' as any) || 'Дом'}</span>
        </div>
        <div className="island meta-island">
          <button type="button" className="icon-btn" title={t(locale, 'settings')} onClick={() => navigate('/')}> <Icon name="settings" /> </button>
        </div>
      </header>

      <div className="home-body">
        <div className="island home-side">
          <div className="home-side-head">
            <span className="panel-label">{t(locale, 'teams' as any) || 'Команды'}</span>
            <button type="button" className="icon-btn" title="+" onClick={handleCreateTeam}><Icon name="plus" size={16} /></button>
          </div>
          <div className="home-teams">
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                className={`sheet-switch ${activeTeam === team.id ? 'on' : ''}`}
                style={{ padding: '8px 10px', borderRadius: 8, background: activeTeam === team.id ? 'var(--chrome-active-bg)' : 'transparent', width: '100%', textAlign: 'left' }}
                onClick={() => setActiveTeam(team.id)}
              >
                {editingTeam === team.id ? (
                  <input
                    autoFocus
                    value={teamName}
                    onChange={(e) => setTeamName(e.target.value)}
                    onBlur={() => { renameTeam(team.id, teamName); setEditingTeam(null); refresh(); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { renameTeam(team.id, teamName); setEditingTeam(null); refresh(); } if (e.key === 'Escape') setEditingTeam(null); }}
                    onClick={(e) => e.stopPropagation()}
                    style={{ flex: 1, background: 'var(--chrome-panel-2)', border: '1px solid var(--chrome-border)', borderRadius: 6, padding: '4px 6px', color: 'inherit' }}
                  />
                ) : (
                  <span style={{ flex: 1 }}>{team.name}</span>
                )}
                <span style={{ display: 'flex', gap: 4 }} onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => { setEditingTeam(team.id); setTeamName(team.name); }}><Icon name="pen" size={14} /></button>
                  {team.id !== 'default' && <button type="button" className="icon-btn" style={{ width: 24, height: 24 }} onClick={() => { if (confirm('Удалить команду?')) { deleteTeam(team.id); setActiveTeam('default'); refresh(); } }}><Icon name="trash" size={14} /></button>}
                </span>
              </button>
            ))}
          </div>
          <div className="sheet-section" style={{ marginTop: 12 }}>
            <h3>{t(locale, 'join' as any) || 'Подключиться'}</h3>
            <p className="sheet-hint">Вставь ссылку на доску</p>
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={joinLink} onChange={(e) => setJoinLink(e.target.value)} placeholder="https://.../board/abc" style={{ flex: 1, background: 'var(--chrome-panel-2)', border: '1px solid var(--chrome-border-soft)', borderRadius: 8, padding: '6px 8px', color: 'inherit' }} />
              <button type="button" className="style-btn active" onClick={handleJoin}>→</button>
            </div>
          </div>
        </div>

        <div className="island home-main">
          <div className="home-main-head">
            <h2>{teams.find((t) => t.id === activeTeam)?.name ?? ''}</h2>
            <button type="button" className="style-btn active" onClick={handleCreateBoard}><Icon name="plus" size={14} /> {t(locale, 'newBoard' as any) || 'Новая доска'}</button>
          </div>
          <div className="home-list">
            <div className="board-row board-row-head">
              <span className="board-col-idx">#</span>
              <span className="board-col-name">Название</span>
              <span className="board-col-team">Команда</span>
              <span className="board-col-status">Статус</span>
              <span className="board-col-date">Обновлена</span>
              <span className="board-col-actions">Действия</span>
            </div>
            {filtered.length ? (
              filtered.map((b, idx) => (
                <div key={b.id} className="island board-row" onClick={() => navigate(boardUrl(b.id))}>
                  <span className="board-col-idx">{idx + 1}</span>
                  <span className="board-col-name">
                    {editingBoard === b.id ? (
                      <input
                        autoFocus
                        value={boardName}
                        onChange={(e) => setBoardName(e.target.value)}
                        onBlur={() => { renameBoard(b.id, boardName); setEditingBoard(null); refresh(); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') { renameBoard(b.id, boardName); setEditingBoard(null); refresh(); } if (e.key === 'Escape') setEditingBoard(null); }}
                        onClick={(e) => e.stopPropagation()}
                        style={{ flex: 1, background: 'var(--chrome-panel-2)', border: '1px solid var(--chrome-border)', borderRadius: 6, padding: '4px 6px', color: 'inherit', minWidth: 120 }}
                      />
                    ) : (
                      <b style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{b.name}</b>
                    )}
                    <span className="panel-label" style={{ fontSize: 11, display: 'block' }}>{b.id}</span>
                  </span>
                  <span className="board-col-team panel-label">{teams.find((t) => t.id === b.teamId)?.name ?? b.teamId}</span>
                  <span className="board-col-status" onClick={(e) => e.stopPropagation()}>
                    <select
                      value={b.status}
                      onChange={(e) => { setBoardStatus(b.id, e.target.value as BoardStatus); refresh(); }}
                      className="size-select"
                      style={{ height: 28, fontSize: 12 }}
                    >
                      <option value="local">Локальная</option>
                      <option value="shared">Общая</option>
                      <option value="remote">Чужая</option>
                    </select>
                  </span>
                  <span className="board-col-date panel-label">{new Date(b.updatedAt).toLocaleString(readLocale() as string)}</span>
                  <span className="board-col-actions" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="style-btn" onClick={() => navigate(boardUrl(b.id))}>Открыть</button>
                    <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} title="Копировать ссылку" onClick={() => handleCopyLink(b.id)}><Icon name="copy" size={14} /></button>
                    <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} title="Переименовать" onClick={() => { setEditingBoard(b.id); setBoardName(b.name); }}><Icon name="pen" size={14} /></button>
                    <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} title="Удалить" onClick={() => { if (confirm('Удалить доску?')) { deleteBoard(b.id); refresh(); } }}><Icon name="trash" size={14} /></button>
                  </span>
                </div>
              ))
            ) : (
              <div className="sheet-hint">Нет досок в этой команде — создай первую.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
