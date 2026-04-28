import React, { useEffect, useState } from 'react';

/**
 * AutosaveStatus — small indicator that surfaces the outcome of the
 * background draft autosave. Replaces the silent
 * `saveDraft(...).catch(() => {})` pattern at the auto-save call sites
 * (TRQ-166): users now see whether their work is actually being persisted
 * instead of typing into a tab whose persistence has broken.
 *
 * Reads `state.autosave` (status, lastSavedAt, error). Re-renders every
 * 30s while in 'saved' so the relative time stays fresh ("Saved 32s ago"
 * → "Saved 1m ago").
 *
 * Visual budget is intentionally tiny — this lives next to the
 * StepIndicator on every editor screen.
 */
function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return 'over an hour ago';
}

export default function AutosaveStatus({ autosave, onRetry }) {
  // Re-render every 30s so the relative time advances in saved state.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (autosave?.status !== 'saved') return undefined;
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, [autosave?.status, autosave?.lastSavedAt]);

  if (!autosave || autosave.status === 'idle') return null;

  const baseStyle = {
    fontSize: 12,
    fontFamily: 'Inter, sans-serif',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };

  if (autosave.status === 'saving') {
    return (
      <span style={{ ...baseStyle, color: 'var(--tq-muted)' }} aria-live="polite">
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--tq-muted)',
            animation: 'pulse 1.2s ease-in-out infinite',
          }}
        />
        Saving…
      </span>
    );
  }

  if (autosave.status === 'saved') {
    return (
      <span style={{ ...baseStyle, color: 'var(--tq-muted)' }} aria-live="polite">
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--tq-confirmed-bd)',
          }}
        />
        Saved {timeAgo(autosave.lastSavedAt)}
      </span>
    );
  }

  if (autosave.status === 'failed') {
    return (
      <span
        style={{ ...baseStyle, color: 'var(--tq-warn)' }}
        aria-live="assertive"
        title={autosave.error || 'Save failed'}
      >
        <span
          aria-hidden
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--tq-warn)',
          }}
        />
        Save failed
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--tq-accent)',
              fontSize: 12,
              cursor: 'pointer',
              padding: 0,
              textDecoration: 'underline',
            }}
          >
            retry
          </button>
        )}
      </span>
    );
  }

  return null;
}
