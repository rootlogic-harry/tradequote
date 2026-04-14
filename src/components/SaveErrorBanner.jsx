import React from 'react';

export default function SaveErrorBanner({ error, onDismiss }) {
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
      <p className="text-sm font-body">
        Save failed — Your work is preserved in this tab. Try saving again or check your connection.
      </p>
      <button
        onClick={onDismiss}
        className="shrink-0 text-lg leading-none hover:opacity-70"
        style={{ color: '#f87171' }}
      >
        &times;
      </button>
    </div>
  );
}
