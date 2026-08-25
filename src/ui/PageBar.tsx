import { useEffect, useState } from 'react';
import * as store from '../core/store';
import { Icon } from './icons';
import { t } from './i18n';
import type { LocaleId } from '../core/locale';

export function PageBar({ locale }: { locale: LocaleId }) {
  const [pages, setPages] = useState<string[]>(() => store.listPages());
  const [cur, setCur] = useState<string>(() => store.currentPageId());

  useEffect(
    () =>
      store.onPageChange(() => {
        setPages(store.listPages());
        setCur(store.currentPageId());
      }),
    []
  );

  const idx = Math.max(0, pages.indexOf(cur));

  return (
    <div className="island page-bar" role="group" aria-label={t(locale, 'pages')}>
      <button
        type="button"
        className="page-btn"
        title={t(locale, 'prevPage')}
        aria-label={t(locale, 'prevPage')}
        disabled={idx <= 0}
        onClick={() => store.setCurrentPage(pages[idx - 1])}
      >
        <Icon name="chevronLeft" size={16} />
      </button>
      <span className="page-indicator">
        {idx + 1} <span className="page-of">/</span> {pages.length}
      </span>
      <button
        type="button"
        className="page-btn"
        title={t(locale, 'nextPage')}
        aria-label={t(locale, 'nextPage')}
        disabled={idx >= pages.length - 1}
        onClick={() => store.setCurrentPage(pages[idx + 1])}
      >
        <Icon name="chevronRight" size={16} />
      </button>
      <span className="page-sep" aria-hidden="true" />
      <button
        type="button"
        className="page-btn"
        title={t(locale, 'addPage')}
        aria-label={t(locale, 'addPage')}
        onClick={() => store.addPage()}
      >
        <Icon name="plus" size={15} />
      </button>
      <button
        type="button"
        className="page-btn page-danger"
        title={t(locale, 'deletePage')}
        aria-label={t(locale, 'deletePage')}
        disabled={pages.length <= 1}
        onClick={() => {
          if (window.confirm(`${t(locale, 'deletePage')}?`)) store.deletePage(cur);
        }}
      >
        <Icon name="trash" size={15} />
      </button>
    </div>
  );
}
