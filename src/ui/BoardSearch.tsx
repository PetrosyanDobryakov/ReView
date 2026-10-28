import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import type { LocaleId } from '../core/locale';
import { t } from './i18n';

/**
 * Board text search (Ctrl+F): texts, stickies, table cells, media file
 * names on the active page. Enter flies to the match and selects it;
 * arrows cycle, Esc closes. The selection outline is the highlight.
 */
export function BoardSearch({
  engine,
  locale,
  revision,
  onClose,
}: {
  engine: Engine;
  locale: LocaleId;
  /** Bumps when board content changes so open results stay fresh. */
  revision: number;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(
    () => engine.searchBoard(query),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, query, revision]
  );
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    setActive(0);
  }, [query]);
  const jump = (index: number) => {
    const m = results[index];
    if (!m) return;
    engine.setSelection([m.id]);
    engine.focusBox(m.box);
  };
  const shown = results.slice(0, 12);
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t(locale, 'boardSearch')}
      style={{
        position: 'fixed',
        left: '50%',
        top: 76,
        transform: 'translateX(-50%)',
        zIndex: 1300,
        width: 'min(420px, calc(100vw - 32px))',
      }}
      className="board-row-menu"
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 4 }}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t(locale, 'boardSearchHint')}
          aria-label={t(locale, 'boardSearchHint')}
          spellCheck={false}
          autoComplete="off"
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: 'var(--chrome-text)',
            fontSize: 14,
            padding: '6px 8px',
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === 'Enter') {
              e.preventDefault();
              jump(active);
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(shown.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            }
          }}
        />
        <button
          type="button"
          className="icon-btn"
          title={t(locale, 'close')}
          aria-label={t(locale, 'close')}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      {query.trim() ? (
        shown.length ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: '2px 4px 6px', maxHeight: 240, overflowY: 'auto' }}>
            {shown.map((m, i) => (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  onClick={() => {
                    setActive(i);
                    jump(i);
                  }}
                  onMouseEnter={() => setActive(i)}
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'baseline',
                    width: '100%',
                    textAlign: 'left',
                    background: i === active ? 'var(--chrome-active-bg, rgba(124,140,255,0.16))' : 'transparent',
                    border: 'none',
                    borderRadius: 8,
                    padding: '6px 8px',
                    cursor: 'pointer',
                    color: 'var(--chrome-text)',
                    fontSize: 13,
                  }}
                >
                  <span className="p2p-tag" style={{ flex: 'none' }}>
                    {m.kind}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.snippet}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sheet-hint" style={{ margin: 0, padding: '2px 12px 10px' }}>
            {t(locale, 'boardSearchEmpty')}
          </p>
        )
      ) : null}
    </div>
  );
}
