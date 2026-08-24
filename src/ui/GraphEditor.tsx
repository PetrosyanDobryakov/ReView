import { useEffect, useRef, useState } from 'react';
import type { Engine, GraphEditTarget } from '../engine/Engine';

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
  const timerRef = useRef(0);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => window.clearTimeout(timerRef.current);
  }, []);

  const preview = (expr: string) => {
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      engine.commitGraphPreview(target.id, expr);
    }, 140);
  };

  const finish = () => {
    engine.commitGraph(target.id, value);
    onDone();
  };

  const cancel = () => {
    engine.commitGraph(target.id, target.expr);
    onDone();
  };

  const left = engine.worldToScreen(target.x, target.y + target.h);

  return (
    <div className="graph-editor" style={{ left: left.x, top: left.y + 8 }}>
      <span className="graph-editor-label">y =</span>
      <input
        ref={inputRef}
        type="text"
        value={value}
        spellCheck={false}
        onChange={(e) => {
          setValue(e.target.value);
          preview(e.target.value);
        }}
        onBlur={cancel}
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
  );
}
