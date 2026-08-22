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

createRoot(document.getElementById('root')!).render(<App />);
