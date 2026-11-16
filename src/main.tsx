import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/archivo/wdth.css';
import '@fontsource-variable/archivo/wdth-italic.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles/base.css';
import './styles/replay.css';
import './styles/home.css';
import './styles/analysis.css';
import './styles/engineer.css';
import './styles/report.css';
import './styles/pages.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
