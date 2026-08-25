import { useEffect, useRef, useState } from 'react';
import type { Engine, GraphEditTarget } from '../engine/Engine';
import { compileGraph } from '../core/graphEval';
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
  const locale = readLocale();
  const compiled = compileGraph(value);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => window.clearTimeout(timerRef.current);
  }, []);

  const preview = (expr: string) => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      engine.commitGraphPreview(target.id, expr);
    }, 120);
  };

  const finish = () => {
    window.clearTimeout(timerRef.current);
    engine.commitGraph(target.id, value);
    onDone();
  };

  const cancel = () => {
    window.clearTimeout(timerRef.current);
    engine.commitGraph(target.id, target.expr);
    onDone();
  };

  const applyPreset = (expr: string) => {
    setValue(expr);
    preview(expr);
    inputRef.current?.focus();
  };

  const left = engine.worldToScreen(target.x, target.y + target.h);

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
            setValue(e.target.value);
          }}
          onBlur={(e) => {
            // Keep open when focus moves to a preset chip inside the editor.
            const next = e.relatedTarget as Node | null;
            if (next && rootRef.current?.contains(next)) return;
            finish();
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
