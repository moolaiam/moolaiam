import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createDefaultHost } from './host';
import { ParamProvider } from './state/ParamContext';
import { Plugin } from './ui/Plugin';
import './styles/app.css';

const host = createDefaultHost();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ParamProvider host={host}>
      <Plugin />
    </ParamProvider>
  </StrictMode>,
);
