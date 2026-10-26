/**
 * Production access lock (2026-10-26).
 *
 * FastQuote is closed to new signups. The only account that may use
 * the app is Mark's live Auth0 id. Client quote links (/q/:token)
 * and the public site are not gated here — this is the tradesman app.
 *
 * Outside production the lock is off so tests and local development
 * keep working.
 */

export const MARK_USER_ID = 'markdoyle';

export function isAppAccessAllowed(userId, env = process.env.NODE_ENV) {
  if (env !== 'production') return true;
  return userId === MARK_USER_ID;
}
