import { useEffect, useRef, useState } from 'react';
import type { LocaleId } from '../core/locale';
import type { Engine } from '../engine/Engine';
import {
  decodeMediaState,
  followMediaEnabled,
  localMediaVolume,
  setFollowMediaEnabled,
  setLocalMediaVolume,
} from '../core/mediaRoles';
import { iControlMedia } from '../core/store';
import {
  fmtAudioTime,
  getAudio,
  getVideo,
  mediaUrl,
  AUDIO_CARD_H,
  AUDIO_CARD_H_GUEST,
} from '../core/shapes';
import { clampToVisualViewport } from '../core/pointerEnv';
import { t } from './i18n';

const CARD_W = 280;
const CARD_H = 280;

function PlayGlyph({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="2.5" width="3.4" height="11" rx="1" fill="currentColor" />
      <rect x="9.6" y="2.5" width="3.4" height="11" rx="1" fill="currentColor" />
    </svg>
  ) : (
    <svg width="32" height="32" viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M4.2 2.2l9.2 5.8-9.2 5.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function VolRow({
  label,
  value,
  onInput,
  onCommit,
}: {
  label: string;
  value: number;
  onInput: (pct: number) => void;
  onCommit?: (pct: number) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span
        title={label}
        style={{
          flex: 'none',
          maxWidth: 96,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 12,
          color: 'var(--chrome-text-dim)',
        }}
      >
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        aria-label={label}
        title={label}
        style={{ flex: 1, minWidth: 0, accentColor: 'var(--chrome-accent)', pointerEvents: 'auto' }}
        onChange={(e) => onInput(Number(e.target.value))}
        onPointerUp={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
        onBlur={(e) => onCommit?.(Number((e.target as HTMLInputElement).value))}
      />
    </div>
  );
}

/**
 * Always-visible player card for one media shape, laid out like the mockup:
 * bare outline Play at the left, filename pill over a thin timeline with live
 * time, then "stop for me" plus my volume — and, when this device may drive
 * it, a second "stop for all" row plus the shared volume.
 *
 * Audio is a board object like a photo: the card fills its world rect, so it
 * zooms with the board and keeps its board size. Manual resize (any handle)
 * scales the shape uniformly; the card renders its 280px content at
 * shape-screen-width scale and never distorts. Video docks below its frame.
 *
 * Play semantics: participant toggles local playback; organizer starts the
 * countdown for everyone when idle, otherwise toggles locally (all-stop is
 * the button below).
 *
 * The container is pointer-transparent so canvas gestures (select / move)
 * keep working everywhere except the controls themselves.
 */
function MediaCard({
  engine,
  shapeId,
  kind,
  locale,
  selected,
}: {
  engine: Engine;
  shapeId: string;
  kind: 'audio' | 'video';
  locale: LocaleId;
  selected: boolean;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const seekingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
  const [sharedPlaying, setSharedPlaying] = useState(false);
  const [follow, setFollow] = useState(() => followMediaEnabled());
  const [can, setCan] = useState(() => iControlMedia());
  const [selfVol, setSelfVol] = useState(() => Math.round(localMediaVolume() * 100));
  const [allVol, setAllVol] = useState(() => {
    try {
      const v = engine.views.get(shapeId);
      const g = decodeMediaState(v?.mediaState)?.vol;
      return typeof g === 'number' ? Math.round(g * 100) : 100;
    } catch {
      return 100;
    }
  });
  const stateRef = useRef({ playing, sharedPlaying, follow, can });
  stateRef.current = { playing, sharedPlaying, follow, can };

  useEffect(() => {
    const poll = window.setInterval(() => {
      try {
        const next = iControlMedia();
        if (next !== stateRef.current.can) setCan(next);
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => window.clearInterval(poll);
  }, [engine]);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      try {
        const v = engine.views.get(shapeId);
        const box = boxRef.current;
        if (!v || (v.type !== 'audio' && v.type !== 'video') || !box) {
          if (box) box.style.display = 'none';
          return;
        }
        const a = engine.worldToScreen(v.x, v.y);
        const b = engine.worldToScreen(v.x + v.w, v.y + v.h);
        const vv = typeof window !== 'undefined' ? { w: window.innerWidth, h: window.innerHeight } : { w: 0, h: 0 };
        if (a.x > vv.w || a.y > vv.h || b.x < 0 || b.y < 0) {
          box.style.display = 'none';
          return;
        }
        box.style.display = '';
        // Audio fills its world rect like a photo: the card content (CARD_W
        // wide) scales with the shape's screen width, so board zoom rescales
        // the player and it keeps its board size. Video docks below its frame.
        const screenW = Math.max(1, b.x - a.x);
        const k = kind === 'audio' ? screenW / CARD_W : 1;
        const estH =
          kind === 'audio'
            ? stateRef.current.can
              ? AUDIO_CARD_H
              : AUDIO_CARD_H_GUEST
            : CARD_H;
        const cardW = CARD_W * k;
        const cardH = estH * k;
        let left: number;
        let top: number;
        if (kind === 'audio') {
          left = (a.x + b.x) / 2 - cardW / 2;
          top = (a.y + b.y) / 2 - cardH / 2;
        } else {
          left = a.x;
          top = b.y + 8;
        }
        const pos = clampToVisualViewport(left, top, cardW, cardH);
        box.style.left = `${Math.round(pos.left)}px`;
        box.style.top = `${Math.round(pos.top)}px`;
        box.style.width = `${CARD_W}px`;
        const wantTransform = kind === 'audio' ? `scale(${k})` : '';
        if (box.style.transform !== wantTransform) box.style.transform = wantTransform;
        const url = mediaUrl(v);
        const el = kind === 'audio' ? getAudio(url) : getVideo(url);
        const isPlaying = Boolean(el && !el.paused && !el.ended);
        if (isPlaying !== stateRef.current.playing) setPlaying(isPlaying);
        const sp = decodeMediaState(v.mediaState)?.playing === true;
        if (sp !== stateRef.current.sharedPlaying) setSharedPlaying(sp);
        const dur = el && Number.isFinite(el.duration) ? el.duration : NaN;
        if (seekRef.current && !seekingRef.current) {
          seekRef.current.value = String(
            el && Number.isFinite(dur) && dur > 0 ? Math.round((el.currentTime / dur) * 1000) : 0
          );
        }
        if (timeRef.current) {
          timeRef.current.textContent =
            el && Number.isFinite(dur)
              ? `${fmtAudioTime(el.currentTime)} / ${fmtAudioTime(dur)}`
              : '--:--';
        }
        if (nameRef.current) {
          const fallback = t(locale, kind === 'audio' ? 'infoAudio' : 'infoVideo');
          const name = (() => {
            try {
              const n = (v.mediaName ?? '').trim();
              return n || fallback;
            } catch {
              return fallback;
            }
          })();
          if (nameRef.current.textContent !== name) nameRef.current.textContent = name;
          if (nameRef.current.title !== name) nameRef.current.title = name;
        }
      } catch {
        /* overlay never breaks paint */
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, shapeId, kind, locale]);

  const withElement = (fn: (el: HTMLMediaElement, vol: number) => void): boolean => {
    try {
      const v = engine.views.get(shapeId);
      if (!v) return false;
      const el = kind === 'audio' ? getAudio(mediaUrl(v)) : getVideo(mediaUrl(v));
      if (!el) return false;
      const global = decodeMediaState(v.mediaState)?.vol ?? 1;
      fn(el, Math.max(0, Math.min(1, global)));
      engine.setDirty();
      return true;
    } catch {
      return false;
    }
  };

  const stopSelf = () => {
    engine.cancelPendingMedia(shapeId);
    withElement((el) => {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    });
  };

  const playSelf = () => {
    engine.cancelPendingMedia(shapeId);
    const local = Math.max(0, Math.min(1, selfVol / 100));
    setLocalMediaVolume(local);
    withElement((el, global) => {
      try {
        el.volume = global * local;
      } catch {
        /* ignore */
      }
    });
    if (kind === 'audio') engine.toggleAudioSelected(shapeId);
    else engine.toggleVideoSelected(shapeId);
  };

  // Big round button: local play/pause for me only, never touches the
  // shared state. Stopping for everyone is the host's button below.
  const toggleSelf = () => {
    if (stateRef.current.playing) stopSelf();
    else playSelf();
  };

  // Mockup semantics. Participant: local toggle. Organizer: idle → countdown
  // start for everyone; while shared playing → local toggle (all-stop lives
  // in the row below).
  const pressPlay = () => {
    if (stateRef.current.can && !stateRef.current.sharedPlaying) {
      void engine.setMediaSharedState(shapeId, { playing: true });
      return;
    }
    toggleSelf();
  };

  const seekSelf = (frac: number) => {
    engine.cancelPendingMedia(shapeId);
    withElement((el) => {
      const dur = el.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      try {
        el.currentTime = Math.max(0, Math.min(1, frac)) * dur;
      } catch {
        /* before metadata */
      }
    });
  };

  const volSelf = (pct: number) => {
    const local = Math.max(0, Math.min(1, pct / 100));
    setSelfVol(Math.round(local * 100));
    setLocalMediaVolume(local);
    withElement((el, global) => {
      try {
        el.volume = global * local;
      } catch {
        /* ignore */
      }
    });
  };

  const volAllPreview = (pct: number) => {
    setAllVol(pct);
    const local = Math.max(0, Math.min(1, selfVol / 100));
    withElement((el) => {
      try {
        el.volume = Math.max(0, Math.min(1, pct / 100)) * local;
      } catch {
        /* ignore */
      }
    });
  };

  const volAllCommit = (pct: number) => {
    setAllVol(pct);
    engine.setMediaSharedState(shapeId, { vol: Math.max(0, Math.min(1, pct / 100)) });
  };

  return (
    <div
      ref={boxRef}
      className="board-row-menu"
      role="group"
      aria-label={t(locale, kind === 'audio' ? 'infoAudio' : 'infoVideo')}
      style={{
        position: 'fixed',
        width: CARD_W,
        zIndex: 60,
        pointerEvents: 'none',
        transformOrigin: 'top left',
        borderColor: selected ? 'var(--chrome-accent)' : undefined,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
        <button
          type="button"
          style={{
            width: 56,
            height: 56,
            flex: 'none',
            pointerEvents: 'auto',
            background: 'transparent',
            border: 'none',
            padding: 0,
            color: 'var(--chrome-text)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          title={t(locale, kind === 'audio' ? 'ctxAudioToggle' : 'ctxVideoToggle')}
          aria-label={t(locale, kind === 'audio' ? 'ctxAudioToggle' : 'ctxVideoToggle')}
          onClick={pressPlay}
        >
          <PlayGlyph playing={playing} />
        </button>
        <div style={{ flex: 1, minWidth: 0, pointerEvents: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 5 }}>
            <span
              ref={nameRef}
              className="p2p-tag"
              style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              ref={seekRef}
              type="range"
              min={0}
              max={1000}
              defaultValue={0}
              aria-label={t(locale, 'mediaSeek')}
              style={{ flex: 1, minWidth: 0, accentColor: 'var(--chrome-accent)', pointerEvents: 'auto' }}
              onPointerDown={() => {
                seekingRef.current = true;
              }}
              onPointerUp={() => {
                seekingRef.current = false;
              }}
              onChange={(e) => seekSelf(Number(e.target.value) / 1000)}
            />
            <span ref={timeRef} className="sheet-mono" style={{ flex: 'none' }}>
              --:--
            </span>
          </div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6, pointerEvents: 'none' }}>
        <button
          type="button"
          className="style-btn"
          style={{ flex: 'none', minWidth: 100, pointerEvents: 'auto' }}
          onClick={stopSelf}
        >
          {t(locale, 'mediaStopSelf')}
        </button>
        <div style={{ flex: 1, minWidth: 0, pointerEvents: 'none' }}>
          <VolRow
            label={t(locale, 'mediaVolSelf')}
            value={selfVol}
            onInput={volSelf}
          />
        </div>
      </div>
      {can ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, pointerEvents: 'none' }}>
          <button
            type="button"
            className="style-btn"
            style={{ flex: 'none', minWidth: 100, pointerEvents: 'auto' }}
            title={t(locale, 'mediaStopAllHint')}
            onClick={() => void engine.setMediaSharedState(shapeId, { playing: false })}
          >
            {t(locale, 'mediaStopAll')}
          </button>
          <div style={{ flex: 1, minWidth: 0, pointerEvents: 'none' }}>
            <VolRow
              label={t(locale, 'mediaVolAll')}
              value={allVol}
              onInput={volAllPreview}
              onCommit={volAllCommit}
            />
          </div>
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6, pointerEvents: 'none' }}>
        <button
          type="button"
          aria-pressed={follow}
          title={t(locale, 'mediaFollowHint')}
          className={`style-btn p2p-mini${follow ? ' active' : ''}`}
          style={{ pointerEvents: 'auto' }}
          onClick={() => {
            const next = !follow;
            setFollow(next);
            setFollowMediaEnabled(next);
            if (next) engine.refollowMedia(shapeId);
          }}
        >
          {t(locale, 'mediaFollow')}
        </button>
      </div>
    </div>
  );
}

export function MediaCards({
  engine,
  shapes,
  locale,
  selectedIds,
}: {
  engine: Engine;
  shapes: Array<{ id: string; kind: 'audio' | 'video' }>;
  locale: LocaleId;
  selectedIds: Set<string>;
}) {
  if (!shapes.length) return null;
  return (
    <>
      {shapes.map((s) => (
        <MediaCard
          key={s.id}
          engine={engine}
          shapeId={s.id}
          kind={s.kind}
          locale={locale}
          selected={selectedIds.has(s.id)}
        />
      ))}
    </>
  );
}
