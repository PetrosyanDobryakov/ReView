import { useEffect, useLayoutEffect, useRef } from 'react';
import type { EditTarget } from '../engine/Engine';
import type { Engine } from '../engine/Engine';
import { boardFont, displayInk } from '../core/shapes';
import { viewPaperBg } from '../core/store';
import { spansToHtml, plainToSpans, sanitizeRichHtml } from '../core/richText';
import { readLiveFormat, type LiveTextFormat } from '../core/textEditorFormat';

export function TextOverlay({
  target,
  engine,
  editorRef,
  onDone,
  onCancel,
  onFormatChange,
}: {
  target: EditTarget;
  engine: Engine;
  editorRef?: (el: HTMLDivElement | null) => void;
  onDone: (text: string, html: string) => void;
  onCancel: () => void;
  onFormatChange?: (format: LiveTextFormat) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  const blurTimer = useRef<number | null>(null);
  /** Ignore blur until the opening pointer gesture / first paint has settled. */
  const armedRef = useRef(false);
  const zoom = engine.camera.zoom;
  const pos = engine.worldToScreen(target.x, target.y);
  const fontPx = Math.max(12, Math.round(target.fontSize * zoom));
  const isCentered = target.centered;
  const displayColor = target.type === 'text' ? displayInk(target.color, viewPaperBg()) : target.color;
  const align = target.textAlign ?? (isCentered ? 'center' : 'left');

  const emitFormat = () => {
    const el = ref.current;
    if (!el || !onFormatChange) return;
    onFormatChange(readLiveFormat(el, target.color));
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    armedRef.current = false;
    doneRef.current = false;
    if (target.richHtml && target.richHtml.includes('<')) {
      el.innerHTML = sanitizeRichHtml(target.richHtml);
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
    el.style.color = displayColor;
    el.focus();
    const sel = window.getSelection();
    if (sel) {
      sel.selectAllChildren(el);
      sel.collapseToEnd();
    }
    emitFormat();
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

  useLayoutEffect(() => {
    editorRef?.(ref.current);
    return () => {
      if (blurTimer.current !== null) {
        window.clearTimeout(blurTimer.current);
        blurTimer.current = null;
      }
      editorRef?.(null);
    };
  }, [editorRef]);

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

  useEffect(() => {
    const el = ref.current;
    if (!el || !onFormatChange) return;
    const sync = () => emitFormat();
    el.addEventListener('input', sync);
    el.addEventListener('keyup', sync);
    el.addEventListener('mouseup', sync);
    document.addEventListener('selectionchange', sync);
    return () => {
      el.removeEventListener('input', sync);
      el.removeEventListener('keyup', sync);
      el.removeEventListener('mouseup', sync);
      document.removeEventListener('selectionchange', sync);
    };
  }, [onFormatChange, target.color]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.color = displayColor;
    if (target.textAlign) el.style.textAlign = target.textAlign;
  }, [displayColor, target.textAlign, target.fontSize, target.bold, target.italic]);

  const finish = (commit: boolean) => {
    if (blurTimer.current !== null) {
      window.clearTimeout(blurTimer.current);
      blurTimer.current = null;
    }
    if (doneRef.current) return;
    doneRef.current = true;
    const el = ref.current;
    const raw = el?.innerText ?? '';
    const html = sanitizeRichHtml(el?.innerHTML ?? '');
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
          emitFormat();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          document.execCommand('italic');
          emitFormat();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
          e.preventDefault();
          document.execCommand('underline');
          emitFormat();
        } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
          e.preventDefault();
          document.execCommand('strikeThrough');
          emitFormat();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        const text = e.clipboardData.getData('text/plain');
        if (html && html.includes('<')) {
          const safe = sanitizeRichHtml(html);
          document.execCommand('insertHTML', false, safe);
        } else {
          document.execCommand('insertText', false, text);
        }
        emitFormat();
      }}
      onBlur={(e) => {
        if (!armedRef.current) {
          requestAnimationFrame(() => {
            if (!doneRef.current) ref.current?.focus();
          });
          return;
        }
        const related = e.relatedTarget as HTMLElement | null;
        if (related?.closest('.style-island, .pen-pop, .chrome-select-pop, .pen-slots')) {
          requestAnimationFrame(() => ref.current?.focus());
          return;
        }
        if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
        blurTimer.current = window.setTimeout(() => {
          blurTimer.current = null;
          const active = document.activeElement;
          if (ref.current && (active === ref.current || ref.current.contains(active))) return;
          if (active instanceof HTMLElement && active.closest('.style-island, .pen-pop, .chrome-select-pop, .pen-slots')) {
            ref.current?.focus();
            return;
          }
          finish(true);
        }, 160);
      }}
      onFocus={() => {
        if (blurTimer.current !== null) {
          window.clearTimeout(blurTimer.current);
          blurTimer.current = null;
        }
      }}
    />
  );
}
