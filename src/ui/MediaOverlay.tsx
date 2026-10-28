import { useEffect, useRef, useState } from 'react';
import type { LocaleId } from '../core/locale';
import type { Engine } from '../engine/Engine';
import {
  decodeMediaState,
  followMediaEnabled,
  isMediaInSync,
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
} from '../core/shapes';
import { t } from './i18n';

const CARD_W = 280;
/** Video dock content width: longitudinal (~3:1), scaled to frame width. */
const VIDEO_W = 480;
/** Transport buttons share one fixed width so both sliders align. */
const BTN_W = 104;
/** Volume label column shares one fixed width for the same reason. */
const VOL_LABEL_W = 96;

interface MediaCardLayout {
  left: number;
  top: number;
  width: number;
  /** Null = auto height (video dock flows). */
  height: number | null;
  transform: string;
  inner: { width: number; left: number; top: number; transform: string } | null;
}

/**
 * Card geometry from the world rect — one formula for the first paint and
 * the rAF loop, so mounting never flashes an unscaled card (the multi-select
 * "one big player" flash). Audio fills its rect with contain-fit controls;
 * the video dock matches the frame width.
 */
function layoutMediaCard(
  engine: Engine,
  shapeId: string,
  kind: 'audio' | 'video'
): MediaCardLayout | null {
  const v = engine.views.get(shapeId);
  if (!v || (v.type !== 'audio' && v.type !== 'video')) return null;
  const a = engine.worldToScreen(v.x, v.y);
  const b = engine.worldToScreen(v.x + v.w, v.y + v.h);
  const screenW = Math.max(1, b.x - a.x);
  const screenH = Math.max(1, b.y - a.y);
  if (kind === 'audio') {
    const estH = AUDIO_CARD_H;
    // Contain-fit scale, but the content width stretches to fill:
    // extra horizontal space grows the sliders (timeline first), so
    // a wide window means finer scrubbing instead of empty margins.
    const kc = Math.max(0.01, Math.min(screenW / CARD_W, screenH / estH));
    return {
      left: a.x,
      top: a.y,
      width: screenW,
      height: screenH,
      transform: '',
      inner: {
        width: screenW / kc,
        left: 0,
        top: (screenH - estH * kc) / 2,
        transform: `scale(${kc.toFixed(4)})`,
      },
    };
  }
  // Video dock: longitudinal tab, same width as the frame on screen
  // at any zoom — fixed to the board like audio, not constant on screen.
  const k = screenW / VIDEO_W;
  return {
    left: a.x,
    top: b.y + 8,
    width: VIDEO_W,
    height: null,
    transform: `scale(${k.toFixed(4)})`,
    inner: null,
  };
}

function VolRow({
  label,
  value,
  onInput,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  onInput: (pct: number) => void;
  onCommit?: (pct: number) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
      <span
        title={label}
        style={{
          flex: 'none',
          width: VOL_LABEL_W,
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
        disabled={disabled}
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
 * Always-visible player card for one media shape: filename pill over a thin
 * timeline with live time, then "for me" plus my volume — and a second
 * "for all" row plus the shared volume (locked without driving rights).
 * Transport buttons carry tinted substrates so they read as buttons.
 *
 * Audio is a board object like a photo: the themed backdrop fills its world
 * rect exactly (so the selection frame always hugs it). The controls
 * contain-fit but stretch horizontally: extra width grows the sliders, so a
 * wide window means a longer timeline. The player zooms with the board.
 * Video docks one longitudinal tab (~3:1: transport buttons in a row, both
 * volume sliders full width below), scaled to the frame width.
 *
 * Board-object rules: true coords, no viewport clamp (slides off-screen like
 * any shape), constant 12px theme corners at any zoom, wheel over
 * buttons/sliders zooms the board. Cards sit below interface chrome (z 10);
 * peer cursor glyphs paint on a dedicated top canvas so they stay visible
 * over opaque cards.
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
  const innerRef = useRef<HTMLDivElement>(null);
  const seekRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const seekingRef = useRef(false);
  const volAllLive = useRef(false);
  const allVolRef = useRef(100);
  const [playing, setPlaying] = useState(false);
  const [sharedPlaying, setSharedPlaying] = useState(false);
  const [follow, setFollow] = useState(() => followMediaEnabled());
  // Diverged from the shared session (local pause/scrub/resume while it
  // runs): the follow button goes unlit until I catch up. Derived in the
  // tick from element vs shared state — no manual juggling.
  const [desync, setDesync] = useState(false);
  // May I drive the shared transport? Owner/editors only; viewers stay
  // local with a locked row. Losing it mid-countdown cancels my pending start.
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
  const stateRef = useRef({ playing, sharedPlaying, follow, can, desync });
  stateRef.current = { playing, sharedPlaying, follow, can, desync };
  allVolRef.current = allVol;

  useEffect(() => {
    const poll = window.setInterval(() => {
      try {
        const next = iControlMedia();
        if (next !== stateRef.current.can) {
          setCan(next);
          if (!next) engine.cancelPendingMedia(shapeId);
        }
      } catch {
        /* ignore */
      }
    }, 2000);
    return () => window.clearInterval(poll);
  }, [engine, shapeId]);

  // Wheel over buttons/sliders zooms the board like anywhere else: the
  // canvas never sees events over this sibling, so forward them. Native
  // listener (not React onWheel) so preventDefault actually works — this
  // also stops a focused slider from eating the wheel as a value change.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        engine.wheelZoom(e.clientX, e.clientY, e.deltaY !== 0 ? e.deltaY : e.deltaX);
      } catch {
        /* ignore */
      }
    };
    box.addEventListener('wheel', onWheel, { passive: false });
    return () => box.removeEventListener('wheel', onWheel);
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
        // First positioned frame reveals the card: mounting paints one
        // unscaled frame otherwise (a huge flash at low zoom).
        if (box.style.visibility !== 'visible') box.style.visibility = 'visible';
        // Board objects, not popups: true coords, no viewport clamp — the
        // card slides off-screen exactly like the shape under it (the cull
        // above hides it only when fully out). Wheel over controls zooms the
        // board (forwarded by the effect below, since the canvas never sees
        // events over this sibling).
        const lay = layoutMediaCard(engine, shapeId, kind);
        if (!lay) {
          box.style.display = 'none';
          return;
        }
        // DOM backdrop honors shape opacity like the canvas bodies do.
        const dim = v.alpha !== undefined && v.alpha < 1 ? String(Math.max(0.05, v.alpha)) : '';
        if (box.style.opacity !== dim) box.style.opacity = dim;
        box.style.left = `${Math.round(lay.left)}px`;
        box.style.top = `${Math.round(lay.top)}px`;
        box.style.width = `${Math.round(lay.width)}px`;
        if (lay.height !== null) box.style.height = `${Math.round(lay.height)}px`;
        if (box.style.transform !== lay.transform) box.style.transform = lay.transform;
        const inner = innerRef.current;
        if (inner && lay.inner) {
          inner.style.width = `${lay.inner.width.toFixed(1)}px`;
          inner.style.left = `${lay.inner.left.toFixed(1)}px`;
          inner.style.top = `${lay.inner.top.toFixed(1)}px`;
          if (inner.style.transform !== lay.inner.transform) inner.style.transform = lay.inner.transform;
        }
        const url = mediaUrl(v);
        const el = kind === 'audio' ? getAudio(url) : getVideo(url);
        const isPlaying = Boolean(el && !el.paused && !el.ended);
        if (isPlaying !== stateRef.current.playing) setPlaying(isPlaying);
        const mst = decodeMediaState(v.mediaState);
        const sp = mst?.playing === true;
        if (sp !== stateRef.current.sharedPlaying) setSharedPlaying(sp);
        // Shared volume rides in: the follower's slider follows the driver's
        // hand, unless I'm dragging it myself right now (commit wins).
        const gv = mst?.vol;
        if (typeof gv === 'number' && !volAllLive.current) {
          const pct = Math.round(gv * 100);
          if (pct !== allVolRef.current) setAllVol(pct);
        }
        // Follow-button truth: converged with the shared session or diverged
        // (local pause/scrub/resume while it runs). A pending countdown for
        // me converges at fire.
        const sync = isMediaInSync(
          el
            ? { paused: el.paused, ended: el.ended, currentTime: el.currentTime, duration: el.duration }
            : null,
          mst,
          stateRef.current.follow,
          engine.mediaStartPending(shapeId)
        );
        if (sync === stateRef.current.desync) setDesync(!sync);
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

  // Local-only preview for me (never writes shared state). Shared driving
  // lives in the "for all" row.
  const toggleSelf = () => {
    if (stateRef.current.playing) stopSelf();
    else playSelf();
  };

  // Shared "for all" press: idle → shared start (countdown, or instant when
  // alone); shared playing → shared stop; a session stuck at the end
  // restarts for everyone from 0 instead of resuming into silence.
  const pressAll = () => {
    if (stateRef.current.sharedPlaying) {
      try {
        const v = engine.views.get(shapeId);
        const el = v ? (kind === 'audio' ? getAudio(mediaUrl(v)) : getVideo(mediaUrl(v))) : null;
        const dur = el && Number.isFinite(el.duration) ? el.duration : NaN;
        const ended =
          Boolean(el?.ended) ||
          Boolean(el && Number.isFinite(dur) && el.currentTime >= dur - 0.5);
        if (ended) {
          void engine.setMediaSharedState(shapeId, { playing: true, pos: 0 });
          return;
        }
      } catch {
        /* fall through to shared stop */
      }
      void engine.setMediaSharedState(shapeId, { playing: false });
      return;
    }
    void engine.setMediaSharedState(shapeId, { playing: true });
  };

  const seekSelf = (frac: number) => {
    engine.cancelPendingMedia(shapeId);
    seekingRef.current = true;
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

  // Anyone driving during an active shared session moves everyone: the
  // final position commits to shared state (followers apply immediately,
  // no new countdown). Idle sessions stay local.
  const seekCommit = () => {
    if (!seekingRef.current) return;
    seekingRef.current = false;
    try {
      if (!stateRef.current.can || !stateRef.current.sharedPlaying) return;
      const v = engine.views.get(shapeId);
      if (!v) return;
      const el = kind === 'audio' ? getAudio(mediaUrl(v)) : getVideo(mediaUrl(v));
      if (el && Number.isFinite(el.currentTime)) {
        void engine.setMediaSharedState(shapeId, { pos: el.currentTime, quiet: true });
      }
    } catch {
      /* ignore */
    }
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
    volAllLive.current = true;
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
    volAllLive.current = false;
    engine.setMediaSharedState(shapeId, { vol: Math.max(0, Math.min(1, pct / 100)), quiet: true });
  };

  // Controls: audio stacks rows in the scaled inner wrapper that contain-fits
  // the world rect; video lays out one longitudinal tab (~3:1) in a dock
  // scaled to the frame width. Transport buttons share one fixed width and
  // volume labels one fixed column, so sliders always align in both cards.
  const topRow = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, pointerEvents: 'none' }}>
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
              seekCommit();
            }}
            onBlur={() => {
              seekCommit();
            }}
            onChange={(e) => seekSelf(Number(e.target.value) / 1000)}
          />
          <span ref={timeRef} className="sheet-mono" style={{ flex: 'none' }}>
            --:--
          </span>
        </div>
      </div>
    </div>
  );
  // Transport buttons read as buttons: tinted substrate + semibold label,
  // stronger for the shared (primary) one.
  const meButton = (
    <button
      type="button"
      className="style-btn"
      style={{
        flex: 'none',
        width: BTN_W,
        pointerEvents: 'auto',
        fontWeight: 600,
        background: 'color-mix(in srgb, var(--chrome-accent) 16%, transparent)',
      }}
      onClick={toggleSelf}
    >
      {t(locale, playing ? 'mediaStopSelf' : 'mediaPlaySelf')}
    </button>
  );
  const allButton = (
    <button
      type="button"
      className="style-btn"
      style={{
        flex: 'none',
        width: BTN_W,
        pointerEvents: 'auto',
        fontWeight: 700,
        background: 'color-mix(in srgb, var(--chrome-accent) 30%, transparent)',
        borderColor: 'color-mix(in srgb, var(--chrome-accent) 60%, transparent)',
        opacity: can ? undefined : 0.45,
      }}
      disabled={!can}
      title={t(locale, can ? (sharedPlaying ? 'mediaStopAllHint' : 'mediaPlayAllHint') : 'mediaLockedHint')}
      onClick={pressAll}
    >
      {t(locale, sharedPlaying ? 'mediaStopAll' : 'mediaPlayAll')}
    </button>
  );
  const selfVolRow = (
    <VolRow
      label={t(locale, 'mediaVolSelf')}
      value={selfVol}
      onInput={volSelf}
    />
  );
  const allVolRow = (
    <VolRow
      label={t(locale, 'mediaVolAll')}
      value={allVol}
      onInput={volAllPreview}
      onCommit={volAllCommit}
      disabled={!can}
    />
  );
  // Follow button, three outcomes: opted out → opt in and catch up;
  // diverged (unlit after a local pause/scrub/resume) → catch up now, the
  // seek jump is the lag; in step → opt out into local-only.
  const pressFollow = () => {
    if (!follow) {
      setFollow(true);
      setFollowMediaEnabled(true);
      engine.refollowMedia(shapeId);
    } else if (desync) {
      engine.resyncMedia(shapeId);
    } else {
      setFollow(false);
      setFollowMediaEnabled(false);
    }
  };
  const followButton = (
    <button
      type="button"
      aria-pressed={follow && !desync}
      title={t(locale, 'mediaFollowHint')}
      className={`style-btn p2p-mini${follow && !desync ? ' active' : ''}`}
      style={{ pointerEvents: 'auto' }}
      onClick={pressFollow}
    >
      {t(locale, 'mediaFollow')}
    </button>
  );
  const controls = (
    <>
      {topRow}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 6, pointerEvents: 'none' }}>
        {meButton}
        <div style={{ flex: 1, minWidth: 0, pointerEvents: 'none' }}>
          {selfVolRow}
        </div>
      </div>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4, pointerEvents: 'none' }}
        title={can ? undefined : t(locale, 'mediaLockedHint')}
      >
        {allButton}
        <div style={{ flex: 1, minWidth: 0, pointerEvents: 'none', opacity: can ? undefined : 0.45 }}>
          {allVolRow}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 6, pointerEvents: 'none' }}>
        {followButton}
      </div>
    </>
  );
  // Longitudinal video tab: buttons in one row, both volume sliders full
  // width below — same controls, nothing square, sliders always aligned.
  const videoControls = (
    <>
      {topRow}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 8, pointerEvents: 'none' }}>
        {meButton}
        {allButton}
        <div style={{ flex: 1, minWidth: 0, pointerEvents: 'none' }} />
        {followButton}
      </div>
      <div style={{ paddingTop: 6, pointerEvents: 'none' }}>
        {selfVolRow}
      </div>
      <div
        style={{ paddingTop: 4, pointerEvents: 'none', opacity: can ? undefined : 0.45 }}
        title={can ? undefined : t(locale, 'mediaLockedHint')}
      >
        {allVolRow}
      </div>
    </>
  );

  // First-paint geometry (same formula as the rAF): mounting must never
  // flash an unscaled card. The rAF owns every field afterwards.
  const initialLayout = layoutMediaCard(engine, shapeId, kind);

  return (
    <div
      ref={boxRef}
      className="board-row-menu"
      role="group"
      aria-label={t(locale, kind === 'audio' ? 'infoAudio' : 'infoVideo')}
      style={{
        position: 'fixed',
        zIndex: 10,
        minWidth: 0,
        // No mount animation: the theme class animates transform, which
        // would override scale(k) and flash the dock at natural size.
        animation: 'none',
        visibility: initialLayout ? 'visible' : 'hidden',
        left: initialLayout ? Math.round(initialLayout.left) : undefined,
        top: initialLayout ? Math.round(initialLayout.top) : undefined,
        width: initialLayout ? Math.round(initialLayout.width) : undefined,
        height:
          initialLayout && initialLayout.height !== null
            ? Math.round(initialLayout.height)
            : undefined,
        transform: initialLayout?.transform || undefined,
        pointerEvents: 'none',
        transformOrigin: 'top left',
        borderColor: selected ? 'var(--chrome-accent)' : undefined,
      }}
    >
      {kind === 'audio' ? (
        <div
          ref={innerRef}
          style={{
            position: 'absolute',
            left: initialLayout?.inner ? Math.round(initialLayout.inner.left) : 0,
            top: initialLayout?.inner ? Math.round(initialLayout.inner.top) : 0,
            width: initialLayout?.inner ? Math.round(initialLayout.inner.width) : CARD_W,
            transform: initialLayout?.inner?.transform,
            pointerEvents: 'none',
            transformOrigin: 'top left',
          }}
        >
          {controls}
        </div>
      ) : (
        videoControls
      )}
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
      {shapes.map((s) => {
        // Audio owns a permanent board window; the video dock only appears
        // for the selected video (canvas dblclick still toggles playback).
        if (s.kind === 'video' && !selectedIds.has(s.id)) return null;
        return (
          <MediaCard
            key={s.id}
            engine={engine}
            shapeId={s.id}
            kind={s.kind}
            locale={locale}
            selected={selectedIds.has(s.id)}
          />
        );
      })}
    </>
  );
}
