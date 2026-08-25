import { useRef, useState, useEffect } from 'react';
import type { ToolId } from '../engine/tools';
import type { ShapeView, TextAlign } from '../core/shapes';
import { readableTextOn } from '../core/shapes';
import {
  effectivePen,
  updateEraserSettings,
  updatePenSettings,
  updateShapeSettings,
  updateTextSettings,
  ARROW_HEAD_MAX,
  ARROW_HEAD_MIN,
  RECT_CORNER_RADIUS,
  SHAPE_STROKE_MAX,
  SHAPE_STROKE_MIN,
  type EraserSettings,
  type PenSettings,
  type ShapeSettings,
  type TextSettings,
} from '../core/settings';
import { viewPaperBg, patchShapes } from '../core/store';
import { readPrefs } from '../core/prefs';
import { addCustomColor, PALETTE_HUES, readCustomColors, readPenSlots, removeCustomColor, writePenSlot } from '../core/penColors';
import type { LocaleId } from '../core/locale';
import type { EditTarget } from '../engine/Engine';
import { t } from './i18n';
import { Icon, type IconName } from './icons';
import { ChromeSelect } from './ChromeSelect';
import { MOTION, useExitPresence } from './motion';
import { hasFill } from '../core/shapes';

const TEXT_SIZES = [12, 14, 16, 18, 24, 32, 48, 64];
const ERASER_SIZES = [16, 32, 64];
const SHAPE_TOOLS: ToolId[] = ['rect', 'ellipse', 'sticky', 'arrow', 'diamond', 'frame', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display', 'graph'];
const FILL_TYPES = new Set(['rect', 'ellipse', 'sticky', 'diamond', 'frame', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display', 'graph']);
const STROKE_TYPES = new Set(['rect', 'ellipse', 'arrow', 'pen', 'diamond', 'frame', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display', 'graph']);
const TEXT_TYPES = new Set(['text', 'sticky', 'rect', 'ellipse', 'diamond', 'frame', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display']);
const CENTERED_TYPES = new Set(['rect', 'ellipse', 'diamond', 'triangle', 'parallelogram', 'hexagon', 'cylinder', 'terminator', 'subroutine', 'display']);

type FormatPatch = Partial<
  Pick<TextSettings, 'bold' | 'italic' | 'underline' | 'strike' | 'align' | 'highlight' | 'color' | 'size'>
>;

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

/** Miro-style quick slots + palette popup (shared across pen / fill / stroke / text). */
function ColorSlots({ locale, color, onPick }: { locale: LocaleId; color: string; onPick: (c: string) => void }) {
  const [slots, setSlots] = useState<string[]>(() => readPenSlots());
  const [customs, setCustoms] = useState<string[]>(() => readCustomColors());
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const lastAddAt = useRef(0);
  const addInputRef = useRef<HTMLInputElement>(null);

  // native 'change' fires once on dialog confirm — use it to commit to custom colors
  // (synthetic onChange fires continuously while dragging in the native picker)
  useEffect(() => {
    const el = addInputRef.current;
    if (!el) return;
    const commit = () => {
      lastAddAt.current = performance.now();
      setCustoms(addCustomColor(el.value));
    };
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  });

  useEffect(() => {
    if (openIdx === null) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return;
      // native color dialog can emit a stray outside pointerdown on focus return
      if (performance.now() - lastAddAt.current < 600) return;
      setOpenIdx(null);
    };
    window.addEventListener('pointerdown', onDown);
    return () => window.removeEventListener('pointerdown', onDown);
  }, [openIdx]);

  const pick = (c: string) => {
    if (openIdx !== null) {
      writePenSlot(openIdx, c);
      setSlots(readPenSlots());
    }
    onPick(c);
    setOpenIdx(null);
  };

  const shadeRows: string[][] = [];
  for (let row = 0; row < PALETTE_HUES[0].length; row++) {
    shadeRows.push(PALETTE_HUES.map((hue) => hue[row]));
  }

  const activeColor = color.toLowerCase();

  return (
    <div className="pen-slots" ref={rootRef}>
      {slots.map((c, i) => (
        <button
          type="button"
          key={i}
          className={`pen-slot${activeColor === c.toLowerCase() ? ' active' : ''}`}
          style={{ background: c }}
          title={c}
          aria-label={`color ${i + 1}`}
          aria-pressed={activeColor === c.toLowerCase()}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (openIdx === i) {
              setOpenIdx(null);
              return;
            }
            onPick(c);
            setOpenIdx(i);
          }}
        />
      ))}
      {openIdx !== null && (
        <div className="pen-pop" role="dialog" aria-label={t(locale, 'penColors')}>
          <div className="pen-pop-grid">
            {shadeRows.map((row, ri) =>
              row.map((c, ci) => (
                <button
                  type="button"
                  key={`${ri}-${ci}`}
                  className={`pen-pop-swatch${activeColor === c.toLowerCase() ? ' active' : ''}`}
                  style={{ background: c }}
                  title={c}
                  aria-label={c}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c)}
                />
              ))
            )}
          </div>
          {customs.length > 0 && (
            <>
              <span className="panel-label">
                {t(locale, 'customColors')} · {t(locale, 'rightClickDelete')}
              </span>
              <div className="pen-pop-grid customs">
                {customs.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`pen-pop-swatch${activeColor === c.toLowerCase() ? ' active' : ''}`}
                    style={{ background: c }}
                    title={c}
                    aria-label={c}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => pick(c)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setCustoms(removeCustomColor(c));
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Delete' || e.key === 'Backspace') {
                        e.preventDefault();
                        setCustoms(removeCustomColor(c));
                      }
                    }}
                  />
                ))}
              </div>
            </>
          )}
          <label className="pen-add" title={t(locale, 'addColor')}>
            <span>{t(locale, 'addColor')}</span>
            <input
              ref={addInputRef}
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#ffffff'}
              onPointerDown={() => {
                lastAddAt.current = performance.now();
              }}
              onChange={(e) => {
                // live: preview on slot; customs list is committed on the native change event
                lastAddAt.current = performance.now();
                if (openIdx !== null) {
                  writePenSlot(openIdx, e.target.value);
                  setSlots(readPenSlots());
                }
                onPick(e.target.value);
              }}
            />
          </label>
        </div>
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
  const rectTargets = selected.filter((v) => v.type === 'rect' && !v.locked);
  const arrowTargets = selected.filter((v) => v.type === 'arrow' && !v.locked);
  const outlineTargets = strokeTargets.filter((v) => v.type !== 'pen');

  const showFill = showShapeDraw || fillTargets.length > 0;
  const showStroke = showShapeDraw || showPen || strokeTargets.length > 0 || penTargets.length > 0;
  const showText = showTextDraw || textTargets.length > 0;
  const showPenStyle = showPen || (penTargets.length > 0 && fillTargets.length === 0 && textTargets.length === 0);
  const showOutlineWidth =
    (showShapeDraw && tool !== 'sticky' && tool !== 'graph') || outlineTargets.length > 0;
  const showCorners = tool === 'rect' || rectTargets.length > 0;
  const showArrowHead = tool === 'arrow' || arrowTargets.length > 0;

  const want = showEraser || showFill || showStroke || showText || showPenStyle;
  const shown = useExitPresence(want, MOTION.enter);
  const flags = { showEraser, showFill, showStroke, showText, showPenStyle, showOutlineWidth, showCorners, showArrowHead };
  const hold = useRef(flags);
  if (want) hold.current = flags;
  const view = hold.current;
  const mode = [
    view.showEraser,
    view.showPenStyle,
    view.showFill,
    view.showStroke,
    view.showText,
    view.showOutlineWidth,
    view.showCorners,
    view.showArrowHead,
  ]
    .map(Number)
    .join('');

  if (!shown) return null;

  const fillValue = fillTargets[0]?.fill ?? (shape.filled ? shape.fill : 'transparent');
  const fillOn = hasFill(fillValue);
  const strokeValue = strokeTargets[0]?.stroke ?? penTargets[0]?.stroke ?? (showPen ? pen.color : shape.stroke);
  const outlineWidth = outlineTargets[0]?.strokeWidth ?? shape.strokeWidth;
  const cornersRound =
    rectTargets.length > 0
      ? rectTargets.every((v) => (v.cornerRadius === undefined ? true : v.cornerRadius > 0))
      : shape.rounded;
  const arrowHeadValue = arrowTargets[0]?.arrowHead ?? shape.arrowHead;

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
      const sel = window.getSelection();
      const hasRange = !!sel && !sel.isCollapsed && sel.rangeCount > 0;
      if (hasRange && (patch.bold !== undefined || patch.italic !== undefined || patch.underline !== undefined || patch.strike !== undefined || patch.highlight !== undefined)) {
        if (patch.bold !== undefined) document.execCommand('bold');
        if (patch.italic !== undefined) document.execCommand('italic');
        if (patch.underline !== undefined) document.execCommand('underline');
        if (patch.strike !== undefined) document.execCommand('strikeThrough');
        if (patch.highlight !== undefined) {
          if (patch.highlight) document.execCommand('hiliteColor', false, '#ffe27a');
          else document.execCommand('removeFormat');
        }
        return;
      }
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
          <button
            type="button"
            className={`style-btn style-btn-icon${!fillOn ? ' active' : ''}`}
            title={t(locale, 'noFill')}
            aria-label={t(locale, 'noFill')}
            aria-pressed={!fillOn}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              updateShapeSettings({ filled: false });
              if (fillTargets.length) {
                patchShapes(fillTargets.map((v) => [v.id, { fill: 'transparent' }]));
                onPatched();
              }
            }}
          >
            <Icon name="noFill" size={16} />
          </button>
          <ColorSlots
            locale={locale}
            color={fillOn ? fillValue : ''}
            onPick={(c) => {
              updateShapeSettings({ fill: c, filled: true });
              if (fillTargets.length) {
                patchShapes(fillTargets.map((v) => [v.id, { fill: c }]));
                onPatched();
              }
            }}
          />
        </>
      )}
      {view.showCorners && (
        <>
          <div className="toolbelt-sep" />
          <button
            type="button"
            className={`style-btn${!cornersRound ? ' active' : ''}`}
            title={t(locale, 'cornersSharp')}
            aria-pressed={!cornersRound}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              updateShapeSettings({ rounded: false });
              if (rectTargets.length) {
                patchShapes(rectTargets.map((v) => [v.id, { cornerRadius: 0 }]));
                onPatched();
              }
            }}
          >
            {t(locale, 'cornersSharp')}
          </button>
          <button
            type="button"
            className={`style-btn${cornersRound ? ' active' : ''}`}
            title={t(locale, 'cornersRound')}
            aria-pressed={cornersRound}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              updateShapeSettings({ rounded: true });
              if (rectTargets.length) {
                patchShapes(rectTargets.map((v) => [v.id, { cornerRadius: RECT_CORNER_RADIUS }]));
                onPatched();
              }
            }}
          >
            {t(locale, 'cornersRound')}
          </button>
        </>
      )}
      {view.showStroke && (
        <>
          <span className="panel-label">{t(locale, 'stroke')}</span>
          <ColorSlots
            locale={locale}
            color={strokeValue}
            onPick={(c) => {
              updatePenSettings({ color: c });
              updateShapeSettings({ stroke: c });
              const patches: Array<[string, Partial<ShapeView>]> = [];
              for (const v of strokeTargets) patches.push([v.id, { stroke: c }]);
              for (const v of penTargets) patches.push([v.id, { stroke: c }]);
              if (patches.length) {
                patchShapes(patches);
                onPatched();
              }
            }}
          />
        </>
      )}
      {view.showOutlineWidth && (
        <>
          <input
            className="size-slider"
            type="range"
            min={SHAPE_STROKE_MIN}
            max={SHAPE_STROKE_MAX}
            value={outlineWidth}
            title={t(locale, 'strokeWidth')}
            aria-label={t(locale, 'strokeWidth')}
            onChange={(e) => {
              const strokeWidth = Number(e.target.value);
              updateShapeSettings({ strokeWidth });
              if (outlineTargets.length) {
                patchShapes(outlineTargets.map((v) => [v.id, { strokeWidth }]));
                onPatched();
              }
            }}
          />
          <span className="size-value">{outlineWidth}</span>
        </>
      )}
      {view.showArrowHead && (
        <>
          <span className="panel-label">{t(locale, 'arrowHead')}</span>
          <input
            className="size-slider"
            type="range"
            min={ARROW_HEAD_MIN}
            max={ARROW_HEAD_MAX}
            value={arrowHeadValue}
            title={t(locale, 'arrowHead')}
            aria-label={t(locale, 'arrowHead')}
            onChange={(e) => {
              const arrowHead = Number(e.target.value);
              updateShapeSettings({ arrowHead });
              if (arrowTargets.length) {
                patchShapes(arrowTargets.map((v) => [v.id, { arrowHead }]));
                onPatched();
              }
            }}
          />
          <span className="size-value">{arrowHeadValue}</span>
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
          <ColorSlots
            locale={locale}
            color={textValue}
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
          <ChromeSelect
            className="size-select"
            size="md"
            preserveFocus
            value={String(textSize)}
            label={t(locale, 'textSize')}
            title={t(locale, 'textSize')}
            options={(TEXT_SIZES.includes(textSize) ? TEXT_SIZES : [...TEXT_SIZES, textSize].sort((a, b) => a - b)).map(
              (s) => ({ value: String(s), label: String(s) })
            )}
            onChange={(next) => {
              applyFormat({ size: Number(next) });
            }}
          />
        </>
      )}
      </div>
    </div>
  );
}
