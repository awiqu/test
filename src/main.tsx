import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import { useEditor } from './editor/store';

// для отладки и e2e-тестов
(window as unknown as { __redlogic: typeof useEditor }).__redlogic = useEditor;

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
