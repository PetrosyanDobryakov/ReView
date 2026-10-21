import { useEffect, useState } from 'react';
import type { LocaleId } from '../core/locale';
import { getCurrentBoardId } from '../core/store';
import { onPrefsChange, readPrefs, writePrefs, type AppPrefs } from '../core/prefs';
import { loadUser, onUserChange, saveUserColor, USER_COLOR_PALETTE } from '../core/user';
import { APP_BUILD } from '../core/version';
import {
  appInviteUrl,
  checkNat,
  currentTurn,
  getBoardRoomName,
  isDesktop,
  lanBoardUrl,
  fetchLanAddresses,
  inviteHostname,
  onMesh,
  p2pClient,
  reconnectSync,
  refreshHubs,
  resolveInviteBoardUrl,
  type MeshSnapshot,
  type NatReport,
  type PeerInfo,
  type SyncStatus,
} from '../net';
import { t, type MessageKey } from './i18n';
import { SlideTrack } from './SlideTrack';
import { SwapText } from './SwapText';

type ConnMode = 'auto' | 'direct' | 'lan';

const MODES: ConnMode[] = ['auto', 'direct', 'lan'];

const MODE_HINT: Record<ConnMode, MessageKey> = {
  auto: 'connModeAutoHint',
  direct: 'connModeDirectHint',
  lan: 'connModeLanHint',
};

const MODE_LABEL: Record<ConnMode, MessageKey> = {
  auto: 'connModeAuto',
  direct: 'connModeDirect',
  lan: 'connModeLan',
};

const LINK_STATE_KEY: Record<PeerInfo['state'], MessageKey> = {
  open: 'p2pStateOpen',
  connecting: 'p2pStateConnecting',
  failed: 'p2pStateFailed',
  closed: 'p2pStateClosed',
};

const PATH_KEY: Record<PeerInfo['path'], MessageKey | null> = {
  lan: 'p2pPathLan',
  direct: 'p2pPathDirect',
  relay: 'p2pPathRelay',
  hub: 'p2pPathHub',
  unknown: null,
};

const ICE_BACKUP_KEY = 'review-ice-before-lan';

function readMode(p: AppPrefs): ConnMode {
  if (Array.isArray(p.p2pIce) && p.p2pIce.length === 0) return 'lan';
  if (!p.p2pTurn && !p.p2pRelays) return 'direct';
  return 'auto';
}

function readIceBackup(): string[] | null {
  try {
    const raw = localStorage.getItem(ICE_BACKUP_KEY);
    const list: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : null;
  } catch {
    return null;
  }
}

function applyModePatch(mode: ConnMode, cur: AppPrefs): Partial<AppPrefs> {
  if (mode === 'lan') {
    try {
      if (cur.p2pIce && cur.p2pIce.length) localStorage.setItem(ICE_BACKUP_KEY, JSON.stringify(cur.p2pIce));
    } catch {
      /* best effort */
    }
    return { p2pIce: [] };
  }
  const lanNow = Array.isArray(cur.p2pIce) && cur.p2pIce.length === 0;
  const ice = lanNow ? readIceBackup() : cur.p2pIce;
  if (mode === 'direct') return { p2pTurn: false, p2pRelays: false, p2pIce: ice };
  return { p2pTurn: true, p2pRelays: true, p2pIce: ice };
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

async function copyFallback(text: string): Promise<boolean> {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * The human side of P2P: status, invite, identity, link mode, people and
 * network check. Raw wires (hub editing, ICE lines, logs) live behind the
 * developer gate in System; diagnostics copy stays here for support cases.
 */
export function ConnectionTab({
  locale,
  sync,
  saved,
  ephemeral,
  nick,
  onNick,
}: {
  locale: LocaleId;
  sync: SyncStatus;
  saved: boolean;
  ephemeral: boolean;
  nick: string;
  onNick: (value: string) => void;
}) {
  const [prefs, setPrefs] = useState<AppPrefs>(() => readPrefs());
  const [snap, setSnap] = useState<MeshSnapshot>(() => p2pClient.getMeshSnapshot());
  const [names, setNames] = useState(() => p2pClient.clientNames());
  const [userColor, setUserColor] = useState(() => loadUser().color);
  const [nat, setNat] = useState<NatReport | 'checking' | null>(null);
  const [diagCopied, setDiagCopied] = useState(false);
  const [inviteFlash, setInviteFlash] = useState<'ok' | 'fail' | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [kickedIds, setKickedIds] = useState<string[]>(() => p2pClient.blockedPeers());
  const boardSession = Boolean(getCurrentBoardId());
  const desktop = isDesktop();
  const mode = readMode(prefs);

  useEffect(() => onMesh((s) => {
    setSnap(s);
    setNames(p2pClient.clientNames());
    setKickedIds(p2pClient.blockedPeers());
  }), []);

  useEffect(() => onPrefsChange((p) => setPrefs(p)), []);

  useEffect(() => onUserChange((u) => setUserColor(u.color)), []);

  const apply = (patch: Partial<AppPrefs>) => {
    setPrefs(writePrefs(patch));
    reconnectSync();
  };

  const runNat = async (): Promise<NatReport> => {
    setNat('checking');
    const r = await checkNat().catch((): NatReport => ({ kind: 'unknown', publicIp: null, mapped: [], stunServers: 0 }));
    setNat(r);
    return r;
  };

  const copyDiagnostics = async () => {
    const report = nat && nat !== 'checking' ? nat : await runNat();
    const mesh = p2pClient.getMeshSnapshot();
    const prefsNow = readPrefs();
    const redactedIce = prefsNow.p2pIce
      ? prefsNow.p2pIce.map((line) => {
          const parts = line.split('|').map((s) => s.trim());
          if (parts.length >= 3) return `${parts[0]}|${parts[1]}|(set)`;
          return line;
        })
      : null;
    let viteHubs = '';
    try {
      viteHubs = String((import.meta as unknown as { env?: Record<string, string> }).env?.VITE_HUBS ?? '');
    } catch {
      /* ignore */
    }
    let events: unknown = [];
    try {
      events = p2pClient.getRecentEvents();
    } catch {
      /* ignore */
    }
    const text = JSON.stringify(
      {
        app: APP_BUILD,
        desktop,
        ua: navigator.userAgent,
        at: new Date().toISOString(),
        origin: typeof location !== 'undefined' ? location.origin : null,
        viteHubs,
        syncEnabled: prefsNow.syncEnabled !== false,
        webrtc: mesh.webrtc,
        nat: report,
        turn: currentTurn() ? { exp: new Date(currentTurn()!.exp).toISOString() } : null,
        turnPref: prefsNow.p2pTurn,
        prefs: {
          p2pRelays: prefsNow.p2pRelays,
          p2pTurn: prefsNow.p2pTurn,
          p2pLanDiscovery: prefsNow.p2pLanDiscovery,
          p2pIce: redactedIce,
        },
        room: mesh.room,
        self: mesh.self,
        hubs: mesh.hubs.map((h) => ({ url: h.url, state: h.state, peers: h.peers, error: h.error })),
        peers: mesh.peers.map((p) => ({
          peer: p.peer.slice(0, 8),
          state: p.state,
          path: p.path,
          attempts: p.attempts,
          lastError: p.lastError,
          lastDirectError: p.lastDirectError,
          awareAgeMs: p.awareAgeMs,
          queued: p.queued,
          relay: p.relay,
          ice: p.ice,
          hubs: p.hubs,
          app: p.app,
        })),
        events,
      },
      null,
      1,
    );
    if ((await copy(text)) || (await copyFallback(text))) {
      setDiagCopied(true);
      window.setTimeout(() => setDiagCopied(false), 2000);
    }
  };

  const flashInvite = (ok: boolean) => {
    setInviteFlash(ok ? 'ok' : 'fail');
    window.setTimeout(() => setInviteFlash(null), 2000);
  };

  const copyInvite = async () => {
    const boardId = getCurrentBoardId();
    if (!boardId) {
      flashInvite(false);
      return;
    }
    try {
      const { url } = await resolveInviteBoardUrl(boardId);
      if (url && ((await copy(url)) || (await copyFallback(url)))) {
        flashInvite(true);
        return;
      }
    } catch {
      /* fall through to LAN */
    }
    try {
      const info = await fetchLanAddresses();
      const host = inviteHostname(info.addresses);
      if (host && ((await copy(lanBoardUrl(boardId, host, info.port))) || (await copyFallback(lanBoardUrl(boardId, host, info.port))))) {
        flashInvite(true);
        return;
      }
    } catch {
      /* ignore */
    }
    flashInvite(false);
  };

  const copyAppInvite = async () => {
    const boardId = getCurrentBoardId();
    if (!boardId) {
      flashInvite(false);
      return;
    }
    flashInvite((await copy(appInviteUrl(boardId))) || (await copyFallback(appInviteUrl(boardId))));
  };

  const kick = (peer: string) => {
    if (p2pClient.blockPeer(peer)) setKickedIds(p2pClient.blockedPeers());
  };

  const toggleExpanded = (peer: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(peer)) next.delete(peer);
      else next.add(peer);
      return next;
    });
  };

  const peerLabel = (p: PeerInfo) => {
    for (const c of p.clients) {
      const n = names.get(c);
      if (n) return n;
    }
    return null;
  };

  const open = snap.peers.filter((p) => p.state === 'open').length;
  const hubsOpen = snap.hubs.filter((h) => h.state === 'open').length;
  const hubsPeers = snap.hubs.reduce((n, h) => n + (h.state === 'open' ? h.peers : 0), 0);
  const hubsSummary = t(locale, 'connHubsSummary')
    .replace('{open}', String(hubsOpen))
    .replace('{all}', String(snap.hubs.length))
    .replace('{peers}', String(hubsPeers));

  return (
    <div className="p2p-panel">
      <button
        type="button"
        role="switch"
        className={`sheet-switch${prefs.syncEnabled ? ' on' : ''}`}
        aria-checked={prefs.syncEnabled}
        onClick={() => apply({ syncEnabled: !prefs.syncEnabled })}
      >
        <span>{t(locale, 'p2pSwitch')}</span>
        <span className="switch" aria-hidden="true">
          <span className="switch-thumb" />
        </span>
      </button>
      <p className="sheet-hint">
        <SwapText text={t(locale, 'p2pIntro')} />
      </p>
      {!snap.webrtc ? (
        <p className="sheet-hint p2p-warn">{t(locale, 'p2pNoWebrtc')}</p>
      ) : null}

      <ul className="sheet-keys">
        <li>
          <span className={`status-line${sync.online ? ' on' : ''}`}>
            {!prefs.syncEnabled ? t(locale, 'syncDisconnect') : sync.online ? t(locale, 'online') : t(locale, 'offline')}
          </span>
          <span>
            {t(locale, 'p2pPeers')}: {open}
          </span>
        </li>
        <li>
          <span>{t(locale, 'syncRoom')}</span>
          <span className="sheet-mono">{boardSession ? getBoardRoomName(getCurrentBoardId()) : '—'}</span>
        </li>
        <li>
          <span>{t(locale, 'p2pPeerId')}</span>
          <span className="sheet-mono">{snap.self}</span>
        </li>
        <li>
          <span className={`status-line${ephemeral ? ' wait' : saved ? ' on' : ' wait'}`}>{t(locale, 'persist')}</span>
          <span>{ephemeral ? t(locale, 'persistSession') : saved ? t(locale, 'persistSaved') : t(locale, 'loading')}</span>
        </li>
      </ul>

      <section className="sheet-section">
        <h3>{t(locale, 'membersInvite')}</h3>
        {!boardSession ? (
          <p className="sheet-hint">{t(locale, 'syncBoardOnly')}</p>
        ) : (
          <div className="sheet-actions">
            <button
              type="button"
              className="style-btn active"
              disabled={!boardSession}
              onClick={() => void copyInvite()}
            >
              {inviteFlash === 'ok'
                ? t(locale, 'membersInviteCopied')
                : inviteFlash === 'fail'
                  ? t(locale, 'membersInviteFail')
                  : t(locale, 'membersCopyInvite')}
            </button>
            <button
              type="button"
              className="style-btn"
              disabled={!boardSession}
              title={t(locale, 'membersInviteNetHint')}
              onClick={() => void copyAppInvite()}
            >
              {t(locale, 'membersCopyAppInvite')}
            </button>
          </div>
        )}
      </section>

      <section className="sheet-section">
        <h3>{t(locale, 'membersYou')}</h3>
        <label className="nick-row">
          <span>{t(locale, 'nickname')}</span>
          <input
            type="text"
            className="nick-input"
            value={nick}
            maxLength={24}
            placeholder={t(locale, 'nicknameHint')}
            onChange={(e) => onNick(e.target.value)}
          />
        </label>
        <div className="members-colors sheet-member-colors" role="group" aria-label={t(locale, 'membersColor')}>
          {USER_COLOR_PALETTE.map((c) => (
            <button
              type="button"
              key={c}
              className={`members-swatch${userColor.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
              style={{ background: c }}
              title={c}
              aria-label={c}
              aria-pressed={userColor.toLowerCase() === c.toLowerCase()}
              onClick={() => {
                const next = saveUserColor(c);
                setUserColor(next.color);
              }}
            />
          ))}
          <input
            type="color"
            className="members-swatch-custom"
            value={/^#[0-9a-fA-F]{6}$/i.test(userColor) ? userColor : '#7c8cff'}
            title={userColor}
            aria-label={t(locale, 'membersColor')}
            onChange={(e) => {
              const next = saveUserColor(e.target.value);
              setUserColor(next.color);
            }}
          />
        </div>
      </section>

      <section className="sheet-section">
        <h3>{t(locale, 'connMode')}</h3>
        <SlideTrack className="locale-row" active={mode}>
          {MODES.map((m) => (
            <button
              type="button"
              key={m}
              className="style-btn"
              data-slide-active={mode === m ? 'true' : undefined}
              aria-pressed={mode === m}
              onClick={() => {
                if (m === mode) return;
                apply(applyModePatch(m, readPrefs()));
              }}
            >
              {t(locale, MODE_LABEL[m])}
            </button>
          ))}
        </SlideTrack>
        <p className="sheet-hint">{t(locale, MODE_HINT[mode])}</p>
      </section>

      <section className="sheet-section">
        <h3>{t(locale, 'connPeople')}</h3>
        {!boardSession ? (
          <p className="sheet-hint">{t(locale, 'syncBoardOnly')}</p>
        ) : snap.peers.length === 0 && kickedIds.length === 0 ? (
          <p className="sheet-hint">{t(locale, 'p2pNoPeers')}</p>
        ) : (
          <ul className="p2p-list">
            {snap.peers.map((p) => {
              const who = peerLabel(p);
              const path = PATH_KEY[p.path];
              const isOpen = expanded.has(p.peer);
              return (
                <li key={p.peer} className="p2p-row">
                  <span className="p2p-row-head">
                    <span
                      className={`status-line${p.state === 'open' ? ' on' : p.state === 'connecting' ? ' wait' : ''}`}
                    >
                      {who ? (
                        <span className="p2p-name" style={{ color: who.color }}>
                          {who.name}
                        </span>
                      ) : (
                        <span className="sheet-mono">{p.peer.slice(0, 8)}</span>
                      )}
                    </span>
                    <span className="p2p-tag">{t(locale, LINK_STATE_KEY[p.state])}</span>
                  </span>
                  <span className="p2p-meta">
                    {path ? <span>{t(locale, path)}</span> : null}
                    {p.rtt !== null ? <span>{p.rtt} ms</span> : null}
                    {p.app ? <span className="sheet-mono">v{p.app.split('+')[0]}</span> : null}
                  </span>
                  <span className="p2p-meta">
                    <button
                      type="button"
                      className="style-btn p2p-mini"
                      aria-expanded={isOpen}
                      onClick={() => toggleExpanded(p.peer)}
                    >
                      {isOpen ? t(locale, 'connHide') : t(locale, 'connDetails')}
                    </button>
                    <button
                      type="button"
                      className="style-btn p2p-mini"
                      title={t(locale, 'connKickTitle')}
                      onClick={() => kick(p.peer)}
                    >
                      {t(locale, 'connKick')}
                    </button>
                  </span>
                  {isOpen ? (
                    <span className="p2p-meta">
                      {p.state === 'open' ? (
                        <span>
                          {bytes(p.bytesIn)} / {bytes(p.bytesOut)}
                        </span>
                      ) : null}
                      {p.attempts > 1 && p.state !== 'open' ? <span>#{p.attempts}</span> : null}
                      {p.state !== 'open' && p.lastError ? <span className="p2p-warn">{p.lastError}</span> : null}
                      {p.lastDirectError ? <span className="p2p-warn">direct: {p.lastDirectError}</span> : null}
                      {p.ice ? (
                        <span className="sheet-mono">
                          {p.ice.local.join('+') || '—'} / {p.ice.remote.join('+') || '—'}
                        </span>
                      ) : null}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        {kickedIds.length ? (
          <p className="sheet-hint">
            {t(locale, 'connKicked')}: <span className="sheet-mono">{kickedIds.join(', ')}</span>
          </p>
        ) : null}
      </section>

      <section className="sheet-section">
        <h3>{t(locale, 'p2pNetCheck')}</h3>
        {nat === 'checking' ? (
          <p className="sheet-hint">{t(locale, 'p2pNatChecking')}</p>
        ) : nat ? (
          <p className={`sheet-hint${nat.kind === 'ok' ? '' : ' p2p-warn'}`}>
            {t(locale, nat.kind === 'ok' ? 'p2pNatOk' : nat.kind === 'symmetric' ? 'p2pNatSymmetric' : nat.kind === 'blocked' ? 'p2pNatBlocked' : 'p2pNatUnknown')}
            {nat.publicIp ? ` (${nat.mapped.join(', ')})` : ''}
          </p>
        ) : (
          <p className="sheet-hint">{t(locale, 'p2pNetCheckHint')}</p>
        )}
        <div className="sheet-actions">
          <button type="button" className="style-btn" disabled={nat === 'checking'} onClick={() => void runNat()}>
            {t(locale, 'p2pNatRun')}
          </button>
          <button type="button" className="style-btn" disabled={nat === 'checking'} onClick={() => void copyDiagnostics()}>
            {diagCopied ? t(locale, 'syncLanCopied') : t(locale, 'p2pDiagCopy')}
          </button>
        </div>
      </section>

      <section className="sheet-section">
        <h3>{t(locale, 'p2pHubs')}</h3>
        <p className="sheet-hint">{hubsSummary}</p>
        <div className="sheet-actions">
          <button type="button" className="style-btn" disabled={!boardSession} onClick={() => refreshHubs()}>
            {t(locale, 'p2pRefresh')}
          </button>
        </div>
      </section>
    </div>
  );
}
