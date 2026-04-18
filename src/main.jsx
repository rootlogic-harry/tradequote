import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', textAlign: 'center',
          background: '#1a1714', color: '#f0ede8', padding: 20,
          fontFamily: 'Inter, sans-serif',
        }}>
          <div style={{
            fontFamily: 'Barlow Condensed, sans-serif', fontSize: 32,
            fontWeight: 800, color: '#e8a838', letterSpacing: '0.05em', marginBottom: 24,
          }}>
            FASTQUOTE
          </div>
          <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#999', fontSize: 14, marginBottom: 8 }}>
            Your saved quotes are safe. Refresh the page to continue.
          </p>
          <p style={{ color: '#666', fontSize: 12, marginBottom: 24 }}>
            If this keeps happening, try closing and reopening the app.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              onClick={() => window.location.reload()}
              style={{
                color: '#1a1714', background: '#e8a838', border: 'none',
                borderRadius: 8, padding: '10px 24px', fontSize: 14, cursor: 'pointer',
                fontFamily: 'Inter, sans-serif', fontWeight: 600,
              }}
            >
              Refresh
            </button>
            <button
              onClick={() => { window.location.hash = ''; window.location.reload(); }}
              style={{
                color: '#e8a838', background: 'none', border: '1px solid #3a3630',
                borderRadius: 8, padding: '10px 24px', fontSize: 14, cursor: 'pointer',
                fontFamily: 'Inter, sans-serif',
              }}
            >
              Go to Dashboard
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
