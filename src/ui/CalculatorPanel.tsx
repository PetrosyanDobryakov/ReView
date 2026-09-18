import { useEffect, useMemo, useRef, useState } from 'react';
import type { CalculatorEditTarget, Engine } from '../engine/Engine';
import {
  applyCalcKey,
  calcKeyFromKeyboard,
  calcPublicFromPersisted,
  persistedFromShape,
  shapeFieldsFromPersisted,
  type CalcKey,
  type CalcPersisted,
} from '../core/calcEngine';
import { calcCssZoom, calcFrameScale } from '../core/calcGeometry';
import { buildCalcFaceLayout } from '../core/calcKeypad';
import { shapeRotation } from '../core/transform';
import { graphChromeKind } from '../core/editChrome';
import { viewPaperBg } from '../core/store';
import { resolveCalcBodyFill, relativeLuminance, withAlpha, themeFor } from '../core/shapes';
import { readChromeCssColor } from '../core/chromeTheme';
import { readLocale } from '../core/locale';
import { t } from './i18n';

type CalcStampKind = 'result' | 'expression';

function shapeToPersisted(engine: Engine, id: string): CalcPersisted {
  const v = engine.views.get(id);
  return persistedFromShape(v ?? {});
}

/**
 * Open calculator session: interaction layer only.
 * Canvas paints display + keypad; this panel supplies Win-calc chrome (nav +
 * mode title) and invisible key hit targets. While open, canvas skips header
 * mode text so it does not ghost under the overlay.
 */
export function CalculatorPanel({
  target,
  engine,
  onDone,
}: {
  target: CalculatorEditTarget;
  engine: Engine;
  onDone: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  const locale = readLocale();
  const [tick, setTick] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const navOpenRef = useRef(false);
  navOpenRef.current = navOpen;
  const live = engine.views.get(target.id);
  const persisted = useMemo(
    () => shapeToPersisted(engine, target.id),
    [engine, target.id, tick, live?.calcState, live?.calcDisplay, live?.calcMode]
  );
  const pub = calcPublicFromPersisted(persisted);
  const paper = viewPaperBg();

  const sync = (next: CalcPersisted) => {
    engine.patchCalculator(target.id, shapeFieldsFromPersisted(next));
    setTick((n) => n + 1);
  };

  const press = (key: CalcKey) => {
    sync(applyCalcKey(persisted, key));
  };

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    engine.closeCalculator();
    onDone();
  };

  const finishRef = useRef(finish);
  finishRef.current = finish;

  useEffect(() => {
    rootRef.current?.focus();
    return () => {
      doneRef.current = true;
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (doneRef.current) return;
      const el = e.target;
      if (!(el instanceof Element)) return;
      // Close nav first when tapping elsewhere inside the panel.
      if (navOpenRef.current && navRef.current && !navRef.current.contains(el)) {
        setNavOpen(false);
      }
      if (rootRef.current?.contains(el)) return;
      const kind = graphChromeKind(el);
      if (kind === 'keep') return;
      // Canvas geometry drags (resize/move) while the keypad is open — keep session.
      if (el === engine.canvas || engine.canvas.contains(el)) return;
      finishRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [engine]);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let raf = 0;
    const loop = () => {
      const v = engine.views.get(target.id);
      if (!v) {
        finishRef.current();
        return;
      }
      const z = engine.camera.zoom;
      const frame = calcFrameScale(v.w, v.h);
      const p = engine.worldToScreen(v.x, v.y);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.width = `${Math.max(1, v.w * z)}px`;
      el.style.height = `${Math.max(1, v.h * z)}px`;
      // Frame × zoom only — no readability floor (labels track the object like board text).
      el.style.setProperty('--calc-zoom', String(calcCssZoom(z, frame)));
      const rot = shapeRotation(v);
      el.style.transform = rot ? `rotate(${rot}deg)` : '';
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [engine, target.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (doneRef.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (navOpenRef.current) {
          setNavOpen(false);
          return;
        }
        // Close keypad session (resize/undo access). CE remains an on-pad key.
        finishRef.current();
        return;
      }
      const mapped = calcKeyFromKeyboard(e, pub.mode, pub.second);
      if (!mapped) return;
      e.preventDefault();
      e.stopPropagation();
      press(mapped);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const layout = buildCalcFaceLayout(
    live?.w ?? target.w,
    live?.h ?? target.h,
    pub.mode,
    pub.second,
    calcFrameScale(live?.w ?? target.w, live?.h ?? target.h)
  );
  const screen = engine.worldToScreen(target.x, target.y);
  const z = engine.camera.zoom;
  const frame = calcFrameScale(target.w, target.h);
  const rot = target.rotation ?? (live ? shapeRotation(live) : 0);
  // Theme-only face (ignore shape fill/stroke / style island).
  const bodyBg = resolveCalcBodyFill(paper, live?.fill ?? 'transparent');
  const lightBody = (relativeLuminance(bodyBg) ?? 0) > 0.55;
  const panel = readChromeCssColor('--chrome-panel');
  const chromeText = readChromeCssColor('--chrome-text');
  const inkHex =
    panel &&
    chromeText &&
    /^#[0-9a-fA-F]{6}$/i.test(panel) &&
    /^#[0-9a-fA-F]{6}$/i.test(chromeText) &&
    bodyBg.toLowerCase() === panel.toLowerCase()
      ? chromeText
      : themeFor(bodyBg).text;
  const ink = /^#[0-9a-fA-F]{6}$/i.test(inkHex) ? withAlpha(inkHex, 0.92) : lightBody ? 'rgba(28, 28, 26, 0.92)' : 'rgba(236, 234, 228, 0.92)';
  const muted = /^#[0-9a-fA-F]{6}$/i.test(inkHex) ? withAlpha(inkHex, 0.5) : lightBody ? 'rgba(28, 28, 26, 0.5)' : 'rgba(236, 234, 228, 0.5)';
  const fw = Math.max(1, live?.w ?? target.w);
  const fh = Math.max(1, live?.h ?? target.h);
  const modeLabel = pub.mode === 'scientific' ? t(locale, 'calcScientific') : t(locale, 'calcStandard');

  const closeNav = () => setNavOpen(false);

  return (
    <div
      ref={rootRef}
      className={`calc-panel calc-panel--hit${pub.error ? ' is-error' : ''}${pub.mode === 'scientific' ? ' is-sci' : ''}${lightBody ? ' is-light' : ''}`}
      style={{
        left: screen.x,
        top: screen.y,
        width: Math.max(1, target.w * z),
        height: Math.max(1, target.h * z),
        color: ink,
        ['--calc-zoom' as string]: String(calcCssZoom(z, frame)),
        ['--calc-ink' as string]: ink,
        ['--calc-muted' as string]: muted,
        transform: rot ? `rotate(${rot}deg)` : undefined,
        transformOrigin: 'top left',
      }}
      tabIndex={0}
      role="application"
      aria-label={t(locale, 'calculator')}
    >
      <div
        className="calc-toolbar"
        style={{
          position: 'absolute',
          left: `${(layout.header.x / fw) * 100}%`,
          top: `${(layout.header.y / fh) * 100}%`,
          width: `${(layout.header.w / fw) * 100}%`,
          height: `${(layout.header.h / fh) * 100}%`,
          ['--calc-nav-w' as string]: `${(layout.chrome.navW / layout.header.w) * 100}%`,
          ['--calc-nav-gap' as string]: `${(layout.chrome.navGap / layout.header.w) * 100}%`,
          ['--calc-control-h' as string]: `${(layout.chrome.controlH / layout.header.h) * 100}%`,
          ['--calc-title-px' as string]: `${layout.chrome.titlePx * z}px`,
          ['--calc-bar-h' as string]: `${layout.chrome.barH * z}px`,
          ['--calc-bar-gap' as string]: `${layout.chrome.barGap * z}px`,
          ['--calc-bar-w' as string]: `${(layout.chrome.navW * layout.chrome.barWFrac * z).toFixed(2)}px`,
          ['--calc-icon-align-y' as string]: `${layout.chrome.iconAlignY * z}px`,
        }}
      >
        <div className={`calc-nav${navOpen ? ' is-open' : ''}`} ref={navRef}>
          <button
            type="button"
            className={`calc-nav-trigger${navOpen ? ' is-on' : ''}`}
            aria-haspopup="menu"
            aria-expanded={navOpen}
            title={t(locale, 'calcNavMenu')}
            aria-label={t(locale, 'calcNavMenu')}
            onClick={() => setNavOpen((o) => !o)}
          >
            <span className="calc-nav-glyph" aria-hidden="true">
              <span className="calc-nav-bar" />
              <span className="calc-nav-bar" />
              <span className="calc-nav-bar" />
            </span>
          </button>
          <button
            type="button"
            className="calc-mode-title"
            aria-haspopup="menu"
            aria-expanded={navOpen}
            title={modeLabel}
            onClick={() => setNavOpen((o) => !o)}
          >
            <span className="calc-mode-label">{modeLabel}</span>
          </button>
          {navOpen && (
            <div className="calc-nav-menu" role="menu">
              <button
                type="button"
                role="menuitemradio"
                aria-checked={pub.mode === 'standard'}
                className={pub.mode === 'standard' ? 'is-on' : ''}
                onClick={() => {
                  press('mode-standard');
                  closeNav();
                }}
              >
                {t(locale, 'calcStandard')}
              </button>
              <button
                type="button"
                role="menuitemradio"
                aria-checked={pub.mode === 'scientific'}
                className={pub.mode === 'scientific' ? 'is-on' : ''}
                onClick={() => {
                  press('mode-scientific');
                  closeNav();
                }}
              >
                {t(locale, 'calcScientific')}
              </button>
              {pub.mode === 'scientific' && (
                <button
                  type="button"
                  role="menuitem"
                  className={`calc-angle${pub.angle === 'rad' ? ' is-on' : ''}`}
                  onClick={() => {
                    press(pub.angle === 'rad' ? 'DEG' : 'RAD');
                    closeNav();
                  }}
                >
                  {pub.angle === 'rad' ? 'RAD' : 'DEG'}
                </button>
              )}
              <div className="calc-nav-sep" role="separator" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  engine.copyCalculatorDisplay(target.id);
                  closeNav();
                }}
              >
                {t(locale, 'calcCopy')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  engine.stampCalculatorResult(target.id, 'result' satisfies CalcStampKind);
                  closeNav();
                }}
              >
                {t(locale, 'calcStampResultShort')}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  engine.stampCalculatorResult(target.id, 'expression' satisfies CalcStampKind);
                  closeNav();
                }}
              >
                {t(locale, 'calcStampExprShort')}
              </button>
            </div>
          )}
        </div>
        {pub.mode === 'scientific' && (
          <button
            type="button"
            className={`calc-angle-chip${pub.angle === 'rad' ? ' is-on' : ''}`}
            onClick={() => press(pub.angle === 'rad' ? 'DEG' : 'RAD')}
            title={pub.angle === 'rad' ? 'RAD' : 'DEG'}
          >
            {pub.angle === 'rad' ? 'RAD' : 'DEG'}
          </button>
        )}
      </div>

      {/* Live display is canvas-painted; keep a polite aria mirror for AT. */}
      <div className="calc-display calc-display--sr" aria-live="polite">
        {pub.hasMemory ? 'M ' : ''}
        {pub.expr ? `${pub.expr} ` : ''}
        {pub.display}
      </div>

      {layout.keys.map((k) => (
        <button
          key={`${k.id}-${k.label}-${k.x}-${k.y}`}
          type="button"
          className={`calc-key calc-key--hit${k.cls ? ` ${k.cls}` : ''}`}
          style={{
            position: 'absolute',
            left: `${(k.x / fw) * 100}%`,
            top: `${(k.y / fh) * 100}%`,
            width: `${(k.w / fw) * 100}%`,
            height: `${(k.h / fh) * 100}%`,
          }}
          onClick={() => press(k.id)}
          aria-label={k.label}
        />
      ))}
    </div>
  );
}
