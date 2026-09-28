import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ToolId } from '../engine/tools';
import { onPrefsChange, readPrefs, writePrefs } from '../core/prefs';
import {
  TOOL_FAMILIES,
  isParkable,
  moveToolInOrders,
  readOrders as readToolbarOrders,
  type StripGroup,
  type ToolbarOrders,
} from '../core/toolbarOrder';
import { Icon, TOOLBELT_ICON_SIZE, type IconName } from './icons';
import type { LocaleId } from '../core/locale';
import { t } from './i18n';
import { SlideTrack } from './SlideTrack';
import { isCoarsePointer } from '../core/pointerEnv';
import { zoomedPortalPosition } from './portalPlace';

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
  /** Current pen ink, shown as a dot on the pen button. */
  penColor: string;
  cropActive: boolean;
  onTool: (id: ToolId) => void;
  onInsertFile: () => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
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

function uiScale(): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
}

/**
 * Anchored popover above a toolbelt button (portaled: ≤720 `.toolbelt-scroll`
 * scrolls on x, which clips anything absolutely positioned inside it).
 */
function usePopover(width: number, estimatedHeight: number) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  const place = useCallback(() => {
    const trigger = btnRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const scale = uiScale();
    const w = width * scale;
    const centered = {
      left: rect.left + rect.width / 2 - w / 2,
      right: rect.left + rect.width / 2 + w / 2,
      top: rect.top,
      bottom: rect.bottom,
    };
    setPos(
      zoomedPortalPosition(centered, {
        width,
        estimatedHeight,
        align: 'left',
        scale,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      })
    );
  }, [width, estimatedHeight]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (btnRef.current?.contains(target) || popRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const first = popRef.current?.querySelector<HTMLButtonElement>('[aria-checked="true"], button');
    first?.focus();
  }, [open, pos === null]);

  return { btnRef, popRef, open, setOpen, pos };
}

/** Last member used per family slot — survives toolbelt re-renders for the session. */
const lastFamilyMember = new Map<ToolId, ToolId>();

function FamilyFlyout({
  slot,
  members,
  tool,
  locale,
  popRef,
  pos,
  onPick,
}: {
  slot: ToolId;
  members: ToolId[];
  tool: ToolId;
  locale: LocaleId;
  popRef: React.RefObject<HTMLDivElement | null>;
  pos: { left: number; top: number };
  onPick: (id: ToolId) => void;
}) {
  const label = t(locale, slot === 'select' ? 'selectMenu' : 'shapesMenu');
  const grid = members.length > 4;
  return createPortal(
    <div
      ref={popRef}
      className={`island tool-flyout${grid ? ' tool-flyout-grid' : ''}`}
      role="menu"
      aria-label={label}
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="tool-flyout-title">{label}</div>
      <div className="tool-flyout-body">
        {members.map((id) => (
          <button
            key={id}
            type="button"
            role="menuitemradio"
            aria-checked={tool === id}
            className={`tool-flyout-item${tool === id ? ' active' : ''}`}
            title={t(locale, id)}
            aria-label={t(locale, id)}
            onClick={() => onPick(id)}
          >
            <Icon name={id as IconName} size={TOOLBELT_ICON_SIZE} />
            {!grid && <span>{t(locale, id)}</span>}
          </button>
        ))}
      </div>
    </div>,
    document.body
  );
}

const FLYOUT_HOLD_MS = 380;

function ToolButtons({
  ids,
  tool,
  locale,
  group,
  penColor,
  onTool,
  onMove,
}: {
  ids: ToolId[];
  tool: ToolId;
  locale: LocaleId;
  group: StripGroup;
  penColor: string;
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

  // Slide thumb follows the slot, so a family member lights its slot.
  const slotOf = (id: ToolId) => (TOOL_FAMILIES[id]?.includes(tool) ? id : null);
  const activeSlot = ids.find((id) => id === tool || slotOf(id)) ?? null;

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
      <SlideTrack className="tool-group" active={activeSlot}>
        {ids.map((id) => {
          const dnd: React.ButtonHTMLAttributes<HTMLButtonElement> = {
            draggable: allowReorder,
            onDragStart: (e) => beginDrag(e, id),
            onDragEnd: endDrag,
            onDragOver: (e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              const r = e.currentTarget.getBoundingClientRect();
              const after = e.clientX > r.left + r.width / 2;
              setDrop((cur) => (cur && cur.id === id && cur.after === after ? cur : { id, after }));
            },
            onDragLeave: () => {
              setDrop((cur) => (cur && cur.id === id ? null : cur));
            },
            onDrop: (e) => {
              e.preventDefault();
              const drag = dropToolId(e);
              setDrop(null);
              if (drag) onMove(drag, group, id, drop?.id === id ? drop.after : false);
              clearToolbarClickSuppressNow();
            },
          };
          const cls = `tool-btn${dragId === id ? ' dragging' : ''}${drop?.id === id ? (drop.after ? ' drop-after' : ' drop-before') : ''}`;
          const members = TOOL_FAMILIES[id];
          if (members) {
            return (
              <FamilyButton
                key={id}
                slot={id}
                members={members}
                tool={tool}
                locale={locale}
                className={cls}
                dnd={dnd}
                onTool={onTool}
              />
            );
          }
          return (
            <button
              type="button"
              key={id}
              className={cls}
              data-slide-active={tool === id ? 'true' : undefined}
              title={t(locale, id)}
              aria-label={t(locale, id)}
              aria-pressed={tool === id}
              {...dnd}
              onClick={() => {
                if (suppressToolbarClick) return;
                onTool(id);
              }}
            >
              <Icon name={id as IconName} size={TOOLBELT_ICON_SIZE} />
              {id === 'pen' && <span className="tool-ink-dot" style={{ background: penColor }} aria-hidden="true" />}
            </button>
          );
        })}
      </SlideTrack>
    </div>
  );
}

/**
 * One strip slot for a tool family (select + lasso, every shape under rect).
 * Click picks the last member; click again (or hold, or right-click) opens the flyout.
 */
function FamilyButton({
  slot,
  members,
  tool,
  locale,
  className,
  dnd,
  onTool,
}: {
  slot: ToolId;
  members: ToolId[];
  tool: ToolId;
  locale: LocaleId;
  className: string;
  dnd: React.ButtonHTMLAttributes<HTMLButtonElement>;
  onTool: (id: ToolId) => void;
}) {
  const inFamily = members.includes(tool);
  if (inFamily) lastFamilyMember.set(slot, tool);
  const shown = inFamily ? tool : (lastFamilyMember.get(slot) ?? slot);
  const pop = usePopover(members.length > 4 ? 212 : 196, members.length > 4 ? 200 : 48 + members.length * 40);
  const holdTimer = useRef<number | null>(null);
  const heldOpen = useRef(false);

  const prevTool = useRef(tool);
  useEffect(() => {
    if (prevTool.current !== tool) pop.setOpen(false);
    prevTool.current = tool;
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearHold = () => {
    if (holdTimer.current != null) window.clearTimeout(holdTimer.current);
    holdTimer.current = null;
  };

  const label = `${t(locale, shown)} · ${t(locale, slot === 'select' ? 'selectMenu' : 'shapesMenu')}`;

  return (
    <>
      <button
        ref={pop.btnRef}
        type="button"
        className={`${className} tool-family`}
        data-slide-active={inFamily ? 'true' : undefined}
        title={label}
        aria-label={label}
        aria-pressed={inFamily}
        aria-haspopup="menu"
        aria-expanded={pop.open}
        {...dnd}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          heldOpen.current = false;
          clearHold();
          holdTimer.current = window.setTimeout(() => {
            heldOpen.current = true;
            pop.setOpen(true);
          }, FLYOUT_HOLD_MS);
        }}
        onPointerUp={clearHold}
        onPointerLeave={clearHold}
        onContextMenu={(e) => {
          e.preventDefault();
          clearHold();
          pop.setOpen(true);
        }}
        onClick={() => {
          if (suppressToolbarClick || heldOpen.current) return;
          if (inFamily) pop.setOpen((v) => !v);
          else onTool(shown);
        }}
      >
        <Icon name={shown as IconName} size={TOOLBELT_ICON_SIZE} />
        <span className="tool-caret" aria-hidden="true" />
      </button>
      {pop.open && pop.pos && (
        <FamilyFlyout
          slot={slot}
          members={members}
          tool={tool}
          locale={locale}
          popRef={pop.popRef}
          pos={pop.pos}
          onPick={(id) => {
            lastFamilyMember.set(slot, id);
            onTool(id);
            pop.setOpen(false);
            pop.btnRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

/** Insert shelf: parked specialty tools (draggable both ways) + file / image insert. */
function InsertMenu({
  tool,
  locale,
  ids,
  onTool,
  onMove,
  onInsertFile,
}: {
  tool: ToolId;
  locale: LocaleId;
  ids: ToolId[];
  onTool: (id: ToolId) => void;
  onMove: (id: ToolId, to: StripGroup, before: ToolId | null, after: boolean) => void;
  onInsertFile: () => void;
}) {
  const menuId = useId();
  const pop = usePopover(232, Math.min(360, 60 + (ids.length + 1) * 44));
  const [drop, setDrop] = useState<{ id: ToolId; after: boolean } | null>(null);
  const [dragId, setDragId] = useState<ToolId | null>(null);
  const allowReorder = !isCoarsePointer();

  const prevTool = useRef(tool);
  useEffect(() => {
    if (prevTool.current !== tool) pop.setOpen(false);
    prevTool.current = tool;
  }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  const isActive = ids.includes(tool);

  const pick = (id: ToolId) => {
    onTool(id);
    pop.setOpen(false);
    pop.btnRef.current?.focus();
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
    setDrop(null);
    clearToolbarClickSuppressSoon();
  };

  const menu =
    pop.open && pop.pos
      ? createPortal(
          <div
            ref={pop.popRef}
            id={menuId}
            className="island block-scheme-popover more-pop"
            role="menu"
            aria-label={t(locale, 'insert')}
            style={{ left: pop.pos.left, top: pop.pos.top }}
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
            <div className="block-scheme-popover-title">{t(locale, 'insert')}</div>
            <button
              type="button"
              role="menuitem"
              className="tool-btn more-row"
              title={t(locale, 'insertFile')}
              onClick={() => {
                pop.setOpen(false);
                onInsertFile();
              }}
            >
              <Icon name="insertImage" size={TOOLBELT_ICON_SIZE} />
              <span className="more-row-label">{t(locale, 'insertFileShort')}</span>
            </button>
            {ids.length > 0 && <div className="more-sep" role="separator" />}
            {ids.map((id) => (
              <button
                key={id}
                type="button"
                role="menuitem"
                draggable={allowReorder}
                className={`tool-btn more-row${tool === id ? ' active' : ''}${dragId === id ? ' dragging' : ''}${drop?.id === id ? (drop.after ? ' drop-after' : ' drop-before') : ''}`}
                title={t(locale, id)}
                aria-label={t(locale, id)}
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
          </div>,
          document.body
        )
      : null;

  return (
    <div className="tool-group scheme-group">
      <button
        ref={pop.btnRef}
        type="button"
        className={`tool-btn tool-family${isActive ? ' active' : ''}`}
        title={t(locale, 'insert')}
        aria-label={t(locale, 'insert')}
        aria-pressed={isActive}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={pop.open}
        onClick={() => pop.setOpen((v) => !v)}
        onDragOver={(e) => {
          // Spring-load: hovering the shelf button mid-drag opens the popover.
          if (!allowReorder) return;
          if (!pop.open) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            pop.setOpen(true);
          }
        }}
        onDrop={(e) => {
          if (!allowReorder) return;
          if (e.defaultPrevented) return;
          const drag = dropToolId(e);
          if (!drag) return;
          e.preventDefault();
          onMove(drag, 'more', null, false);
          pop.setOpen(true);
          clearToolbarClickSuppressNow();
        }}
      >
        <Icon name={isActive ? (tool as IconName) : 'insert'} size={TOOLBELT_ICON_SIZE} />
        <span className="tool-caret" aria-hidden="true" />
      </button>
      {menu}
    </div>
  );
}

export function Toolbar({
  locale,
  tool,
  penColor,
  cropActive,
  onTool,
  onInsertFile,
  onApplyCrop,
  onCancelCrop,
}: ToolbarProps) {
  const [toolHoverAnim, setToolHoverAnim] = useState(() => readPrefs().toolHoverAnim);
  const [recognize, setRecognize] = useState(() => readPrefs().recognizeShapes);
  const [orders, setOrders] = useState(readOrders);

  useEffect(
    () =>
      onPrefsChange((p) => {
        setToolHoverAnim(p.toolHoverAnim);
        setRecognize(p.recognizeShapes);
        setOrders(readOrders());
      }),
    []
  );

  const moveTool = (id: ToolId, to: StripGroup, before: ToolId | null, after: boolean) => {
    const next = moveToolInOrders(orders, id, to, before, after);
    if (next === orders) return;
    writePrefs({ toolbarOrder: next });
    setOrders(next);
  };

  const hasStrip = orders.nav.length > 0 || orders.create.length > 0;

  return (
    <div
      className="toolbelt"
      role="toolbar"
      aria-label={t(locale, 'tools')}
      data-tool-anim={toolHoverAnim ? 'on' : undefined}
    >
      <div className="toolbelt-scroll">
        {orders.nav.length > 0 && (
          <ToolButtons ids={orders.nav} tool={tool} locale={locale} group="nav" penColor={penColor} onTool={onTool} onMove={moveTool} />
        )}
        {orders.nav.length > 0 && orders.create.length > 0 && <div className="toolbelt-sep" />}
        {orders.create.length > 0 && (
          <ToolButtons ids={orders.create} tool={tool} locale={locale} group="create" penColor={penColor} onTool={onTool} onMove={moveTool} />
        )}
        {hasStrip && <div className="toolbelt-sep" />}
        <InsertMenu
          tool={tool}
          locale={locale}
          ids={orders.more}
          onTool={onTool}
          onMove={moveTool}
          onInsertFile={onInsertFile}
        />
        <div className="tool-group">
          <button
            type="button"
            className={`tool-btn tool-toggle${recognize ? ' active' : ''}`}
            title={t(locale, 'recognizeToggle')}
            aria-label={t(locale, 'recognizeShapes')}
            aria-pressed={recognize}
            onClick={() => writePrefs({ recognizeShapes: !recognize })}
          >
            <Icon name="sparkles" size={TOOLBELT_ICON_SIZE} />
          </button>
        </div>
        {cropActive && (
          <>
            <div className="toolbelt-sep" />
            <div className="tool-group">
              <button
                type="button"
                className="tool-btn crop-apply tool-pop"
                title={t(locale, 'cropApply')}
                aria-label={t(locale, 'cropApply')}
                onClick={onApplyCrop}
              >
                <Icon name="check" size={TOOLBELT_ICON_SIZE} />
              </button>
              <button
                type="button"
                className="tool-btn tool-pop"
                title={t(locale, 'cropCancel')}
                aria-label={t(locale, 'cropCancel')}
                onClick={onCancelCrop}
              >
                <Icon name="close" size={TOOLBELT_ICON_SIZE} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
