import { useEffect, useState } from 'react';
import type { LocaleId } from '../core/locale';
import { getCurrentBoardId } from '../core/store';
import { parseIceLines, readPrefs, writePrefs, type AppPrefs } from '../core/prefs';
import {
  DEFAULT_ICE,
  normalizeHubUrl,
  onMesh,
  p2pClient,
  reconnectSync,
  type HubInfo,
  type MeshSnapshot,
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

/**
 * Developer wires for P2P: raw hub list with manual add/remove, the three
 * low-level switches the link-mode radio abstracts, and the ICE textarea.
 * Rendered only behind the developer gate in System. Everyday controls
 * (status, invite, mode, people, network check) live in ConnectionTab.
 */
export function P2pPanel({ locale }: { locale: LocaleId }) {
  const [prefs, setPrefs] = useState<AppPrefs>(() => readPrefs());
  const [snap, setSnap] = useState<MeshSnapshot>(() => p2pClient.getMeshSnapshot());
  const [hubDraft, setHubDraft] = useState('');
  const [hubError, setHubError] = useState(false);
  const [iceDraft, setIceDraft] = useState(() => (readPrefs().p2pIce ?? [...DEFAULT_ICE]).join('\n'));
  const [iceError, setIceError] = useState(false);
  const boardSession = Boolean(getCurrentBoardId());

  useEffect(() => onMesh((s) => setSnap(s)), []);

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

  return (
    <div className="p2p-panel">
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
                {h.error ? <span className="p2p-warn">{h.error}</span> : null}
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
