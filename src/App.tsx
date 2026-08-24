import { useEffect, useRef, useState } from 'react';
import { Engine } from './engine/Engine';
import type { EditTarget, GraphEditTarget } from './engine/Engine';
import type { ToolId } from './engine/tools';
import type { ShapeView } from './core/shapes';
import { Toolbar } from './ui/Toolbar';
import { SettingsSheet } from './ui/SettingsSheet';
import { Presence } from './ui/Presence';
import { StyleBar } from './ui/StyleBar';
import { AlignBar } from './ui/AlignBar';
import { TextOverlay } from './ui/TextOverlay';
import { GraphEditor } from './ui/GraphEditor';
import { PageBar } from './ui/PageBar';
import { ExportDialog } from './ui/ExportDialog';
import type { ExportSource } from './ui/ExportDialog';
import type { ShapeBox } from './core/shapes';
import { Icon } from './ui/icons';
import { modKey, t } from './ui/i18n';
import { destroyProvider, meta, metaBg, metaGrid, onSyncStatus, persistence, setMeta, undoManager } from './core/store';
import type { SyncStatus } from './core/store';
import { onSettingsChange, settings } from './core/settings';
import { DEFAULT_BOARD_NAME, getBoardName, onBoardNameChange, writeBoardName } from './core/boardName';
import { readChromeTheme, type ChromeThemeId } from './core/chromeTheme';
import { applyLocale, readLocale, type LocaleId } from './core/locale';
import { loadUser, onUserChange, saveUser } from './core/user';
import { getProvider, onPeers, publishPresence, onPageChange } from './core/store';
import type { PeerCursor } from './core/store';
import { MOTION, useExitPresence } from './ui/motion';

type BoardMenu = { x: number; y: number; shapeId: string | null; type: string | null; locked: boolean };

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
  const [editGraph, setEditGraph] = useState<GraphEditTarget | null>(null);
  const [exportState, setExportState] = useState<{ source: ExportSource; rect: ShapeBox | null } | null>(null);
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
  const [menu, setMenu] = useState<BoardMenu | null>(null);
  const [info, setInfo] = useState<{ title: string; lines: string[] } | null>(null);
  const [chromeTheme, setChromeTheme] = useState<ChromeThemeId>(() => readChromeTheme());
  const [locale, setLocale] = useState<LocaleId>(() => readLocale());
  const [nick, setNick] = useState(() => loadUser().name);
  const [peers, setPeers] = useState<PeerCursor[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [boardTitle, setBoardTitle] = useState(getBoardName);
  const [editingName, setEditingName] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuHold = useRef<BoardMenu | null>(null);
  const infoHold = useRef<{ title: string; lines: string[] } | null>(null);
  const errorHold = useRef<string | null>(null);
  if (menu) menuHold.current = menu;
  if (info) infoHold.current = info;
  if (error) errorHold.current = error;

  const refreshSelected = () => setSelected(engineRef.current?.selectedViews() ?? []);

  useEffect(() => {
    applyLocale(locale);
    document.title = boardTitle === DEFAULT_BOARD_NAME ? t(locale, 'title') : boardTitle;
  }, [locale, boardTitle]);

  useEffect(() => onBoardNameChange(setBoardTitle), []);

  useEffect(() => {
    const user = loadUser();
    publishPresence(user);
    const offUser = onUserChange((u) => {
      setNick(u.name);
      publishPresence(u);
    });
    const p = getProvider();
    const onStatus = (st: { status: string }) => {
      if (st.status === 'connected') publishPresence(loadUser());
    };
    p.on('status', onStatus);
    return () => {
      offUser();
      p.off('status', onStatus);
    };
  }, []);

  useEffect(() => {
    return onPeers((list) => {
      setPeers(list);
      engineRef.current?.setPeers(list);
    });
  }, []);

  useEffect(() => onPageChange(() => engineRef.current?.resetToPage()), []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.events.onExportRegion = (rect) => {
      if (!rect) return;
      setExportState({ source: 'region', rect });
    };
  }, []);

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
  engine.events.onEditGraph = (target) => setEditGraph(target);
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
    const syncUndo = () => {
      setCanUndo(undoManager.undoStack.length > 0);
      setCanRedo(undoManager.redoStack.length > 0);
    };
    syncUndo();
    undoManager.on('stack-item-added', syncUndo);
    undoManager.on('stack-item-popped', syncUndo);
    undoManager.on('stack-cleared', syncUndo);
    return () => {
      persistence.off('synced', onSynced);
      offSettings();
      meta.unobserve(onMeta);
      offSync();
      undoManager.off('stack-item-added', syncUndo);
      undoManager.off('stack-item-popped', syncUndo);
      undoManager.off('stack-cleared', syncUndo);
      engine.destroy();
      engineRef.current = null;
      destroyProvider();
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) {
        setMenu(null);
        return;
      }
      if (info) {
        setInfo(null);
        return;
      }
      if (settingsOpen) setSettingsOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, info, settingsOpen]);

  const closeMenu = () => setMenu(null);
  const menuShown = useExitPresence(Boolean(menu), MOTION.overlay);
  const infoShown = useExitPresence(Boolean(info), MOTION.overlay);
  const errorShown = useExitPresence(Boolean(error), MOTION.enter);
  const menuView = menu ?? (menuShown ? menuHold.current : null);
  const infoView = info ?? (infoShown ? infoHold.current : null);
  const errorView = error ?? (errorShown ? errorHold.current : null);
  const menuX = menuView ? Math.min(menuView.x, window.innerWidth - 240) : 0;
  const menuY = menuView ? Math.min(menuView.y, window.innerHeight - 320) : 0;

  const menuItems: Array<{ label: string; hint?: string; danger?: boolean; run: () => void }> = [];
  if (menuView) {
    const e = engine;
    if (menuView.shapeId) {
      const shapeId = menuView.shapeId;
      menuItems.push(
        { label: t(locale, 'ctxCopy'), hint: `${modKey()}+C`, run: () => e?.copySelection() },
        { label: t(locale, 'ctxCopyImage'), hint: `${modKey()}+Shift+C`, run: () => e?.copySelectionAsImage() },
        { label: t(locale, 'ctxDuplicate'), hint: `${modKey()}+D`, run: () => e?.duplicateSelection() },
        { label: t(locale, 'ctxDelete'), hint: 'Delete', danger: true, run: () => e?.deleteSelection() }
      );
      if (menuView.type === 'image') {
        const view = engine?.views.get(shapeId);
        const cropped = Boolean(view && (view.cropW !== undefined || view.cropH !== undefined));
        menuItems.push(
          { label: t(locale, 'ctxDownload'), run: () => e?.downloadSelection() },
          {
            label: t(locale, 'crop'),
            run: () => {
              e?.setSelection([shapeId]);
              e?.startCropSelected();
            },
          },
          { label: t(locale, 'ctxOriginal'), run: () => e?.scaleSelectionToOriginal() }
        );
        if (cropped) {
          menuItems.push({
            label: t(locale, 'ctxResetCrop'),
            run: () => e?.resetCropSelected(),
          });
        }
      }
      if (menuView.type === 'pen') {
        menuItems.push({ label: t(locale, 'ctxCsv'), run: () => e?.exportCsvSelection() });
      }
      menuItems.push(
        { label: t(locale, 'ctxFront'), run: () => e?.bringFront() },
        { label: t(locale, 'ctxBack'), run: () => e?.sendBack() },
        {
          label: menuView.locked ? t(locale, 'ctxUnlock') : t(locale, 'ctxLock'),
          hint: `${modKey()}+Shift+L`,
          run: () => e?.toggleLockSelection(),
        },
        {
          label: t(locale, 'ctxInfo'),
          run: () => {
            const i = e?.shapeInfo(shapeId);
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
        <canvas ref={canvasRef} aria-label={t(locale, 'board')} />
        <PageBar locale={locale} />
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
        {editGraph && engine && (
          <GraphEditor
            target={editGraph}
            engine={engine}
            onDone={() => setEditGraph(null)}
          />
        )}
        {exportState && engine && (
          <ExportDialog
            locale={locale}
            engine={engine}
            initialSource={exportState.source}
            rect={exportState.rect}
            hasSelection={selectionCount > 0}
            onPickAgain={() => {
              setExportState(null);
              engineRef.current?.beginExportPick();
            }}
            onClose={() => setExportState(null)}
          />
        )}
      </div>

      <header className="file-bar">
        <div className="island file-island">
          {editingName ? (
            <input
              className="brand-edit"
              value={boardTitle}
              autoFocus
              maxLength={40}
              aria-label={t(locale, 'renameBoard')}
              onChange={(e) => setBoardTitle(e.target.value)}
              onBlur={() => {
                writeBoardName(boardTitle);
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  writeBoardName(boardTitle);
                  setEditingName(false);
                }
                if (e.key === 'Escape') {
                  setBoardTitle(getBoardName());
                  setEditingName(false);
                }
              }}
              onKeyUp={(e) => e.stopPropagation()}
            />
          ) : (
            <button
              type="button"
              className="brand"
              title={t(locale, 'renameBoard')}
              onClick={() => setEditingName(true)}
            >
              {boardTitle}
            </button>
          )}
          <div className="island-sep" />
          <button type="button" className="icon-btn" title={t(locale, 'undo')} aria-label={t(locale, 'undo')} disabled={!canUndo} onClick={() => undoManager.undo()}>
            <Icon name="undo" />
          </button>
          <button type="button" className="icon-btn" title={t(locale, 'redo')} aria-label={t(locale, 'redo')} disabled={!canRedo} onClick={() => undoManager.redo()}>
            <Icon name="redo" />
          </button>
          <div className="island-sep" />
          <button type="button" className="icon-btn" title={t(locale, 'zoomOut')} aria-label={t(locale, 'zoomOut')} onClick={() => engine?.zoomBy(1 / 1.2)}>
            <Icon name="minus" />
          </button>
          <button type="button" className="zoom-value" title={t(locale, 'zoomReset')} aria-label={t(locale, 'zoomReset')} onClick={() => engine?.resetZoom()}>
            {zoom}%
          </button>
          <button type="button" className="icon-btn" title={t(locale, 'zoomIn')} aria-label={t(locale, 'zoomIn')} onClick={() => engine?.zoomBy(1.2)}>
            <Icon name="plus" />
          </button>
          <button type="button" className="icon-btn" title={t(locale, 'fit')} aria-label={t(locale, 'fit')} onClick={() => engine?.fitContent()}>
            <Icon name="fit" />
          </button>
        </div>
        <div className="island meta-island">
          {errorShown && errorView && (
            <button
              type="button"
              className={`error-banner${error ? '' : ' is-leaving'}`}
              onClick={() => setError(null)}
              title={t(locale, 'errorHint')}
              aria-label={t(locale, 'errorHint')}
            >
              {t(locale, 'error')}: {errorView}
            </button>
          )}
          <span className="shape-count" title={t(locale, 'objectsCount')} aria-label={`${shapeCount}`}>
            {shapeCount}
          </span>
          <Presence locale={locale} online={sync.online} names={peers.map((p) => p.name)} />
          <div className="island-sep" />
          <button
            type="button"
            className={`icon-btn${settingsOpen ? ' is-open' : ''}`}
            title={t(locale, 'settings')}
            aria-label={t(locale, 'settings')}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}
          >
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
      <AlignBar engine={engine} locale={locale} selectionCount={selectionCount} totalCount={shapeCount} />

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
        onExport={() => {
          const e = engineRef.current;
          if (!e) return;
          if (selectionCount > 0 && e.selectionBounds()) {
            setExportState({ source: 'selection', rect: null });
          } else {
            const box = e.contentBox();
            if (!box) {
              e.beginExportPick();
            } else {
              setExportState({ source: 'all', rect: null });
            }
          }
        }}
      />

      <SettingsSheet
        open={settingsOpen}
        locale={locale}
        chromeTheme={chromeTheme}
        bg={bg}
        gridOn={gridOn}
        sync={sync}
        saved={saved}
        nick={nick}
        onNick={(value) => saveUser(value)}
        onLocale={setLocale}
        onChromeTheme={setChromeTheme}
        onBg={(value) => setMeta({ bg: value })}
        onGrid={(on) => setMeta({ grid: on })}
        onClose={() => setSettingsOpen(false)}
      />

      {menuShown && menuView && (
        <div
          className={`ctx-menu${menu ? '' : ' is-leaving'}`}
          style={{ left: menuX, top: menuY }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menuItems.map((item, index) => (
            <button
              type="button"
              key={item.label}
              className={`ctx-item${item.danger ? ' danger' : ''}`}
              style={{ animationDelay: `${index * 18}ms` }}
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
      {infoShown && infoView && (
        <div className={`info-modal${info ? '' : ' is-leaving'}`}>
          <div className="info-head">
            <b>{infoView.title}</b>
            <button type="button" className="icon-btn" title={t(locale, 'close')} aria-label={t(locale, 'close')} onClick={() => setInfo(null)}>
              <Icon name="close" />
            </button>
          </div>
          {infoView.lines.map((line) => (
            <div key={line} className="info-line">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
