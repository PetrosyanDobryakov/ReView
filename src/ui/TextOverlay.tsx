import { useEffect, useRef } from 'react';
import type { EditTarget } from '../engine/Engine';
import type { Engine } from '../engine/Engine';

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
  const zoom = engine.camera.zoom;
  const pos = engine.worldToScreen(target.x, target.y);
  const fontPx = Math.max(12, Math.round(target.fontSize * zoom));
  const color = target.color;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = target.text;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
  }, []);

  const finish = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (commit) onDone(ref.current?.textContent ?? '');
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
      spellCheck={false}
      style={{
        left: pos.x,
        top: pos.y,
        width: Math.max(120, target.w * zoom),
        minHeight: fontPx * 1.3,
        fontSize: fontPx,
        color,
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
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
      onBlur={() => finish(true)}
    />
  );
}
