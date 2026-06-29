/**
 * Analytics Phase 1 — first-party event beacon for the React SPA.
 *
 * Mirror of src/utils/trackPageview.js, but for named events (quote
 * started, photo uploaded, pdf downloaded, etc.) rather than pageviews.
 *
 * Privacy:
 *   - Honours `navigator.doNotTrack === '1'` — skips ALL writes.
 *   - Honours `sessionStorage.fq_no_track === '1'` for local debugging.
 *   - Test env (no `window`) no-ops so Jest doesn't fire fetch.
 *   - Silent failure — never throws, never logs to console.error.
 *
 * Public API:
 *   - trackEvent(name, props) → fire-and-forget beacon to /api/event
 */

function isDntOn() {
  if (typeof navigator === 'undefined') return false;
  const dnt = navigator.doNotTrack || window.doNotTrack;
  if (dnt === '1' || dnt === 'yes') return true;
  try {
    if (sessionStorage.getItem('fq_no_track') === '1') return true;
  } catch {
    // sessionStorage may be unavailable in private mode — fall through.
  }
  return false;
}

export function trackEvent(name, props = {}) {
  // Test-env / SSR — bail before touching navigator/fetch.
  if (typeof window === 'undefined') return;
  if (!name || typeof name !== 'string') return;
  if (isDntOn()) return;
  try {
    // keepalive: lets the beacon survive page unload (e.g. PDF download
    // navigation or external Stripe redirect). Bodies capped at 64KB
    // browser-side; our payload is well under 1KB.
    fetch('/api/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, props: props && typeof props === 'object' ? props : {} }),
      keepalive: true,
      credentials: 'same-origin',
    }).catch(() => {
      // Network failures are silent by design — analytics must never
      // break the user experience.
    });
  } catch {
    // Defensive: never throw out of the beacon.
  }
}
