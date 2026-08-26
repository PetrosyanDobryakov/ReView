import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Engine } from './engine/Engine';
import type { EditTarget, GraphEditTarget } from './engine/Engine';
import type { ToolId } from './engine/tools';
import type { ShapeView } from './core/shapes';
import { Toolbar } from './ui/Toolbar';
import { SettingsSheet } from './ui/SettingsSheet';
import { MembersMenu } from './ui/MembersMenu';
import { StyleBar } from './ui/StyleBar';
import { TextOverlay } from './ui/TextOverlay';
import { GraphEditor } from './ui/GraphEditor';
import { PageBar } from './ui/PageBar';
import { ExportDialog } from './ui/ExportDialog';
import type { ExportSource } from './ui/ExportDialog';
import type { ShapeBox } from './core/shapes';
import type { AlignKind } from './core/align';
import { Icon } from './ui/icons';
import { modKey, t, type MessageKey } from './ui/i18n';
import {
  pauseBoardView,
  meta,
  metaBg,
  metaGrid,
  metaTitle,
  metaOwnerId,
  viewPaperBg,
  persistence,
  setMeta,
  undoManager,
  initBoard,
  enableBoardPersistence,
  onActivePageChange,
  onBoardReady,
  currentPageId,
} from './core/store';
import {
  onSyncStatus,
  onPeers,
  peerRosterKey,
  publishPresence,
  publishTool,
  publishPage,
  publishBoardView,
  onSyncLifecycle,
  type SyncStatus,
  type PeerCursor,
} from './net';
import { readPrefs, writePrefs, onPrefsChange } from './core/prefs';
import { onSettingsChange, settings } from './core/settings';
import { getBoard, saveBoardLocally, isBoardPersistedLocally, boardUrl } from './core/boards';
import { cloneBoard } from './core/boardClone';
import {
  boardRenameMode,
  commitBoardRename,
  displayBoardTitle,
  mirrorSyncedTitle,
  reconcileBoardTitleOnOpen,
  usesLocalBoardName,
} from './core/boardTitle';
import { fileToDocPages } from './core/docImport';
import { readChromeTheme, type ChromeThemeId } from './core/chromeTheme';
import { applyLocale, readLocale, type LocaleId } from './core/locale';
import { loadUser, onUserChange, saveUser } from './core/user';
import { MOTION, useExitPresence } from './ui/motion';
import { readLiveFormat, type LiveTextFormat } from './core/textEditorFormat';
import { JoinSavePrompt } from './ui/JoinSavePrompt';
import { navigateThemed } from './ui/navTransition';
import { isOrbitPaper } from './core/orbit';
import { applyOrbitToolDefaults, restoreOrbitToolDefaults } from './core/orbitDraw';

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
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<Engine | null>(null);
  const [tool, setTool] = useState<ToolId>('select');
  const [selectionCount, setSelectionCount] = useState(0);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const [selected, setSelected] = useState<ShapeView[]>([]);
  const [zoom, setZoom] = useState(100);
  const [shapeCount, setShapeCount] = useState(0);
  const [saved, setSaved] = useState(false);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [editLiveFormat, setEditLiveFormat] = useState<LiveTextFormat | null>(null);
  const textEditorRef = useRef<HTMLDivElement | null>(null);
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
  const [sync, setSync] = useState<SyncStatus>({ online: false, users: 0, enabled: true });
  const [menu, setMenu] = useState<BoardMenu | null>(null);
  const [info, setInfo] = useState<{ title: string; lines: string[] } | null>(null);
  const [chromeTheme, setChromeTheme] = useState<ChromeThemeId>(() => readChromeTheme());
  const [locale, setLocale] = useState<LocaleId>(() => readLocale());
  const [nick, setNick] = useState(() => loadUser().name);
  const [peers, setPeers] = useState<PeerCursor[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocus, setSettingsFocus] = useState<'connection' | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const boardMeta = getBoard(boardId);
  const [boardTitle, setBoardTitle] = useState(() => {
    const m = getBoard(boardId);
    return displayBoardTitle(m, null, m?.name ?? 'ReView');
  });
  const [boardOwnerId, setBoardOwnerId] = useState<string | null>(() => metaOwnerId());
  const [renameMode, setRenameMode] = useState(() => boardRenameMode(getBoard(boardId), metaOwnerId()));
  const [editingName, setEditingName] = useState(false);
  const [ephemeral, setEphemeral] = useState(() => !isBoardPersistedLocally(getBoard(boardId)));
  const [joinPrompt, setJoinPrompt] = useState(false);
  const [hostOffline, setHostOffline] = useState(false);
  const syncWasOnline = useRef(false);
  useEffect(() => {
    const m = getBoard(boardId);
    if (m) setBoardTitle(displayBoardTitle(m, metaTitle(), m.name));
    setBoardOwnerId(metaOwnerId());
    setRenameMode(boardRenameMode(m, metaOwnerId()));
    setEphemeral(!isBoardPersistedLocally(m));
    syncWasOnline.current = false;
    setHostOffline(false);
  }, [boardId]);

  useEffect(() => {
    const m = getBoard(boardId);
    if (!isBoardPersistedLocally(m)) {
      try {
        if (!sessionStorage.getItem(`review-join-prompt-${boardId}`)) {
          setJoinPrompt(true);
        }
      } catch {
        setJoinPrompt(true);
      }
    } else {
      setJoinPrompt(false);
    }
  }, [boardId]);

  useEffect(() => {
    if (!ephemeral || !sync.enabled) return;
    const timer = window.setTimeout(() => {
      setHostOffline((prev) => prev || !syncWasOnline.current);
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [boardId, ephemeral, sync.enabled]);

  useEffect(() => {
    if (sync.online) {
      syncWasOnline.current = true;
      setHostOffline(false);
    } else if (syncWasOnline.current && ephemeral) {
      setHostOffline(true);
    }
  }, [sync.online, ephemeral]);

  const dismissJoinPrompt = () => {
    try {
      sessionStorage.setItem(`review-join-prompt-${boardId}`, '1');
    } catch {
      /* ignore */
    }
    setJoinPrompt(false);
  };

  const handleKeepOnDevice = () => {
    saveBoardLocally(boardId);
    enableBoardPersistence();
    setEphemeral(false);
    setSaved(true);
    setHostOffline(false);
    setRenameMode(boardRenameMode(getBoard(boardId), boardOwnerId));
    dismissJoinPrompt();
  };

  const handleSaveAsMyBoard = () => {
    void cloneBoard(boardId).then((copy) => {
      if (!copy) {
        setError(t(readLocale(), 'error'));
        return;
      }
      dismissJoinPrompt();
      navigateThemed(navigate, boardUrl(copy.id));
    });
  };

  useEffect(() => {
    const onReady = () => {
      const title = reconcileBoardTitleOnOpen(boardId, boardMeta?.name ?? 'ReView');
      setBoardTitle(title);
      setBoardOwnerId(metaOwnerId());
      setRenameMode(boardRenameMode(getBoard(boardId), metaOwnerId()));
    };
    onReady();
    return onBoardReady(onReady);
  }, [boardId, boardMeta?.name]);

  useEffect(() => {
    return onPrefsChange(() => {
      const m = getBoard(boardId);
      if (m && isBoardPersistedLocally(m)) {
        enableBoardPersistence();
        setEphemeral(false);
        setSaved(true);
      }
    });
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
      .then(({ pages, ratio, truncated }) => {
        if (!pages.length) {
          setError(t(locale, 'docFailed'));
          return;
        }
        e.addDocument(pages, ratio, at);
        if (truncated) setError(t(locale, 'docTruncated'));
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
    publishPresence(loadUser());
    publishTool(tool);
    publishPage(currentPageId());
    publishBoardView(!document.hidden);
    const offUser = onUserChange((u) => {
      setNick(u.name);
      publishPresence(u);
    });
    const offLife = onSyncLifecycle(() => {
      publishPresence(loadUser());
      publishTool(engineRef.current?.tool.id ?? 'select');
      publishPage(currentPageId());
      publishBoardView(!document.hidden);
    });
    const onVisibility = () => {
      // Alt-tab / minimize: freeze cursor at last pose, do not clear awareness.
      publishBoardView(!document.hidden);
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      offUser();
      offLife();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [boardId]);

  useEffect(() => {
    let roster = '';
    const pushEngine = (list: PeerCursor[]) => {
      engineRef.current?.setPeers(list);
    };
    const offPeers = onPeers((list) => {
      pushEngine(list);
      const next = peerRosterKey(list);
      if (next === roster) return;
      roster = next;
      setPeers(list);
    });
    const offPage = onActivePageChange(() => {
      publishPage(currentPageId());
    });
    return () => {
      offPeers();
      offPage();
    };
  }, [boardId]);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.events.onExportRegion = (rect) => {
      if (!rect) return;
      setExportState({ source: 'region', rect });
    };
  }, []);

  useEffect(() => {
    // Re-init if leaveBoard nulled the id (Strict Mode remount / HMR).
    initBoard(boardId);
    setEphemeral(!persistence);
    if (isOrbitPaper(viewPaperBg()) || isOrbitPaper(readPrefs().paperBg ?? '')) {
      applyOrbitToolDefaults();
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const engine = new Engine(canvas);
    engineRef.current = engine;
    engine.events.onSelection = (ids) => {
      setSelectionCount(ids.length);
      setSelectionRevision((n) => n + 1);
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
    engine.events.onEditText = (target) => {
      setEditLiveFormat(null);
      setEditTarget(target);
    };
    engine.events.onEditGraph = (target) => setEditGraph(target);
    engine.events.onError = (message) => setError(message);
    const reload = () => {
      engine.ensureStoreBound();
      engine.resetToPage();
    };
    const offBoardReady = onBoardReady(reload);
    if ((persistence as unknown as { synced?: boolean } | null)?.synced) reload();
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
      const m = getBoard(boardId);
      const ownerId = metaOwnerId();
      setBoardOwnerId(ownerId);
      setRenameMode(boardRenameMode(m, ownerId));
      const synced = metaTitle();
      if (synced && m && !usesLocalBoardName(m)) {
        mirrorSyncedTitle(boardId, synced);
        setBoardTitle(displayBoardTitle(m, synced, m.name));
      }
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
      offBoardReady();
      if (curPersist) try { curPersist.off('synced', onSynced); } catch {}
      offSettings();
      try { curMeta.unobserve(onMeta); } catch {}
      offSync();
      curUndo.off('stack-item-added', syncUndo);
      curUndo.off('stack-item-popped', syncUndo);
      curUndo.off('stack-cleared', syncUndo);
      engine.destroy();
      engineRef.current = null;
      pauseBoardView();
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
        {editTarget && engine && (
          <TextOverlay
            target={editTarget}
            engine={engine}
            editorRef={(el) => {
              textEditorRef.current = el;
            }}
            onFormatChange={setEditLiveFormat}
            onDone={(value, html) => {
              engine.commitText(editTarget.id, value, editTarget, html);
              setEditTarget(null);
              setEditLiveFormat(null);
              textEditorRef.current = null;
            }}
            onCancel={() => {
              engine.cancelTextEdit();
              setEditTarget(null);
              setEditLiveFormat(null);
              textEditorRef.current = null;
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
            selectionRevision={selectionRevision}
            shapeRevision={shapeCount}
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
          {editingName && renameMode ? (
            <input
              className="brand-edit"
              value={boardTitle}
              autoFocus
              maxLength={40}
              aria-label={t(locale, 'renameBoard')}
              onChange={(e) => setBoardTitle(e.target.value)}
              onBlur={() => {
                const v = commitBoardRename(boardId, boardTitle, boardOwnerId, boardMeta?.name ?? 'ReView');
                setBoardTitle(v);
                setEditingName(false);
              }}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') {
                  const v = commitBoardRename(boardId, boardTitle, boardOwnerId, boardMeta?.name ?? 'ReView');
                  setBoardTitle(v);
                  setEditingName(false);
                }
                if (e.key === 'Escape') {
                  const m = getBoard(boardId);
                  setBoardTitle(displayBoardTitle(m, metaTitle(), m?.name ?? 'ReView'));
                  setEditingName(false);
                }
              }}
              onKeyUp={(e) => e.stopPropagation()}
            />
          ) : (
            <button
              type="button"
              className="brand"
              title={renameMode ? t(locale, 'renameBoard') : t(locale, 'boardTitleReadOnly')}
              onClick={() => {
                if (renameMode) setEditingName(true);
              }}
              style={renameMode ? undefined : { cursor: 'default' }}
            >
              {boardTitle}
            </button>
          )}
          <div className="island-sep" />
          <PageBar locale={locale} />
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
                title={t(locale, 'keepOnDeviceHint')}
                aria-label={t(locale, 'keepOnDevice')}
                onClick={handleKeepOnDevice}
              >
                {t(locale, 'keepOnDevice')}
              </button>
            </>
          )}
        </div>
        <div className="island meta-island">
          {hostOffline && ephemeral && (
            <button
              type="button"
              className="host-offline-banner"
              title={t(locale, 'keepOnDeviceHint')}
              onClick={handleKeepOnDevice}
            >
              <span>{t(locale, 'hostOfflineBanner')}</span>
              <span className="host-offline-cta">{t(locale, 'keepOnDevice')}</span>
            </button>
          )}
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
          <MembersMenu
            locale={locale}
            boardId={boardId}
            online={sync.online}
            syncEnabled={sync.enabled}
            peers={peers}
            onOpenConnection={() => {
              setSettingsFocus('connection');
              setSettingsOpen(true);
            }}
          />
          <div className="island-sep" />
          <button
            type="button"
            className={`icon-btn${settingsOpen ? ' is-open' : ''}`}
            title={t(locale, 'settings')}
            aria-label={t(locale, 'settings')}
            aria-expanded={settingsOpen}
            onClick={() => {
              setSettingsFocus(null);
              setSettingsOpen(true);
            }}
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
        editLiveFormat={editLiveFormat}
        getTextEditor={() => textEditorRef.current}
        onPatched={refreshSelected}
        onEditStyle={(patch) => setEditTarget((cur) => (cur ? { ...cur, ...patch } : null))}
        onRemeasureText={(ids) => engineRef.current?.remeasureTextShapes(ids)}
        onSyncEditFormat={(root, fallback) => setEditLiveFormat(readLiveFormat(root, fallback))}
      />
      {/* ponytail: removed align panel from top per user — was broken in Orbit and unwanted */}
      {/* <AlignBar engine={engine} locale={locale} selectionCount={selectionCount} totalCount={shapeCount} /> */}

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
          const wasOrbit = isOrbitPaper(bg);
          const nextOrbit = isOrbitPaper(value);
          writePrefs({ paperBg: value });
          setBg(value);
          if (nextOrbit && !wasOrbit) applyOrbitToolDefaults();
          else if (!nextOrbit && wasOrbit) restoreOrbitToolDefaults();
        }}
        onGrid={(on) => setMeta({ grid: on })}
        focusSection={settingsFocus}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsFocus(null);
        }}
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
      {joinPrompt && (
        <JoinSavePrompt
          locale={locale}
          onKeepOnDevice={handleKeepOnDevice}
          onSaveAsMyBoard={handleSaveAsMyBoard}
          onLater={dismissJoinPrompt}
        />
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
