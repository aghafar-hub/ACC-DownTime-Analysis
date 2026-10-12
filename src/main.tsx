import './installPrompt';
import './mobile/viewport';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './components/ui.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
