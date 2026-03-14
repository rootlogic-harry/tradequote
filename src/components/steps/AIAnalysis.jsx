import React, { useState, useEffect } from 'react';
import { LOADING_MESSAGES } from '../../constants.js';

export default function AIAnalysis({ state, dispatch }) {
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
        <div className="bg-tq-error/10 border border-tq-error/30 rounded-lg p-6">
          <p className="text-tq-error font-heading font-bold text-lg mb-2">
            Analysis Failed
          </p>
          <p className="text-tq-text text-sm mb-6">{state.analysisError}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}
              className="px-6 py-2 rounded border border-tq-border text-tq-text font-heading uppercase text-sm hover:bg-tq-card"
            >
              Back
            </button>
            <button
              onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}
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

      <p className="text-tq-text font-heading text-xl font-bold mb-3 transition-all duration-500">
        {LOADING_MESSAGES[messageIndex]}
      </p>

      <p className="text-tq-muted text-sm">
        This usually takes 15–30 seconds
      </p>
    </div>
  );
}
