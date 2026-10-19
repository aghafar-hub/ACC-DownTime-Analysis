import './installPrompt';
import './mobile/viewport';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './fonts';
import './index.css';
import './components/ui.css';
import './mobile/touch.css';
import App from './App';
import { installEllipsisTitles } from './util/ellipsisTitles';
import { AppErrorBoundary } from './components/CrashScreen';

installEllipsisTitles();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
