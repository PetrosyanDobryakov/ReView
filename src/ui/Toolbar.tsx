import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ToolId } from '../engine/tools';
import { onPrefsChange, readPrefs, writePrefs } from '../core/prefs';
import {
  FIGURES,
  isParkable,
  moveToolInOrders,
  readOrders as readToolbarOrders,
  type StripGroup,
  type ToolbarOrders,
} from '../core/toolbarOrder';
import { codeToDisplay, getToolBind, onKeybindsChange } from '../core/keybindings';
import { Icon, TOOLBELT_ICON_SIZE, type IconName } from './icons';
import type { LocaleId } from '../core/locale';
import { t } from './i18n';
import { SlideTrack } from './SlideTrack';
import { isCoarsePointer } from '../core/pointerEnv';
import { zoomedPortalPosition } from './portalPlace';

/** Tool button title: label + the LIVE bind (rebinds show up immediately). */
export function toolTitle(locale: LocaleId, id: ToolId): string {
  const base = t(locale, id);
  let bind = '';
  try {
    bind = getToolBind(id) ?? '';
  } catch {
    bind = '';
  }
  const disp = bind ? codeToDisplay(bind) : '';
  return disp ? `${base} (${disp})` : base;
}

function readOrders(): ToolbarOrders {
  return readToolbarOrders(readPrefs().toolbarOrder);
}

/** Tool id from a DnD payload, or null for foreign drags (files, …). */
function dropToolId(e: React.DragEvent): ToolId | null {
  let v = '';
  try {
    v = e.dataTransfer.getData('text/plain');
  } catch {
    return null;
  }
  return v && isParkable(v) ? (v as ToolId) : null;
}

export interface ToolbarProps {
  locale: LocaleId;
  tool: ToolId;
  selectionCount: number;
  canCrop: boolean;
  cropActive: boolean;
  onTool: (id: ToolId) => void;
  onDelete: () => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onInsertImage: () => void;
  onCrop: () => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
  onExport: () => void;
  onStamp: (emoji: string) => void;
}

/** Shared drag-click guard: a drop anywhere must release it — the source button
 * can unmount mid-drop (strip <-> shelf move re-renders it away), in which case
 * its own dragend never fires and a per-component flag would stick forever. */
let suppressToolbarClick = false;
let windowDragEndHooked = false;
function armToolbarClickSuppress(): void {
  suppressToolbarClick = true;
  if (!windowDragEndHooked && typeof window !== 'undefined') {
    windowDragEndHooked = true;
    // native dragend always reaches window, even when the source node is gone
    window.addEventListener('dragend', () => {
      window.setTimeout(() => {
        suppressToolbarClick = false;
      }, 0);
    });
  }
}
function clearToolbarClickSuppressSoon(): void {
  window.setTimeout(() => {
    suppressToolbarClick = false;
  }, 0);
}
/** A successful drop never produces a click — release immediately. */
function clearToolbarClickSuppressNow(): void {
  suppressToolbarClick = false;
}

function ToolButtons({
  ids,
  tool,
  locale,
  group,
  onTool,
  onMove,
}: {
  ids: ToolId[];
  tool: ToolId;
  locale: LocaleId;
  group: StripGroup;
  onTool: (id: ToolId) => void;
  onMove: (id: ToolId, to: StripGroup, before: ToolId | null, after: boolean) => void;
}) {
  const [drop, setDrop] = useState<{ id: ToolId; after: boolean } | null>(null);
  const [dragId, setDragId] = useState<ToolId | null>(null);
  const allowReorder = !isCoarsePointer();

  const beginDrag = (e: React.DragEvent, id: ToolId) => {
    if (!allowReorder) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    armToolbarClickSuppress();
    setDragId(id);
  };
  const endDrag = () => {
    setDragId(null);
    setDrop(null);
    clearToolbarClickSuppressSoon();
  };

  return (
    <div
      className="tool-drop-group"
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
      }}
      onDrop={(e) => {
        if (e.defaultPrevented) return;
        const drag = dropToolId(e);
        if (!drag) return;
        e.preventDefault();
        onMove(drag, group, null, false);
        clearToolbarClickSuppressNow();
      }}
    >
    <SlideTrack className="tool-group" active={ids.includes(tool) ? tool : null}>
      {ids.map((id) => (
        <button
          type="button"
          key={id}
          className={`tool-btn${dragId === id ? ' dragging' : ''}${drop?.id === id ? (drop.after ? ' drop-after' : ' drop-before') : ''}`}
          data-slide-active={tool === id ? 'true' : undefined}
          title={toolTitle(locale, id)}
          aria-label={toolTitle(locale, id)}
          aria-pressed={tool === id}
          draggable={allowReorder}
          onDragStart={(e) => beginDrag(e, id)}
          onDragEnd={endDrag}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const r = e.currentTarget.getBoundingClientRect();
            const after = e.clientX > r.left + r.width / 2;
            setDrop((cur) => (cur && cur.id === id && cur.after === after ? cur : { id, after }));
          }}
          onDragLeave={() => {
            setDrop((cur) => (cur && cur.id === id ? null : cur));
          }}
          onDrop={(e) => {
            e.preventDefault();
            const drag = dropToolId(e);
            setDrop(null);
            if (drag) onMove(drag, group, id, drop?.id === id ? drop.after : false);
            clearToolbarClickSuppressNow();
          }}
          onClick={() => {
            if (suppressToolbarClick) return;
            onTool(id);
          }}
        >
          <Icon name={id as IconName} size={TOOLBELT_ICON_SIZE} />
        </button>
      ))}
    </SlideTrack>
    </div>
  );
}

/** Overflow shelf: parked tool rows, draggable both ways.
 * Menu is portaled: ≤720 `.toolbelt-scroll` uses overflow-x:auto (which forces y clipping) +
 * mask-image, so an in-tree absolute popover was painted/clipped away on phone — tap looked dead. */
function MoreMenu({
  tool,
  locale,
  ids,
  onTool,
  onMove,
}: {
  tool: ToolId;
  locale: LocaleId;
  ids: ToolId[];
  onTool: (id: ToolId) => void;
  onMove: (id: ToolId, to: StripGroup, before: ToolId | null, after: boolean) => void;
}) {
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [drop, setDrop] = useState<{ id: ToolId; after: boolean } | null>(null);
  const [dragId, setDragId] = useState<ToolId | null>(null);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number } | null>(null);
  const allowReorder = !isCoarsePointer();

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  const placeMenu = useCallback(() => {
    const trigger = btnRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const scale =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const width = 220;
    const estimatedHeight = Math.min(410, 48 + ids.length * 44 + 16);
    const scaledW = width * scale;
    const centered = {
      left: rect.left + rect.width / 2 - scaledW / 2,
      right: rect.left + rect.width / 2 + scaledW / 2,
      top: rect.top,
      bottom: rect.bottom,
    };
    setMenuStyle(
      zoomedPortalPosition(centered, {
        width,
        estimatedHeight,
        align: 'left',
        scale,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      })
    );
  }, [ids.length]);

  useEffect(() => {
    if (!open) return;
    const active = menuRef.current?.querySelector<HTMLButtonElement>('button');
    active?.focus();
  }, [open]);

  const prevTool = useRef(tool);
  useEffect(() => {
    if (prevTool.current !== tool) close();
    prevTool.current = tool;
  }, [tool, close]);

  const isActive = ids.includes(tool);

  const pick = (id: ToolId) => {
    onTool(id);
    close();
    btnRef.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    placeMenu();
    const onReflow = (e: Event) => {
      // Inner list scroll must not move the popup (it used to fly upward).
      const target = e.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      placeMenu();
    };
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    // Estimates lie on long shelves: correct with real geometry once
    // painted (no loop — deps don't include menuStyle).
    const raf = requestAnimationFrame(() => {
      const el = menuRef.current;
      const trigger = btnRef.current;
      if (!el || !trigger) return;
      const scale =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
      const r = el.getBoundingClientRect();
      const t = trigger.getBoundingClientRect();
      const margin = 8 * scale;
      const gap = 8 * scale;
      // Dock the popup bottom to the trigger top so it hugs the toolbar
      // instead of floating; clamp into the viewport on short screens.
      const docked = t.top - gap - r.height;
      const top = Math.max(margin, docked);
      setMenuStyle((cur) => (cur ? { left: cur.left, top: top / scale } : cur));
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, placeMenu]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
      btnRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close]);

  const beginDrag = (e: React.DragEvent, id: ToolId) => {
    if (!allowReorder) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    armToolbarClickSuppress();
    setDragId(id);
  };
  const endDrag = () => {
    setDragId(null);
    setDrop(null);
    clearToolbarClickSuppressSoon();
  };

  const menu =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="island block-scheme-popover more-pop"
            role="menu"
            aria-label={t(locale, 'more')}
            style={{ left: menuStyle.left, top: menuStyle.top }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(e) => {
              if (e.defaultPrevented) return;
              const drag = dropToolId(e);
              if (!drag) return;
              e.preventDefault();
              onMove(drag, 'more', null, false);
              clearToolbarClickSuppressNow();
            }}
          >
            <div className="block-scheme-popover-title">{t(locale, 'more')}</div>
            <div className="more-rows" role="group" aria-label={t(locale, 'more')}>
            {ids.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                draggable={allowReorder}
                className={`tool-btn more-row${tool === id ? ' active' : ''}${dragId === id ? ' dragging' : ''}${drop?.id === id ? (drop.after ? ' drop-after' : ' drop-before') : ''}`}
                title={toolTitle(locale, id)}
                aria-label={toolTitle(locale, id)}
                onDragStart={(e) => beginDrag(e, id)}
                onDragEnd={endDrag}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  const r = e.currentTarget.getBoundingClientRect();
                  const after = e.clientY > r.top + r.height / 2;
                  setDrop((cur) => (cur && cur.id === id && cur.after === after ? cur : { id, after }));
                }}
                onDragLeave={() => {
                  setDrop((cur) => (cur && cur.id === id ? null : cur));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const drag = dropToolId(e);
                  const at = drop?.id === id ? drop.after : false;
                  setDrop(null);
                  if (drag) onMove(drag, 'more', id, at);
                  clearToolbarClickSuppressNow();
                }}
                onClick={() => {
                  if (suppressToolbarClick) return;
                  pick(id);
                }}
              >
                <Icon name={id as IconName} size={TOOLBELT_ICON_SIZE} />
                <span className="more-row-label">{t(locale, id)}</span>
              </button>
            ))}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="tool-group scheme-group">
      <button
        ref={btnRef}
        type="button"
        className={`tool-btn${isActive ? ' active' : ''}`}
        title={t(locale, 'more')}
        aria-label={t(locale, 'more')}
        aria-pressed={isActive}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => {
          setOpen((v) => !v);
        }}
        onDragOver={(e) => {
          // Spring-load: hovering the shelf button mid-drag opens the popover.
          if (!allowReorder) return;
          if (!open) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            setOpen(true);
          }
        }}
        onDrop={(e) => {
          if (!allowReorder) return;
          if (e.defaultPrevented) return;
          const drag = dropToolId(e);
          if (!drag) return;
          e.preventDefault();
          onMove(drag, 'more', null, false);
          setOpen(true);
          clearToolbarClickSuppressNow();
        }}
      >
        <Icon name="dots" size={TOOLBELT_ICON_SIZE} />
      </button>
      {menu}
    </div>
  );
}

/** Figures tab: every geometric shape in one grid. Replaces the strip
 * rect/ellipse buttons and the old scheme flyout. Rows drag out to the
 * strip; the button shows the last used figure. */
function FiguresMenu({
  tool,
  locale,
  onTool,
}: {
  tool: ToolId;
  locale: LocaleId;
  onTool: (id: ToolId) => void;
}) {
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [dragId, setDragId] = useState<ToolId | null>(null);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number } | null>(null);
  const [lastFigure, setLastFigure] = useState<ToolId>('rect');
  const allowReorder = !isCoarsePointer();

  const close = useCallback(() => setOpen(false), []);

  const placeMenu = useCallback(() => {
    const trigger = btnRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const scale =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const width = 220;
    const estimatedHeight = Math.min(410, 48 + FIGURES.length * 44 + 16);
    const scaledW = width * scale;
    const centered = {
      left: rect.left + rect.width / 2 - scaledW / 2,
      right: rect.left + rect.width / 2 + scaledW / 2,
      top: rect.top,
      bottom: rect.bottom,
    };
    setMenuStyle(
      zoomedPortalPosition(centered, {
        width,
        estimatedHeight,
        align: 'left',
        scale,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      })
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    placeMenu();
    const onReflow = (e: Event) => {
      // Inner list scroll must not move the popup (it used to fly upward).
      const target = e.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      placeMenu();
    };
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    // Same dock-to-trigger correction as the More shelf (long grid).
    const raf = requestAnimationFrame(() => {
      const el = menuRef.current;
      const trigger = btnRef.current;
      if (!el || !trigger) return;
      const scale =
        parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
      const r = el.getBoundingClientRect();
      const t = trigger.getBoundingClientRect();
      const margin = 8 * scale;
      const gap = 8 * scale;
      const docked = t.top - gap - r.height;
      const top = Math.max(margin, docked);
      setMenuStyle((cur) => (cur ? { left: cur.left, top: top / scale } : cur));
    });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, placeMenu]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
      btnRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close]);

  const prevTool = useRef(tool);
  useEffect(() => {
    if (prevTool.current !== tool) close();
    prevTool.current = tool;
  }, [tool, close]);

  useEffect(() => {
    if (!open) return;
    const active = menuRef.current?.querySelector<HTMLButtonElement>('button');
    active?.focus();
  }, [open]);

  useEffect(() => {
    if (FIGURES.includes(tool)) setLastFigure(tool);
  }, [tool]);

  const isActive = FIGURES.includes(tool);

  const pick = (id: ToolId) => {
    setLastFigure(id);
    onTool(id);
    close();
    btnRef.current?.focus();
  };

  const beginDrag = (e: React.DragEvent, id: ToolId) => {
    if (!allowReorder) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    armToolbarClickSuppress();
    setDragId(id);
  };
  const endDrag = () => {
    setDragId(null);
    clearToolbarClickSuppressSoon();
  };

  const menu =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="island block-scheme-popover more-pop"
            role="menu"
            aria-label={t(locale, 'figures')}
            style={{ left: menuStyle.left, top: menuStyle.top }}
          >
            <div className="block-scheme-popover-title">{t(locale, 'figures')}</div>
            <div className="more-rows" role="group" aria-label={t(locale, 'figures')}>
            {FIGURES.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                draggable={allowReorder}
                className={`tool-btn more-row${tool === id ? ' active' : ''}${dragId === id ? ' dragging' : ''}`}
                title={toolTitle(locale, id)}
                aria-label={toolTitle(locale, id)}
                onDragStart={(e) => beginDrag(e, id)}
                onDragEnd={endDrag}
                onClick={() => {
                  if (suppressToolbarClick) return;
                  pick(id);
                }}
              >
                <Icon name={id as IconName} size={TOOLBELT_ICON_SIZE} />
                <span className="more-row-label">{t(locale, id)}</span>
              </button>
            ))}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="tool-group">
      <button
        ref={btnRef}
        type="button"
        className={`tool-btn${isActive ? ' active' : ''}`}
        title={t(locale, 'figures')}
        aria-label={t(locale, 'figures')}
        aria-pressed={isActive}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={lastFigure as IconName} size={TOOLBELT_ICON_SIZE} />
      </button>
      {menu}
    </div>
  );
}

/** Emoji reactions: pick one, then stamp the board (stays armed). */
export const STAMP_EMOJI = ['👍', '👎', '⭐', '❤️', '➕', '❓', '✖️', '✅'] as const;

function ReactionsMenu({
  tool,
  locale,
  onStamp,
}: {
  tool: ToolId;
  locale: LocaleId;
  onStamp: (emoji: string) => void;
}) {
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ left: number; top: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);

  const placeMenu = useCallback(() => {
    const trigger = btnRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const scale =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const width = 220;
    const estimatedHeight = 200;
    const scaledW = width * scale;
    const centered = {
      left: rect.left + rect.width / 2 - scaledW / 2,
      right: rect.left + rect.width / 2 + scaledW / 2,
      top: rect.top,
      bottom: rect.bottom,
    };
    setMenuStyle(
      zoomedPortalPosition(centered, {
        width,
        estimatedHeight,
        align: 'left',
        scale,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      })
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setMenuStyle(null);
      return;
    }
    placeMenu();
    const onReflow = (e: Event) => {
      // Inner list scroll must not move the popup (it used to fly upward).
      const target = e.target as Node | null;
      if (target && menuRef.current?.contains(target)) return;
      placeMenu();
    };
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    return () => {
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, placeMenu]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      close();
      btnRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open, close]);

  const prevTool = useRef(tool);
  useEffect(() => {
    if (prevTool.current !== tool) close();
    prevTool.current = tool;
  }, [tool, close]);

  const isActive = tool === 'stamp';

  const menu =
    open && menuStyle
      ? createPortal(
          <div
            ref={menuRef}
            id={menuId}
            className="island block-scheme-popover more-pop"
            role="menu"
            aria-label={t(locale, 'reactions')}
            style={{ left: menuStyle.left, top: menuStyle.top }}
          >
            <div className="block-scheme-popover-title">{t(locale, 'reactions')}</div>
            <div className="reactions-grid" role="group" aria-label={t(locale, 'reactions')}>
            {STAMP_EMOJI.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="menuitem"
                className="reactions-cell"
                aria-label={emoji}
                title={emoji}
                onClick={() => {
                  onStamp(emoji);
                  close();
                  btnRef.current?.focus();
                }}
              >
                {emoji}
              </button>
            ))}
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className="tool-group">
      <button
        ref={btnRef}
        type="button"
        className={`tool-btn${isActive ? ' active' : ''}`}
        title={t(locale, 'reactions')}
        aria-label={t(locale, 'reactions')}
        aria-pressed={isActive}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="reactions" size={TOOLBELT_ICON_SIZE} />
      </button>
      {menu}
    </div>
  );
}

export function Toolbar({
  locale,
  tool,
  selectionCount,
  canCrop,
  cropActive,
  onTool,
  onDelete,
  onCopy,
  onDuplicate,
  onInsertImage,
  onCrop,
  onApplyCrop,
  onCancelCrop,
  onExport,
  onStamp,
}: ToolbarProps) {
  const [toolHoverAnim, setToolHoverAnim] = useState(() => readPrefs().toolHoverAnim);
  const [orders, setOrders] = useState(readOrders);
  // Rebinds must refresh button titles immediately (binds live outside prefs).
  const [, setBindTick] = useState(0);
  useEffect(() => onKeybindsChange(() => setBindTick((n) => n + 1)), []);

  useEffect(() => onPrefsChange((p) => setToolHoverAnim(p.toolHoverAnim)), []);
  useEffect(() => onPrefsChange(() => setOrders(readOrders())), []);

  const moveTool = (id: ToolId, to: StripGroup, before: ToolId | null, after: boolean) => {
    const next = moveToolInOrders(orders, id, to, before, after);
    if (next === orders) return;
    writePrefs({ toolbarOrder: next });
    setOrders(next);
  };

  const hasSelection = selectionCount > 0;

  return (
    <div
      className="toolbelt"
      role="toolbar"
      aria-label={t(locale, 'tools')}
      data-tool-anim={toolHoverAnim ? 'on' : undefined}
    >
      <div className="toolbelt-scroll">
        {orders.nav.length > 0 && (
          <ToolButtons ids={orders.nav} tool={tool} locale={locale} group="nav" onTool={onTool} onMove={moveTool} />
        )}
        {orders.create.length > 0 && (
          <ToolButtons ids={orders.create} tool={tool} locale={locale} group="create" onTool={onTool} onMove={moveTool} />
        )}
        <FiguresMenu tool={tool} locale={locale} onTool={onTool} />
        <ReactionsMenu tool={tool} locale={locale} onStamp={onStamp} />
        <MoreMenu tool={tool} locale={locale} ids={orders.more} onTool={onTool} onMove={moveTool} />
        <div className="toolbelt-sep" />
        <div className="tool-group">
          {hasSelection && (
            <button type="button" className="tool-btn" data-commit-edit title={t(locale, 'delete')} aria-label={t(locale, 'delete')} onClick={onDelete}>
              <Icon name="trash" size={TOOLBELT_ICON_SIZE} />
            </button>
          )}
          {hasSelection && (
            <button type="button" className="tool-btn" data-commit-edit title={t(locale, 'copy')} aria-label={t(locale, 'copy')} onClick={onCopy}>
              <Icon name="copy" size={TOOLBELT_ICON_SIZE} />
            </button>
          )}
          {hasSelection && (
            <button type="button" className="tool-btn" data-commit-edit title={t(locale, 'duplicate')} aria-label={t(locale, 'duplicate')} onClick={onDuplicate}>
              <Icon name="duplicate" size={TOOLBELT_ICON_SIZE} />
            </button>
          )}
        </div>
        <div className="tool-group">
          <button type="button" className="tool-btn" data-commit-edit title={t(locale, 'export')} aria-label={t(locale, 'export')} onClick={onExport}>
            <Icon name="download" size={TOOLBELT_ICON_SIZE} />
          </button>
          <div className="tool-media-slot">
            {cropActive ? (
              <button
                key="apply"
                type="button"
                className="tool-btn crop-apply tool-pop"
                title={t(locale, 'cropApply')}
                aria-label={t(locale, 'cropApply')}
                onClick={onApplyCrop}
              >
                <Icon name="check" size={TOOLBELT_ICON_SIZE} />
              </button>
            ) : (
              <button
                key="file"
                type="button"
                className="tool-btn"
                title={t(locale, 'insertFile')}
                aria-label={t(locale, 'insertFile')}
                onClick={onInsertImage}
              >
                <Icon name="upload" size={TOOLBELT_ICON_SIZE} />
              </button>
            )}
          </div>
          <div className="tool-media-slot">
            {cropActive ? (
              <button
                key="cancel"
                type="button"
                className="tool-btn tool-pop"
                title={t(locale, 'cropCancel')}
                aria-label={t(locale, 'cropCancel')}
                onClick={onCancelCrop}
              >
                <Icon name="close" size={TOOLBELT_ICON_SIZE} />
              </button>
            ) : canCrop ? (
              <button
                key="crop"
                type="button"
                className="tool-btn tool-pop"
                title={t(locale, 'crop')}
                aria-label={t(locale, 'crop')}
                onClick={onCrop}
              >
                <Icon name="crop" size={TOOLBELT_ICON_SIZE} />
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
