import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { bootstrapAppearance } from './settings';
import './styles.css';

// Apply the saved theme/fonts before the first paint to avoid a flash.
bootstrapAppearance();

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('root element not found');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
