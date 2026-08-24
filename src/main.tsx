import { createRoot } from 'react-dom/client';
import App from './App';
import { applyChromeTheme, readChromeTheme } from './core/chromeTheme';
import { applyLocale, readLocale } from './core/locale';
import { t } from './ui/i18n';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/onest/cyrillic-400.css';
import '@fontsource/onest/cyrillic-500.css';
import '@fontsource/onest/cyrillic-600.css';
import '@fontsource/onest/cyrillic-700.css';
import './index.css';

const locale = readLocale();
applyChromeTheme(readChromeTheme());
applyLocale(locale);
document.title = t(locale, 'title');

window.addEventListener('error', (e) => {
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;inset:auto 12px 12px 12px;max-height:45vh;overflow:auto;z-index:99999;background:#300;color:#fff;padding:10px;font-size:12px;white-space:pre-wrap;border-radius:8px';
  box.textContent = '[error] ' + (e.error?.stack || e.message);
  document.body.appendChild(box);
});

try {
  createRoot(document.getElementById('root')!).render(<App />);
} catch (err) {
  const box = document.createElement('pre');
  box.style.cssText =
    'position:fixed;inset:0;z-index:99999;background:#300;color:#fff;padding:12px;font-size:12px;white-space:pre-wrap;overflow:auto';
  box.textContent = '[render] ' + String(err);
  document.body.appendChild(box);
}
