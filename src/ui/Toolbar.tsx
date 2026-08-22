import type { ToolId } from '../engine/tools';
import { Icon } from './icons';
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
            <Icon name={id} />
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
            <Icon name={id} />
          </button>
        ))}
      </div>
      <div className="toolbelt-sep" />
      <div className="tool-group">
        <button className="tool-btn" title={t(locale, 'delete')} disabled={!selectionCount} onClick={onDelete}>
          <Icon name="trash" />
        </button>
        <button className="tool-btn" title={t(locale, 'copy')} disabled={!selectionCount} onClick={onCopy}>
          <Icon name="copy" />
        </button>
        <button className="tool-btn" title={t(locale, 'paste')} onClick={onPaste}>
          <Icon name="paste" />
        </button>
        <button className="tool-btn" title={t(locale, 'duplicate')} disabled={!selectionCount} onClick={onDuplicate}>
          <Icon name="duplicate" />
        </button>
      </div>
      <div className="toolbelt-sep" />
      <div className="tool-group">
        {cropActive ? (
          <>
            <button className="tool-btn crop-apply" title={t(locale, 'cropApply')} onClick={onApplyCrop}>
              <Icon name="check" />
            </button>
            <button className="tool-btn" title={t(locale, 'cropCancel')} onClick={onCancelCrop}>
              <Icon name="close" />
            </button>
          </>
        ) : (
          <>
            <button className="tool-btn" title={t(locale, 'insertImage')} onClick={onInsertImage}>
              <Icon name="image" />
            </button>
            <button className="tool-btn" title={t(locale, 'crop')} disabled={!canCrop} onClick={onCrop}>
              <Icon name="crop" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
