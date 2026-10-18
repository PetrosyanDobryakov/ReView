import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import type { LocaleId } from '../core/locale';
import { Icon, type IconName } from './icons';
import { t, type MessageKey } from './i18n';

/**
 * 1.0 floating selection bar: the verbs for what is selected, parked just above
 * it (below when there is no room). Tools stay put in the toolbelt; this is the
 * only place selection actions live outside the context menu.
 */
export interface SelectionBarProps {
  engine: Engine | null;
  locale: LocaleId;
  selectionCount: number;
  selectionRevision: number;
  canCrop: boolean;
  /** Editing text, cropping, a menu or a dialog is up — step aside. */
  suppressed: boolean;
  onDuplicate: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onToggleLock: () => void;
  onCrop: () => void;
  onExport: () => void;
  onMore: (x: number, y: number) => void;
}

const GAP = 12;
const EDGE = 8;

export function SelectionBar({
  engine,
  locale,
  selectionCount,
  selectionRevision,
  canCrop,
  suppressed,
  onDuplicate,
  onCopy,
  onDelete,
  onToggleLock,
  onCrop,
  onExport,
  onMore,
}: SelectionBarProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const [pressing, setPressing] = useState(false);

  // Hide while a pointer is down on the board (drag, resize, rotate, marquee).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (e.target instanceof HTMLCanvasElement) setPressing(true);
    };
    const onUp = () => setPressing(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, []);

  const visible = Boolean(engine) && selectionCount > 0 && !suppressed;

  // Follow the selection every frame while shown: camera pans, zooms and remote
  // edits all move it, and reading a box is cheaper than wiring each source.
  useEffect(() => {
    if (!visible || !engine) return;
    let raf = 0;
    let last = '';
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const anchor = anchorRef.current;
      const bar = barRef.current;
      const box = engine.selectionBounds();
      if (!anchor || !bar || !box) return;
      const a = engine.worldToScreen(box.x, box.y);
      const b = engine.worldToScreen(box.x + box.w, box.y + box.h);
      const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
      const bw = bar.offsetWidth * scale;
      const bh = bar.offsetHeight * scale;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      // Keep clear of the top islands (~64px) and the toolbelt stack (~150px).
      const topLimit = 64 * scale;
      const bottomLimit = vh - 150 * scale;
      let y = a.y - GAP - bh;
      if (y < topLimit) y = b.y + GAP;
      if (y + bh > bottomLimit) y = Math.max(topLimit, Math.min(a.y - GAP - bh, bottomLimit - bh));
      const cx = (a.x + b.x) / 2;
      const x = Math.min(Math.max(EDGE, cx - bw / 2), vw - bw - EDGE);
      const key = `${Math.round(x)},${Math.round(y)}`;
      if (key === last) return;
      last = key;
      anchor.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      anchor.dataset.placed = 'true';
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      if (anchorRef.current) delete anchorRef.current.dataset.placed;
    };
  }, [visible, engine, selectionRevision]);

  if (!visible || !engine) return null;

  const views = engine.selectedViews();
  const anyUnlocked = views.some((v) => !v.locked);

  const btn = (icon: IconName, key: MessageKey, onClick: (e: React.MouseEvent<HTMLButtonElement>) => void, extra = '') => (
    <button
      type="button"
      className={`icon-btn selbar-btn${extra}`}
      data-commit-edit
      title={t(locale, key)}
      aria-label={t(locale, key)}
      onClick={onClick}
    >
      <Icon name={icon} size={18} />
    </button>
  );

  return (
    <div ref={anchorRef} className={`selbar-anchor${pressing ? ' is-pressing' : ''}`}>
      <div ref={barRef} className="island selbar" role="toolbar" aria-label={t(locale, 'selectionBar')}>
        {btn('duplicate', 'ctxDuplicate', onDuplicate)}
        {btn('copy', 'ctxCopy', onCopy)}
        {canCrop && btn('crop', 'crop', onCrop)}
        {btn('export', 'exportImage', onExport)}
        <div className="island-sep" />
        {btn(anyUnlocked ? 'lock' : 'unlock', anyUnlocked ? 'ctxLock' : 'ctxUnlock', (e) => {
          if (anyUnlocked) onToggleLock();
          else {
            // Unlock needs the press-and-hold in the context menu (deliberate).
            const r = e.currentTarget.getBoundingClientRect();
            onMore(r.left, r.bottom + 6);
          }
        })}
        {btn('trash', 'ctxDelete', onDelete, ' danger')}
        {btn('dotsH', 'moreActions', (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onMore(r.left, r.bottom + 6);
        })}
      </div>
    </div>
  );
}
