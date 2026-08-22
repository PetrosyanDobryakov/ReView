import { createRoot } from 'react-dom/client';
import App from './App';
import { applyChromeTheme, readChromeTheme } from './core/chromeTheme';
import { applyLocale, readLocale } from './core/locale';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import './index.css';

applyChromeTheme(readChromeTheme());
applyLocale(readLocale());

createRoot(document.getElementById('root')!).render(<App />);
