import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engine } from '../engine/Engine';
import type { ShapeBox } from '../core/shapes';
import { viewPaperBg } from '../core/store';
import type { LocaleId } from '../core/locale';
import { t } from './i18n';

export type ExportSource = 'all' | 'selection' | 'region';

export function ExportDialog({
  locale,
  engine,
  initialSource,
  rect,
  hasSelection,
  onPickAgain,
  onClose,
}: {
  locale: LocaleId;
  engine: Engine;
  initialSource: ExportSource;
  rect: ShapeBox | null;
  hasSelection: boolean;
  onPickAgain: () => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<ExportSource>(initialSource);
  const [scale, setScale] = useState(2);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, rect]);

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
        const result = await engine.exportBlob(box, {
          scale,
          format,
          quality,
          background: format === 'jpeg' || !transparent ? viewPaperBg() : null,
        });
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
    { id: 'all', label: t(locale, 'exportPage') },
    { id: 'selection', label: t(locale, 'exportSelection'), disabled: !hasSelection },
    { id: 'region', label: t(locale, 'exportRegion'), disabled: !rect },
  ];

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
            <div className="export-row">
              <span className="export-label">{t(locale, 'exportFormat')}</span>
              <button
                type="button"
                className={`style-btn${format === 'png' ? ' active' : ''}`}
                onClick={() => setFormat('png')}
              >
                PNG
              </button>
              <button
                type="button"
                className={`style-btn${format === 'jpeg' ? ' active' : ''}`}
                onClick={() => setFormat('jpeg')}
              >
                JPEG
              </button>
              {format === 'png' && (
                <>
                  <label className="export-check">
                    <input
                      type="checkbox"
                      checked={transparent}
                      onChange={(e) => setTransparent(e.target.checked)}
                    />
                    {t(locale, 'exportTransparent')}
                  </label>
                </>
              )}
            </div>
            {format === 'jpeg' && (
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
            <button
              type="button"
              className="style-btn"
              onClick={onPickAgain}
            >
              {t(locale, 'exportPickAgain')}
            </button>
          </div>
          <div className="export-preview">
            {previewUrl ? (
              <img src={previewUrl} alt="" />
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
            download={`review-${dims?.w ?? 0}x${dims?.h ?? 0}.${format === 'jpeg' ? 'jpg' : 'png'}`}
          >
            {t(locale, 'exportDownload')}
          </a>
        </footer>
      </div>
    </div>
  );
}
