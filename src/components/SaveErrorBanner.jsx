import React from 'react';

export default function SaveErrorBanner({ error, onDismiss, onRetry }) {
  if (!error) return null;

  return (
    <div
      className="rounded-lg px-4 py-3 mb-4 flex items-start justify-between gap-3"
      style={{
        backgroundColor: 'rgba(248, 113, 113, 0.1)',
        border: '1px solid rgba(248, 113, 113, 0.3)',
        color: '#f87171',
      }}
    >
      <div className="flex-1">
        <p className="text-sm font-body font-medium mb-1">
          Save failed
        </p>
        <p className="text-xs font-body" style={{ opacity: 0.85 }}>
          Your work is still here in this tab. Check your signal and try saving again.
        </p>
        {onRetry && (
          <button
            onClick={onRetry}
            className="mt-2 text-xs font-heading font-bold uppercase tracking-wide px-3 py-1.5 rounded transition-colors"
            style={{ border: '1px solid rgba(248, 113, 113, 0.4)', color: '#f87171' }}
          >
            Try Again
          </button>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="shrink-0 text-lg leading-none hover:opacity-70"
        style={{ color: '#f87171', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        &times;
      </button>
    </div>
  );
}
