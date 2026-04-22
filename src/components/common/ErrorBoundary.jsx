/**
 * Error boundaries — top-level and scoped.
 *
 * Root: wraps <App/> in main.jsx. Catches anything that escapes every
 * scoped boundary below. Full-screen fallback + Refresh / Dashboard.
 *
 * Scoped: wraps a single risky surface (e.g. QuoteDocument preview,
 * ReviewEdit measurements grid). If that subtree throws, the user sees
 * an inline error card for just that section — the rest of the app
 * keeps working and their in-progress edits are preserved.
 *
 * Why the scoped flavour matters: without it, one bad `aiValue` shape
 * on a saved-quote snapshot (schema drift) or one malformed photo URL
 * takes the whole screen down. Paul loses his edits, panics, and we
 * get a support ticket. With it, he sees "Preview couldn't load \u2014
 * try refreshing just this section" and keeps going.
 */
import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, errorKey: 0 };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    const label = this.props.scope ? `[ErrorBoundary:${this.props.scope}]` : '[ErrorBoundary]';
    console.error(label, error, info?.componentStack);
    // Opt-in callback — lets the caller send to an error-tracking
    // service or show a toast. Kept optional so wrapping a component
    // doesn't require any setup.
    if (typeof this.props.onError === 'function') {
      try { this.props.onError(error, info); } catch { /* never rethrow */ }
    }
  }

  reset = () => {
    // Force React to re-mount children with a fresh key so the next
    // render starts clean. If the error is deterministic (bad data),
    // it'll fail again \u2014 but that's better UX than locking the
    // subtree behind a fallback forever.
    this.setState((s) => ({ hasError: false, errorKey: s.errorKey + 1 }));
  };

  render() {
    if (!this.state.hasError) {
      return (
        <React.Fragment key={this.state.errorKey}>
          {this.props.children}
        </React.Fragment>
      );
    }

    // Custom fallback wins if provided.
    if (this.props.fallback) {
      return typeof this.props.fallback === 'function'
        ? this.props.fallback({ reset: this.reset, scope: this.props.scope })
        : this.props.fallback;
    }

    // Scoped default \u2014 inline card, preserves surrounding layout.
    if (this.props.scope) {
      return (
        <div
          role="alert"
          style={{
            background: 'var(--tq-surface-2, #2a2520)',
            border: '1px solid var(--tq-accent, #e8a838)',
            borderRadius: 8,
            padding: 16,
            margin: '8px 0',
            color: 'var(--tq-ink, #f0ede8)',
            fontSize: 14,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            This section couldn\u2019t load.
          </div>
          <div style={{ color: 'var(--tq-muted, #999)', marginBottom: 12, fontSize: 13 }}>
            Your work is preserved. Try refreshing this section \u2014 the rest of
            the app is still running.
          </div>
          <button
            type="button"
            onClick={this.reset}
            style={{
              color: 'var(--tq-bg, #1a1714)',
              background: 'var(--tq-accent, #e8a838)',
              border: 'none',
              borderRadius: 6,
              padding: '8px 16px',
              fontSize: 13,
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    // Full-page default \u2014 used by the root boundary in main.jsx.
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
}

export default ErrorBoundary;
