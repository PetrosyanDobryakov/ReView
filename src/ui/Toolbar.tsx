import { useEffect, useId, useRef, useState } from 'react';
import type { ToolId } from '../engine/tools';
import { onPrefsChange, readPrefs } from '../core/prefs';
import { Icon, TOOLBELT_ICON_SIZE, type IconName } from './icons';
import type { LocaleId } from '../core/locale';
import { t, type MessageKey } from './i18n';
import { SlideTrack } from './SlideTrack';

const NAV: ToolId[] = ['select', 'lasso', 'pan'];
const CREATE: ToolId[] = ['pen', 'eraser', 'rect', 'ellipse', 'arrow', 'sticky', 'text', 'graph'];
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
const DEFAULT_SCHEME: ToolId = 'diamond';

function isSchemeTool(id: ToolId): boolean {
  return SCHEME.includes(id);
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
  onTool,
}: {
  ids: ToolId[];
  tool: ToolId;
  locale: LocaleId;
  onTool: (id: ToolId) => void;
}) {
  return (
    <SlideTrack className="tool-group" active={ids.includes(tool) ? tool : null}>
      {ids.map((id) => (
        <button
          type="button"
          key={id}
          className="tool-btn"
          data-slide-active={tool === id ? 'true' : undefined}
          title={t(locale, id)}
          aria-label={t(locale, id)}
          aria-pressed={tool === id}
          onClick={() => onTool(id)}
        >
          <Icon name={id as IconName} size={TOOLBELT_ICON_SIZE} />
        </button>
      ))}
    </SlideTrack>
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
  const menuId = useId();
  const schemeRootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const [schemeOpen, setSchemeOpen] = useState(false);
  const [lastSchemeTool, setLastSchemeTool] = useState<ToolId>(DEFAULT_SCHEME);
  const [toolHoverAnim, setToolHoverAnim] = useState(() => readPrefs().toolHoverAnim);

  useEffect(() => onPrefsChange((p) => setToolHoverAnim(p.toolHoverAnim)), []);

  useEffect(() => {
    if (isSchemeTool(tool)) setLastSchemeTool(tool);
  }, [tool]);

  const prevTool = useRef(tool);
  useEffect(() => {
    if (isSchemeTool(prevTool.current) && !isSchemeTool(tool)) setSchemeOpen(false);
    prevTool.current = tool;
  }, [tool]);

  useEffect(() => {
    if (!schemeOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (schemeRootRef.current?.contains(target)) return;
      setSchemeOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setSchemeOpen(false);
      chevronRef.current?.focus();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [schemeOpen]);

  useEffect(() => {
    if (!schemeOpen) return;
    const active = menuRef.current?.querySelector<HTMLButtonElement>(
      '[data-scheme-active="true"], [role="menuitem"]'
    );
    active?.focus();
  }, [schemeOpen]);

  const isSchemeActive = isSchemeTool(tool);
  const schemeIcon = (isSchemeActive ? tool : lastSchemeTool) as IconName;
  const hasSelection = selectionCount > 0;

  const pickScheme = (id: ToolId) => {
    setLastSchemeTool(id);
    onTool(id);
    setSchemeOpen(false);
    chevronRef.current?.focus();
  };

  return (
    <div
      className="toolbelt"
      role="toolbar"
      aria-label={t(locale, 'tools')}
      data-tool-anim={toolHoverAnim ? 'on' : undefined}
    >
      <div className="toolbelt-scroll">
        <ToolButtons ids={NAV} tool={tool} locale={locale} onTool={onTool} />
        <div className="toolbelt-sep" />
        <ToolButtons ids={CREATE} tool={tool} locale={locale} onTool={onTool} />
        <div className="toolbelt-sep" />
        <div className="tool-group scheme-group" ref={schemeRootRef}>
          <button
            type="button"
            className={`tool-btn${isSchemeActive ? ' active' : ''}`}
            title={t(locale, lastSchemeTool)}
            aria-label={t(locale, lastSchemeTool)}
            aria-pressed={isSchemeActive}
            onClick={() => {
              onTool(lastSchemeTool);
              setSchemeOpen(false);
            }}
          >
            <Icon name={schemeIcon} size={TOOLBELT_ICON_SIZE} />
          </button>
          <button
            ref={chevronRef}
            type="button"
            className={`tool-btn scheme-chevron${schemeOpen ? ' active' : ''}`}
            title={t(locale, 'blockScheme')}
            aria-label={t(locale, 'blockScheme')}
            aria-haspopup="menu"
            aria-controls={menuId}
            aria-expanded={schemeOpen}
            onClick={() => setSchemeOpen((v) => !v)}
          >
            <Icon name="chevronDown" size={14} />
          </button>
          {schemeOpen && (
            <div
              ref={menuRef}
              id={menuId}
              className="island block-scheme-popover"
              role="menu"
              aria-label={t(locale, 'blockScheme')}
            >
              <div className="block-scheme-popover-title">{t(locale, 'blockScheme')}</div>
              {SCHEME.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  className={`tool-btn${tool === id ? ' active' : ''}`}
                  data-scheme-active={tool === id ? 'true' : undefined}
                  title={t(locale, id)}
                  aria-label={t(locale, id)}
                  aria-checked={tool === id}
                  onClick={() => pickScheme(id)}
                >
                  <Icon name={id as IconName} size={TOOLBELT_ICON_SIZE} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="toolbelt-sep" />
        <div className="tool-group">
          <button
            type="button"
            className="tool-btn"
            title={actionLabel(locale, 'delete', 'deleteDisabled', hasSelection)}
            aria-label={actionLabel(locale, 'delete', 'deleteDisabled', hasSelection)}
            disabled={!hasSelection}
            onClick={onDelete}
          >
            <Icon name="trash" size={TOOLBELT_ICON_SIZE} />
          </button>
          <button
            type="button"
            className="tool-btn"
            title={actionLabel(locale, 'copy', 'copyDisabled', hasSelection)}
            aria-label={actionLabel(locale, 'copy', 'copyDisabled', hasSelection)}
            disabled={!hasSelection}
            onClick={onCopy}
          >
            <Icon name="copy" size={TOOLBELT_ICON_SIZE} />
          </button>
          <button type="button" className="tool-btn" title={t(locale, 'paste')} aria-label={t(locale, 'paste')} onClick={onPaste}>
            <Icon name="paste" size={TOOLBELT_ICON_SIZE} />
          </button>
          <button
            type="button"
            className="tool-btn"
            title={actionLabel(locale, 'duplicate', 'duplicateDisabled', hasSelection)}
            aria-label={actionLabel(locale, 'duplicate', 'duplicateDisabled', hasSelection)}
            disabled={!hasSelection}
            onClick={onDuplicate}
          >
            <Icon name="duplicate" size={TOOLBELT_ICON_SIZE} />
          </button>
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
