import { useEffect, useLayoutEffect, useRef } from 'react';
import type { EditTarget } from '../engine/Engine';
import type { Engine } from '../engine/Engine';
import { boardFont, displayInk } from '../core/shapes';
import { viewPaperBg } from '../core/store';
import { spansToHtml, plainToSpans } from '../core/richText';

export function TextOverlay({
  target,
  engine,
  onDone,
  onCancel,
}: {
  target: EditTarget;
  engine: Engine;
  onDone: (text: string, html: string) => void;
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
    if (target.richHtml && target.richHtml.includes('<')) {
      el.innerHTML = target.richHtml;
    } else if (target.bold || target.italic || target.underline || target.strike || target.highlight) {
      el.innerHTML = spansToHtml(
        plainToSpans(target.text, {
          bold: target.bold,
          italic: target.italic,
          underline: target.underline,
          strike: target.strike,
          highlight: target.highlight,
        })
      );
    } else {
      el.innerText = target.text;
    }
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
    const arm = () => {
      armedRef.current = true;
    };
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
    const el = ref.current;
    const raw = el?.innerText ?? '';
    const html = el?.innerHTML ?? '';
    if (commit) onDone(raw, html);
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
        justifyContent: isCentered
          ? align === 'left'
            ? 'flex-start'
            : align === 'right'
              ? 'flex-end'
              : 'center'
          : undefined,
        textAlign: align,
        background: 'transparent',
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
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          document.execCommand('bold');
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          document.execCommand('italic');
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
          e.preventDefault();
          document.execCommand('underline');
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        const text = e.clipboardData.getData('text/plain');
        if (html && html.includes('<')) {
          document.execCommand('insertHTML', false, html);
        } else {
          document.execCommand('insertText', false, text);
        }
      }}
      onBlur={() => {
        if (!armedRef.current) {
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
