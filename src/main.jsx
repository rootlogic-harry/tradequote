import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import ErrorBoundary from './components/common/ErrorBoundary.jsx';
import { installSpaPageviewBeacon } from './utils/trackPageview.js';

// TRQ-15: SPA route → /api/track beacon. Installed before render so
// the first pageview fires alongside the initial paint. Honours
// navigator.doNotTrack and silently no-ops on any failure.
installSpaPageviewBeacon();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
