import { useEffect, useRef, useState } from 'react';
import { Engine } from './engine/Engine';
import type { EditTarget } from './engine/Engine';
import type { ToolId } from './engine/tools';
import type { ShapeView } from './core/shapes';
import { Toolbar } from './ui/Toolbar';
import { SettingsSheet } from './ui/SettingsSheet';
import { StyleBar } from './ui/StyleBar';
import { TextOverlay } from './ui/TextOverlay';
import { Icon } from './ui/icons';
import { t } from './ui/i18n';
import { meta, metaBg, metaGrid, onSyncStatus, persistence, setMeta, undoManager } from './core/store';
import type { SyncStatus } from './core/store';
import { onSettingsChange, settings } from './core/settings';
import { readChromeTheme, type ChromeThemeId } from './core/chromeTheme';
import { applyLocale, readLocale, type LocaleId } from './core/locale';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [selectionCount, setSelectionCount] = useState(0);
  const [selected, setSelected] = useState<ShapeView[]>([]);
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
  const [menu, setMenu] = useState<{ x: number; y: number; shapeId: string | null; type: string | null; locked: boolean } | null>(
    null
  );
  const [info, setInfo] = useState<{ title: string; lines: string[] } | null>(null);
  const [chromeTheme, setChromeTheme] = useState<ChromeThemeId>(() => readChromeTheme());
  const [locale, setLocale] = useState<LocaleId>(() => readLocale());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshSelected = () => setSelected(engineRef.current?.selectedViews() ?? []);

  useEffect(() => {
    applyLocale(locale);
    document.title = t(locale, 'title');
  }, [locale]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas);
    engineRef.current = engine;
    engine.events.onSelection = (ids) => {
      setSelectionCount(ids.length);
      setCanCrop(engine.hasImageSelection());
      setSelected(engine.selectedViews());
    };
    engine.events.onCrop = (active) => setCropActive(active);
    engine.events.onContextMenu = (m) => setMenu(m);
    engine.events.onInfo = (i) => setInfo(i);
    engine.events.onStats = (s) => {
      setZoom(Math.round(s.zoom * 100));
      setShapeCount(s.shapes);
    };
    engine.events.onTool = (id) => setTool(id);
    engine.events.onEditText = (target) => setEditTarget(target);
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
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      setMenu(null);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settingsOpen]);

  const closeMenu = () => setMenu(null);
  const menuX = menu ? Math.min(menu.x, window.innerWidth - 240) : 0;
  const menuY = menu ? Math.min(menu.y, window.innerHeight - 320) : 0;

  const menuItems: Array<{ label: string; hint?: string; danger?: boolean; run: () => void }> = [];
  if (menu) {
    const e = engine;
    if (menu.shapeId) {
      menuItems.push(
        { label: t(locale, 'ctxCopy'), hint: 'Ctrl+C', run: () => e?.copySelection() },
        { label: t(locale, 'ctxCopyImage'), hint: 'Ctrl+Shift+C', run: () => e?.copySelectionAsImage() },
        { label: t(locale, 'ctxDuplicate'), hint: 'Ctrl+D', run: () => e?.duplicateSelection() },
        { label: t(locale, 'ctxDelete'), hint: 'Delete', danger: true, run: () => e?.deleteSelection() }
      );
      if (menu.type === 'image') {
        menuItems.push(
          { label: t(locale, 'ctxDownload'), run: () => e?.downloadSelection() },
          { label: t(locale, 'ctxOriginal'), run: () => e?.scaleSelectionToOriginal() }
        );
      }
      if (menu.type === 'pen') {
        menuItems.push({ label: t(locale, 'ctxCsv'), run: () => e?.exportCsvSelection() });
      }
      menuItems.push(
        { label: t(locale, 'ctxFront'), run: () => e?.bringFront() },
        { label: t(locale, 'ctxBack'), run: () => e?.sendBack() },
        {
          label: menu.locked ? t(locale, 'ctxUnlock') : t(locale, 'ctxLock'),
          hint: 'Ctrl+Shift+L',
          run: () => e?.toggleLockSelection(),
        },
        {
          label: t(locale, 'ctxInfo'),
          run: () => {
            const i = e?.shapeInfo(menu.shapeId!);
            e?.events.onInfo?.(i ?? null);
          },
        }
      );
    } else {
      menuItems.push({ label: t(locale, 'ctxPaste'), hint: 'Ctrl+V', run: () => e?.pasteSelection() });
    }
  }

  return (
    <div className={`app${settingsOpen ? ' settings-open' : ''}`}>
      <div className="canvas-wrap">
        <canvas ref={canvasRef} />
        {editTarget && engine && (
          <TextOverlay
            target={editTarget}
            engine={engine}
            onDone={(value) => {
              engine.commitText(editTarget.id, value, editTarget);
              setEditTarget(null);
            }}
            onCancel={() => {
              engine.cancelTextEdit();
              setEditTarget(null);
            }}
          />
        )}
      </div>

      <header className="file-bar">
        <div className="island file-island">
          <div className="brand">
            {t(locale, 'brand')} <span className="brand-sub">{shapeCount}</span>
          </div>
          <div className="island-sep" />
          <button className="icon-btn" title={t(locale, 'undo')} onClick={() => undoManager.undo()}>
            <Icon name="undo" />
          </button>
          <button className="icon-btn" title={t(locale, 'redo')} onClick={() => undoManager.redo()}>
            <Icon name="redo" />
          </button>
          <div className="island-sep" />
          <button className="icon-btn" title={t(locale, 'zoomOut')} onClick={() => engine?.zoomBy(1 / 1.2)}>
            <Icon name="minus" />
          </button>
          <button className="zoom-value" title={t(locale, 'zoomReset')} onClick={() => engine?.resetZoom()}>
            {zoom}%
          </button>
          <button className="icon-btn" title={t(locale, 'zoomIn')} onClick={() => engine?.zoomBy(1.2)}>
            <Icon name="plus" />
          </button>
          <button className="icon-btn" title={t(locale, 'fit')} onClick={() => engine?.fitContent()}>
            <Icon name="fit" />
          </button>
        </div>
        <div className="island meta-island">
          {error && (
            <button className="error-banner" onClick={() => setError(null)} title={t(locale, 'errorHint')}>
              {t(locale, 'error')}: {error}
            </button>
          )}
          <div className={`sync-badge${sync.online ? ' online' : ''}`} title={t(locale, 'syncHint')}>
            {sync.online ? `${t(locale, 'online')} · ${sync.users}` : t(locale, 'offline')}
          </div>
          <div className={`save-badge${saved ? ' saved' : ''}`}>{saved ? t(locale, 'saved') : t(locale, 'loading')}</div>
          <button className="icon-btn" title={t(locale, 'settings')} onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" />
          </button>
        </div>
      </header>

      <StyleBar
        locale={locale}
        tool={tool}
        selected={selected}
        pen={pen}
        shape={shape}
        text={text}
        eraser={eraser}
        onPatched={refreshSelected}
      />

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

      <Toolbar
        locale={locale}
        tool={tool}
        selectionCount={selectionCount}
        canCrop={canCrop}
        cropActive={cropActive}
        onTool={setTool}
        onDelete={() => engine?.deleteSelection()}
        onCopy={() => engine?.copySelection()}
        onPaste={() => engine?.pasteSelection()}
        onDuplicate={() => engine?.duplicateSelection()}
        onInsertImage={() => fileRef.current?.click()}
        onCrop={() => engine?.startCropSelected()}
        onApplyCrop={() => engine?.applyCrop()}
        onCancelCrop={() => engine?.cancelCrop()}
      />

      <SettingsSheet
        open={settingsOpen}
        locale={locale}
        chromeTheme={chromeTheme}
        bg={bg}
        gridOn={gridOn}
        onLocale={setLocale}
        onChromeTheme={setChromeTheme}
        onBg={(value) => setMeta({ bg: value })}
        onGrid={(on) => setMeta({ grid: on })}
        onClose={() => setSettingsOpen(false)}
      />

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
            <button className="icon-btn" title={t(locale, 'close')} onClick={() => setInfo(null)}>
              <Icon name="close" />
            </button>
          </div>
          {info.lines.map((line) => (
            <div key={line} className="info-line">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
