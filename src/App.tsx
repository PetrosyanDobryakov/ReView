import { useEffect, useRef, useState } from 'react';
import { Engine } from './engine/Engine';
import type { EditTarget } from './engine/Engine';
import type { ToolId } from './engine/tools';
import { Toolbar, Icon } from './ui/Toolbar';
import { TextOverlay } from './ui/TextOverlay';
import { meta, metaBg, metaGrid, onSyncStatus, persistence, setMeta, undoManager } from './core/store';
import type { SyncStatus } from './core/store';
import { onSettingsChange, settings, updateEraserSettings, updatePenSettings, updateShapeSettings, updateTextSettings } from './core/settings';

const BG_PRESETS: Array<{ value: string; label: string }> = [
  { value: '#161922', label: 'Тёмный' },
  { value: '#0d0f16', label: 'Почти чёрный' },
  { value: '#2b3040', label: 'Графит' },
  { value: '#f4f4f5', label: 'Светлый' },
  { value: '#fffdf5', label: 'Кремовый' },
];

const PEN_COLORS = ['#f2f5ff', '#ffe27a', '#ff6b6b', '#4cd964', '#7c8cff', '#ffa94d', '#d0bfff', '#ff9fd0'];

const FILL_COLORS = ['#ffffff', '#ffe27a', '#ff6b6b', '#4cd964', '#7c8cff', '#ffa94d', '#d0bfff', '#ff9fd0'];

const STROKE_COLORS = ['#7c8cff', '#1f2430', '#ffffff', '#ff6b6b', '#4cd964', '#ffa94d', '#d0bfff', '#ff9fd0'];

const TEXT_COLORS = ['#ffe27a', '#4cd964', '#ff6b6b', '#1f2430', '#f2f5ff', '#d0bfff', '#7c8cff', '#ffa94d'];

const TEXT_SIZES = [12, 14, 16, 18, 24, 32, 48, 64];

const ERASER_SIZES = [16, 32, 64];

const SHAPE_TOOLS: ToolId[] = ['rect', 'ellipse', 'sticky', 'arrow'];

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [selectionCount, setSelectionCount] = useState(0);
  const [zoom, setZoom] = useState(100);
  const [shapeCount, setShapeCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pen, setPen] = useState({ ...settings.pen });
  const [shape, setShape] = useState({ ...settings.shape });
  const [text, setText] = useState({ ...settings.text });
  const [eraser, setEraser] = useState({ ...settings.eraser });
  const [bg, setBg] = useState(metaBg());
  const [gridOn, setGridOn] = useState(metaGrid());
  const [cropActive, setCropActive] = useState(false);
  const [canCrop, setCanCrop] = useState(false);
  const [sync, setSync] = useState<SyncStatus>({ online: false, users: 0 });
  const [menu, setMenu] = useState<{ x: number; y: number; shapeId: string | null; type: string | null; locked: boolean } | null>(null);
  const [info, setInfo] = useState<{ title: string; lines: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas);
    engineRef.current = engine;
    engine.events.onSelection = (ids) => {
      setSelectionCount(ids.length);
      setCanCrop(engine.hasImageSelection());
    };
    engine.events.onCrop = (active) => setCropActive(active);
    engine.events.onContextMenu = (m) => setMenu(m);
    engine.events.onInfo = (i) => setInfo(i);
    engine.events.onStats = (s) => {
      setZoom(Math.round(s.zoom * 100));
      setShapeCount(s.shapes);
    };
    engine.events.onTool = (id) => setTool(id);
    engine.events.onEditText = (t) => setEditTarget(t);
    engine.events.onError = (message) => setError(message);
    const onSynced = () => setSaved(true);
    if (persistence.synced) setSaved(true);
    else persistence.on('synced', onSynced);
    const offSettings = onSettingsChange(() => {
      setPen({ ...settings.pen });
      setShape({ ...settings.shape });
      setText({ ...settings.text });
      setEraser({ ...settings.eraser });
    });
    const onMeta = () => {
      setBg(metaBg());
      setGridOn(metaGrid());
    };
    meta.observe(onMeta);
    const offSync = onSyncStatus(setSync);
    return () => {
      persistence.off('synced', onSynced);
      offSettings();
      meta.unobserve(onMeta);
      offSync();
      engine.destroy();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setTool(tool);
  }, [tool]);

  const engine = engineRef.current;

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      const el = document.querySelector('.ctx-menu');
      if (el && el.contains(e.target as Node)) return;
      setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const closeMenu = () => setMenu(null);
  const menuX = menu ? Math.min(menu.x, window.innerWidth - 240) : 0;
  const menuY = menu ? Math.min(menu.y, window.innerHeight - 320) : 0;

  const menuItems: Array<{ label: string; hint?: string; danger?: boolean; run: () => void }> = [];
  if (menu) {
    const e = engine;
    if (menu.shapeId) {
      menuItems.push(
        { label: 'Копировать', hint: 'Ctrl+C', run: () => e?.copySelection() },
        { label: 'Копировать как картинку', hint: 'Ctrl+Shift+C', run: () => e?.copySelectionAsImage() },
        { label: 'Дублировать', hint: 'Ctrl+D', run: () => e?.duplicateSelection() },
        { label: 'Удалить', hint: 'Delete', danger: true, run: () => e?.deleteSelection() }
      );
      if (menu.type === 'image') {
        menuItems.push(
          { label: 'Скачать', run: () => e?.downloadSelection() },
          { label: 'Исходный размер', run: () => e?.scaleSelectionToOriginal() }
        );
      }
      if (menu.type === 'pen') {
        menuItems.push({ label: 'Экспорт в CSV (Excel)', run: () => e?.exportCsvSelection() });
      }
      menuItems.push(
        { label: 'На передний план', run: () => e?.bringFront() },
        { label: 'На задний план', run: () => e?.sendBack() },
        { label: menu.locked ? 'Разблокировать' : 'Заблокировать', hint: 'Ctrl+Shift+L', run: () => e?.toggleLockSelection() },
        { label: 'Инфо', run: () => { const i = e?.shapeInfo(menu.shapeId!); e?.events.onInfo?.(i ?? null); } }
      );
    } else {
      menuItems.push({ label: 'Вставить', hint: 'Ctrl+V', run: () => e?.pasteSelection() });
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          Доска <span className="brand-sub">v0.8 · локальная</span>
        </div>
        <div className="topbar-group">
          <button className="top-btn" title="Отменить (Ctrl+Z)" onClick={() => undoManager.undo()}>
            <Icon d="M3 7v6h6M21 17a9 9 0 0 0-15-6.7L3 13" />
          </button>
          <button className="top-btn" title="Повторить (Ctrl+Y)" onClick={() => undoManager.redo()}>
            <Icon d="M21 7v6h-6M3 17a9 9 0 0 1 15-6.7L21 13" />
          </button>
        </div>
        <div className="topbar-group">
          <button className="top-btn" title="Отдалить" onClick={() => engine?.zoomBy(1 / 1.2)}>
            −
          </button>
          <button className="zoom-value" title="100% — сбросить зум" onClick={() => engine?.resetZoom()}>
            {zoom}%
          </button>
          <button className="top-btn" title="Приблизить" onClick={() => engine?.zoomBy(1.2)}>
            +
          </button>
          <button className="top-btn" title="Показать всё содержимое" onClick={() => engine?.fitContent()}>
            <Icon d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
          </button>
        </div>
        <div className="spacer" />
        {tool === 'pen' && (
          <div className="topbar-group pen-panel">
            <button
              className={`style-btn${pen.style === 'marker' ? ' active' : ''}`}
              title="Маркер — сплошная линия"
              onClick={() => updatePenSettings({ style: 'marker' })}
            >
              Маркер
            </button>
            <button
              className={`style-btn${pen.style === 'highlighter' ? ' active' : ''}`}
              title="Хайлайтер — полупрозрачный, рисует под содержимым"
              onClick={() => updatePenSettings({ style: 'highlighter' })}
            >
              Хайлайтер
            </button>
            <input
              className="size-slider"
              type="range"
              min={1}
              max={20}
              value={pen.size}
              title="Толщина кисти"
              onChange={(e) => updatePenSettings({ size: Number(e.target.value) })}
            />
            <span className="size-value">{pen.size}</span>
            <div className="swatches">
              {PEN_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch${pen.color === c ? ' active' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => updatePenSettings({ color: c })}
                />
              ))}
              <input
                type="color"
                className="swatch-custom"
                value={pen.color}
                title="Свой цвет"
                onChange={(e) => updatePenSettings({ color: e.target.value })}
              />
            </div>
          </div>
        )}
        {tool === 'eraser' && (
          <div className="topbar-group pen-panel">
            <span className="panel-label">Ластик</span>
            <button
              className={`style-btn${eraser.mode === 'whole' ? ' active' : ''}`}
              title="Стирает весь объект целиком при касании"
              onClick={() => updateEraserSettings({ mode: 'whole' })}
            >
              Весь объект
            </button>
            <button
              className={`style-btn${eraser.mode === 'partial' ? ' active' : ''}`}
              title="Стирает только ту часть линии, которую задел"
              onClick={() => updateEraserSettings({ mode: 'partial' })}
            >
              Часть линии
            </button>
            {ERASER_SIZES.map((s) => (
              <button
                key={s}
                className={`style-btn${eraser.size === s ? ' active' : ''}`}
                title={`Размер ${s}`}
                onClick={() => updateEraserSettings({ size: s })}
              >
                <span
                  className="eraser-dot"
                  style={{ width: s / 2.5, height: s / 2.5 }}
                />
              </button>
            ))}
          </div>
        )}
        {SHAPE_TOOLS.includes(tool) && (
          <div className="topbar-group pen-panel">
            <span className="panel-label">Заливка</span>
            <div className="swatches">
              {FILL_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch${shape.fill === c ? ' active' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => updateShapeSettings({ fill: c })}
                />
              ))}
            </div>
            <span className="panel-label">Контур</span>
            <div className="swatches">
              {STROKE_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch${shape.stroke === c ? ' active' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => updateShapeSettings({ stroke: c })}
                />
              ))}
            </div>
          </div>
        )}
        {tool === 'text' && (
          <div className="topbar-group pen-panel">
            <span className="panel-label">Цвет</span>
            <div className="swatches">
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  className={`swatch${text.color === c ? ' active' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => updateTextSettings({ color: c })}
                />
              ))}
              <input
                type="color"
                className="swatch-custom"
                value={text.color}
                title="Свой цвет"
                onChange={(e) => updateTextSettings({ color: e.target.value })}
              />
            </div>
            <span className="panel-label">Размер</span>
            <select
              className="bg-select"
              value={text.size}
              title="Размер текста"
              onChange={(e) => updateTextSettings({ size: Number(e.target.value) })}
            >
              {TEXT_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
        )}
        {cropActive ? (
          <div className="topbar-group">
            <button
              className="top-btn crop-apply"
              title="Применить обрезку (Enter)"
              onClick={() => engine?.applyCrop()}
            >
              ✓
            </button>
            <button className="top-btn" title="Отмена (Esc)" onClick={() => engine?.cancelCrop()}>
              ✕
            </button>
          </div>
        ) : (
          <div className="topbar-group">
            <button
              className="top-btn"
              title="Вставить картинку из файла"
              onClick={() => fileRef.current?.click()}
            >
              <Icon d="M4 5h16v14H4z M4 15l5-5 4 4 3-3 4 4" />
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) engine?.insertImageFile(file);
                e.target.value = '';
              }}
            />
            <button
              className="top-btn"
              title="Обрезать картинку"
              disabled={!canCrop}
              onClick={() => engine?.startCropSelected()}
            >
              <Icon d="M5 5h14v14M9 3l-6 6v6M15 21l6-6V9" />
            </button>
          </div>
        )}
        <div className="topbar-group">
          <select
            className="bg-select"
            value={bg}
            title="Фон доски"
            onChange={(e) => setMeta({ bg: e.target.value })}
          >
            {BG_PRESETS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <label className="grid-toggle" title="Показать сетку">
            <input type="checkbox" checked={gridOn} onChange={(e) => setMeta({ grid: e.target.checked })} />
            Сетка
          </label>
        </div>
        {error && (
          <button className="error-banner" onClick={() => setError(null)} title="Ошибка движка — кликни, чтобы скрыть">
            Ошибка: {error}
          </button>
        )}
        <div className={`sync-badge${sync.online ? ' online' : ''}`} title="Синхронизация между устройствами">
          {sync.online ? `Онлайн · ${sync.users}` : 'Оффлайн'}
        </div>
        <div className={`save-badge${saved ? ' saved' : ''}`}>
          {saved ? 'Сохранено локально' : 'Загрузка…'}
        </div>
      </header>
      <div className="main">
        <Toolbar
          tool={tool}
          selectionCount={selectionCount}
          onTool={setTool}
          onDelete={() => engine?.deleteSelection()}
          onCopy={() => engine?.copySelection()}
          onPaste={() => engine?.pasteSelection()}
          onDuplicate={() => engine?.duplicateSelection()}
          onUndo={() => undoManager.undo()}
          onRedo={() => undoManager.redo()}
        />
        <div className="canvas-wrap">
          <canvas ref={canvasRef} />
          {editTarget && engine && (
            <TextOverlay
              target={editTarget}
              engine={engine}
              onDone={(text) => {
                engine.commitText(editTarget.id, text, editTarget);
                setEditTarget(null);
              }}
              onCancel={() => {
                engine.cancelTextEdit();
                setEditTarget(null);
              }}
            />
          )}
        </div>
      </div>
      {menu && (
        <div className="ctx-menu" style={{ left: menuX, top: menuY }} onContextMenu={(e) => e.preventDefault()}>
          {menuItems.map((item) => (
            <button
              key={item.label}
              className={`ctx-item${item.danger ? ' danger' : ''}`}
              onClick={() => {
                item.run();
                closeMenu();
              }}
            >
              <span>{item.label}</span>
              {item.hint && <span className="ctx-hint">{item.hint}</span>}
            </button>
          ))}
        </div>
      )}
      {info && (
        <div className="info-modal">
          <div className="info-head">
            <b>{info.title}</b>
            <button className="top-btn" title="Закрыть" onClick={() => setInfo(null)}>
              ✕
            </button>
          </div>
          {info.lines.map((l) => (
            <div key={l} className="info-line">
              {l}
            </div>
          ))}
        </div>
      )}
      <footer className="statusbar">
        <span>{shapeCount} объектов</span>
        <span className="sep">·</span>
        <span>
          Колесо — зум · Правая кнопка / Пробел — движение доски · Ctrl+D — дубликат · Ctrl+Z — отмена
        </span>
      </footer>
    </div>
  );
}
