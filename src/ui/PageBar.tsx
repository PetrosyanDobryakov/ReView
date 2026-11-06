import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as store from '../core/store';
import { Icon } from './icons';
import { t } from './i18n';
import type { LocaleId } from '../core/locale';
import { onPeers } from '../net';
import { zoomedPortalPosition } from './portalPlace';

export function PageBar({ locale }: { locale: LocaleId }) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number } | null>(null);
  const [pages, setPages] = useState<string[]>(() => store.listPages());
  const [cur, setCur] = useState<string>(() => store.currentPageId());
  const [peerNames, setPeerNames] = useState<Map<string, string[]>>(() => new Map());

  useEffect(
    () =>
      store.onPageChange(() => {
        setPages(store.listPages());
        setCur(store.currentPageId());
      }),
    []
  );

  useEffect(
    () => {
      let rosterKey = '';
      return onPeers((peers) => {
        const byPage = new Map<string, string[]>();
        for (const p of peers) {
          if (!p.page || !p.name) continue;
          const list = byPage.get(p.page) ?? [];
          if (!list.includes(p.name)) list.push(p.name);
          byPage.set(p.page, list);
        }
        const next = [...byPage.entries()]
          .map(([pg, names]) => `${pg}:${[...names].sort().join(',')}`)
          .sort()
          .join('\0');
        // Cursor xy churn must not setState — that reconciled PageBar every packet.
        if (next === rosterKey) return;
        rosterKey = next;
        setPeerNames(byPage);
      });
    },
    []
  );

  const idx = Math.max(0, pages.indexOf(cur));
  const close = useCallback(() => setOpen(false), []);

  const placeMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    setMenuStyle(
      zoomedPortalPosition(rect, {
        width: 240,
        estimatedHeight: 280,
        align: 'left',
        scale,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      })
    );
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
  }, [open, placeMenu, pages.length, idx]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
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
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const label = `${idx + 1} / ${pages.length}`;
  const elsewhereNames = [...peerNames.entries()].filter(([pg]) => pg !== cur).flatMap(([, names]) => names);
  const hasPeerElsewhere = elsewhereNames.length > 0;

  const menu =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            role="dialog"
            aria-modal="true"
            aria-label={t(locale, 'pages')}
            className="pages-menu island"
            style={{ left: menuStyle.left, top: menuStyle.top }}
          >
            <div className="pages-menu-head">
              <h3 className="pages-menu-title">{t(locale, 'pages')}</h3>
              <span className="pages-menu-count">{label}</span>
            </div>
            <ul className="pages-menu-list" role="listbox" aria-label={t(locale, 'pages')}>
              {pages.map((id, i) => {
                const active = id === cur;
                const names = id !== cur ? (peerNames.get(id) ?? []) : [];
                const hasPeer = names.length > 0;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={`pages-menu-item${active ? ' is-active' : ''}`}
                      onClick={() => {
                        store.setCurrentPage(id);
                        close();
                      }}
                    >
                      <span className="pages-menu-item-label">
                        {t(locale, 'page')} {i + 1}
                      </span>
                      {hasPeer ? <span className="pages-peer-dot" aria-hidden="true" title={names.join(', ')} /> : null}
                      {active ? <Icon name="check" size={14} /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="pages-menu-actions">
              <button
                type="button"
                className="style-btn pages-menu-action"
                title={t(locale, 'addPage')}
                aria-label={t(locale, 'addPage')}
                onClick={() => store.addPage()}
              >
                <Icon name="plus" size={15} />
                <span>{t(locale, 'addPage')}</span>
              </button>
              <button
                type="button"
                className="style-btn pages-menu-action pages-menu-danger"
                title={t(locale, 'deletePage')}
                aria-label={t(locale, 'deletePage')}
                disabled={pages.length <= 1}
                onClick={() => {
                  if (window.confirm(`${t(locale, 'deletePage')}?`)) store.deletePage(cur);
                }}
              >
                <Icon name="trash" size={15} />
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="pages-root">
      <button
        ref={triggerRef}
        type="button"
        className={`pages-trigger${open ? ' is-open' : ''}`}
        title={t(locale, 'pages')}
        aria-label={`${t(locale, 'pages')}: ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="more" size={16} />
        <span className="pages-trigger-label">{label}</span>
        <Icon name="chevronDown" size={14} />
        {hasPeerElsewhere ? <span className="pages-trigger-dot" aria-hidden="true" title={elsewhereNames.join(', ')} /> : null}
      </button>
      {menu}
    </div>
  );
}
