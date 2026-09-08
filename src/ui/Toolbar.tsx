import { useEffect, useId, useRef, useState } from 'react';
import type { ToolId } from '../engine/tools';
import { onPrefsChange, readPrefs, writePrefs } from '../core/prefs';
import { Icon, TOOLBELT_ICON_SIZE, type IconName } from './icons';
import type { LocaleId } from '../core/locale';
import { t, type MessageKey } from './i18n';
import { SlideTrack } from './SlideTrack';

const NAV_DEFAULTS: ToolId[] = ['select', 'lasso', 'pan'];
const CREATE_DEFAULTS: ToolId[] = ['pen', 'eraser', 'rect', 'ellipse', 'arrow', 'sticky', 'text'];
/** Tools that live on the strip and can be reordered by drag (popovers excluded). */
const MOVABLE = new Set<ToolId>([...NAV_DEFAULTS, ...CREATE_DEFAULTS]);
const SCHEME: ToolId[] = [
  'diamond',
  'triangle',
  'parallelogram',
  'hexagon',
  'cylinder',
  'terminator',
  'subroutine',
  'display',
  'frame',
];
/** Overflow shelf for specialty tools (graph today, tables later). */
const MORE: ToolId[] = ['graph'];

type StripGroup = 'nav' | 'create';

function readOrders(): { nav: ToolId[]; create: ToolId[] } {
  const saved = readPrefs().toolbarOrder;
  const clean = (v: unknown): ToolId[] =>
    Array.isArray(v) ? v.filter((x): x is ToolId => typeof x === 'string' && MOVABLE.has(x as ToolId)) : [];
  const nav = clean(saved?.nav);
  const create = clean(saved?.create).filter((id) => !nav.includes(id));
  const seen = new Set<ToolId>([...nav, ...create]);
  for (const id of NAV_DEFAULTS) {
    if (!seen.has(id)) {
      nav.push(id);
      seen.add(id);
    }
  }
  for (const id of CREATE_DEFAULTS) {
    if (!seen.has(id)) {
      create.push(id);
      seen.add(id);
    }
  }
  return { nav, create };
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
  onPaste: () => void;
  onDuplicate: () => void;
  onInsertImage: () => void;
  onCrop: () => void;
  onApplyCrop: () => void;
  onCancelCrop: () => void;
  onExport: () => void;
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
  const suppressClick = useRef(false);

  const beginDrag = (e: React.DragEvent, id: ToolId) => {
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
    suppressClick.current = true;
    setDragId(id);
  };
  const endDrag = () => {
    setDragId(null);
    setDrop(null);
    window.setTimeout(() => {
      suppressClick.current = false;
    }, 0);
  };

  return (
    <SlideTrack className="tool-group" active={ids.includes(tool) ? tool : null}>
      {ids.map((id) => (
        <button
          type="button"
          key={id}
          className={`tool-btn${dragId === id ? ' dragging' : ''}${drop?.id === id ? (drop.after ? ' drop-after' : ' drop-before') : ''}`}
          data-slide-active={tool === id ? 'true' : undefined}
          title={t(locale, id)}
          aria-label={t(locale, id)}
          aria-pressed={tool === id}
          draggable
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
            const drag = e.dataTransfer.getData('text/plain');
            setDrop(null);
            if (drag) onMove(drag as ToolId, group, id, drop?.id === id ? drop.after : false);
          }}
          onClick={() => {
            if (suppressClick.current) return;
            onTool(id);
          }}
        >
          <Icon name={id as IconName} size={TOOLBELT_ICON_SIZE} />
        </button>
      ))}
    </SlideTrack>
  );
}

/** Tool shelf with a popover (block-scheme, more). Remembers the last used tool. */
function PopoverToolGroup({
  ids,
  defaultId,
  tool,
  locale,
  titleKey,
  chevronIcon,
  onTool,
}: {
  ids: ToolId[];
  defaultId: ToolId;
  tool: ToolId;
  locale: LocaleId;
  titleKey: MessageKey;
  chevronIcon: IconName;
  onTool: (id: ToolId) => void;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [lastTool, setLastTool] = useState<ToolId>(defaultId);

  useEffect(() => {
    if (ids.includes(tool)) setLastTool(tool);
  }, [tool, ids]);

  const prevTool = useRef(tool);
  useEffect(() => {
    if (ids.includes(prevTool.current) && !ids.includes(tool)) setOpen(false);
    prevTool.current = tool;
  }, [tool, ids]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      chevronRef.current?.focus();
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
    const active = menuRef.current?.querySelector<HTMLButtonElement>(
      '[data-scheme-active="true"], [role="menuitem"]'
    );
    active?.focus();
  }, [open]);

  const isActive = ids.includes(tool);
  const icon = (isActive ? tool : lastTool) as IconName;

  const pick = (id: ToolId) => {
    setLastTool(id);
    onTool(id);
    setOpen(false);
    chevronRef.current?.focus();
  };

  return (
    <div className="tool-group scheme-group" ref={rootRef}>
      <button
        type="button"
        className={`tool-btn${isActive ? ' active' : ''}`}
        title={t(locale, lastTool)}
        aria-label={t(locale, lastTool)}
        aria-pressed={isActive}
        onClick={() => {
          onTool(lastTool);
          setOpen(false);
        }}
      >
        <Icon name={icon} size={TOOLBELT_ICON_SIZE} />
      </button>
      <button
        ref={chevronRef}
        type="button"
        className={`tool-btn scheme-chevron${open ? ' active' : ''}`}
        title={t(locale, titleKey)}
        aria-label={t(locale, titleKey)}
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name={chevronIcon} size={14} />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          className="island block-scheme-popover"
          role="menu"
          aria-label={t(locale, titleKey)}
        >
          <div className="block-scheme-popover-title">{t(locale, titleKey)}</div>
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              role="menuitemradio"
              className={`tool-btn${tool === id ? ' active' : ''}`}
              data-scheme-active={tool === id ? 'true' : undefined}
              title={t(locale, id)}
              aria-label={t(locale, id)}
              aria-checked={tool === id}
              onClick={() => pick(id)}
            >
              <Icon name={id as IconName} size={TOOLBELT_ICON_SIZE} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function actionLabel(
  locale: LocaleId,
  enabled: MessageKey,
  disabled: MessageKey,
  ok: boolean
): string {
  return t(locale, ok ? enabled : disabled);
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
  onPaste,
  onDuplicate,
  onInsertImage,
  onCrop,
  onApplyCrop,
  onCancelCrop,
  onExport,
}: ToolbarProps) {
  const [toolHoverAnim, setToolHoverAnim] = useState(() => readPrefs().toolHoverAnim);
  const [orders, setOrders] = useState(readOrders);

  useEffect(() => onPrefsChange((p) => setToolHoverAnim(p.toolHoverAnim)), []);
  useEffect(() => onPrefsChange(() => setOrders(readOrders())), []);

  const moveTool = (id: ToolId, to: StripGroup, before: ToolId | null, after: boolean) => {
    if (!MOVABLE.has(id)) return;
    const next = {
      nav: orders.nav.filter((x) => x !== id),
      create: orders.create.filter((x) => x !== id),
    };
    const list = next[to];
    const at = before ? list.indexOf(before) : -1;
    if (at < 0) list.push(id);
    else list.splice(after ? at + 1 : at, 0, id);
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
        <ToolButtons ids={orders.nav} tool={tool} locale={locale} group="nav" onTool={onTool} onMove={moveTool} />
        <div className="toolbelt-sep" />
        <ToolButtons ids={orders.create} tool={tool} locale={locale} group="create" onTool={onTool} onMove={moveTool} />
        <div className="toolbelt-sep" />
        <PopoverToolGroup
          ids={SCHEME}
          defaultId="diamond"
          tool={tool}
          locale={locale}
          titleKey="blockScheme"
          chevronIcon="chevronDown"
          onTool={onTool}
        />
        <div className="toolbelt-sep" />
        <PopoverToolGroup
          ids={MORE}
          defaultId="graph"
          tool={tool}
          locale={locale}
          titleKey="more"
          chevronIcon="more"
          onTool={onTool}
        />
        <div className="toolbelt-sep" />
        <div className="tool-group">
          {hasSelection && (
            <button type="button" className="tool-btn" title={t(locale, 'delete')} aria-label={t(locale, 'delete')} onClick={onDelete}>
              <Icon name="trash" size={TOOLBELT_ICON_SIZE} />
            </button>
          )}
          {hasSelection && (
            <button type="button" className="tool-btn" title={t(locale, 'copy')} aria-label={t(locale, 'copy')} onClick={onCopy}>
              <Icon name="copy" size={TOOLBELT_ICON_SIZE} />
            </button>
          )}
          <button type="button" className="tool-btn" title={t(locale, 'paste')} aria-label={t(locale, 'paste')} onClick={onPaste}>
            <Icon name="paste" size={TOOLBELT_ICON_SIZE} />
          </button>
          {hasSelection && (
            <button type="button" className="tool-btn" title={t(locale, 'duplicate')} aria-label={t(locale, 'duplicate')} onClick={onDuplicate}>
              <Icon name="duplicate" size={TOOLBELT_ICON_SIZE} />
            </button>
          )}
        </div>
        <div className="toolbelt-sep" />
        <div className="tool-group">
          <button type="button" className="tool-btn" title={t(locale, 'export')} aria-label={t(locale, 'export')} onClick={onExport}>
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
            ) : (
              <button
                key="crop"
                type="button"
                className="tool-btn"
                title={actionLabel(locale, 'crop', 'cropDisabled', canCrop)}
                aria-label={actionLabel(locale, 'crop', 'cropDisabled', canCrop)}
                disabled={!canCrop}
                onClick={onCrop}
              >
                <Icon name="crop" size={TOOLBELT_ICON_SIZE} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
