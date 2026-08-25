import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { LocaleId } from '../core/locale';
import type { PeerCursor } from '../core/store';
import { clearPeerDisplay, setPeerDisplay } from '../core/peerDisplay';
import {
  loadUser,
  onUserChange,
  saveUser,
  saveUserColor,
  USER_COLOR_PALETTE,
  type UserInfo,
} from '../core/user';
import { Icon } from './icons';
import { t } from './i18n';

function Face({ color, title }: { color: string; title?: string }) {
  return (
    <span className="members-face" style={{ background: color }} title={title}>
      <Icon name="person" size={12} />
    </span>
  );
}

function ColorRow({
  value,
  label,
  onPick,
}: {
  value: string;
  label: string;
  onPick: (c: string) => void;
}) {
  return (
    <div className="members-colors" role="group" aria-label={label}>
      {USER_COLOR_PALETTE.map((c) => (
        <button
          type="button"
          key={c}
          className={`members-swatch${value.toLowerCase() === c.toLowerCase() ? ' active' : ''}`}
          style={{ background: c }}
          title={c}
          aria-label={c}
          aria-pressed={value.toLowerCase() === c.toLowerCase()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
        />
      ))}
      <input
        type="color"
        className="members-swatch-custom"
        value={/^#[0-9a-fA-F]{6}$/i.test(value) ? value : '#7c8cff'}
        title={value}
        aria-label={label}
        onMouseDown={(e) => e.preventDefault()}
        onChange={(e) => onPick(e.target.value)}
      />
    </div>
  );
}

export function MembersMenu({
  locale,
  online,
  peers,
  onOpenConnection,
}: {
  locale: LocaleId;
  online: boolean;
  peers: PeerCursor[];
  onOpenConnection: () => void;
}) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const nickInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [user, setUser] = useState<UserInfo>(() => loadUser());
  const [nickDraft, setNickDraft] = useState(() => loadUser().name);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => onUserChange((u) => {
    setUser(u);
    setNickDraft(u.name);
  }), []);

  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => nickInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  const placeMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = 300;
    const gap = 8;
    const left = Math.min(Math.max(8, rect.right - width), window.innerWidth - width - 8);
    const estimatedHeight = 360;
    const below = rect.bottom + gap;
    const above = rect.top - gap - estimatedHeight;
    const flip = below + estimatedHeight > window.innerHeight - 8 && above >= 8;
    setMenuStyle({ left, top: Math.max(8, flip ? above : below) });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    placeMenu();
    const onReflow = () => placeMenu();
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, placeMenu, peers.length]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        triggerRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const faces: { color: string; key: string }[] = [
    { color: user.color, key: 'self' },
    ...peers.slice(0, 3).map((p) => ({ color: p.color, key: `peer-${p.id}` })),
  ];
  const overflow = Math.max(0, peers.length - 3);
  const label = online ? t(locale, 'online') : t(locale, 'offline');
  const title = peers.length
    ? `${label}: ${[user.name, ...peers.map((p) => p.name)].join(', ')}`
    : `${t(locale, 'members')} — ${label}`;

  const menu =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="dialog"
            aria-modal="true"
            aria-label={t(locale, 'members')}
            className="members-menu island"
            style={{ left: menuStyle.left, top: menuStyle.top }}
          >
            <section className="members-section">
              <h3 className="members-section-title">{t(locale, 'membersYou')}</h3>
              <label className="members-field">
                <span>{t(locale, 'nickname')}</span>
                <input
                  ref={nickInputRef}
                  type="text"
                  className="nick-input"
                  value={nickDraft}
                  maxLength={24}
                  placeholder={t(locale, 'nicknameHint')}
                  onChange={(e) => {
                    setNickDraft(e.target.value);
                    saveUser(e.target.value);
                  }}
                />
              </label>
              <ColorRow
                value={user.color}
                label={t(locale, 'membersColor')}
                onPick={(c) => saveUserColor(c)}
              />
            </section>

            <section className="members-section">
              <h3 className="members-section-title">{t(locale, 'membersOnBoard')}</h3>
              {peers.length === 0 ? (
                <p className="members-empty">{t(locale, 'membersAlone')}</p>
              ) : (
                <ul className="members-list">
                  {peers.map((peer) => (
                    <li key={peer.id} className="members-peer">
                      <div className="members-peer-head">
                        <Face color={peer.color} />
                        <label className="members-field members-field-grow">
                          <span className="visually-hidden">{t(locale, 'peerLocalName')}</span>
                          <input
                            type="text"
                            className="nick-input"
                            value={peer.name}
                            maxLength={24}
                            title={
                              peer.overridden
                                ? `${peer.publishedName} → ${peer.name}`
                                : peer.publishedName
                            }
                            onChange={(e) => setPeerDisplay(peer.userId, { name: e.target.value })}
                          />
                        </label>
                        {peer.overridden ? (
                          <button
                            type="button"
                            className="style-btn members-reset"
                            title={t(locale, 'membersResetLocal')}
                            onClick={() => clearPeerDisplay(peer.userId)}
                          >
                            {t(locale, 'membersResetLocal')}
                          </button>
                        ) : null}
                      </div>
                      <ColorRow
                        value={peer.color}
                        label={t(locale, 'membersColor')}
                        onPick={(c) => setPeerDisplay(peer.userId, { color: c })}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <footer className="members-foot">
              <button
                type="button"
                className="style-btn"
                onClick={() => {
                  close();
                  onOpenConnection();
                }}
              >
                {t(locale, 'membersOpenConnection')}
              </button>
            </footer>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="members-root">
      <button
        ref={triggerRef}
        type="button"
        className={`members-trigger${online ? ' online' : ''}${open ? ' is-open' : ''}`}
        title={title}
        aria-label={t(locale, 'members')}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="members-stack" aria-hidden="true">
          {faces.map((f, i) => (
            <span key={f.key} className="members-stack-item" style={{ zIndex: faces.length - i }}>
              <Face color={f.color} />
            </span>
          ))}
          {overflow > 0 ? <span className="members-overflow">+{overflow}</span> : null}
        </span>
      </button>
      {menu}
    </div>
  );
}
