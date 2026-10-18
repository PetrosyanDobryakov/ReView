import { useEffect, useState } from 'react';
import type { LocaleId } from '../core/locale';
import { getCurrentBoardId } from '../core/store';
import { parseIceLines, readPrefs, writePrefs, type AppPrefs } from '../core/prefs';
import { APP_BUILD } from '../core/version';
import {
  checkNat,
  currentTurn,
  type NatReport,
  DEFAULT_ICE,
  fetchLanAddresses,
  getBoardRoomName,
  inviteHostname,
  isDesktop,
  lanAppUrl,
  normalizeHubUrl,
  onMesh,
  changeDataFolder,
  desktopHostInfo,
  openBoardsFolder,
  p2pClient,
  reconnectSync,
  refreshHubs,
  type HubInfo,
  type MeshSnapshot,
  type PeerInfo,
  type SyncStatus,
} from '../net';
import { t, type MessageKey } from './i18n';
import { SwapText } from './SwapText';

const HUB_STATE_KEY: Record<HubInfo['state'], MessageKey> = {
  open: 'p2pStateOpen',
  connecting: 'p2pStateConnecting',
  retrying: 'p2pHubRetrying',
  blocked: 'p2pHubBlocked',
  error: 'p2pHubError',
};

const HUB_SOURCE_KEY: Record<HubInfo['source'], MessageKey> = {
  self: 'p2pHubSelf',
  lan: 'p2pHubLan',
  preset: 'p2pHubPreset',
  custom: 'p2pHubCustom',
  invite: 'p2pHubInvite',
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

/**
 * The P2P control surface: on/off, this device's host and invite address,
 * live peer links (path, latency, traffic), hubs, and ICE settings.
 */
export function P2pPanel({
  locale,
  sync,
  saved,
  ephemeral,
}: {
  locale: LocaleId;
  sync: SyncStatus;
  saved: boolean;
  ephemeral: boolean;
}) {
  const [prefs, setPrefs] = useState<AppPrefs>(() => readPrefs());
  const [snap, setSnap] = useState<MeshSnapshot>(() => p2pClient.getMeshSnapshot());
  const [names, setNames] = useState(() => p2pClient.clientNames());
  const [lan, setLan] = useState<{ addresses: string[]; port: number } | null>(null);
  const [lanState, setLanState] = useState<'loading' | 'ok' | 'none'>('loading');
  const [copied, setCopied] = useState(false);
  const [hubDraft, setHubDraft] = useState('');
  const [hubError, setHubError] = useState(false);
  const [iceDraft, setIceDraft] = useState(() => (readPrefs().p2pIce ?? [...DEFAULT_ICE]).join('\n'));
  const [iceError, setIceError] = useState(false);
  const boardSession = Boolean(getCurrentBoardId());
  const desktop = isDesktop();
  const [nat, setNat] = useState<NatReport | 'checking' | null>(null);
  const [diagCopied, setDiagCopied] = useState(false);
  const runNat = async (): Promise<NatReport> => {
    setNat('checking');
    const r = await checkNat().catch((): NatReport => ({ kind: 'unknown', publicIp: null, mapped: [], stunServers: 0 }));
    setNat(r);
    return r;
  };
  const copyDiagnostics = async () => {
    const report = nat && nat !== 'checking' ? nat : await runNat();
    const mesh = p2pClient.getMeshSnapshot();
    const text = JSON.stringify(
      {
        app: APP_BUILD,
        desktop,
        ua: navigator.userAgent,
        at: new Date().toISOString(),
        nat: report,
        turn: currentTurn() ? { exp: new Date(currentTurn()!.exp).toISOString() } : null,
        turnPref: readPrefs().p2pTurn,
        room: mesh.room,
        self: mesh.self,
        hubs: mesh.hubs.map((h) => ({ url: h.url, state: h.state, peers: h.peers, error: h.error })),
        peers: mesh.peers.map((p) => ({
          peer: p.peer.slice(0, 8),
          state: p.state,
          path: p.path,
          attempts: p.attempts,
          lastError: p.lastError,
          ice: p.ice,
          hubs: p.hubs,
          app: p.app,
        })),
      },
      null,
      1,
    );
    if (await copy(text)) {
      setDiagCopied(true);
      window.setTimeout(() => setDiagCopied(false), 2000);
    } else {
      prompt(t(locale, 'p2pDiagCopy'), text);
    }
  };
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    if (desktop) void desktopHostInfo().then((i) => setDataDir(i?.dataDir ?? i?.boardsDir ?? null));
  }, [desktop]);

  useEffect(
    () =>
      onMesh((s) => {
        setSnap(s);
        setNames(p2pClient.clientNames());
      }),
    [],
  );

  useEffect(() => {
    let live = true;
    setLanState('loading');
    fetchLanAddresses()
      .then((info) => {
        if (!live) return;
        setLan({ addresses: info.addresses, port: info.port });
        setLanState(info.addresses.length ? 'ok' : 'none');
      })
      .catch(() => {
        if (live) setLanState('none');
      });
    return () => {
      live = false;
    };
  }, []);

  const apply = (patch: Partial<AppPrefs>) => {
    setPrefs(writePrefs(patch));
    reconnectSync();
  };

  const addHub = () => {
    const url = normalizeHubUrl(hubDraft);
    if (!url) {
      setHubError(true);
      return;
    }
    setHubDraft('');
    setHubError(false);
    if (!prefs.p2pHubs.includes(url)) apply({ p2pHubs: [...prefs.p2pHubs, url] });
  };

  const inviteHost = lan ? inviteHostname(lan.addresses) : null;
  const peerLabel = (p: PeerInfo) => {
    for (const c of p.clients) {
      const n = names.get(c);
      if (n) return n;
    }
    return null;
  };
  const open = snap.peers.filter((p) => p.state === 'open').length;

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
          <span className={`status-line${ephemeral ? ' wait' : saved ? ' on' : ' wait'}`}>{t(locale, 'persist')}</span>
          <span>{ephemeral ? t(locale, 'persistSession') : saved ? t(locale, 'persistSaved') : t(locale, 'loading')}</span>
        </li>
        <li>
          <span>{t(locale, 'syncRoom')}</span>
          <span className="sheet-mono">{boardSession ? getBoardRoomName(getCurrentBoardId()) : '—'}</span>
        </li>
        <li>
          <span>{t(locale, 'p2pPeerId')}</span>
          <span className="sheet-mono">{snap.self}</span>
        </li>
      </ul>

      <div className="lan-block">
        <h4 className="lan-block-title">
          <SwapText text={t(locale, 'syncLanSection')} />
        </h4>
        {lanState === 'loading' ? (
          <p className="sheet-hint">{t(locale, 'syncLanLoading')}</p>
        ) : lanState === 'none' || !inviteHost ? (
          <p className="sheet-hint">
            <SwapText text={t(locale, 'syncLanEmpty')} />
          </p>
        ) : (
          <ul className="lan-ip-list">
            {lan!.addresses.map((ip) => (
              <li key={ip} className="sheet-mono">
                {lanAppUrl(ip, lan!.port)}
              </li>
            ))}
          </ul>
        )}
        <div className="sheet-actions">
          <button
            type="button"
            className="style-btn active"
            disabled={!inviteHost || !lan}
            onClick={async () => {
              if (!inviteHost || !lan) return;
              const url = lanAppUrl(inviteHost, lan.port);
              if (await copy(url)) {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              } else {
                prompt(t(locale, 'syncLanCopyApp'), url);
              }
            }}
          >
            {copied ? t(locale, 'syncLanCopied') : t(locale, 'syncLanCopyApp')}
          </button>
          {desktop ? (
            <button type="button" className="style-btn" onClick={() => void openBoardsFolder()}>
              {t(locale, 'p2pBoardsFolder')}
            </button>
          ) : null}
        </div>
        {desktop && dataDir ? (
          <div className="p2p-row">
            <span className="sheet-hint">{t(locale, 'p2pDataFolder')}</span>
            <span className="sheet-mono p2p-url" title={dataDir}>
              {dataDir}
            </span>
            <button
              type="button"
              className="style-btn p2p-mini"
              disabled={moving}
              onClick={async () => {
                setMoving(true);
                try {
                  if (!(await changeDataFolder())) setMoving(false);
                } catch {
                  setMoving(false);
                }
              }}
            >
              {moving ? t(locale, 'p2pDataMoving') : t(locale, 'p2pDataChange')}
            </button>
          </div>
        ) : null}
        <p className="sheet-hint">
          <SwapText text={t(locale, 'syncLanFirewall')} />
        </p>
      </div>

      <div className="lan-block">
        <h4 className="lan-block-title">{t(locale, 'p2pPeers')}</h4>
        {!boardSession ? (
          <p className="sheet-hint">{t(locale, 'syncBoardOnly')}</p>
        ) : snap.peers.length === 0 ? (
          <p className="sheet-hint">{t(locale, 'p2pNoPeers')}</p>
        ) : (
          <ul className="p2p-list">
            {snap.peers.map((p) => {
              const who = peerLabel(p);
              const path = PATH_KEY[p.path];
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
                    {p.state === 'open' ? (
                      <span>
                        {bytes(p.bytesIn)} / {bytes(p.bytesOut)}
                      </span>
                    ) : null}
                    {p.attempts > 1 && p.state !== 'open' ? <span>#{p.attempts}</span> : null}
                    {p.state !== 'open' && p.lastError ? <span className="p2p-warn">{p.lastError}</span> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="lan-block">
        <h4 className="lan-block-title">{t(locale, 'p2pNetCheck')}</h4>
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
      </div>

      <div className="lan-block">
        <h4 className="lan-block-title">{t(locale, 'p2pHubs')}</h4>
        <p className="sheet-hint">
          <SwapText text={t(locale, 'p2pHubsHint')} />
        </p>
        {boardSession && snap.hubs.length === 0 ? (
          <p className="sheet-hint p2p-warn">{t(locale, 'p2pNoHubs')}</p>
        ) : null}
        <ul className="p2p-list">
          {snap.hubs.map((h) => (
            <li key={h.url} className="p2p-row">
              <span className="p2p-row-head">
                <span
                  className={`status-line${h.state === 'open' ? ' on' : h.state === 'connecting' || h.state === 'retrying' ? ' wait' : ''}`}
                >
                  <span className="sheet-mono p2p-url" title={h.url}>
                    {h.name ? `${h.name} · ` : ''}
                    {h.url.replace(/^(nostr\+)?wss?:\/\//, '')}
                  </span>
                </span>
                <span className="p2p-tag">{t(locale, HUB_SOURCE_KEY[h.source])}</span>
              </span>
              <span className="p2p-meta">
                <span>{t(locale, HUB_STATE_KEY[h.state])}</span>
                {h.state === 'open' ? (
                  <span>
                    {h.peers} {t(locale, 'p2pHubPeers')}
                  </span>
                ) : null}
                {h.source === 'custom' ? (
                  <button
                    type="button"
                    className="style-btn p2p-mini"
                    onClick={() => apply({ p2pHubs: prefs.p2pHubs.filter((u) => u !== h.url) })}
                  >
                    {t(locale, 'p2pRemove')}
                  </button>
                ) : null}
              </span>
            </li>
          ))}
          {/* Custom hubs stay listed even with no board open, so they can be removed. */}
          {!boardSession
            ? prefs.p2pHubs.map((u) => (
                <li key={u} className="p2p-row">
                  <span className="p2p-row-head">
                    <span className="sheet-mono p2p-url">{u.replace(/^wss?:\/\//, '')}</span>
                    <span className="p2p-tag">{t(locale, 'p2pHubCustom')}</span>
                  </span>
                  <span className="p2p-meta">
                    <button
                      type="button"
                      className="style-btn p2p-mini"
                      onClick={() => apply({ p2pHubs: prefs.p2pHubs.filter((x) => x !== u) })}
                    >
                      {t(locale, 'p2pRemove')}
                    </button>
                  </span>
                </li>
              ))
            : null}
        </ul>
        <label className="nick-row">
          <span>{t(locale, 'p2pAddHub')}</span>
          <input
            type="text"
            className="nick-input"
            value={hubDraft}
            placeholder="192.168.1.20:1234"
            spellCheck={false}
            aria-invalid={hubError}
            onChange={(e) => {
              setHubDraft(e.target.value);
              setHubError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addHub();
            }}
          />
        </label>
        <p className="sheet-hint">
          <SwapText text={t(locale, hubError ? 'p2pAddHubInvalid' : 'p2pAddHubHint')} />
        </p>
        <div className="sheet-actions">
          <button type="button" className="style-btn active" disabled={!hubDraft.trim()} onClick={addHub}>
            {t(locale, 'p2pAdd')}
          </button>
          <button type="button" className="style-btn" disabled={!boardSession} onClick={() => refreshHubs()}>
            {t(locale, 'p2pRefresh')}
          </button>
        </div>
        <button
          type="button"
          role="switch"
          className={`sheet-switch p2p-gap${prefs.p2pLanDiscovery ? ' on' : ''}`}
          aria-checked={prefs.p2pLanDiscovery}
          onClick={() => apply({ p2pLanDiscovery: !prefs.p2pLanDiscovery })}
        >
          <span>{t(locale, 'p2pLanDiscovery')}</span>
          <span className="switch" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </button>
        <button
          type="button"
          role="switch"
          className={`sheet-switch p2p-gap${prefs.p2pRelays ? ' on' : ''}`}
          aria-checked={prefs.p2pRelays}
          title={t(locale, 'p2pRelaysHint')}
          onClick={() => apply({ p2pRelays: !prefs.p2pRelays })}
        >
          <span>{t(locale, 'p2pRelays')}</span>
          <span className="switch" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </button>
        <button
          type="button"
          role="switch"
          className={`sheet-switch p2p-gap${prefs.p2pTurn ? ' on' : ''}`}
          aria-checked={prefs.p2pTurn}
          title={t(locale, 'p2pTurnHint')}
          onClick={() => apply({ p2pTurn: !prefs.p2pTurn })}
        >
          <span>{t(locale, 'p2pTurn')}</span>
          <span className="switch" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </button>
      </div>

      <details className="lan-block p2p-advanced">
        <summary className="lan-block-title">{t(locale, 'p2pAdvanced')}</summary>
        <label className="p2p-ice">
          <span>{t(locale, 'p2pIce')}</span>
          <textarea
            className="nick-input"
            rows={3}
            value={iceDraft}
            spellCheck={false}
            aria-invalid={iceError}
            onChange={(e) => {
              setIceDraft(e.target.value);
              setIceError(false);
            }}
          />
        </label>
        <p className="sheet-hint">
          <SwapText text={t(locale, iceError ? 'p2pIceInvalid' : 'p2pIceHint')} />
        </p>
        <div className="sheet-actions">
          <button
            type="button"
            className="style-btn active"
            onClick={() => {
              const parsed = parseIceLines(iceDraft);
              if (!parsed) {
                setIceError(true);
                return;
              }
              apply({ p2pIce: parsed });
            }}
          >
            {t(locale, 'syncUrlApply')}
          </button>
          <button
            type="button"
            className="style-btn"
            onClick={() => {
              setIceDraft(DEFAULT_ICE.join('\n'));
              setIceError(false);
              apply({ p2pIce: null });
            }}
          >
            {t(locale, 'syncUrlReset')}
          </button>
        </div>
      </details>
    </div>
  );
}
