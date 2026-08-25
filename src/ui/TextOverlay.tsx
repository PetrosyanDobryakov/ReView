import { useEffect, useLayoutEffect, useRef } from 'react';
import type { EditTarget } from '../engine/Engine';
import type { Engine } from '../engine/Engine';
import { boardFont, displayInk, TEXT_HIGHLIGHT } from '../core/shapes';
import { viewPaperBg } from '../core/store';

export function TextOverlay({
  target,
  engine,
  onDone,
  onCancel,
}: {
  target: EditTarget;
  engine: Engine;
  onDone: (text: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  /** Ignore blur until the opening pointer gesture / first paint has settled. */
  const armedRef = useRef(false);
  const zoom = engine.camera.zoom;
  const pos = engine.worldToScreen(target.x, target.y);
  const fontPx = Math.max(12, Math.round(target.fontSize * zoom));
  const isCentered = target.centered;
  const displayColor = target.type === 'text' ? displayInk(target.color, viewPaperBg()) : target.color;
  const align = target.textAlign ?? (isCentered ? 'center' : 'left');

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    armedRef.current = false;
    doneRef.current = false;
    el.innerText = target.text;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
    const arm = () => {
      armedRef.current = true;
    };
    // Opened from pointerup / keyboard: arm on next frame. Also arm on next pointerup
    // in case a trailing click from the same gesture still arrives.
    const raf = requestAnimationFrame(arm);
    window.addEventListener('pointerup', arm, { once: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointerup', arm);
    };
  }, [target.id, target.x, target.y]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const loop = () => {
      const z = engine.camera.zoom;
      const p = engine.worldToScreen(target.x, target.y);
      const size = Math.max(12, Math.round(target.fontSize * z));
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.width = `${Math.max(isCentered ? 20 : 120, target.w * z)}px`;
      el.style.fontSize = `${size}px`;
      el.style.font = boardFont(size, target);
      if (isCentered) {
        el.style.height = `${target.h * z}px`;
        el.style.minHeight = `${target.h * z}px`;
      } else {
        el.style.minHeight = `${size * 1.3}px`;
        el.style.height = 'auto';
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine, target, isCentered]);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    const raw = ref.current?.innerText ?? '';
    if (commit) onDone(raw);
    else onCancel();
  };

  return (
    <div
      ref={ref}
      className="text-overlay"
      contentEditable
      role="textbox"
      aria-multiline="true"
      suppressContentEditableWarning
      spellCheck
      style={{
        left: pos.x,
        top: pos.y,
        width: Math.max(isCentered ? 20 : 120, target.w * zoom),
        height: isCentered ? target.h * zoom : undefined,
        minHeight: isCentered ? target.h * zoom : fontPx * 1.3,
        font: boardFont(fontPx, target),
        color: displayColor,
        caretColor: displayColor,
        display: isCentered ? 'flex' : 'block',
        alignItems: isCentered ? 'center' : undefined,
        justifyContent: isCentered ? (align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center') : undefined,
        textAlign: align,
        textDecoration: [target.underline ? 'underline' : '', target.strike ? 'line-through' : '']
          .filter(Boolean)
          .join(' ') || 'none',
        background: target.highlight && target.type === 'text' ? TEXT_HIGHLIGHT : 'transparent',
        borderRadius: target.highlight && target.type === 'text' ? 4 : undefined,
        padding: isCentered ? '0 8px' : target.type === 'sticky' ? '8px' : target.highlight ? '2px 4px' : '0',
        overflow: isCentered ? 'hidden' : undefined,
        boxSizing: 'border-box',
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const text = e.clipboardData.getData('text/plain');
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        sel.deleteFromDocument();
        sel.getRangeAt(0).insertNode(document.createTextNode(text));
        sel.collapseToEnd();
      }}
      onBlur={() => {
        if (!armedRef.current) {
          // Premature blur from the opening click — reclaim focus.
          requestAnimationFrame(() => {
            if (!doneRef.current) ref.current?.focus();
          });
          return;
        }
        finish(true);
      }}
    />
  );
}
