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
import { fmtAudioTime, getAudio, getVideo, mediaUrl } from '../core/shapes';
import { clampToVisualViewport } from '../core/pointerEnv';
import { t } from './i18n';

const OVERLAY_W = 264;
const OVERLAY_H = 196;

function PlayGlyph({ playing }: { playing: boolean }) {
  return playing ? (
    <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3" y="2.5" width="3.4" height="11" rx="1" fill="currentColor" />
      <rect x="9.6" y="2.5" width="3.4" height="11" rx="1" fill="currentColor" />
    </svg>
  ) : (
    <svg width="22" height="22" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 2.3l8.7 5.7-8.7 5.7z" fill="currentColor" />
    </svg>
  );
}

function SpeakerGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2 6h3l4-3.2v10.4L5 10H2z" fill="currentColor" />
      <path
        d="M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.7a6 6 0 0 1 0 8.6"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Floating transport for a selected audio/video shape: big play toggle,
 * scrubbable timeline, own volume — plus shared ("for everyone") transport
 * and shared volume when this device may drive it (board owner / editor).
 * Positioned above the shape every frame; unmounts with selection change.
 */
export function MediaOverlay({
  engine,
  shapeId,
  kind,
  locale,
}: {
  engine: Engine;
  shapeId: string;
  kind: 'audio' | 'video';
  locale: LocaleId;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const seekingRef = useRef(false);
  const [playing, setPlaying] = useState(false);
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
  const stateRef = useRef({ playing, follow, can });
  stateRef.current = { playing, follow, can };

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
  }, []);

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      try {
        const v = engine.views.get(shapeId);
        const box = boxRef.current;
        if (!v || (v.type !== 'audio' && v.type !== 'video') || !box) return;
        const url = mediaUrl(v);
        const el = kind === 'audio' ? getAudio(url) : getVideo(url);
        const top = engine.worldToScreen(v.x + v.w / 2, v.y);
        const pos = clampToVisualViewport(top.x - OVERLAY_W / 2, top.y - OVERLAY_H - 12, OVERLAY_W, OVERLAY_H);
        box.style.left = `${Math.round(pos.left)}px`;
        box.style.top = `${Math.round(pos.top)}px`;
        const isPlaying = Boolean(el && !el.paused && !el.ended);
        if (isPlaying !== stateRef.current.playing) setPlaying(isPlaying);
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
      } catch {
        /* overlay never breaks paint */
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engine, shapeId, kind]);

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

  const playSelf = () => {
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

  const seekSelf = (frac: number) => {
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
      aria-label={kind === 'audio' ? 'audio' : 'video'}
      style={{ position: 'fixed', width: OVERLAY_W, zIndex: 60 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 2px 6px' }}>
        <button
          type="button"
          className="style-btn active"
          style={{ width: 46, height: 46, borderRadius: '50%', padding: 0, flex: 'none' }}
          title={t(locale, kind === 'audio' ? 'ctxAudioToggle' : 'ctxVideoToggle')}
          aria-label={t(locale, kind === 'audio' ? 'ctxAudioToggle' : 'ctxVideoToggle')}
          onClick={playSelf}
        >
          <PlayGlyph playing={playing} />
        </button>
        <span ref={timeRef} className="sheet-mono" style={{ maxWidth: '100%' }}>
          --:--
        </span>
        <button
          type="button"
          aria-pressed={follow}
          title={t(locale, 'mediaFollowHint')}
          className={`style-btn p2p-mini${follow ? ' active' : ''}`}
          style={{ marginLeft: 'auto' }}
          onClick={() => {
            const next = !follow;
            setFollow(next);
            setFollowMediaEnabled(next);
          }}
        >
          {t(locale, 'mediaFollow')}
        </button>
      </div>
      <input
        ref={seekRef}
        type="range"
        min={0}
        max={1000}
        defaultValue={0}
        aria-label={t(locale, 'mediaSeek')}
        style={{ width: '100%', accentColor: 'var(--chrome-accent)' }}
        onPointerDown={() => {
          seekingRef.current = true;
        }}
        onPointerUp={() => {
          seekingRef.current = false;
        }}
        onChange={(e) => seekSelf(Number(e.target.value) / 1000)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6 }}>
        <span style={{ display: 'inline-flex', color: 'var(--chrome-text-dim)' }}>
          <SpeakerGlyph />
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={selfVol}
          aria-label={t(locale, 'mediaVolSelf')}
          title={t(locale, 'mediaVolSelf')}
          style={{ flex: 1, accentColor: 'var(--chrome-accent)' }}
          onChange={(e) => volSelf(Number(e.target.value))}
        />
      </div>
      {can ? (        <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 8 }}>
          <button
            type="button"
            className="style-btn p2p-mini"
            title={t(locale, 'mediaPlayAllHint')}
            onClick={() => void engine.setMediaSharedState(shapeId, { playing: true })}
          >
            {t(locale, 'mediaPlayAll')}
          </button>
          <button
            type="button"
            className="style-btn p2p-mini"
            title={t(locale, 'mediaStopAllHint')}
            onClick={() => void engine.setMediaSharedState(shapeId, { playing: false })}
          >
            {t(locale, 'mediaStopAll')}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={allVol}
            aria-label={t(locale, 'mediaVolAll')}
            title={t(locale, 'mediaVolAll')}
            style={{ flex: 1, accentColor: 'var(--chrome-accent)' }}
            onChange={(e) => volAllPreview(Number(e.target.value))}
            onPointerUp={(e) => volAllCommit(Number((e.target as HTMLInputElement).value))}
            onBlur={(e) => volAllCommit(Number((e.target as HTMLInputElement).value))}
          />
        </div>
      ) : null}
    </div>
  );
}
