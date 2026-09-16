import { useEffect, useLayoutEffect, useRef } from 'react';
import type { EditTarget } from '../engine/Engine';
import type { Engine } from '../engine/Engine';
import { boardFont, overlayDisplayColor, textOverlayLineHeight, textOverlayPaddingCss, textOverlayWidthPx } from '../core/shapes';
import { viewPaperBg } from '../core/store';
import { spansToHtml, plainToSpans, sanitizeRichHtml } from '../core/richText';
import { overlayFinishNow, overlayKeepEdit } from '../core/editChrome';
import { readLiveFormat, textOverlayAllowsRich, type LiveTextFormat } from '../core/textEditorFormat';
import { clampToVisualViewport } from '../core/pointerEnv';

export function TextOverlay({
  target,
  engine,
  editorRef,
  onDone,
  onCancel,
  onFormatChange,
  onCellAdvance,
}: {
  target: EditTarget;
  engine: Engine;
  editorRef?: (el: HTMLDivElement | null) => void;
  onDone: (text: string, html: string) => void;
  onCancel: () => void;
  onFormatChange?: (format: LiveTextFormat) => void;
  /** Table cells only: Enter/Tab commits and moves to the next cell. */
  onCellAdvance?: (dir: 'down' | 'right') => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  const blurTimer = useRef<number | null>(null);
  /** Ignore blur until the opening pointer gesture / first paint has settled. */
  const armedRef = useRef(false);
  const zoom = engine.camera.zoom;
  const pos = engine.worldToScreen(target.x, target.y);
  const fontPx = Math.max(0.5, target.fontSize * zoom);
  const overlayW = textOverlayWidthPx(target, zoom);
  const lineHeight = textOverlayLineHeight(target.type);
  const isCentered = target.centered;
  const isFrame = target.type === 'frame';
  const allowsRich = textOverlayAllowsRich(target);
  const view = target.id ? engine.views.get(target.id) : undefined;
  const displayColor = overlayDisplayColor(target, view, viewPaperBg());
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
    if (allowsRich && target.richHtml && target.richHtml.includes('<')) {
      el.innerHTML = sanitizeRichHtml(target.richHtml);
    } else if (allowsRich && (target.bold || target.italic || target.underline || target.strike || target.highlight)) {
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
      const size = Math.max(0.5, target.fontSize * z);
      const width = textOverlayWidthPx(target, z);
      const estH = isCentered
        ? target.h * z
        : Math.max(size * textOverlayLineHeight(target.type), el.offsetHeight || size * 2);
      const clamped = clampToVisualViewport(p.x, p.y, width, estH, 8);
      el.style.left = `${clamped.left}px`;
      el.style.top = `${clamped.top}px`;
      el.style.width = `${width}px`;
      el.style.fontSize = `${size}px`;
      el.style.font = boardFont(size, target);
      el.style.padding = textOverlayPaddingCss(target, z);
      el.style.lineHeight = String(textOverlayLineHeight(target.type));
      el.style.overflow = isCentered ? 'hidden' : 'visible';
      el.style.whiteSpace = isFrame ? 'nowrap' : 'pre-wrap';
      if (isCentered) {
        el.style.height = `${target.h * z}px`;
        el.style.minHeight = `${target.h * z}px`;
      } else {
        el.style.minHeight = `${size * textOverlayLineHeight(target.type)}px`;
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
        width: overlayW,
        height: isCentered ? target.h * zoom : undefined,
        minHeight: isCentered ? target.h * zoom : fontPx * lineHeight,
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
        lineHeight,
        background: 'transparent',
        borderRadius: target.highlight && target.type === 'text' ? 4 : undefined,
        padding: textOverlayPaddingCss(target, zoom),
        overflow: isCentered ? 'hidden' : 'visible',
        whiteSpace: isFrame ? 'nowrap' : undefined,
        boxSizing: 'border-box',
        transform: target.rotation ? `rotate(${target.rotation}deg)` : undefined,
        transformOrigin: 'top left',
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          finish(true);
        } else if (target.tableCell && e.key === 'Enter') {
          // ponytail: Enter commits and EXITS cell editing so the table can be
          // dragged right away; Tab keeps fast multi-cell entry (moves right).
          e.preventDefault();
          finish(true);
        } else if (isFrame && e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (target.tableCell && e.key === 'Tab') {
          e.preventDefault();
          finish(true);
          onCellAdvance?.('right');
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        } else if (allowsRich && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          document.execCommand('bold');
          emitFormat();
        } else if (allowsRich && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          document.execCommand('italic');
          emitFormat();
        } else if (allowsRich && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
          e.preventDefault();
          document.execCommand('underline');
          emitFormat();
        } else if (allowsRich && (e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x') {
          e.preventDefault();
          document.execCommand('strikeThrough');
          emitFormat();
        }
      }}
      onPaste={(e) => {
        e.preventDefault();
        const html = e.clipboardData.getData('text/html');
        const text = e.clipboardData.getData('text/plain');
        if (allowsRich && html && html.includes('<')) {
          const safe = sanitizeRichHtml(html);
          if (safe.trim()) document.execCommand('insertHTML', false, safe);
          else document.execCommand('insertText', false, text);
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
        if (overlayKeepEdit(related)) {
          requestAnimationFrame(() => {
            if (!doneRef.current) ref.current?.focus();
          });
          return;
        }
        if (overlayFinishNow(related)) {
          // toolbar / file-bar / save-as: commit instead of refocus (flowchart insert lock)
          finish(true);
          return;
        }
        if (blurTimer.current !== null) window.clearTimeout(blurTimer.current);
        blurTimer.current = window.setTimeout(() => {
          blurTimer.current = null;
          const active = document.activeElement;
          if (ref.current && (active === ref.current || ref.current.contains(active))) return;
          if (overlayKeepEdit(active)) {
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
