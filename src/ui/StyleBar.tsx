import { useRef } from 'react';
import type { ToolId } from '../engine/tools';
import type { ShapeView } from '../core/shapes';
import {
  updateEraserSettings,
  updatePenSettings,
  updateShapeSettings,
  updateTextSettings,
  type EraserSettings,
  type PenSettings,
  type ShapeSettings,
  type TextSettings,
} from '../core/settings';
import { patchShapes } from '../core/store';
import type { LocaleId } from '../core/locale';
import { t } from './i18n';
import { MOTION, useExitPresence } from './motion';

const PEN_COLORS = ['#eceae4', '#ffe27a', '#ff6b6b', '#4cd964', '#c4a35a', '#ffa94d', '#c4b8a8', '#ff9fd0'];
const FILL_COLORS = ['#ffffff', '#ffe27a', '#ff6b6b', '#4cd964', '#c4a35a', '#ffa94d', '#e8e2d6', '#ff9fd0'];
const STROKE_COLORS = ['#6b6b66', '#1c1c1a', '#ffffff', '#ff6b6b', '#4cd964', '#ffa94d', '#c4b8a8', '#ff9fd0'];
const TEXT_COLORS = ['#ffe27a', '#4cd964', '#ff6b6b', '#1c1c1a', '#eceae4', '#c4a35a', '#6b6b66', '#ffa94d'];
const TEXT_SIZES = [12, 14, 16, 18, 24, 32, 48, 64];
const ERASER_SIZES = [16, 32, 64];
const SHAPE_TOOLS: ToolId[] = ['rect', 'ellipse', 'sticky', 'arrow'];
const FILL_TYPES = new Set(['rect', 'ellipse', 'sticky', 'arrow']);
const STROKE_TYPES = new Set(['rect', 'ellipse', 'arrow', 'pen']);
const TEXT_TYPES = new Set(['text', 'sticky']);

function Swatches({
  colors,
  value,
  onPick,
  custom,
}: {
  colors: string[];
  value: string;
  onPick: (c: string) => void;
  custom?: boolean;
}) {
  return (
    <div className="swatches">
      {colors.map((c) => (
        <button
          key={c}
          className={`swatch${value === c ? ' active' : ''}`}
          style={{ background: c }}
          title={c}
          onClick={() => onPick(c)}
        />
      ))}
      {custom && (
        <input type="color" className="swatch-custom" value={value} title={value} onChange={(e) => onPick(e.target.value)} />
      )}
    </div>
  );
}

export function StyleBar({
  locale,
  tool,
  selected,
  pen,
  shape,
  text,
  eraser,
  onPatched,
}: {
  locale: LocaleId;
  tool: ToolId;
  selected: ShapeView[];
  pen: PenSettings;
  shape: ShapeSettings;
  text: TextSettings;
  eraser: EraserSettings;
  onPatched: () => void;
}) {
  const drawing = selected.length === 0;
  const showEraser = tool === 'eraser';
  const showPen = tool === 'pen' && drawing;
  const showShapeDraw = SHAPE_TOOLS.includes(tool) && drawing;
  const showTextDraw = tool === 'text' && drawing;
  const fillTargets = selected.filter((v) => FILL_TYPES.has(v.type) && !v.locked);
  const strokeTargets = selected.filter((v) => STROKE_TYPES.has(v.type) && !v.locked);
  const textTargets = selected.filter((v) => TEXT_TYPES.has(v.type) && !v.locked);
  const penTargets = selected.filter((v) => v.type === 'pen' && !v.locked);

  const showFill = showShapeDraw || fillTargets.length > 0;
  const showStroke = showShapeDraw || showPen || strokeTargets.length > 0 || penTargets.length > 0;
  const showText = showTextDraw || textTargets.length > 0;
  const showPenStyle = showPen || (penTargets.length > 0 && fillTargets.length === 0 && textTargets.length === 0);

  const want = showEraser || showFill || showStroke || showText || showPenStyle;
  const shown = useExitPresence(want, MOTION.enter);
  const flags = { showEraser, showFill, showStroke, showText, showPenStyle };
  const hold = useRef(flags);
  if (want) hold.current = flags;
  const view = hold.current;
  const mode = [view.showEraser, view.showPenStyle, view.showFill, view.showStroke, view.showText].map(Number).join('');

  if (!shown) return null;

  const fillValue = fillTargets[0]?.fill ?? shape.fill;
  const strokeValue = strokeTargets[0]?.stroke ?? penTargets[0]?.stroke ?? (showPen ? pen.color : shape.stroke);
  const textValue = textTargets[0]?.textColor ?? text.color;
  const textSize = textTargets[0]?.fontSize ?? text.size;

  return (
    <div className={`island style-island${want ? '' : ' is-leaving'}`}>
      <div className="style-island-body" key={mode}>
      {view.showEraser && (
        <>
          <button
            className={`style-btn${eraser.mode === 'whole' ? ' active' : ''}`}
            title={t(locale, 'eraserWholeHint')}
            onClick={() => updateEraserSettings({ mode: 'whole' })}
          >
            {t(locale, 'eraserWhole')}
          </button>
          <button
            className={`style-btn${eraser.mode === 'partial' ? ' active' : ''}`}
            title={t(locale, 'eraserPartialHint')}
            onClick={() => updateEraserSettings({ mode: 'partial' })}
          >
            {t(locale, 'eraserPartial')}
          </button>
          {ERASER_SIZES.map((s) => (
            <button
              key={s}
              className={`style-btn${eraser.size === s ? ' active' : ''}`}
              title={`${s}`}
              onClick={() => updateEraserSettings({ size: s })}
            >
              <span className="eraser-dot" style={{ width: s / 2.5, height: s / 2.5 }} />
            </button>
          ))}
        </>
      )}
      {view.showPenStyle && (
        <>
          <button
            className={`style-btn${pen.style === 'marker' ? ' active' : ''}`}
            title={t(locale, 'markerHint')}
            onClick={() => updatePenSettings({ style: 'marker' })}
          >
            {t(locale, 'marker')}
          </button>
          <button
            className={`style-btn${pen.style === 'highlighter' ? ' active' : ''}`}
            title={t(locale, 'highlighterHint')}
            onClick={() => updatePenSettings({ style: 'highlighter' })}
          >
            {t(locale, 'highlighter')}
          </button>
          <input
            className="size-slider"
            type="range"
            min={1}
            max={20}
            value={pen.size}
            title={t(locale, 'brushSize')}
            onChange={(e) => {
              const size = Number(e.target.value);
              updatePenSettings({ size });
              if (penTargets.length) {
                patchShapes(penTargets.map((v) => [v.id, { strokeWidth: pen.style === 'highlighter' ? size * 4 : size }]));
                onPatched();
              }
            }}
          />
          <span className="size-value">{pen.size}</span>
        </>
      )}
      {view.showFill && (
        <>
          <span className="panel-label">{t(locale, 'fill')}</span>
          <Swatches
            colors={FILL_COLORS}
            value={fillValue}
            onPick={(c) => {
              updateShapeSettings({ fill: c });
              if (fillTargets.length) {
                patchShapes(fillTargets.map((v) => [v.id, { fill: c }]));
                onPatched();
              }
            }}
          />
        </>
      )}
      {view.showStroke && (
        <>
          <span className="panel-label">{t(locale, 'stroke')}</span>
          <Swatches
            colors={showPen || penTargets.length ? PEN_COLORS : STROKE_COLORS}
            value={strokeValue}
            custom
            onPick={(c) => {
              updatePenSettings({ color: c });
              updateShapeSettings({ stroke: c });
              const patches: Array<[string, Partial<ShapeView>]> = [];
              for (const v of strokeTargets) patches.push([v.id, { stroke: c }]);
              if (patches.length) {
                patchShapes(patches);
                onPatched();
              }
            }}
          />
        </>
      )}
      {view.showText && (
        <>
          <Swatches
            colors={TEXT_COLORS}
            value={textValue}
            custom
            onPick={(c) => {
              updateTextSettings({ color: c });
              if (textTargets.length) {
                patchShapes(textTargets.map((v) => [v.id, { textColor: c }]));
                onPatched();
              }
            }}
          />
          <select
            className="size-select"
            value={textSize}
            title={t(locale, 'textSize')}
            onChange={(e) => {
              const size = Number(e.target.value);
              updateTextSettings({ size });
              if (textTargets.length) {
                patchShapes(textTargets.map((v) => [v.id, { fontSize: size }]));
                onPatched();
              }
            }}
          >
            {TEXT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </>
      )}
      </div>
    </div>
  );
}
