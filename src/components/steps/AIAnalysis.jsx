import React, { useState, useEffect } from 'react';
import { LOADING_MESSAGES } from '../../constants.js';

export default function AIAnalysis({ state, dispatch, cancelAnalysis }) {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (!state.isAnalysing) return;
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [state.isAnalysing]);

  if (state.analysisError) {
    return (
      <div className="max-w-xl mx-auto text-center py-20">
        <div className="rounded-lg p-6" style={{ backgroundColor: 'var(--tq-error-bg)', border: '1.5px solid var(--tq-error-bd)' }}>
          <p className="font-heading font-bold text-lg mb-2" style={{ color: 'var(--tq-error-txt)' }}>
            Analysis Failed
          </p>
          <p className="text-sm mb-6" style={{ color: 'var(--tq-text)' }}>{state.analysisError}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}
              className="px-6 py-2 rounded border border-tq-border text-tq-text font-heading uppercase text-sm hover:bg-tq-card"
            >
              Back
            </button>
            <button
              onClick={() => dispatch({ type: 'RETRY_ANALYSIS' })}
              className="px-6 py-2 rounded bg-tq-accent text-tq-bg font-heading uppercase text-sm hover:bg-tq-accent-dark"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto text-center py-20">
      <div className="mb-8">
        <div className="w-16 h-16 border-4 border-tq-accent border-t-transparent rounded-full animate-spin mx-auto" />
      </div>

      <p
        className="mb-3 transition-all duration-500"
        style={{ fontFamily: 'Barlow Condensed, sans-serif', fontSize: 20, fontWeight: 700, color: 'var(--tq-text)' }}
      >
        {LOADING_MESSAGES[messageIndex]}
      </p>

      <p className="text-tq-muted text-sm mb-6">
        This usually takes 15–30 seconds
      </p>

      {cancelAnalysis && (
        <button
          onClick={cancelAnalysis}
          className="border border-tq-border text-tq-muted font-heading uppercase text-sm tracking-wide px-6 py-2 rounded hover:text-tq-text hover:border-tq-text transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
