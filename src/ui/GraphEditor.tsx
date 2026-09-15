import { useEffect, useRef, useState } from 'react';
import type { Engine, GraphEditTarget } from '../engine/Engine';
import { compileGraph } from '../core/graphEval';
import { graphChromeKind } from '../core/editChrome';
import { readLocale } from '../core/locale';
import { t } from './i18n';

const PRESETS = ['sin(x)', 'cos(x)', 'x^2', 'abs(x)', 'exp(x/4)', '1/x'] as const;

export function GraphEditor({
  target,
  engine,
  onDone,
}: {
  target: GraphEditTarget;
  engine: Engine;
  onDone: () => void;
}) {
  const [value, setValue] = useState(target.expr);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef(0);
  const doneRef = useRef(false);
  const locale = readLocale();
  const compiled = compileGraph(value);

  const preview = (expr: string) => {
    engine.commitGraphPreview(target.id, expr);
  };

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    window.clearTimeout(timerRef.current);
    engine.commitGraphPreview(target.id, value);
    engine.commitOpenGraphEditor();
    onDone();
  };

  const cancel = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    window.clearTimeout(timerRef.current);
    engine.cancelGraphEditor();
    onDone();
  };

  const finishRef = useRef(finish);
  const cancelRef = useRef(cancel);
  finishRef.current = finish;
  cancelRef.current = cancel;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      doneRef.current = true;
      window.clearTimeout(timerRef.current);
    };
  }, []);

  // Classify the real hit target on pointerdown (capture) before blur. Blur
  // relatedTarget can be the toolbelt or the active tool, which used to cancel
  // Copy/export before the click wrote the preview.
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (doneRef.current) return;
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (rootRef.current?.contains(t)) return;
      const kind = graphChromeKind(t);
      if (kind === 'keep') return;
      if (kind === 'commit') {
        finishRef.current();
        return;
      }
      if (kind === 'cancel') cancelRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  const applyPreset = (expr: string) => {
    setValue(expr);
    preview(expr);
    inputRef.current?.focus();
  };

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let raf = 0;
    const loop = () => {
      const p = engine.worldToScreen(target.x, target.y);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y + 10}px`;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine, target.x, target.y]);

  const left = engine.worldToScreen(target.x, target.y);

  return (
    <div
      ref={rootRef}
      className="graph-editor"
      style={{ left: left.x, top: left.y + 10 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="graph-editor-row">
        <span className="graph-editor-label">y =</span>
        <input
          ref={inputRef}
          type="text"
          value={value}
          spellCheck={false}
          aria-label={t(locale, 'graphExpr')}
          placeholder="sin(x)"
          onChange={(e) => {
            const next = e.target.value;
            setValue(next);
            preview(next);
          }}
          onBlur={(e) => {
            const next = e.relatedTarget as HTMLElement | null;
            if (next && rootRef.current?.contains(next)) return;
            const kind = graphChromeKind(next);
            if (kind === 'keep') {
              requestAnimationFrame(() => inputRef.current?.focus());
              return;
            }
            if (kind === 'commit') {
              finish();
              return;
            }
            if (kind === 'cancel') {
              cancel();
              return;
            }
            window.clearTimeout(timerRef.current);
            timerRef.current = window.setTimeout(() => finish(), 0);
          }}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              finish();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
        />
      </div>
      {compiled.error ? (
        <div className="graph-editor-error" role="status">
          {compiled.error}
        </div>
      ) : (
        <div className="graph-editor-hint">{t(locale, 'graphHint')}</div>
      )}
      <div className="graph-editor-presets" role="group" aria-label={t(locale, 'graphPresets')}>
        {PRESETS.map((expr) => (
          <button
            key={expr}
            type="button"
            className={`graph-preset${value.trim() === expr ? ' is-active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyPreset(expr)}
          >
            {expr}
          </button>
        ))}
      </div>
    </div>
  );
}
