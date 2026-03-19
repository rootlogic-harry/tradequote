import React, { useState, useEffect } from 'react';
import QuoteDocument from '../QuoteDocument.jsx';

export default function LivePreview({ state }) {
  const [overlayOpen, setOverlayOpen] = useState(false);

  // Debounce state updates to avoid jank during rapid typing
  const [deferredState, setDeferredState] = useState(state);
  useEffect(() => {
    const timer = setTimeout(() => setDeferredState(state), 300);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <>
      {/* Desktop: inline preview */}
      <div className="mt-8 hidden md:block">
        <h3 className="text-lg font-heading font-bold text-tq-text mb-3">
          Live Preview
        </h3>
        <div className="bg-white rounded-lg shadow-lg max-h-[600px] overflow-y-auto">
          <QuoteDocument state={deferredState} />
        </div>
      </div>

      {/* Mobile: preview button */}
      <div className="mt-6 md:hidden">
        <button
          onClick={() => setOverlayOpen(true)}
          className="w-full border border-tq-accent text-tq-accent font-heading font-bold uppercase tracking-wide py-3 rounded hover:bg-tq-accent/10 transition-colors"
        >
          Preview Quote
        </button>
      </div>

      {/* Mobile: full-screen overlay */}
      {overlayOpen && (
        <div className="fixed inset-0 z-50 bg-tq-bg flex flex-col md:hidden">
          <div className="sticky top-0 z-10 bg-tq-surface border-b border-tq-border px-4 py-3 flex items-center justify-between">
            <h3 className="font-heading font-bold text-tq-text">Quote Preview</h3>
            <button
              onClick={() => setOverlayOpen(false)}
              className="text-tq-muted hover:text-tq-text text-2xl leading-none"
            >
              &times;
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <div className="bg-white">
              <QuoteDocument state={deferredState} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
