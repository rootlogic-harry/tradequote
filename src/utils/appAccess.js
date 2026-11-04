/**
 * Production access lock (2026-10-26).
 *
 * FastQuote is closed to new signups. Mark's live Auth0 id and Paul
 * Clough can use the app with no time limit. Paul is back on as a
 * full user (2026-11-04), free of charge. The download-only window
 * is gone. Client quote links
 * (/q/:token) and the public site are not gated here.
 *
 * Outside production the lock is off so tests and local development
 * keep working.
 */

export const MARK_USER_ID = 'markdoyle';
export const PAUL_USER_ID = 'paulclough';
// The Playwright smoke suite signs in as this account against production.
// It is not a customer. Without it, every pull request's smoke check
// fails while the lock is on.
export const SMOKE_USER_ID = 'tq_agent_smoke';

const ALLOWED_USER_IDS = new Set([MARK_USER_ID, PAUL_USER_ID, SMOKE_USER_ID]);

export function isAppAccessAllowed(userId, env = process.env.NODE_ENV) {
  if (env !== 'production') return true;
  return ALLOWED_USER_IDS.has(userId);
}

export function canCreateQuotes(userId, env = process.env.NODE_ENV) {
  // Everyone who can sign in can quote. Paul included.
  return isAppAccessAllowed(userId, env);
}
