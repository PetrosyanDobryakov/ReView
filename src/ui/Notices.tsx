import { useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from './i18n';
import type { LocaleId } from '../core/locale';
import { Icon } from './icons';

export type NoticeKind = 'info' | 'error';

export interface Notice {
  id: number;
  kind: NoticeKind;
  title: string;
  detail?: string;
  /**
   * toast: bar drains over `ms`, then auto-gone. countdown: bar fills over
   * `ms` (the warning), then onDone fires and the bar drains back over
   * `lingerMs` before auto-gone. × always dismisses now.
   */
  mode: 'toast' | 'countdown';
  ms: number;
  lingerMs: number;
  onDone?: () => void;
  onDismiss?: (auto: boolean) => void;
}

function NoticeItem({
  notice,
  locale,
  onDone,
  onDismiss,
}: {
  notice: Notice;
  locale: LocaleId;
  onDone: (n: Notice) => void;
  onDismiss: (n: Notice, auto: boolean) => void;
}) {
  const [phase, setPhase] = useState<'fill' | 'linger' | 'drain'>(() =>
    notice.mode === 'countdown' ? 'fill' : 'drain'
  );
  const [started, setStarted] = useState(false);
  const doneRef = useRef(false);
  const goneRef = useRef(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setStarted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    let t1: ReturnType<typeof setTimeout> | null = null;
    let t2: ReturnType<typeof setTimeout> | null = null;
    if (notice.mode === 'countdown') {
      t1 = setTimeout(() => {
        if (!doneRef.current) {
          doneRef.current = true;
          try {
            onDone(notice);
          } catch {
            /* ignore */
          }
        }
        setPhase('linger');
        t2 = setTimeout(() => {
          if (!goneRef.current) {
            goneRef.current = true;
            onDismiss(notice, true);
          }
        }, Math.max(500, notice.lingerMs));
      }, Math.max(0, notice.ms));
    } else {
      t2 = setTimeout(() => {
        if (!goneRef.current) {
          goneRef.current = true;
          onDismiss(notice, true);
        }
      }, Math.max(800, notice.ms));
    }
    return () => {
      if (t1) clearTimeout(t1);
      if (t2) clearTimeout(t2);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice.id]);

  const closeKey: MessageKey = 'close';
  return (
    <div className={`notice${notice.kind === 'error' ? ' notice-error' : ''}`} role="status">
      <div className="notice-head">
        <div className="notice-text">
          <div className="notice-title">{notice.title}</div>
          {notice.detail ? <div className="notice-detail">{notice.detail}</div> : null}
        </div>
        <button
          type="button"
          className="icon-btn"
          title={t(locale, closeKey)}
          aria-label={t(locale, closeKey)}
          onClick={() => {
            if (!goneRef.current) {
              goneRef.current = true;
              onDismiss(notice, false);
            }
          }}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="notice-bar" aria-hidden="true">
        <div
          className="notice-fill"
          style={
            phase === 'fill'
              ? { width: started ? '100%' : '0%', transition: `width ${Math.max(0, notice.ms)}ms linear` }
              : phase === 'linger'
                ? { width: started ? '0%' : '100%', transition: `width ${Math.max(500, notice.lingerMs)}ms linear` }
                : { width: started ? '0%' : '100%', transition: `width ${Math.max(800, notice.ms)}ms linear` }
          }
        />
      </div>
    </div>
  );
}

/**
 * Center-screen notices with a progress bar underneath: info drains away,
 * errors drain slower and red, countdowns fill first (the warning), fire
 * onDone, then drain back. × dismisses now. Newest on top, max three.
 */
export function NoticeCenter({
  notices,
  locale,
  onDone,
  onDismiss,
}: {
  notices: Notice[];
  locale: LocaleId;
  onDone: (n: Notice) => void;
  onDismiss: (n: Notice, auto: boolean) => void;
}) {
  if (!notices.length) return null;
  return (
    <div className="notice-center" aria-live="polite">
      {notices.map((n) => (
        <NoticeItem key={n.id} notice={n} locale={locale} onDone={onDone} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
