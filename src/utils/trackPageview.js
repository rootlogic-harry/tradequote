/**
 * TRQ-15 — Pageview beacon for the React SPA.
 *
 * Fires one anonymous POST /api/track per route change:
 *   - On initial mount.
 *   - On every history.pushState / replaceState (wrapped at install time).
 *   - On the browser back/forward popstate event.
 *
 * Privacy:
 *   - Honours `navigator.doNotTrack === '1'` — skips ALL writes.
 *   - Honours `sessionStorage.fq_no_track === '1'` for local debugging.
 *   - Session ID is random-per-session (not persistent across tabs/days).
 *   - All errors are swallowed — the beacon never throws into user code.
 *
 * Public API:
 *   - installSpaPageviewBeacon()  → call once at app startup
 *   - trackPageview(pathOverride) → manual call, useful in tests
 */

const SESSION_KEY = 'fq_session_id';

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

// 64-char random ID. Per-tab, expires when the tab closes. No fingerprint.
function ensureSessionId() {
  try {
    let id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    return null;
  }
}

export function trackPageview(pathOverride) {
  if (typeof window === 'undefined') return;
  if (isDntOn()) return;
  try {
    const path = pathOverride || window.location.pathname || '/';
    const referrer = document.referrer || '';
    const sessionId = ensureSessionId();
    // keepalive: lets the beacon survive page unload (e.g. when the
    // user clicks an external link). Browsers cap keepalive bodies at
    // 64KB — our payload is well under 1KB so no risk.
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, referrer, sessionId }),
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

let installed = false;
export function installSpaPageviewBeacon() {
  if (typeof window === 'undefined' || installed) return;
  installed = true;
  // Initial pageview on first install.
  trackPageview();
  // SPA navigation hook — wrap pushState + replaceState so any router
  // (App.jsx's setCurrentView, react-router, manual history calls)
  // fires the beacon without needing to know about it.
  const wrap = (name) => {
    const orig = window.history[name];
    if (!orig || orig.__fq_wrapped) return;
    window.history[name] = function (...args) {
      const ret = orig.apply(this, args);
      // Defer one tick so DOM/title updates land before the beacon
      // captures the new URL.
      setTimeout(() => trackPageview(), 0);
      return ret;
    };
    window.history[name].__fq_wrapped = true;
  };
  wrap('pushState');
  wrap('replaceState');
  window.addEventListener('popstate', () => trackPageview());
}
