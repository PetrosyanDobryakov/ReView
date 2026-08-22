import type { ToolId } from '../engine/tools';
import { Icon, TOOLBELT_ICON_SIZE } from './icons';
import type { LocaleId } from '../core/locale';
import { t } from './i18n';

const NAV: ToolId[] = ['select', 'lasso', 'pan'];
const CREATE: ToolId[] = ['pen', 'eraser', 'rect', 'ellipse', 'arrow', 'sticky', 'text'];

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
}: ToolbarProps) {
  return (
    <div className="toolbelt" role="toolbar" aria-label={t(locale, 'tools')}>
      <div className="tool-group">
        {NAV.map((id) => (
          <button
            key={id}
            className={`tool-btn${tool === id ? ' active' : ''}`}
            title={t(locale, id)}
            onClick={() => onTool(id)}
          >
            <Icon name={id} size={TOOLBELT_ICON_SIZE} />
          </button>
        ))}
      </div>
      <div className="toolbelt-sep" />
      <div className="tool-group">
        {CREATE.map((id) => (
          <button
            key={id}
            className={`tool-btn${tool === id ? ' active' : ''}`}
            title={t(locale, id)}
            onClick={() => onTool(id)}
          >
            <Icon name={id} size={TOOLBELT_ICON_SIZE} />
          </button>
        ))}
      </div>
      <div className="toolbelt-sep" />
      <div className="tool-group">
        <button className="tool-btn" title={t(locale, 'delete')} disabled={!selectionCount} onClick={onDelete}>
          <Icon name="trash" size={TOOLBELT_ICON_SIZE} />
        </button>
        <button className="tool-btn" title={t(locale, 'copy')} disabled={!selectionCount} onClick={onCopy}>
          <Icon name="copy" size={TOOLBELT_ICON_SIZE} />
        </button>
        <button className="tool-btn" title={t(locale, 'paste')} onClick={onPaste}>
          <Icon name="paste" size={TOOLBELT_ICON_SIZE} />
        </button>
        <button className="tool-btn" title={t(locale, 'duplicate')} disabled={!selectionCount} onClick={onDuplicate}>
          <Icon name="duplicate" size={TOOLBELT_ICON_SIZE} />
        </button>
      </div>
      <div className="toolbelt-sep" />
      <div className="tool-group">
        {cropActive ? (
          <>
            <button className="tool-btn crop-apply" title={t(locale, 'cropApply')} onClick={onApplyCrop}>
              <Icon name="check" size={TOOLBELT_ICON_SIZE} />
            </button>
            <button className="tool-btn" title={t(locale, 'cropCancel')} onClick={onCancelCrop}>
              <Icon name="close" size={TOOLBELT_ICON_SIZE} />
            </button>
          </>
        ) : (
          <>
            <button className="tool-btn" title={t(locale, 'insertImage')} onClick={onInsertImage}>
              <Icon name="image" size={TOOLBELT_ICON_SIZE} />
            </button>
            <button className="tool-btn" title={t(locale, 'crop')} disabled={!canCrop} onClick={onCrop}>
              <Icon name="crop" size={TOOLBELT_ICON_SIZE} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
