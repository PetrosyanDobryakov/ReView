import type { ToolId } from '../engine/tools';
import { Icon, TOOLBELT_ICON_SIZE } from './icons';
import type { LocaleId } from '../core/locale';
import { t } from './i18n';
import { SlideTrack } from './SlideTrack';

const NAV: ToolId[] = ['select', 'lasso', 'pan'];
const CREATE: ToolId[] = ['pen', 'eraser', 'rect', 'ellipse', 'arrow', 'sticky', 'text', 'graph'];

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
          <Icon name={id} size={TOOLBELT_ICON_SIZE} />
        </button>
      ))}
    </SlideTrack>
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
  onPaste,
  onDuplicate,
  onInsertImage,
  onCrop,
  onApplyCrop,
  onCancelCrop,
  onExport,
}: ToolbarProps) {
  return (
    <div className="toolbelt" role="toolbar" aria-label={t(locale, 'tools')}>
      <ToolButtons ids={NAV} tool={tool} locale={locale} onTool={onTool} />
      <div className="toolbelt-sep" />
      <ToolButtons ids={CREATE} tool={tool} locale={locale} onTool={onTool} />
      <div className="toolbelt-sep" />
      <div className="tool-group">
        <button type="button" className="tool-btn" title={t(locale, 'delete')} aria-label={t(locale, 'delete')} disabled={!selectionCount} onClick={onDelete}>
          <Icon name="trash" size={TOOLBELT_ICON_SIZE} />
        </button>
        <button type="button" className="tool-btn" title={t(locale, 'copy')} aria-label={t(locale, 'copy')} disabled={!selectionCount} onClick={onCopy}>
          <Icon name="copy" size={TOOLBELT_ICON_SIZE} />
        </button>
        <button type="button" className="tool-btn" title={t(locale, 'paste')} aria-label={t(locale, 'paste')} onClick={onPaste}>
          <Icon name="paste" size={TOOLBELT_ICON_SIZE} />
        </button>
        <button type="button" className="tool-btn" title={t(locale, 'duplicate')} aria-label={t(locale, 'duplicate')} disabled={!selectionCount} onClick={onDuplicate}>
          <Icon name="duplicate" size={TOOLBELT_ICON_SIZE} />
        </button>
      </div>
      <div className="toolbelt-sep" />
      <div className="tool-group">
        <button type="button" className="tool-btn" title={t(locale, 'export')} aria-label={t(locale, 'export')} onClick={onExport}>
          <Icon name="download" size={TOOLBELT_ICON_SIZE} />
        </button>
        {cropActive ? (
          <>
            <button key="apply" type="button" className="tool-btn crop-apply tool-pop" title={t(locale, 'cropApply')} aria-label={t(locale, 'cropApply')} onClick={onApplyCrop}>
              <Icon name="check" size={TOOLBELT_ICON_SIZE} />
            </button>
            <button key="cancel" type="button" className="tool-btn tool-pop" title={t(locale, 'cropCancel')} aria-label={t(locale, 'cropCancel')} onClick={onCancelCrop}>
              <Icon name="close" size={TOOLBELT_ICON_SIZE} />
            </button>
          </>
        ) : (
          <>
            <button key="image" type="button" className="tool-btn" title={t(locale, 'insertImage')} aria-label={t(locale, 'insertImage')} onClick={onInsertImage}>
              <Icon name="image" size={TOOLBELT_ICON_SIZE} />
            </button>
            <button key="crop" type="button" className="tool-btn" title={t(locale, 'crop')} aria-label={t(locale, 'crop')} disabled={!canCrop} onClick={onCrop}>
              <Icon name="crop" size={TOOLBELT_ICON_SIZE} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
