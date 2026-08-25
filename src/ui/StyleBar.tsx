import { useRef } from 'react';
import type { ToolId } from '../engine/tools';
import type { ShapeView, TextAlign } from '../core/shapes';
import { readableTextOn } from '../core/shapes';
import {
  effectivePen,
  updateEraserSettings,
  updatePenSettings,
  updateShapeSettings,
  updateTextSettings,
  type EraserSettings,
  type PenSettings,
  type ShapeSettings,
  type TextSettings,
} from '../core/settings';
import { viewPaperBg, patchShapes } from '../core/store';
import { readPrefs } from '../core/prefs';
import type { LocaleId } from '../core/locale';
import type { EditTarget } from '../engine/Engine';
import { t } from './i18n';
import { Icon, type IconName } from './icons';
import { MOTION, useExitPresence } from './motion';

const PEN_COLORS = ['#eceae4', '#ffe27a', '#ff6b6b', '#4cd964', '#c4a35a', '#ffa94d', '#c4b8a8', '#ff9fd0'];
const FILL_COLORS = ['#ffffff', '#ffe27a', '#ff6b6b', '#4cd964', '#c4a35a', '#ffa94d', '#e8e2d6', '#ff9fd0'];
const STROKE_COLORS = ['#6b6b66', '#1c1c1a', '#ffffff', '#ff6b6b', '#4cd964', '#ffa94d', '#c4b8a8', '#ff9fd0'];
/** Free-text + sticky palette. Dark swatches are for stickies / light boards; free text auto-contrasts on dark boards. */
const TEXT_COLORS = ['#eceae4', '#ffe27a', '#4cd964', '#ff6b6b', '#ffa94d', '#c4a35a', '#6b6b66', '#1c1c1a'];
const TEXT_SIZES = [12, 14, 16, 18, 24, 32, 48, 64];
const ERASER_SIZES = [16, 32, 64];
const SHAPE_TOOLS: ToolId[] = ['rect', 'ellipse', 'sticky', 'arrow', 'diamond', 'frame', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display'];
const FILL_TYPES = new Set(['rect', 'ellipse', 'sticky', 'diamond', 'frame', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display']);
const STROKE_TYPES = new Set(['rect', 'ellipse', 'arrow', 'pen', 'diamond', 'frame', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display']);
const TEXT_TYPES = new Set(['text', 'sticky', 'diamond', 'frame', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display']);
const CENTERED_TYPES = new Set(['rect', 'ellipse', 'diamond', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display']);

type FormatPatch = Partial<
  Pick<TextSettings, 'bold' | 'italic' | 'underline' | 'strike' | 'align' | 'highlight' | 'color' | 'size'>
>;

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
          type="button"
          key={c}
          className={`swatch${value === c ? ' active' : ''}`}
          style={{ background: c }}
          title={c}
          aria-label={c}
          aria-pressed={value === c}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(c)}
        />
      ))}
      {custom && (
        <input
          type="color"
          className="swatch-custom"
          value={value}
          title={value}
          onMouseDown={(e) => e.preventDefault()}
          onChange={(e) => onPick(e.target.value)}
        />
      )}
    </div>
  );
}

function FormatBtn({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: IconName;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`style-btn style-btn-icon${active ? ' active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      <Icon name={icon} size={16} />
    </button>
  );
}

function formatFromShape(v: ShapeView): {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  align: TextAlign;
  highlight: boolean;
  color: string;
  size: number;
} {
  return {
    bold: !!v.bold,
    italic: !!v.italic,
    underline: !!v.underline,
    strike: !!v.strike,
    align: v.textAlign ?? (CENTERED_TYPES.has(v.type) ? 'center' : 'left'),
    highlight: !!v.highlight,
    color: v.textColor ?? '',
    size: v.fontSize ?? 18,
  };
}

export function StyleBar({
  locale,
  tool,
  selected,
  pen,
  shape,
  text,
  eraser,
  editing,
  editTarget,
  onPatched,
  onEditStyle,
}: {
  locale: LocaleId;
  tool: ToolId;
  selected: ShapeView[];
  pen: PenSettings;
  shape: ShapeSettings;
  text: TextSettings;
  eraser: EraserSettings;
  editing: boolean;
  editTarget: EditTarget | null;
  onPatched: () => void;
  onEditStyle: (patch: Partial<EditTarget>) => void;
}) {
  const drawing = selected.length === 0;
  const showEraser = tool === 'eraser';
  const showPen = tool === 'pen' && drawing;
  const showShapeDraw = SHAPE_TOOLS.includes(tool) && drawing;
  const showTextDraw = (tool === 'text' && drawing) || editing;
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

  const live = editTarget
    ? {
        bold: editTarget.bold,
        italic: editTarget.italic,
        underline: editTarget.underline,
        strike: editTarget.strike,
        align: editTarget.textAlign,
        highlight: editTarget.highlight,
        color: editTarget.color,
        size: editTarget.fontSize,
      }
    : textTargets[0]
      ? formatFromShape(textTargets[0])
      : {
          bold: text.bold,
          italic: text.italic,
          underline: text.underline,
          strike: text.strike,
          align: text.align,
          highlight: text.highlight,
          color: text.color,
          size: text.size,
        };

  const textValue = live.color || text.color;
  const textSize = live.size;
  const showHighlight =
    editTarget?.type === 'text' ||
    (!editTarget && tool === 'text' && drawing) ||
    (!editTarget && textTargets.length > 0 && textTargets.every((v) => v.type === 'text'));

  const applyFormat = (patch: FormatPatch) => {
    updateTextSettings(patch);
    const shapePatch: Partial<ShapeView> = {};
    if (patch.bold !== undefined) shapePatch.bold = patch.bold;
    if (patch.italic !== undefined) shapePatch.italic = patch.italic;
    if (patch.underline !== undefined) shapePatch.underline = patch.underline;
    if (patch.strike !== undefined) shapePatch.strike = patch.strike;
    if (patch.align !== undefined) shapePatch.textAlign = patch.align;
    if (patch.highlight !== undefined) shapePatch.highlight = patch.highlight;
    if (patch.size !== undefined) shapePatch.fontSize = patch.size;
    if (patch.color !== undefined) shapePatch.textColor = patch.color;

    if (textTargets.length && Object.keys(shapePatch).length) {
      patchShapes(textTargets.map((v) => [v.id, shapePatch]));
      onPatched();
    }

    if (editing) {
      const editPatch: Partial<EditTarget> = {};
      if (patch.bold !== undefined) editPatch.bold = patch.bold;
      if (patch.italic !== undefined) editPatch.italic = patch.italic;
      if (patch.underline !== undefined) editPatch.underline = patch.underline;
      if (patch.strike !== undefined) editPatch.strike = patch.strike;
      if (patch.align !== undefined) editPatch.textAlign = patch.align;
      if (patch.highlight !== undefined) editPatch.highlight = patch.highlight;
      if (patch.size !== undefined) editPatch.fontSize = patch.size;
      if (patch.color !== undefined) editPatch.color = patch.color;
      onEditStyle(editPatch);
      if (editTarget?.id && Object.keys(shapePatch).length) {
        patchShapes([[editTarget.id, shapePatch]]);
        onPatched();
      }
    }
  };

  return (
    <div className={`island style-island${want ? '' : ' is-leaving'}`}>
      <div className="style-island-body" key={mode}>
      {view.showEraser && (
        <>
          <button
            type="button"
            className={`style-btn${eraser.mode === 'whole' ? ' active' : ''}`}
            title={t(locale, 'eraserWholeHint')}
            aria-pressed={eraser.mode === 'whole'}
            onClick={() => updateEraserSettings({ mode: 'whole' })}
          >
            {t(locale, 'eraserWhole')}
          </button>
          <button
            type="button"
            className={`style-btn${eraser.mode === 'partial' ? ' active' : ''}`}
            title={t(locale, 'eraserPartialHint')}
            aria-pressed={eraser.mode === 'partial'}
            onClick={() => updateEraserSettings({ mode: 'partial' })}
          >
            {t(locale, 'eraserPartial')}
          </button>
          {ERASER_SIZES.map((s) => (
            <button
              type="button"
              key={s}
              className={`style-btn${eraser.size === s ? ' active' : ''}`}
              title={`${s}`}
              aria-pressed={eraser.size === s}
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
            type="button"
            className={`style-btn${pen.style === 'marker' ? ' active' : ''}`}
            title={t(locale, 'markerHint')}
            aria-pressed={pen.style === 'marker'}
            onClick={() => {
              updatePenSettings({ style: 'marker' });
              const next = effectivePen();
              if (penTargets.length) {
                patchShapes(penTargets.map((v) => [v.id, { alpha: next.alpha, strokeWidth: next.width }]));
                onPatched();
              }
            }}
          >
            {t(locale, 'marker')}
          </button>
          <button
            type="button"
            className={`style-btn${pen.style === 'highlighter' ? ' active' : ''}`}
            title={t(locale, 'highlighterHint')}
            aria-pressed={pen.style === 'highlighter'}
            onClick={() => {
              updatePenSettings({ style: 'highlighter' });
              const next = effectivePen();
              if (penTargets.length) {
                patchShapes(penTargets.map((v) => [v.id, { alpha: next.alpha, strokeWidth: next.width }]));
                onPatched();
              }
            }}
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
          <div className="text-format" role="group" aria-label={t(locale, 'textFormat')}>
            <FormatBtn
              label={t(locale, 'textBold')}
              icon="bold"
              active={live.bold}
              onClick={() => applyFormat({ bold: !live.bold })}
            />
            <FormatBtn
              label={t(locale, 'textItalic')}
              icon="italic"
              active={live.italic}
              onClick={() => applyFormat({ italic: !live.italic })}
            />
            <FormatBtn
              label={t(locale, 'textUnderline')}
              icon="underline"
              active={live.underline}
              onClick={() => applyFormat({ underline: !live.underline })}
            />
            <FormatBtn
              label={t(locale, 'textStrike')}
              icon="strikethrough"
              active={live.strike}
              onClick={() => applyFormat({ strike: !live.strike })}
            />
            <div className="toolbelt-sep" />
            {showHighlight && (
              <FormatBtn
                label={t(locale, 'textHighlight')}
                icon="highlight"
                active={live.highlight}
                onClick={() => applyFormat({ highlight: !live.highlight })}
              />
            )}
            {showHighlight && <div className="toolbelt-sep" />}
            <FormatBtn
              label={t(locale, 'textAlignLeft')}
              icon="alignLeft"
              active={live.align === 'left'}
              onClick={() => applyFormat({ align: 'left' })}
            />
            <FormatBtn
              label={t(locale, 'textAlignCenter')}
              icon="alignCenterH"
              active={live.align === 'center'}
              onClick={() => applyFormat({ align: 'center' })}
            />
            <FormatBtn
              label={t(locale, 'textAlignRight')}
              icon="alignRight"
              active={live.align === 'right'}
              onClick={() => applyFormat({ align: 'right' })}
            />
          </div>
          <div className="toolbelt-sep" />
          <Swatches
            colors={TEXT_COLORS}
            value={textValue}
            custom
            onPick={(c) => {
              // With adapt-on: store the pick; each client remaps for their paper.
              // With adapt-off: bump low-contrast free-text picks so they stay readable.
              const onlyFreeText =
                showTextDraw ||
                editTarget?.type === 'text' ||
                (textTargets.length > 0 && textTargets.every((v) => v.type === 'text'));
              const bg = viewPaperBg();
              const next =
                onlyFreeText && !readPrefs().adaptInkToPaper ? readableTextOn(c, bg) : c;
              applyFormat({ color: next });
            }}
          />
          <select
            className="size-select"
            value={textSize}
            title={t(locale, 'textSize')}
            onChange={(e) => {
              applyFormat({ size: Number(e.target.value) });
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
