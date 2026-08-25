import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import type { ShapeBox } from '../core/shapes';
import { viewPaperBg } from '../core/store';
import type { LocaleId } from '../core/locale';
import { t } from './i18n';

export type ExportSource = 'all' | 'selection' | 'region';
type ExportFormat = 'png' | 'jpeg' | 'svg' | 'pdf';

export function ExportDialog({
  locale,
  engine,
  initialSource,
  rect,
  hasSelection,
  selectionRevision,
  shapeRevision,
  onPickAgain,
  onClose,
}: {
  locale: LocaleId;
  engine: Engine;
  initialSource: ExportSource;
  rect: ShapeBox | null;
  hasSelection: boolean;
  /** Bumps when selection count or bounds change so export preview stays in sync. */
  selectionRevision?: number;
  /** Bumps when board content changes (for whole-board export preview). */
  shapeRevision?: number;
  onPickAgain: () => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<ExportSource>(initialSource);
  const [scale, setScale] = useState(2);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [quality, setQuality] = useState(0.85);
  const [transparent, setTransparent] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);

  const box: ShapeBox | null = useMemo(() => {
    if (source === 'region') return rect;
    if (source === 'selection') return engine.selectionBounds();
    return engine.contentBox();
  }, [source, rect, engine, selectionRevision, shapeRevision]);

  useEffect(() => {
    if (!box) {
      setPreviewUrl(null);
      setFileSize(null);
      setDims(null);
      setExportError(null);
      return;
    }
    let cancelled = false;
    const id = window.setTimeout(async () => {
      try {
        const bg =
          format === 'jpeg' || format === 'pdf' || !transparent ? viewPaperBg() : null;
        let result: { blob: Blob; width: number; height: number } | null = null;
        if (format === 'svg') {
          result = engine.exportSvg(box, { background: bg });
        } else if (format === 'pdf') {
          result = await engine.exportPdf(box, { scale, quality, background: bg ?? '#ffffff' });
        } else {
          result = await engine.exportBlob(box, {
            scale,
            format,
            quality,
            background: bg,
          });
        }
        if (cancelled) return;
        if (!result) {
          setPreviewUrl(null);
          setFileSize(null);
          setDims(null);
          setExportError(t(locale, 'exportFailed'));
          return;
        }
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        const url = URL.createObjectURL(result.blob);
        urlRef.current = url;
        setPreviewUrl(url);
        setFileSize(result.blob.size);
        setDims({ w: result.width, h: result.height });
        setExportError(null);
      } catch {
        if (!cancelled) {
          setPreviewUrl(null);
          setFileSize(null);
          setDims(null);
          setExportError(t(locale, 'exportFailed'));
        }
      }
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
    };
  }, [box, scale, format, quality, transparent, locale]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    []
  );

  const fmtSize = (n: number): string =>
    n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

  const sources: Array<{ id: ExportSource; label: string; disabled?: boolean }> = [
    { id: 'all', label: t(locale, 'exportAll') },
    { id: 'selection', label: t(locale, 'exportSelection'), disabled: !hasSelection },
    { id: 'region', label: t(locale, 'exportRegion'), disabled: !rect },
  ];

  const formats: Array<{ id: ExportFormat; label: string }> = [
    { id: 'png', label: 'PNG' },
    { id: 'jpeg', label: 'JPEG' },
    { id: 'svg', label: 'SVG' },
    { id: 'pdf', label: 'PDF' },
  ];

  const ext = format === 'jpeg' ? 'jpg' : format;
  const showPreviewImage = format === 'png' || format === 'jpeg';
  const showScale = format === 'png' || format === 'jpeg' || format === 'pdf';

  return (
    <div className="export-root" role="dialog" aria-modal="true" aria-label={t(locale, 'export')}>
      <button className="sheet-backdrop" onClick={onClose} />
      <div className="export-modal">
        <header className="export-head">
          <b>{t(locale, 'export')}</b>
          <button type="button" className="icon-btn" title={t(locale, 'close')} onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="export-body">
          <div className="export-controls">
            <div className="export-row">
              <span className="export-label">{t(locale, 'exportSource')}</span>
              {sources.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`style-btn${source === s.id ? ' active' : ''}`}
                  disabled={s.disabled}
                  onClick={() => setSource(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {showScale && (
              <div className="export-row">
                <span className="export-label">{t(locale, 'exportScale')}</span>
                {[1, 2, 3].map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={`style-btn${scale === s ? ' active' : ''}`}
                    onClick={() => setScale(s)}
                  >
                    ×{s}
                  </button>
                ))}
              </div>
            )}
            <div className="export-row">
              <span className="export-label">{t(locale, 'exportFormat')}</span>
              {formats.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`style-btn${format === f.id ? ' active' : ''}`}
                  onClick={() => setFormat(f.id)}
                >
                  {f.label}
                </button>
              ))}
              {(format === 'png' || format === 'svg') && (
                <label className="export-check">
                  <input
                    type="checkbox"
                    checked={transparent}
                    onChange={(e) => setTransparent(e.target.checked)}
                  />
                  {t(locale, 'exportTransparent')}
                </label>
              )}
            </div>
            {(format === 'jpeg' || format === 'pdf') && (
              <div className="export-row">
                <span className="export-label">{t(locale, 'exportQuality')}</span>
                <input
                  type="range"
                  min={0.5}
                  max={0.95}
                  step={0.05}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                />
                <span>{Math.round(quality * 100)}</span>
              </div>
            )}
            <button type="button" className="style-btn" onClick={onPickAgain}>
              {t(locale, 'exportPickAgain')}
            </button>
          </div>
          <div className="export-preview">
            {previewUrl && showPreviewImage ? (
              <img src={previewUrl} alt="" />
            ) : previewUrl ? (
              <span className="export-empty">
                {format.toUpperCase()} · {dims ? `${dims.w}×${dims.h}` : ''}
                {fileSize !== null ? ` · ${fmtSize(fileSize)}` : ''}
              </span>
            ) : (
              <span className="export-empty">{exportError ?? t(locale, 'exportEmpty')}</span>
            )}
          </div>
        </div>
        <footer className="export-foot">
          <span className="export-size">
            {dims ? `${dims.w}×${dims.h}` : ''}
            {fileSize !== null && dims ? ' · ' : ''}
            {fileSize !== null ? fmtSize(fileSize) : ''}
          </span>
          <a
            className={`style-btn export-download${previewUrl ? '' : ' disabled'}`}
            href={previewUrl ?? undefined}
            download={`review-${dims?.w ?? 0}x${dims?.h ?? 0}.${ext}`}
          >
            {t(locale, 'exportDownload')}
          </a>
        </footer>
      </div>
    </div>
  );
}
