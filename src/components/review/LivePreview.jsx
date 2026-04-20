import React, { useState, useEffect } from 'react';
import QuoteDocument from '../QuoteDocument.jsx';

export default function LivePreview({ state, dispatch }) {
  const [overlayOpen, setOverlayOpen] = useState(false);

  // Debounce state for the read-only PDF/print look on mobile, but pass `state`
  // through unwrapped to the editable preview so keystrokes feel instant.
  const [deferredState, setDeferredState] = useState(state);
  useEffect(() => {
    const timer = setTimeout(() => setDeferredState(state), 300);
    return () => clearTimeout(timer);
  }, [state]);

  // editable=true unlocks inline editing for damage description, schedule
  // titles + descriptions, materials lines, and notes — addresses Mark's
  // "let me edit directly in the preview" feedback. dispatch must be passed.
  const editable = typeof dispatch === 'function';

  return (
    <>
      {/* Desktop: inline preview (editable) */}
      <div className="mt-8 hidden fq:block">
        <h3 className="text-lg font-heading font-bold text-tq-text mb-3">
          Live Preview {editable && <span className="text-xs font-body text-tq-muted ml-2" style={{ textTransform: 'none', letterSpacing: 'normal' }}>(click any text to edit)</span>}
        </h3>
        <div className="bg-white shadow-lg max-h-[700px] overflow-y-auto" style={{ borderRadius: 2 }}>
          <QuoteDocument state={state} dispatch={dispatch} editable={editable} />
        </div>
      </div>

      {/* Mobile: preview button */}
      <div className="mt-6 fq:hidden">
        <button
          onClick={() => setOverlayOpen(true)}
          className="w-full border border-tq-accent text-tq-accent font-heading font-bold uppercase tracking-wide py-3 rounded hover:bg-tq-accent/10 transition-colors"
        >
          Preview Quote
        </button>
      </div>

      {/* Mobile: full-screen overlay (editable) */}
      {overlayOpen && (
        <div className="fixed inset-0 z-50 bg-tq-bg flex flex-col fq:hidden">
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
              <QuoteDocument state={state} dispatch={dispatch} editable={editable} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
