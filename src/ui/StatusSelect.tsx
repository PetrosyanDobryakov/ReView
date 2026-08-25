import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BoardStatus } from '../core/boards';
import type { LocaleId } from '../core/locale';
import { t } from './i18n';
import { Icon } from './icons';

const OPTIONS: BoardStatus[] = ['local', 'shared', 'remote'];

type StatusSelectProps = {
  value: BoardStatus;
  onChange: (value: BoardStatus) => void;
  locale: LocaleId;
  label: string;
};

function statusLabel(locale: LocaleId, value: BoardStatus): string {
  if (value === 'local') return t(locale, 'statusLocal');
  if (value === 'shared') return t(locale, 'statusShared');
  return t(locale, 'statusRemote');
}

export function StatusSelect({ value, onChange, locale, label }: StatusSelectProps) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => OPTIONS.indexOf(value));
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number; width: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);

  const placeMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const estimatedHeight = OPTIONS.length * 36 + 8;
    const below = rect.bottom + gap;
    const above = rect.top - gap - estimatedHeight;
    const flip = below + estimatedHeight > window.innerHeight - 8 && above >= 8;
    setMenuStyle({
      left: rect.left,
      top: flip ? above : below,
      width: rect.width,
    });
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
  }, [open, placeMenu]);

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
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, OPTIONS.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const next = OPTIONS[activeIndex];
        if (next) {
          onChange(next);
          close();
          triggerRef.current?.focus();
        }
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, activeIndex, close, onChange]);

  const pick = (next: BoardStatus) => {
    onChange(next);
    close();
    triggerRef.current?.focus();
  };

  const menu =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="status-select-menu ctx-menu"
            style={{ left: menuStyle.left, top: menuStyle.top, width: menuStyle.width }}
          >
            {OPTIONS.map((option, index) => {
              const selected = option === value;
              return (
                <button
                  key={option}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`status-select-option ctx-item${selected ? ' is-selected' : ''}${activeIndex === index ? ' is-active' : ''}`}
                  style={{ animationDelay: `${index * 18}ms` }}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(option)}
                >
                  <span className="status-select-option-main">
                    <span>{statusLabel(locale, option)}</span>
                  </span>
                  {selected ? <Icon name="check" size={14} /> : null}
                </button>
              );
            })}
          </div>,
          document.body
        )
      : null;

  return (
    <div className="status-select">
      <button
        ref={triggerRef}
        type="button"
        className={`status-select-trigger${open ? ' is-open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            close();
          } else {
            setActiveIndex(OPTIONS.indexOf(value));
            setOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (!open) {
              setActiveIndex(OPTIONS.indexOf(value));
              setOpen(true);
            }
          }
        }}
      >
        <span className="status-select-label">{statusLabel(locale, value)}</span>
        <span className="status-select-chevron" aria-hidden="true">
          <Icon name="chevronDown" size={14} />
        </span>
      </button>
      {menu}
    </div>
  );
}
