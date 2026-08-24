import type { Engine } from '../engine/Engine';
import type { AlignKind } from '../core/align';
import type { LocaleId } from '../core/locale';
import { t } from './i18n';
import { Icon } from './icons';

export function AlignBar({
  engine,
  locale,
  selectionCount,
  totalCount,
}: {
  engine: Engine | null;
  locale: LocaleId;
  selectionCount: number;
  totalCount: number;
}) {
  if (!engine || selectionCount === 0) return null;
  const others = totalCount - selectionCount;
  const canAlignToOthers = others > 0;
  const canDistribute = selectionCount >= 3;
  if (!canAlignToOthers && !canDistribute) return null;

  const run = (k: AlignKind) => engine.alignSelection(k);

  return (
    <div className="island align-island" role="toolbar" aria-label={t(locale, 'alignHint')}>
      {canAlignToOthers && (
        <>
          <button type="button" className="tool-btn" title={t(locale, 'alignLeft')} aria-label={t(locale, 'alignLeft')} onClick={() => run('left')}>
            <Icon name="alignLeft" size={18} />
          </button>
          <button type="button" className="tool-btn" title={t(locale, 'alignCenterH')} aria-label={t(locale, 'alignCenterH')} onClick={() => run('centerH')}>
            <Icon name="alignCenterH" size={18} />
          </button>
          <button type="button" className="tool-btn" title={t(locale, 'alignRight')} aria-label={t(locale, 'alignRight')} onClick={() => run('right')}>
            <Icon name="alignRight" size={18} />
          </button>
          <div className="toolbelt-sep" />
          <button type="button" className="tool-btn" title={t(locale, 'alignTop')} aria-label={t(locale, 'alignTop')} onClick={() => run('top')}>
            <Icon name="alignTop" size={18} />
          </button>
          <button type="button" className="tool-btn" title={t(locale, 'alignCenterV')} aria-label={t(locale, 'alignCenterV')} onClick={() => run('centerV')}>
            <Icon name="alignCenterV" size={18} />
          </button>
          <button type="button" className="tool-btn" title={t(locale, 'alignBottom')} aria-label={t(locale, 'alignBottom')} onClick={() => run('bottom')}>
            <Icon name="alignBottom" size={18} />
          </button>
        </>
      )}
      {canDistribute && (
        <>
          {canAlignToOthers && <div className="toolbelt-sep" />}
          <button type="button" className="tool-btn" title={t(locale, 'distributeH')} aria-label={t(locale, 'distributeH')} onClick={() => run('distributeH')}>
            <Icon name="distributeH" size={18} />
          </button>
          <button type="button" className="tool-btn" title={t(locale, 'distributeV')} aria-label={t(locale, 'distributeV')} onClick={() => run('distributeV')}>
            <Icon name="distributeV" size={18} />
          </button>
        </>
      )}
    </div>
  );
}
