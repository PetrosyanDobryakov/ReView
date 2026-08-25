import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';

export type ChromeSelectOption<T extends string = string> = {
  value: T;
  label: string;
};

type ChromeSelectProps<T extends string> = {
  value: T;
  options: readonly ChromeSelectOption<T>[];
  onChange: (value: T) => void;
  label: string;
  /** `sm` = home status (28px); `md` = style island (32px). */
  size?: 'sm' | 'md';
  /** Stretch trigger to the parent width (home status column). */
  fill?: boolean;
  /** Keep focus on canvas text editing when opening from the style island. */
  preserveFocus?: boolean;
  className?: string;
  title?: string;
};

export function ChromeSelect<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'sm',
  fill = false,
  preserveFocus = false,
  className,
  title,
}: ChromeSelectProps<T>) {
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number; width: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);

  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  const placeMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const gap = 4;
    const estimatedHeight = options.length * 36 + 8;
    const below = rect.bottom + gap;
    const above = rect.top - gap - estimatedHeight;
    const flip = below + estimatedHeight > window.innerHeight - 8 && above >= 8;
    setMenuStyle({
      left: rect.left,
      top: Math.max(8, flip ? above : below),
      width: Math.max(rect.width, size === 'md' ? 72 : rect.width),
    });
  }, [options.length, size]);

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
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        const next = options[activeIndex];
        if (next) {
          onChange(next.value);
          close();
          if (!preserveFocus) triggerRef.current?.focus();
        }
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, activeIndex, close, onChange, options, preserveFocus]);

  const pick = (next: T) => {
    onChange(next);
    close();
    if (!preserveFocus) triggerRef.current?.focus();
  };

  const rootClass = [
    'chrome-select',
    `chrome-select--${size}`,
    fill ? 'chrome-select--fill' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  const menu =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className={`chrome-select-menu chrome-select-menu--${size} ctx-menu`}
            style={{ left: menuStyle.left, top: menuStyle.top, width: menuStyle.width }}
          >
            {options.map((option, index) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={`chrome-select-option ctx-item${selected ? ' is-selected' : ''}${activeIndex === index ? ' is-active' : ''}`}
                  style={{ animationDelay: `${index * 18}ms` }}
                  onMouseDown={preserveFocus ? (e) => e.preventDefault() : undefined}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => pick(option.value)}
                >
                  <span className="chrome-select-option-main">
                    <span>{option.label}</span>
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
    <div className={rootClass}>
      <button
        ref={triggerRef}
        type="button"
        className={`chrome-select-trigger${open ? ' is-open' : ''}`}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        onMouseDown={preserveFocus ? (e) => e.preventDefault() : undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            close();
          } else {
            setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)));
            setOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            e.stopPropagation();
            if (!open) {
              setActiveIndex(Math.max(0, options.findIndex((o) => o.value === value)));
              setOpen(true);
            }
          }
        }}
      >
        <span className="chrome-select-label">{selectedLabel}</span>
        <span className="chrome-select-chevron" aria-hidden="true">
          <Icon name="chevronDown" size={14} />
        </span>
      </button>
      {menu}
    </div>
  );
}
