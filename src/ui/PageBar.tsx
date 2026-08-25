import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as store from '../core/store';
import { Icon } from './icons';
import { t } from './i18n';
import type { LocaleId } from '../core/locale';

export function PageBar({ locale }: { locale: LocaleId }) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number } | null>(null);
  const [pages, setPages] = useState<string[]>(() => store.listPages());
  const [cur, setCur] = useState<string>(() => store.currentPageId());

  useEffect(
    () =>
      store.onPageChange(() => {
        setPages(store.listPages());
        setCur(store.currentPageId());
      }),
    []
  );

  const idx = Math.max(0, pages.indexOf(cur));
  const close = useCallback(() => setOpen(false), []);

  const placeMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = 240;
    const gap = 8;
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    const estimatedHeight = 280;
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
  }, [open, placeMenu, pages.length, idx]);

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

  const label = `${idx + 1} / ${pages.length}`;

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
      </button>
      {menu}
    </div>
  );
}
