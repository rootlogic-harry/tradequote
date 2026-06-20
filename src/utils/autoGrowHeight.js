/**
 * Pure height + overflow decision for the shared AutoGrowTextarea.
 *
 * Why a separate helper:
 *
 *   - The interesting logic (floor at minHeight, cap at maxHeight, flip
 *     overflow to auto once we've capped) is testable on its own without
 *     having to spin up jsdom for the React component.
 *   - Keeps the component file focused on DOM wiring and the fallback /
 *     fade-overlay choreography.
 *
 * Inputs:
 *   scrollHeight — the natural content height in px (textarea.scrollHeight
 *                  after height="auto"). Comes from the DOM at call time.
 *   minHeight    — px floor; what the textarea looks like when empty.
 *   maxHeight    — optional px cap. When unset the textarea grows
 *                  unbounded (current behaviour, preserved for every
 *                  call site that does not opt in).
 *
 * Output:
 *   { height, overflowY, overflowing }
 *     height       — px to apply to style.height (number, caller wraps in `px`).
 *     overflowY    — 'hidden' (default) or 'auto' once capped.
 *     overflowing  — boolean — true exactly when scrollHeight > maxHeight.
 *                    Drives the fade-overlay cue in the component.
 */
export function computeAutoGrowHeight({ scrollHeight, minHeight, maxHeight }) {
  const natural = Math.max(minHeight, scrollHeight);

  if (maxHeight == null) {
    return { height: natural, overflowY: 'hidden', overflowing: false };
  }

  const overflowing = scrollHeight > maxHeight;
  const height = Math.min(natural, maxHeight);
  return {
    height,
    overflowY: overflowing ? 'auto' : 'hidden',
    overflowing,
  };
}
