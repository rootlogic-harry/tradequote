import React, { useState, useEffect } from 'react';
import { LOADING_MESSAGES } from '../../constants.js';

const VIDEO_LOADING_STAGES = [
  { label: 'Uploading video...', durationHint: 10 },
  { label: 'Extracting frames from walkthrough...', durationHint: 15 },
  { label: 'Transcribing audio...', durationHint: 20 },
  { label: 'Analysing footage and generating quote...', durationHint: 60 },
];

export default function AIAnalysis({ state, dispatch, cancelAnalysis }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [videoStage, setVideoStage] = useState(0);

  const { captureMode } = state;
  const isVideoMode = captureMode === 'video';

  useEffect(() => {
    if (!state.isAnalysing) {
      setElapsedSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setMessageIndex((i) => (i + 1) % LOADING_MESSAGES.length);
    }, 3500);
    return () => clearInterval(interval);
  }, [state.isAnalysing]);

  // Elapsed time counter while analysing
  useEffect(() => {
    if (!state.isAnalysing) return;
    const timer = setInterval(() => {
      setElapsedSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [state.isAnalysing]);

  // Video mode: advance stages based on elapsed time
  useEffect(() => {
    if (!state.isAnalysing || !isVideoMode) {
      setVideoStage(0);
      return;
    }
    let accumulated = 0;
    for (let i = 0; i < VIDEO_LOADING_STAGES.length; i++) {
      accumulated += VIDEO_LOADING_STAGES[i].durationHint;
      if (elapsedSeconds < accumulated) {
        setVideoStage(i);
        return;
      }
    }
    setVideoStage(VIDEO_LOADING_STAGES.length - 1);
  }, [elapsedSeconds, state.isAnalysing, isVideoMode]);

  const handleCancel = () => {
    if (cancelAnalysis) cancelAnalysis();
    dispatch({ type: 'ANALYSIS_CANCEL' });
  };

  if (state.analysisError) {
    return (
      <div className="max-w-xl mx-auto text-center py-20">
        <div className="rounded-lg p-6" style={{ backgroundColor: 'var(--tq-error-bg)', border: '1.5px solid var(--tq-error-bd)' }}>
          <p className="font-heading font-bold text-lg mb-2" style={{ color: 'var(--tq-error-txt)' }}>
            Something Went Wrong
          </p>
          <p className="text-sm mb-6" style={{ color: 'var(--tq-text)' }}>{state.analysisError}</p>
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}
              className="px-6 py-2 rounded border border-tq-border text-tq-text font-heading uppercase text-sm hover:bg-tq-card"
              style={{ minHeight: 44 }}
            >
              Back to Job Details
            </button>
            <button
              onClick={() => dispatch({ type: 'RETRY_ANALYSIS' })}
              className="px-6 py-2 rounded bg-tq-accent text-tq-bg font-heading uppercase text-sm hover:bg-tq-accent-dark"
              style={{ minHeight: 44 }}
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Video mode: staged progress
  if (isVideoMode) {
    return (
      <div className="max-w-xl mx-auto text-center py-20">
        <div className="mb-8">
          <div className="w-16 h-16 border-4 border-tq-accent border-t-transparent rounded-full animate-spin mx-auto" />
        </div>

        {/* Stage indicators */}
        <div className="flex flex-col gap-3 mb-8 text-left max-w-xs mx-auto">
          {VIDEO_LOADING_STAGES.map((stage, i) => (
            <div key={i} className="flex items-center gap-3">
              <span
                className="flex items-center justify-center rounded-full shrink-0"
                style={{
                  width: 24,
                  height: 24,
                  fontSize: 12,
                  fontWeight: 700,
                  backgroundColor: i <= videoStage ? 'var(--tq-accent)' : 'var(--tq-surface)',
                  color: i <= videoStage ? '#ffffff' : 'var(--tq-muted)',
                  transition: 'background-color 0.3s, color 0.3s',
                }}
              >
                {i < videoStage ? '✓' : i + 1}
              </span>
              <span
                className="text-sm"
                style={{
                  color: i === videoStage ? 'var(--tq-text)' : 'var(--tq-muted)',
                  fontWeight: i === videoStage ? 600 : 400,
                  transition: 'color 0.3s, font-weight 0.3s',
                }}
              >
                {stage.label}
              </span>
            </div>
          ))}
        </div>

        {state.isAnalysing && elapsedSeconds > 0 && (
          <p className="text-tq-muted text-xs mb-4" style={{ fontFamily: 'IBM Plex Mono, monospace' }}>
            {elapsedSeconds}s elapsed
          </p>
        )}

        <button
          onClick={handleCancel}
          className="border border-tq-border text-tq-muted font-heading uppercase text-sm tracking-wide px-6 py-2 rounded hover:text-tq-text hover:border-tq-text transition-colors"
          style={{ minHeight: 44 }}
        >
          Cancel
        </button>
      </div>
    );
  }

  // Photo mode: existing flow unchanged
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

      <p className="text-tq-muted text-sm mb-4">
        This usually takes 30–90 seconds depending on the number of photos
      </p>

      {state.isAnalysing && elapsedSeconds > 0 && (
        <p className="text-tq-muted text-xs mb-4" style={{ fontFamily: 'IBM Plex Mono, monospace' }}>
          {elapsedSeconds}s elapsed
        </p>
      )}

      <button
        onClick={handleCancel}
        className="border border-tq-border text-tq-muted font-heading uppercase text-sm tracking-wide px-6 py-2 rounded hover:text-tq-text hover:border-tq-text transition-colors"
        style={{ minHeight: 44 }}
      >
        Cancel
      </button>
    </div>
  );
}
