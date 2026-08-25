import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import App from './App';
import { Home } from './ui/Home';
import { loadUser } from './core/user';
import { bootstrapUserProfile } from './core/userProfile';
import { applyChromeTheme, readChromeTheme } from './core/chromeTheme';
import { applyLocale, readLocale } from './core/locale';
import { applyUiScale } from './core/prefs';
import { t } from './ui/i18n';
import { getBoard, ensureBoardWithId } from './core/boards';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/onest/cyrillic-400.css';
import '@fontsource/onest/cyrillic-500.css';
import '@fontsource/onest/cyrillic-600.css';
import '@fontsource/onest/cyrillic-700.css';
import './index.css';

loadUser();
bootstrapUserProfile();

const locale = readLocale();
applyChromeTheme(readChromeTheme());
applyLocale(locale);
applyUiScale();
document.title = t(locale, 'title');

window.addEventListener('error', (e) => {
  showErrorBanner('[error] ' + (e.error?.stack || e.message));
});
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason;
  const text =
    reason instanceof Error ? reason.stack || reason.message : String(reason ?? 'unhandled rejection');
  showErrorBanner('[promise] ' + text);
});

function showErrorBanner(text: string): void {
  const existing = document.querySelectorAll('.review-error-banner');
  if (existing.length > 4) existing[0]?.remove();
  const box = document.createElement('pre');
  box.className = 'review-error-banner';
  box.style.cssText =
    'position:fixed;inset:auto 12px 12px 12px;max-height:45vh;overflow:auto;z-index:99999;background:#300;color:#fff;padding:10px;font-size:12px;white-space:pre-wrap;border-radius:8px;cursor:pointer';
  box.textContent = text + '\n\n(click to dismiss)';
  box.title = 'Click to dismiss';
  box.addEventListener('click', () => box.remove());
  document.body.appendChild(box);
}

function BoardRoute() {
  const { boardId } = useParams<{ boardId: string }>();
  const navigate = useNavigate();
  if (!boardId) return <Navigate to="/" replace />;
  if (!getBoard(boardId)) {
    ensureBoardWithId(boardId);
  }
  return <App boardId={boardId} onBack={() => navigate('/')} />;
}

function HomeRoute() {
  return <Home locale={readLocale()} />;
}

try {
  createRoot(document.getElementById('root')!).render(
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/board/:boardId" element={<BoardRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
} catch (err) {
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:#300;color:#fff;padding:12px;font-size:12px;white-space:pre-wrap;overflow:auto';
  box.textContent = '[render] ' + String(err);
  document.body.appendChild(box);
}
