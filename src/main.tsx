import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';
import { initializeArtifactRegistry } from './utils/registerArtifacts';

// Initialize artifact registry for EIP-712 clear signing
// This registers raw contract artifacts so that all function signatures
// (including unconstrained public functions) can be resolved
initializeArtifactRegistry();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const root = createRoot(rootElement);
root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
