// ── Constants ──

export const MAX_DURATION_MS = 120_000;        // 2 minutes
export const WARNING_THRESHOLD_MS = 105_000;   // 1:45
export const SLOW_PROCESSING_MS = 10_000;

export const VOICE_STATES = {
  IDLE: 'idle',
  RECORDING: 'recording',
  WARNING: 'warning',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  ERROR: 'error',
  PERMISSION_DENIED: 'permission_denied',
  UNSUPPORTED: 'unsupported',
};

// ── Pure helpers ──

/**
 * Build the new textarea value after a successful transcription.
 *
 * Insertion order (per spec):
 *   1. text already present before recording began
 *   2. the returned transcript
 *   3. any text typed while transcription was pending
 */
export function buildInsertedText(preRecordingValue, transcript, currentValue) {
  const pre = preRecordingValue.trimEnd();
  const pendingTyped = currentValue.startsWith(preRecordingValue)
    ? currentValue.slice(preRecordingValue.length).trimStart()
    : '';

  const parts = [];
  if (pre) parts.push(pre);
  parts.push(transcript);
  if (pendingTyped) parts.push(pendingTyped);

  return parts.join('\n\n');
}

/**
 * Check if a recorded segment has been edited by the user.
 * Simple substring match — if the exact text is no longer present, it's been edited.
 */
export function isSegmentEdited(segmentText, currentValue) {
  return !currentValue.includes(segmentText);
}

/**
 * Remove all unedited recorded segments from the textarea value.
 * Preserves manually typed text and edited segments.
 * Cleans up extra whitespace left behind.
 */
export function applyRemoval(value, segments) {
  let result = value;

  for (const seg of segments) {
    if (seg.edited) continue;
    // Remove the segment and any surrounding blank-line separators
    const escaped = seg.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp('\\n\\n' + escaped, 'g'), '');
    result = result.replace(new RegExp(escaped + '\\n\\n', 'g'), '');
    result = result.replace(new RegExp(escaped, 'g'), '');
  }

  // Collapse triple+ newlines to double
  result = result.replace(/\n{3,}/g, '\n\n');
  return result.trim();
}

/**
 * Format milliseconds as m:ss for the recording timer.
 */
export function formatTime(ms) {
  const secs = Math.floor(ms / 1000);
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
