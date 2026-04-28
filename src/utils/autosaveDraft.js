/**
 * Autosave wrapper around saveDraft (TRQ-166).
 *
 * Replaces the six `saveDraft(userId, state).catch(() => {})` call sites
 * across App.jsx, JobDetails.jsx, and ReviewEdit.jsx. Each call dispatches
 * AUTOSAVE_START before the network attempt and AUTOSAVE_OK / AUTOSAVE_FAIL
 * after, so the UI can render a "Saved 12s ago" / "Save failed — retry"
 * indicator instead of users typing into a tab whose persistence has
 * silently broken.
 *
 * Best-effort by design: never re-throws. Background autosaves should
 * not crash the calling effect; errors are surfaced through reducer
 * state, which the UI consumes.
 */
import { saveDraft } from './userDB.js';

export async function autosaveDraft(userId, state, dispatch) {
  if (!userId) return;
  // TRQ-167: skip if the tab is backgrounded. Drafts are keyed
  // UNIQUE(user_id) at the DB layer, so two tabs both running their
  // 5s timer would race on the same row — last write wins. A user
  // with FastQuote open in two tabs (Mark's admin workflow) would
  // see Tab A's typing clobbered by Tab B's stale-state autosave.
  // Skipping when hidden lets the visible tab own the row. When the
  // backgrounded tab is brought forward, the next state change re-
  // arms the 5s timer in App.jsx and it catches up automatically.
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    return;
  }
  // Defensive fallback for the rare call site that doesn't have access
  // to dispatch (e.g. utility code paths). Behaves exactly like the
  // legacy silent catch — degrades cleanly rather than crashing.
  if (!dispatch) {
    try { await saveDraft(userId, state); } catch { /* legacy silent fallback */ }
    return;
  }
  dispatch({ type: 'AUTOSAVE_START' });
  try {
    await saveDraft(userId, state);
    dispatch({ type: 'AUTOSAVE_OK' });
  } catch (err) {
    dispatch({
      type: 'AUTOSAVE_FAIL',
      error: err?.message || 'Save failed',
    });
  }
}
