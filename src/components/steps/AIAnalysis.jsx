import React, { useState, useEffect } from 'react';
import { LOADING_MESSAGES } from '../../constants.js';

const VIDEO_LOADING_STAGES = [
  { label: 'Uploading video...', durationHint: 10, sseStage: null },
  { label: 'Processing video...', durationHint: 15, sseStage: 'processing' },
  { label: 'Analysing footage...', durationHint: 20, sseStage: 'analysing' },
  { label: 'Reviewing analysis...', durationHint: 60, sseStage: 'reviewing' },
];

// Map SSE stage names to UI stage indices
const SSE_STAGE_MAP = { processing: 1, analysing: 2, reviewing: 3, complete: 3 };

export default function AIAnalysis({ state, dispatch, cancelAnalysis }) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [videoStage, setVideoStage] = useState(0);

  const { captureMode, videoProgress, uploadProgress } = state;
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

  // Video mode: advance stages from SSE progress or fall back to time-based estimation
  useEffect(() => {
    if (!state.isAnalysing || !isVideoMode) {
      setVideoStage(0);
      return;
    }

    // Prefer SSE progress if available
    if (videoProgress?.stage && SSE_STAGE_MAP[videoProgress.stage] !== undefined) {
      setVideoStage(SSE_STAGE_MAP[videoProgress.stage]);
      return;
    }

    // Fallback: time-based estimation using durationHint
    let accumulated = 0;
    for (let i = 0; i < VIDEO_LOADING_STAGES.length; i++) {
      accumulated += VIDEO_LOADING_STAGES[i].durationHint;
      if (elapsedSeconds < accumulated) {
        setVideoStage(i);
        return;
      }
    }
    setVideoStage(VIDEO_LOADING_STAGES.length - 1);
  }, [elapsedSeconds, state.isAnalysing, isVideoMode, videoProgress]);

  const handleCancel = () => {
    if (cancelAnalysis) cancelAnalysis();
    dispatch({ type: 'ANALYSIS_CANCEL' });
  };

  if (state.analysisError) {
    return (
      <div className="max-w-xl mx-auto text-center py-20">
        <div className="p-6" style={{ backgroundColor: 'var(--tq-error-bg)', border: '1.5px solid var(--tq-error-bd)', borderRadius: 2 }}>
          <p className="font-heading font-bold text-lg mb-2" style={{ color: 'var(--tq-error-txt)' }}>
            Something Went Wrong
          </p>
          <p className="text-sm mb-6" style={{ color: 'var(--tq-text)' }}>{state.analysisError}</p>
          {isVideoMode && (
            <p className="text-sm mb-4" style={{ color: 'var(--tq-muted)' }}>
              You can also try using photos instead of a video walkthrough.
            </p>
          )}
          <div className="flex gap-3 justify-center flex-wrap">
            <button onClick={() => dispatch({ type: 'SET_STEP', step: 2 })} className="btn-ghost text-sm">
              Back to Job Details
            </button>
            <button
              onClick={() => {
                if (isVideoMode) {
                  dispatch({ type: 'SET_STEP', step: 2 });
                  dispatch({ type: 'ANALYSIS_CANCEL' });
                } else {
                  dispatch({ type: 'RETRY_ANALYSIS' });
                }
              }}
              className="btn-primary text-sm"
            >
              Try Again
            </button>
            {isVideoMode && (
              <button
                onClick={() => {
                  dispatch({ type: 'SET_CAPTURE_MODE', payload: 'photos' });
                  dispatch({ type: 'ANALYSIS_CANCEL' });
                  dispatch({ type: 'SET_STEP', step: 2 });
                }}
                className="btn-ghost text-sm"
              >
                Use Photos Instead
              </button>
            )}
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
          {VIDEO_LOADING_STAGES.map((stage, i) => {
            // Stage 0 (upload): show real uploadProgress percent and ETA when available
            const isUploadStage = i === 0 && videoStage === 0 && uploadProgress?.percent != null;
            const formatEta = (s) => s > 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : `${s}s`;
            const stageLabel = isUploadStage
              ? `Uploading... ${uploadProgress.percent}%${uploadProgress.eta > 0 ? ` • ${formatEta(uploadProgress.eta)} remaining` : ''}`
              : stage.label;

            return (
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
                <div className="flex-1 min-w-0">
                  <span
                    className="text-sm"
                    style={{
                      color: i === videoStage ? 'var(--tq-text)' : 'var(--tq-muted)',
                      fontWeight: i === videoStage ? 600 : 400,
                      transition: 'color 0.3s, font-weight 0.3s',
                    }}
                  >
                    {stageLabel}
                  </span>
                  {/* Upload progress bar for stage 0 */}
                  {isUploadStage && (
                    <div style={{ height: 4, borderRadius: 2, background: 'var(--tq-surface)', marginTop: 4 }}>
                      <div
                        style={{
                          height: '100%',
                          borderRadius: 2,
                          background: 'var(--tq-accent)',
                          width: `${uploadProgress.percent}%`,
                          transition: 'width 0.3s',
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {state.isAnalysing && elapsedSeconds > 0 && (
          <p className="text-tq-muted text-xs mb-4" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            {elapsedSeconds}s elapsed
          </p>
        )}

        <button
          onClick={handleCancel}
          className="btn-ghost text-sm"
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
        <p className="text-tq-muted text-xs mb-4" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
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
