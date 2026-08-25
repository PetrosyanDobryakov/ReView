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
import type { AlignKind } from './core/align';
import { Icon } from './ui/icons';
import { modKey, t, type MessageKey } from './ui/i18n';
import { destroyProvider, meta, metaBg, metaGrid, viewPaperBg, onSyncStatus, persistence, setMeta, undoManager, initBoard, enableBoardPersistence } from './core/store';
import { readPrefs, writePrefs } from './core/prefs';
import type { SyncStatus } from './core/store';
import { onSettingsChange, settings } from './core/settings';
import { getBoard, renameBoard, saveBoardLocally, isBoardPersistedLocally } from './core/boards';
import { fileToDocPages } from './core/docImport';
import { readChromeTheme, type ChromeThemeId } from './core/chromeTheme';
import { applyLocale, readLocale, type LocaleId } from './core/locale';
import { loadUser, onUserChange, saveUser } from './core/user';
import { getProvider, onPeers, publishPresence, onPageChange } from './core/store';
import type { PeerCursor } from './core/store';
import { MOTION, useExitPresence } from './ui/motion';

type BoardMenu = { x: number; y: number; shapeId: string | null; type: string | null; locked: boolean };

type MenuItem = { label: string; hint?: string; danger?: boolean; holdMs?: number; run: () => void };

const UNLOCK_HOLD_MS = 800;

function HoldCtxItem({
  item,
  index,
  onDone,
}: {
  item: MenuItem;
  index: number;
  onDone: () => void;
}) {
  const [filling, setFilling] = useState(false);
  const timer = useRef<number | null>(null);
  const stop = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    setFilling(false);
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      className={`ctx-item ctx-item-hold${item.danger ? ' danger' : ''}`}
      style={{ animationDelay: `${index * 18}ms` }}
      onPointerDown={() => {
        stop();
        setFilling(true);
        timer.current = window.setTimeout(() => {
          timer.current = null;
          onDone();
        }, item.holdMs!);
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onDone();
        }
      }}
    >
      <span
        className="hold-fill"
        style={{
          transitionDuration: filling ? `${item.holdMs}ms` : '80ms',
          width: filling ? '100%' : '0%',
        }}
      />
      <span>{item.label}</span>
      {item.hint && <span className="ctx-hint">{item.hint}</span>}
    </button>
  );
}

export default function App({ boardId, onBack }: { boardId: string; onBack: () => void }) {
  // init per-board store synchronously before any hooks that use it
  initBoard(boardId);
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
  const [bg, setBg] = useState(() => viewPaperBg());
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
  const boardMeta = getBoard(boardId);
  const [boardTitle, setBoardTitle] = useState(() => boardMeta?.name ?? 'ReView');
  const [editingName, setEditingName] = useState(false);
  const [ephemeral, setEphemeral] = useState(() => !isBoardPersistedLocally(getBoard(boardId)));
  useEffect(() => {
    const m = getBoard(boardId);
    if (m) setBoardTitle(m.name);
    setEphemeral(!isBoardPersistedLocally(m));
  }, [boardId]);
  const fileRef = useRef<HTMLInputElement>(null);
  const menuHold = useRef<BoardMenu | null>(null);
  const infoHold = useRef<{ title: string; lines: string[] } | null>(null);
  const errorHold = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFile = (file: File, at?: { x: number; y: number }) => {
    const e = engineRef.current;
    if (!e) return;
    if (file.type.startsWith('image/')) {
      e.insertImageFile(file, at);
      return;
    }
    const name = file.name.toLowerCase();
    const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
    const isTxt =
      name.endsWith('.txt') || file.type === 'text/plain' || file.type.startsWith('text/');
    if (!isPdf && !isTxt) {
      setError(t(readLocale(), 'docFailed'));
      return;
    }
    const locale = readLocale();
    fileToDocPages(file)
      .then(({ pages, ratio }) => {
        if (!pages.length) {
          setError(t(locale, 'docFailed'));
          return;
        }
        e.addDocument(pages, ratio, at);
      })
      .catch(() => setError(t(locale, 'docFailed')));
  };
  const handleFileRef = useRef(handleFile);
  handleFileRef.current = handleFile;

  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth++;
      setDragOver(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const onDragLeave = () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragOver(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const engine = engineRef.current;
      const at = engine ? engine.worldAtClient(e.clientX, e.clientY) : undefined;
      handleFileRef.current(file, at);
    };
    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  if (menu) menuHold.current = menu;
  if (info) infoHold.current = info;
  if (error) errorHold.current = error;

  const refreshSelected = () => setSelected(engineRef.current?.selectedViews() ?? []);

  useEffect(() => {
    applyLocale(locale);
    document.title = boardTitle ? `${boardTitle} — ReView` : t(locale, 'title');
  }, [locale, boardTitle]);

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
  }, [boardId]);

  useEffect(() => onPageChange(() => engineRef.current?.resetToPage()), [boardId]);

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
    const curPersist = persistence;
    const curMeta = meta;
    const curUndo = undoManager;
    const onSynced = () => setSaved(true);
    if (!curPersist) {
      setSaved(false);
    } else if ((curPersist as unknown as { synced: boolean }).synced) {
      setSaved(true);
    } else {
      curPersist.on('synced', onSynced);
    }
    const offSettings = onSettingsChange(() => {
      setPen({ ...settings.pen });
      setShape({ ...settings.shape });
      setText({ ...settings.text });
      setEraser({ ...settings.eraser });
    });
    const onMeta = () => {
      // Paper is local once chosen; until then follow synced meta.
      if (readPrefs().paperBg == null) setBg(metaBg());
      setGridOn(metaGrid());
    };
    curMeta.observe(onMeta);
    const offSync = onSyncStatus(setSync);
    const syncUndo = () => {
      setCanUndo(curUndo.undoStack.length > 0);
      setCanRedo(curUndo.redoStack.length > 0);
    };
    syncUndo();
    curUndo.on('stack-item-added', syncUndo);
    curUndo.on('stack-item-popped', syncUndo);
    curUndo.on('stack-cleared', syncUndo);
    return () => {
      if (curPersist) try { curPersist.off('synced', onSynced); } catch {}
      offSettings();
      try { curMeta.unobserve(onMeta); } catch {}
      offSync();
      curUndo.off('stack-item-added', syncUndo);
      curUndo.off('stack-item-popped', syncUndo);
      curUndo.off('stack-cleared', syncUndo);
      engine.destroy();
      engineRef.current = null;
      destroyProvider();
    };
  }, [boardId]);

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

      const menuItems: MenuItem[] = [];
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
      );
      const selViews = [...(e?.selection ?? [])]
        .map((id) => e?.views.get(id))
        .filter((v): v is ShapeView => Boolean(v));
      const others = shapeCount - selViews.length;
      const canAlign = others > 0;
      const canDistribute = selViews.length >= 3;
      if (canAlign) {
        const alignKinds: Array<[MessageKey, AlignKind]> = [
          ['alignLeft', 'left'],
          ['alignCenterH', 'centerH'],
          ['alignRight', 'right'],
          ['alignTop', 'top'],
          ['alignCenterV', 'centerV'],
          ['alignBottom', 'bottom'],
        ];
        for (const [key, kind] of alignKinds) {
          menuItems.push({ label: t(locale, key), run: () => e?.alignSelection(kind) });
        }
      }
      if (canDistribute) {
        menuItems.push(
          { label: t(locale, 'distributeH'), run: () => e?.alignSelection('distributeH') },
          { label: t(locale, 'distributeV'), run: () => e?.alignSelection('distributeV') },
        );
      }
      const anyUnlocked = selViews.some((v) => !v.locked);
      const allLocked = selViews.length > 0 && selViews.every((v) => v.locked);
      menuItems.push(
        {
          label: anyUnlocked ? t(locale, 'ctxLock') : t(locale, 'ctxUnlock'),
          hint: allLocked ? t(locale, 'holdHint') : `${modKey()}+Shift+L`,
          holdMs: allLocked ? UNLOCK_HOLD_MS : undefined,
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
          <button type="button" className="icon-btn" title={t(locale, 'home')} aria-label={t(locale, 'home')} onClick={onBack}>
            <Icon name="home" />
          </button>
          <div className="island-sep" />
          {editingName ? (
            <input
              className="brand-edit"
              value={boardTitle}
              autoFocus
              maxLength={40}
              aria-label={t(locale, 'renameBoard')}
              onChange={(e) => setBoardTitle(e.target.value)}
              onBlur={() => {
                const v = boardTitle.trim().slice(0, 40) || 'ReView';
                renameBoard(boardId, v);
                setBoardTitle(v);
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  const v = boardTitle.trim().slice(0, 40) || 'ReView';
                  renameBoard(boardId, v);
                  setBoardTitle(v);
                  setEditingName(false);
                }
                if (e.key === 'Escape') {
                  setBoardTitle(getBoard(boardId)?.name ?? 'ReView');
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
          {ephemeral && (
            <>
              <div className="island-sep" />
              <button
                type="button"
                className="style-btn active save-board-btn"
                title={t(locale, 'saveBoardHint')}
                aria-label={t(locale, 'saveBoard')}
                onClick={() => {
                  saveBoardLocally(boardId);
                  enableBoardPersistence();
                  setEphemeral(false);
                  setSaved(true);
                }}
              >
                {t(locale, 'saveBoard')}
              </button>
            </>
          )}
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
        editing={!!editTarget}
        editTarget={editTarget}
        onPatched={refreshSelected}
        onEditStyle={(patch) => setEditTarget((cur) => (cur ? { ...cur, ...patch } : null))}
      />
      <AlignBar engine={engine} locale={locale} selectionCount={selectionCount} totalCount={shapeCount} />

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.pdf,application/pdf,.txt,text/plain"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) handleFileRef.current(file);
        }}
      />

      {dragOver && (
        <div className="drop-overlay" aria-hidden="true">
          <span>{t(locale, 'dropHint')}</span>
        </div>
      )}

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
        ephemeral={ephemeral}
        onNick={(value) => saveUser(value)}
        onLocale={setLocale}
        onChromeTheme={setChromeTheme}
        onBg={(value) => {
          writePrefs({ paperBg: value });
          setBg(value);
        }}
        onGrid={(on) => setMeta({ grid: on })}
        onClose={() => setSettingsOpen(false)}
      />

      {menuShown && menuView && (
        <div
          className={`ctx-menu${menu ? '' : ' is-leaving'}`}
          style={{ left: menuX, top: menuY }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menuItems.map((item, index) =>
            item.holdMs ? (
              <HoldCtxItem key={item.label} item={item} index={index} onDone={() => { item.run(); closeMenu(); }} />
            ) : (
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
            )
          )}
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
