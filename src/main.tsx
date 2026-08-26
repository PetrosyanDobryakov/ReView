import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import App from './App';
import { Home } from './ui/Home';
import { loadUser } from './core/user';
import { bootstrapUserProfile } from './core/userProfile';
import { applyChromeTheme, readChromeTheme, type ChromeThemeId } from './core/chromeTheme';
import { applyLocale, readLocale } from './core/locale';
import { applyUiScale } from './core/prefs';
import { migrateLegacyOrbitPaper } from './core/orbit';
import { t } from './ui/i18n';
import { leaveBoard } from './core/store';
import { getBoard, ensureBoardWithId } from './core/boards';
import { OrbitAtmosphere } from './ui/OrbitAtmosphere';
import { OrbitTactile } from './ui/OrbitTactile';
import { navigateThemed } from './ui/navTransition';
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
const chromeId = readChromeTheme();
migrateLegacyOrbitPaper(chromeId === 'orbit');
applyChromeTheme(chromeId);
applyLocale(locale);
applyUiScale();
document.title = t(locale, 'title');

window.addEventListener('pagehide', () => leaveBoard());

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
  return <App boardId={boardId} onBack={() => navigateThemed(navigate, '/')} />;
}

function HomeRoute() {
  return <Home locale={readLocale()} />;
}

/** Persistent Orbit chrome — survives home ↔ board so the shader doesn't remount. */
function OrbitChrome() {
  const [theme, setTheme] = useState<ChromeThemeId>(() => readChromeTheme());
  useEffect(() => {
    const sync = () => setTheme(readChromeTheme());
    window.addEventListener('review-chrome-theme', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('review-chrome-theme', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  if (theme !== 'orbit') return null;
  return (
    <>
      <OrbitAtmosphere />
      <OrbitTactile />
    </>
  );
}

function AppShell() {
  return (
    <>
      <OrbitChrome />
      <Routes>
        <Route path="/" element={<HomeRoute />} />
        <Route path="/board/:boardId" element={<BoardRoute />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

try {
  createRoot(document.getElementById('root')!).render(
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
} catch (err) {
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:#300;color:#fff;padding:12px;font-size:12px;white-space:pre-wrap;overflow:auto';
  box.textContent = '[render] ' + String(err);
  document.body.appendChild(box);
}
