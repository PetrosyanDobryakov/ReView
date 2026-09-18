import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Engine } from './engine/Engine';
import type { EditTarget, GraphEditTarget, CalculatorEditTarget } from './engine/Engine';
import type { ToolId } from './engine/tools';
import type { ShapeView } from './core/shapes';
import { Toolbar } from './ui/Toolbar';
import { SettingsSheet } from './ui/SettingsSheet';
import { MembersMenu } from './ui/MembersMenu';
import { StyleBar } from './ui/StyleBar';
import { TextOverlay } from './ui/TextOverlay';
import { GraphEditor } from './ui/GraphEditor';
import { CalculatorPanel } from './ui/CalculatorPanel';
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
  getCurrentBoardId,
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
import { getBoard, saveBoardLocally, isBoardPersistedLocally, boardUrl, recordBoardVisit } from './core/boards';
import { cloneBoard } from './core/boardClone';
import { exportBoardFile, importBoardFile, importErrorI18nKey } from './core/boardShare';
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
import { flushOpenTextEditor, persistOpenEditors, readLiveFormat, type LiveTextFormat } from './core/textEditorFormat';
import { JoinSavePrompt } from './ui/JoinSavePrompt';
import { navigateThemed } from './ui/navTransition';
import { isOrbitPaper } from './core/orbit';
import { applyOrbitToolDefaults, restoreOrbitToolDefaults } from './core/orbitDraw';
import { loadCamera, saveCamera } from './core/cameraStore';

type BoardMenu = { x: number; y: number; shapeId: string | null; type: string | null; locked: boolean };

type MenuAction = {
  kind?: 'action';
  label: string;
  hint?: string;
  danger?: boolean;
  holdMs?: number;
  run: () => void;
};
type MenuSeparator = { kind: 'separator' };
type MenuSubmenu = { kind: 'submenu'; label: string; children: MenuAction[] };
type MenuEntry = MenuAction | MenuSeparator | MenuSubmenu;

const UNLOCK_HOLD_MS = 800;

function HoldCtxItem({
  item,
  index,
  onDone,
}: {
  item: MenuAction;
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

function pushSep(entries: MenuEntry[]): void {
  if (entries.length === 0) return;
  const last = entries[entries.length - 1];
  if (last && last.kind === 'separator') return;
  entries.push({ kind: 'separator' });
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
  const editTargetRef = useRef<EditTarget | null>(null);
  useEffect(() => {
    editTargetRef.current = editTarget;
  }, [editTarget]);
  const [editGraph, setEditGraph] = useState<GraphEditTarget | null>(null);
  const [editCalc, setEditCalc] = useState<CalculatorEditTarget | null>(null);
  const [exportState, setExportState] = useState<{ source: ExportSource; rect: ShapeBox | null } | null>(null);
  const [pageEpoch, setPageEpoch] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
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
  const [ctxSubmenu, setCtxSubmenu] = useState<string | null>(null);
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
  // ponytail: UI-hide is session-only — H toggles, board switch/reload restores
  const [uiHidden, setUiHidden] = useState(false);
  const [zoomMenuOpen, setZoomMenuOpen] = useState(false);
  const fileBarRef = useRef<HTMLElement | null>(null);
  const fileIslandRef = useRef<HTMLDivElement | null>(null);
  const metaIslandRef = useRef<HTMLDivElement | null>(null);
  const zoomClusterRef = useRef<HTMLSpanElement | null>(null);
  const zoomOverflowRef = useRef<HTMLSpanElement | null>(null);
  const zoomCollapsedRef = useRef(false);
  const syncWasOnline = useRef(false);
  useEffect(() => {
    const m = getBoard(boardId);
    if (m) setBoardTitle(displayBoardTitle(m, metaTitle(), m.name));
    setBoardOwnerId(metaOwnerId());
    setRenameMode(boardRenameMode(m, metaOwnerId()));
    setEphemeral(!isBoardPersistedLocally(m));
    syncWasOnline.current = false;
    setHostOffline(false);
    setUiHidden(false);
    setZoomMenuOpen(false);
    recordBoardVisit(boardId);
  }, [boardId]);

  useEffect(() => {
    const bar = fileBarRef.current;
    const file = fileIslandRef.current;
    const meta = metaIslandRef.current;
    if (!bar || !file || !meta) return;

    const measure = () => {
      const narrow = window.matchMedia('(max-width: 720px)').matches;
      const tablet = window.matchMedia('(min-width: 721px) and (max-width: 1024px)').matches;
      let next = narrow;
      if (!narrow && tablet) {
        const fileRect = file.getBoundingClientRect();
        const metaRect = meta.getBoundingClientRect();
        const gap = metaRect.left - fileRect.right;
        const overflow = file.scrollWidth > file.clientWidth + 1;
        const clusterW = zoomClusterRef.current?.offsetWidth
          ?? zoomOverflowRef.current?.offsetWidth
          ?? 148;
        if (zoomCollapsedRef.current) {
          next = gap < 12 + clusterW;
        } else {
          next = gap < 12 || overflow;
        }
      }
      zoomCollapsedRef.current = next;
      if (next) bar.setAttribute('data-zoom-collapsed', 'true');
      else {
        bar.removeAttribute('data-zoom-collapsed');
        setZoomMenuOpen(false);
      }
    };

    const ro = new ResizeObserver(measure);
    ro.observe(bar);
    ro.observe(file);
    ro.observe(meta);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [boardTitle, hostOffline, ephemeral, error, zoom]);

  useEffect(() => {
    if (!zoomMenuOpen) return;
    const onPointer = (e: PointerEvent) => {
      const root = zoomOverflowRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      setZoomMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setZoomMenuOpen(false);
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [zoomMenuOpen]);

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
    commitOpenEditors();
    void cloneBoard(boardId)
      .then((copy) => {
        if (!copy) {
          setError(t(readLocale(), 'error'));
          return;
        }
        dismissJoinPrompt();
        navigateThemed(navigate, boardUrl(copy.id));
      })
      .catch(() => {
        setError(t(readLocale(), 'error'));
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
    const name = file.name.toLowerCase();
    if (name.endsWith('.review')) {
      const locale = readLocale();
      void importBoardFile(file).then((res) => {
        if (res.ok) {
          setToast(t(locale, 'importSuccess'));
          window.setTimeout(() => setToast((cur) => (cur === t(locale, 'importSuccess') ? null : cur)), 2000);
          navigateThemed(navigate, boardUrl(res.board.id));
        } else {
          setError(t(locale, importErrorI18nKey(res.error)));
        }
      });
      return;
    }
    const e = engineRef.current;
    if (!e) return;
    if (file.type.startsWith('image/') || /\.(gif|png|jpe?g|webp)$/i.test(file.name)) {
      e.insertImageFile(file, at);
      return;
    }
    if (file.type.startsWith('video/') || /\.(mp4|webm|mov|ogv)$/i.test(file.name)) {
      e.insertVideoFile(file, at);
      return;
    }
    const isPdf = name.endsWith('.pdf') || file.type === 'application/pdf';
    const isTxt =
      name.endsWith('.txt') || file.type === 'text/plain' || file.type.startsWith('text/');
    if (!isPdf && !isTxt) {
      setError(t(readLocale(), 'docFailed'));
      return;
    }
    const locale = readLocale();
    const pos = at ?? { x: e.camera.x, y: e.camera.y };
    const pageId = currentPageId();
    const boardId = getCurrentBoardId();
    fileToDocPages(file)
      .then(({ pages, ratio, truncated }) => {
        if (getCurrentBoardId() !== boardId) return;
        const live = engineRef.current;
        if (!live?.alive) return;
        if (!pages.length) {
          setError(t(locale, 'docFailed'));
          return;
        }
        live.addDocument(pages, ratio, pos, pageId);
        if (truncated) setError(t(locale, 'docTruncated'));
      })
      .catch(() => {
        if (getCurrentBoardId() !== boardId) return;
        setError(t(locale, 'docFailed'));
      });
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
      // Alt-tab / minimize: keep last cursor in awareness (no wipe), remotes hide it via viewing=false.
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
    engine.events.onContextMenu = (m) => {
      setCtxSubmenu(null);
      setMenu(m);
    };
    engine.events.onInfo = (i) => setInfo(i);
    engine.events.onStats = (s) => {
      setZoom(Math.round(s.zoom * 100));
      setShapeCount(s.shapes);
    };
    engine.events.onTool = (id) => setTool(id);
    engine.events.onEditText = (target) => {
      editTargetRef.current = target;
      setEditLiveFormat(null);
      setEditTarget(target);
    };
    // ponytail: engine is replacing the open editor (dblclick another shape
    // while typing) — commit current text synchronously before it is lost.
    engine.events.onRequestCommitText = () => {
      const cur = editTargetRef.current;
      if (!cur) return;
      flushOpenTextEditor(engineRef.current, cur, textEditorRef.current);
      editTargetRef.current = null;
      setEditTarget(null);
      setEditLiveFormat(null);
      textEditorRef.current = null;
    };
    engine.events.onEditGraph = (target) => setEditGraph(target);
    engine.events.onEditCalculator = (target) => setEditCalc(target);
    engine.events.onExportRegion = (rect) => {
      if (!rect) return;
      setExportState({ source: 'region', rect });
    };
    engine.events.onError = (message) => setError(message);
    engine.events.onToast = (message) => {
      setToast(message);
      window.setTimeout(() => setToast((cur) => (cur === message ? null : cur)), 2000);
    };
    engine.events.onToggleUi = () => setUiHidden((v) => !v);
    // ponytail: remember viewport per board+page (localStorage), restore on enter
    const lastCameraKey = { v: '' };
    const persistCamera = () => {
      const e = engineRef.current;
      if (!e) return;
      const view = e.camera.getView();
      const k = `${view.x.toFixed(2)}:${view.y.toFixed(2)}:${view.zoom.toFixed(4)}`;
      if (k === lastCameraKey.v) return;
      lastCameraKey.v = k;
      saveCamera(boardId, currentPageId(), view);
    };
    const restoreCamera = (): boolean => {
      const saved = loadCamera(boardId, currentPageId());
      if (!saved) return false;
      engine.camera.setView(saved);
      engine.setDirty();
      lastCameraKey.v = `${saved.x.toFixed(2)}:${saved.y.toFixed(2)}:${saved.zoom.toFixed(4)}`;
      return true;
    };
    // restore immediately; defer fitContent fallback to after board sync
    restoreCamera();
    const cameraPersistTimer = window.setInterval(persistCamera, 500);
    const onPageHidePersist = () => {
      // Capture so this runs before main.tsx leaveBoard() destroys the Y.Doc.
      const { text } = persistOpenEditors(engineRef.current, editTargetRef.current, textEditorRef.current);
      if (text) {
        editTargetRef.current = null;
        textEditorRef.current = null;
      }
      persistCamera();
    };
    window.addEventListener('pagehide', onPageHidePersist, true);
    window.addEventListener('beforeunload', onPageHidePersist);
    let prevPageId = currentPageId();
    const onCameraPageChange = () => {
      // save previous page viewport
      try {
        const e = engineRef.current;
        if (e) {
          const v = e.camera.getView();
          saveCamera(boardId, prevPageId, v);
        }
      } catch {}
      prevPageId = currentPageId();
      publishPage(prevPageId);
      setPageEpoch((n) => n + 1);
      setExportState((s) => (s?.source === 'region' ? null : s));
      // restore new page viewport (or keep if no saved)
      if (!restoreCamera()) {
        // keep current camera — don't auto-fit and jump the user
      }
    };
    const onSynced = () => setSaved(true);
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
    let curPersist = persistence;
    let curMeta = meta;
    let curUndo = undoManager;
    let chromeBound = false;
    const syncUndo = () => {
      setCanUndo(curUndo.undoStack.length > 0);
      setCanRedo(curUndo.redoStack.length > 0);
    };
    const unbindChrome = () => {
      if (!chromeBound) return;
      const metaSnap = curMeta;
      const undoSnap = curUndo;
      const persistSnap = curPersist;
      if (persistSnap) try { persistSnap.off('synced', onSynced); } catch {}
      try { metaSnap.unobserve(onMeta); } catch {}
      try {
        undoSnap.off('stack-item-added', syncUndo);
        undoSnap.off('stack-item-popped', syncUndo);
        undoSnap.off('stack-cleared', syncUndo);
      } catch {}
      chromeBound = false;
    };
    const bindChrome = () => {
      unbindChrome();
      curMeta = meta;
      curUndo = undoManager;
      curPersist = persistence;
      setEphemeral(!curPersist);
      curMeta.observe(onMeta);
      curUndo.on('stack-item-added', syncUndo);
      curUndo.on('stack-item-popped', syncUndo);
      curUndo.on('stack-cleared', syncUndo);
      chromeBound = true;
      syncUndo();
      if (!curPersist) {
        setSaved(false);
      } else if ((curPersist as unknown as { synced: boolean }).synced) {
        setSaved(true);
      } else {
        curPersist.on('synced', onSynced);
      }
    };
    const reload = () => {
      bindChrome();
      engine.ensureStoreBound();
      engine.resetToPage();
      // after board sync, re-apply saved viewport for this page if any
      restoreCamera();
    };
    bindChrome();
    const offBoardReady = onBoardReady(reload);
    if ((persistence as unknown as { synced?: boolean } | null)?.synced) reload();
    const offCameraPage = onActivePageChange(onCameraPageChange);
    const offSettings = onSettingsChange(() => {
      setPen({ ...settings.pen });
      setShape({ ...settings.shape });
      setText({ ...settings.text });
      setEraser({ ...settings.eraser });
    });
    const offSync = onSyncStatus(setSync);
    return () => {
      persistCamera();
      flushOpenTextEditor(engine, editTargetRef.current, textEditorRef.current);
      engine.cancelGraphEditor();
      engine.closeCalculator();
      editTargetRef.current = null;
      setEditTarget(null);
      setEditLiveFormat(null);
      textEditorRef.current = null;
      setEditGraph(null);
      setEditCalc(null);
      setExportState(null);
      setCropActive(false);
      setCanCrop(false);
      setMenu(null);
      setInfo(null);
      setSelectionCount(0);
      setSelected([]);
      window.clearInterval(cameraPersistTimer);
      window.removeEventListener('pagehide', onPageHidePersist, true);
      window.removeEventListener('beforeunload', onPageHidePersist);
      offCameraPage();
      offBoardReady();
      unbindChrome();
      offSettings();
      offSync();
      engine.destroy();
      engineRef.current = null;
      pauseBoardView();
    };
  }, [boardId]);

  const handleTool = (id: ToolId) => {
    const engine = engineRef.current;
    const cur = editTargetRef.current;
    flushOpenTextEditor(engine, cur, textEditorRef.current);
    if (cur) {
      editTargetRef.current = null;
      setEditTarget(null);
      setEditLiveFormat(null);
      textEditorRef.current = null;
    }
    if (editGraph) {
      engine?.cancelGraphEditor();
      setEditGraph(null);
    }
    if (editCalc) {
      engine?.closeCalculator();
      setEditCalc(null);
    }
    setTool(id);
  };

  const commitOpenEditors = () => {
    const engine = engineRef.current;
    const cur = editTargetRef.current;
    const { graph } = persistOpenEditors(engine, cur, textEditorRef.current);
    if (cur) {
      editTargetRef.current = null;
      setEditTarget(null);
      setEditLiveFormat(null);
      textEditorRef.current = null;
    }
    if (graph) setEditGraph(null);
    if (editCalc) {
      engine?.closeCalculator();
      setEditCalc(null);
    }
  };

  useEffect(() => {
    engineRef.current?.setTool(tool);
  }, [tool]);

  const engine = engineRef.current;

  const dismissMenu = () => {
    engineRef.current?.setPasteAnchor(null);
    setCtxSubmenu(null);
    setMenu(null);
  };

  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      const el = document.querySelector('.ctx-menu');
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      dismissMenu();
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) {
        dismissMenu();
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
  const menuShown = useExitPresence(Boolean(menu), MOTION.overlay);
  const infoShown = useExitPresence(Boolean(info), MOTION.overlay);
  const errorShown = useExitPresence(Boolean(error), MOTION.enter);
  const menuView = menu ?? (menuShown ? menuHold.current : null);
  const infoView = info ?? (infoShown ? infoHold.current : null);
  const errorView = error ?? (errorShown ? errorHold.current : null);
  const menuPad = 8;
  const menuX = menuView
    ? Math.min(Math.max(menuPad, menuView.x), Math.max(menuPad, window.innerWidth - 240))
    : 0;
  // Leave a short visible strip; height is capped via --ctx-max-h + overflow scroll (Align expand).
  const menuY = menuView
    ? Math.min(Math.max(menuPad, menuView.y), Math.max(menuPad, window.innerHeight - 96))
    : 0;
  const menuMaxH = menuView
    ? Math.max(96, window.innerHeight - menuY - menuPad)
    : undefined;

  const menuEntries: MenuEntry[] = [];
  if (menuView) {
    const e = engine;
    if (menuView.shapeId) {
      const shapeId = menuView.shapeId;
      menuEntries.push(
        { label: t(locale, 'ctxCopy'), hint: `${modKey()}+C`, run: () => { commitOpenEditors(); e?.copySelection(); } },
        { label: t(locale, 'ctxCopyImage'), hint: `${modKey()}+Shift+C`, run: () => { commitOpenEditors(); e?.copySelectionAsImage(); } },
        { label: t(locale, 'ctxDuplicate'), hint: `${modKey()}+D`, run: () => { commitOpenEditors(); e?.duplicateSelection(); } },
        { label: t(locale, 'ctxDelete'), hint: 'Delete', danger: true, run: () => e?.deleteSelection() }
      );

      const typeExtras: MenuAction[] = [];
      if (menuView.type === 'image') {
        const view = engine?.views.get(shapeId);
        const cropped = Boolean(view && (view.cropW !== undefined || view.cropH !== undefined));
        typeExtras.push(
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
          typeExtras.push({
            label: t(locale, 'ctxResetCrop'),
            run: () => e?.resetCropSelected(),
          });
        }
      }
      if (menuView.type === 'video') {
        typeExtras.push(
          {
            label: t(locale, 'ctxVideoToggle'),
            run: () => {
              e?.setSelection([shapeId]);
              e?.toggleVideoSelected(shapeId);
            },
          },
          { label: t(locale, 'ctxDownload'), run: () => e?.downloadSelection() },
          { label: t(locale, 'ctxOriginal'), run: () => e?.scaleSelectionToOriginal() }
        );
      }
      if (menuView.type === 'pen') {
        typeExtras.push({ label: t(locale, 'ctxCsv'), run: () => e?.exportCsvSelection() });
      }
      if (menuView.type === 'table') {
        typeExtras.push(
          { label: t(locale, 'ctxTableAddRow'), run: () => e?.tableInsertRow(shapeId) },
          { label: t(locale, 'ctxTableAddCol'), run: () => e?.tableInsertCol(shapeId) },
          { label: t(locale, 'ctxTableDelRow'), danger: true, run: () => e?.tableRemoveRow(shapeId) },
          { label: t(locale, 'ctxTableDelCol'), danger: true, run: () => e?.tableRemoveCol(shapeId) },
          { label: t(locale, 'ctxTableHeader'), run: () => e?.tableToggleHeader(shapeId) }
        );
      }
      if (typeExtras.length) {
        pushSep(menuEntries);
        menuEntries.push(...typeExtras);
      }

      pushSep(menuEntries);
      menuEntries.push(
        { label: t(locale, 'ctxFront'), run: () => e?.bringFront() },
        { label: t(locale, 'ctxBack'), run: () => e?.sendBack() },
      );

      const selViews = [...(e?.selection ?? [])]
        .map((id) => e?.views.get(id))
        .filter((v): v is ShapeView => Boolean(v));
      const others = shapeCount - selViews.length;
      const unlockedSel = selViews.filter((v) => !v.locked);
      const canAlign = others > 0 || (selViews.length >= 2 && unlockedSel.length >= 1);
      const canDistribute = unlockedSel.length >= 3;
      if (canAlign) {
        const alignChildren: MenuAction[] = [];
        const alignKinds: Array<[MessageKey, AlignKind]> = [
          ['alignLeft', 'left'],
          ['alignCenterH', 'centerH'],
          ['alignRight', 'right'],
          ['alignTop', 'top'],
          ['alignCenterV', 'centerV'],
          ['alignBottom', 'bottom'],
        ];
        for (const [key, kind] of alignKinds) {
          alignChildren.push({ label: t(locale, key), run: () => e?.alignSelection(kind) });
        }
        if (canDistribute) {
          alignChildren.push(
            { label: t(locale, 'distributeH'), run: () => e?.alignSelection('distributeH') },
            { label: t(locale, 'distributeV'), run: () => e?.alignSelection('distributeV') },
          );
        }
        pushSep(menuEntries);
        menuEntries.push({ kind: 'submenu', label: t(locale, 'ctxAlign'), children: alignChildren });
      }

      pushSep(menuEntries);
      const anyUnlocked = selViews.some((v) => !v.locked);
      const allLocked = selViews.length > 0 && selViews.every((v) => v.locked);
      menuEntries.push(
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
      menuEntries.push({ label: t(locale, 'ctxPaste'), hint: 'Ctrl+V', run: () => void e?.pasteFromClipboard() });
    }
  }

  let menuAnimIndex = 0;
  const renderMenuAction = (item: MenuAction, key: string, nested = false) => {
    const index = menuAnimIndex++;
    if (item.holdMs) {
      return (
        <HoldCtxItem
          key={key}
          item={item}
          index={index}
          onDone={() => {
            item.run();
            dismissMenu();
          }}
        />
      );
    }
    return (
      <button
        type="button"
        key={key}
        role="menuitem"
        className={`ctx-item${item.danger ? ' danger' : ''}${nested ? ' ctx-item-nested' : ''}`}
        style={{ animationDelay: `${index * 18}ms` }}
        onClick={() => {
          item.run();
          dismissMenu();
        }}
      >
        <span>{item.label}</span>
        {item.hint && <span className="ctx-hint">{item.hint}</span>}
      </button>
    );
  };

  return (
    <div className={`app${settingsOpen ? ' settings-open' : ''}${uiHidden ? ' ui-hidden' : ''}`}>
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
              if (!editTargetRef.current) return;
              if (editTarget.tableCell && editTarget.id) {
                engine.commitTableCell(editTarget.id, editTarget.tableCell.row, editTarget.tableCell.col, value);
              } else {
                engine.commitText(editTarget.id, value, editTarget, html);
              }
              editTargetRef.current = null;
              setEditTarget(null);
              setEditLiveFormat(null);
              textEditorRef.current = null;
            }}
            onCellAdvance={(dir) => {
              const t = editTarget;
              if (!t.tableCell || !t.id) return;
              engineRef.current?.advanceTableCell(t.id, t.tableCell.row, t.tableCell.col, dir);
            }}
            onCancel={() => {
              engine.cancelTextEdit();
              editTargetRef.current = null;
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
        {editCalc && engine && (
          <CalculatorPanel
            target={editCalc}
            engine={engine}
            onDone={() => setEditCalc(null)}
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
            pageRevision={pageEpoch}
            onPickAgain={() => {
              setExportState(null);
              engineRef.current?.beginExportPick();
            }}
            onClose={() => setExportState(null)}
          />
        )}
      </div>

      {uiHidden && (
        <div className="ui-hidden-hint" role="status" aria-label={t(locale, 'showUi')}>
          {t(locale, 'showUi')}
        </div>
      )}
      <header className="file-bar" ref={fileBarRef}>
        <div className="island file-island" ref={fileIslandRef}>
          <button type="button" className="icon-btn" data-dismiss-edit title={t(locale, 'home')} aria-label={t(locale, 'home')} onClick={onBack}>
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
          <button
            type="button"
            className="icon-btn"
            data-keep-edit
            title={t(locale, 'undo')}
            aria-label={t(locale, 'undo')}
            disabled={!canUndo || Boolean(editTarget || editGraph || editCalc)}
            onClick={() => {
              if (engineRef.current?.editing) return;
              undoManager.undo();
              engineRef.current?.remeasureAfterHistory();
            }}
          >
            <Icon name="undo" />
          </button>
          <button
            type="button"
            className="icon-btn"
            data-keep-edit
            title={t(locale, 'redo')}
            aria-label={t(locale, 'redo')}
            disabled={!canRedo || Boolean(editTarget || editGraph || editCalc)}
            onClick={() => {
              if (engineRef.current?.editing) return;
              undoManager.redo();
              engineRef.current?.remeasureAfterHistory();
            }}
          >
            <Icon name="redo" />
          </button>
          <div className="island-sep" />
          <span className="file-zoom-cluster" ref={zoomClusterRef}>
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
            <div className="island-sep" />
          </span>
          <span className="file-zoom-overflow" ref={zoomOverflowRef}>
            <button
              type="button"
              className={`zoom-value file-zoom-overflow-btn${zoomMenuOpen ? ' is-open' : ''}`}
              title={t(locale, 'zoomMenu')}
              aria-label={t(locale, 'zoomMenu')}
              aria-haspopup="menu"
              aria-expanded={zoomMenuOpen}
              onClick={() => setZoomMenuOpen((v) => !v)}
            >
              {zoom}%
            </button>
            {zoomMenuOpen && (
              <div className="island file-zoom-menu" role="menu" aria-label={t(locale, 'zoomMenu')}>
                <button type="button" role="menuitem" className="menu-row" onClick={() => engine?.zoomBy(1 / 1.2)}>
                  <Icon name="minus" />
                  <span>{t(locale, 'zoomOut')}</span>
                </button>
                <button type="button" role="menuitem" className="menu-row" onClick={() => engine?.zoomBy(1.2)}>
                  <Icon name="plus" />
                  <span>{t(locale, 'zoomIn')}</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-row"
                  onClick={() => {
                    engine?.resetZoom();
                    setZoomMenuOpen(false);
                  }}
                >
                  <span>
                    {zoom}% — {t(locale, 'zoomResetShort')}
                  </span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-row"
                  onClick={() => {
                    engine?.fitContent();
                    setZoomMenuOpen(false);
                  }}
                >
                  <Icon name="fit" />
                  <span>{t(locale, 'fit')}</span>
                </button>
              </div>
            )}
            <div className="island-sep" />
          </span>
          <button
            type="button"
            className="icon-btn"
            data-commit-edit
            title={t(locale, 'exportBoardHint')}
            aria-label={t(locale, 'exportBoard')}
            onClick={() => {
              commitOpenEditors();
              void exportBoardFile(boardId).then(res => { const msg = res === 'ok' ? t(readLocale(), 'shareCopied') : res === 'too_large' ? t(readLocale(), 'exportTooLarge') : t(readLocale(), 'error'); setToast(msg); setTimeout(() => setToast(null), 1800); }).catch(() => { setToast(t(readLocale(), 'error')); setTimeout(() => setToast(null), 1800); });
            }}
          >
            <Icon name="download" />
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
        <div className="island meta-island" ref={metaIslandRef}>
          {hostOffline && ephemeral && (
            <button
              type="button"
              className="host-offline-banner"
              title={`${t(locale, 'hostOfflineBanner')} — ${t(locale, 'keepOnDeviceHint')}`}
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
        accept="image/*,video/*,.gif,.mp4,.webm,.mov,.pdf,application/pdf,.txt,text/plain,.review,.json,application/json"
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
        onTool={handleTool}
        onDelete={() => {
          commitOpenEditors();
          engineRef.current?.deleteSelection();
        }}
        onCopy={() => {
          commitOpenEditors();
          engineRef.current?.copySelection();
        }}
        onPaste={() => {
          commitOpenEditors();
          void engineRef.current?.pasteFromClipboard();
        }}
        onDuplicate={() => {
          commitOpenEditors();
          engineRef.current?.duplicateSelection();
        }}
        onInsertImage={() => fileRef.current?.click()}
        onCrop={() => engine?.startCropSelected()}
        onApplyCrop={() => engine?.applyCrop()}
        onCancelCrop={() => engine?.cancelCrop()}
        onExport={() => {
          commitOpenEditors();
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
          role="menu"
          style={{
            left: menuX,
            top: menuY,
            ['--ctx-max-h' as string]: menuMaxH != null ? `${menuMaxH}px` : undefined,
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menuEntries.map((entry, i) => {
            if (entry.kind === 'separator') {
              return <div key={`sep-${i}`} className="ctx-sep" role="separator" />;
            }
            if (entry.kind === 'submenu') {
              const open = ctxSubmenu === entry.label;
              const index = menuAnimIndex++;
              return (
                <div key={`sub-${entry.label}`} className={`ctx-sub${open ? ' is-open' : ''}`}>
                  <button
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                    aria-expanded={open}
                    className="ctx-item ctx-item-sub"
                    style={{ animationDelay: `${index * 18}ms` }}
                    onClick={() => setCtxSubmenu(open ? null : entry.label)}
                  >
                    <span>{entry.label}</span>
                    <span className="ctx-hint ctx-sub-chevron" aria-hidden="true">
                      <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
                    </span>
                  </button>
                  {/* Keep mounted so close can roll height back (mirrors custom-theme-roll). */}
                  <div className="ctx-submenu-roll" aria-hidden={!open} inert={open ? undefined : true}>
                    <div className="ctx-submenu-roll-clip">
                      <div className="ctx-submenu" role="menu" aria-label={entry.label}>
                        {entry.children.map((child, j) =>
                          renderMenuAction(child, `${entry.label}-${child.label}-${j}`, true)
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
            return renderMenuAction(entry, `${entry.label}-${i}`);
          })}
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
      {toast ? (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 72,
            transform: 'translateX(-50%)',
            background: 'var(--chrome-panel)',
            color: 'var(--chrome-text)',
            border: '1px solid var(--chrome-border)',
            borderRadius: 10,
            padding: '10px 16px',
            boxShadow: 'var(--chrome-shadow)',
            zIndex: 9999,
            fontSize: 13,
            maxWidth: 'min(420px, 90vw)',
            whiteSpace: 'normal',
            textAlign: 'center',
            wordBreak: 'break-word',
            lineHeight: 1.4,
          }}
        >
          {toast}
        </div>
      ) : null}
    </div>
  );
}
