import { useEffect, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import { parseThread, type CommentMessage } from '../core/shapes';
import { patchShape } from '../core/store';
import { loadUser } from '../core/user';
import { t } from './i18n';
import type { LocaleId } from '../core/locale';
import { Icon } from './icons';

/** Miro-style thread popup for a comment pin: messages + reply box. */
export function CommentOverlay({
  engine,
  shapeId,
  locale,
  onClose,
}: {
  engine: Engine;
  shapeId: string;
  locale: LocaleId;
  onClose: () => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [messages, setMessages] = useState<CommentMessage[]>(() =>
    parseThread(engine.views.get(shapeId)?.thread)
  );
  const [draft, setDraft] = useState('');
  const lastThread = useRef<string | undefined>(undefined);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // Follow the pin every frame + pick up peers' replies live.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      try {
        const v = engine.views.get(shapeId);
        const box = boxRef.current;
        if (!v || v.type !== 'comment' || !box) {
          if (!v) closeRef.current();
          else if (box) box.style.display = 'none';
          return;
        }
        if (v.thread !== lastThread.current) {
          lastThread.current = v.thread;
          setMessages(parseThread(v.thread));
        }
        const p = engine.worldToScreen(v.x, v.y);
        const w = 288;
        const left = Math.min(Math.max(8, p.x - w / 2), window.innerWidth - w - 8);
        const below = p.y + 24;
        const estH = 340;
        const top =
          below + estH > window.innerHeight - 8 ? Math.max(8, p.y - 24 - estH) : below;
        box.style.display = '';
        box.style.left = `${left}px`;
        box.style.top = `${top}px`;
      } catch {
        /* ignore */
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, shapeId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (boxRef.current?.contains(e.target as Node)) return;
      closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    const v = engine.views.get(shapeId);
    if (!v || v.type !== 'comment') return;
    const next = [
      ...parseThread(v.thread),
      {
        id: `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
        user: loadUser().name,
        text,
        at: Date.now(),
      },
    ];
    patchShape(shapeId, { thread: JSON.stringify(next) });
    setDraft('');
    inputRef.current?.focus();
  };

  const fmtTime = (at: number): string => {
    if (!at) return '';
    try {
      return new Date(at).toLocaleString(locale, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <div ref={boxRef} className="island comment-pop" role="dialog" aria-label={t(locale, 'commentThread')}>
      <div className="comment-head">
        <span className="comment-title">{t(locale, 'commentThread')}</span>
        <button
          type="button"
          className="icon-btn"
          title={t(locale, 'close')}
          aria-label={t(locale, 'close')}
          onClick={() => closeRef.current()}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="comment-thread">
        {messages.length === 0 ? (
          <p className="comment-empty">{t(locale, 'commentEmpty')}</p>
        ) : (
          messages.map((m) => (
            <div key={m.id || `${m.at}-${m.text}`} className="comment-msg">
              <div className="comment-meta">
                <span className="comment-user">{m.user || '?'}</span>
                {m.at ? <span className="comment-time">{fmtTime(m.at)}</span> : null}
              </div>
              <p className="comment-text">{m.text}</p>
            </div>
          ))
        )}
      </div>
      <div className="comment-compose">
        <textarea
          ref={inputRef}
          className="comment-input"
          rows={2}
          value={draft}
          placeholder={t(locale, 'commentPlaceholder')}
          aria-label={t(locale, 'commentPlaceholder')}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button type="button" className="home-btn home-btn-primary home-btn-sm" disabled={!draft.trim()} onClick={send}>
          {t(locale, 'commentSend')}
        </button>
      </div>
    </div>
  );
}
