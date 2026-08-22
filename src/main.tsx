import { createRoot } from 'react-dom/client';
import App from './App';
import { applyChromeTheme, readChromeTheme } from './core/chromeTheme';
import { applyLocale, readLocale } from './core/locale';
import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import '@fontsource/onest/cyrillic-400.css';
import '@fontsource/onest/cyrillic-500.css';
import '@fontsource/onest/cyrillic-600.css';
import '@fontsource/onest/cyrillic-700.css';
import './index.css';

applyChromeTheme(readChromeTheme());
applyLocale(readLocale());

createRoot(document.getElementById('root')!).render(<App />);
