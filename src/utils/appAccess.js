/**
 * Production access lock (2026-10-26), with a short window for Paul
 * (2026-10-27).
 *
 * FastQuote is closed to new signups. Mark's live Auth0 id can use
 * the app with no time limit. Paul Clough can sign in until 6pm UK
 * time on Sunday 1 November 2026 so he can download quotes he
 * already has. He cannot create new ones. Client quote links
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
// 6pm UK time. The UK is on GMT that day, so this is 18:00 UTC.
export const PAUL_ACCESS_UNTIL = '2026-11-01T18:00:00.000Z';

export function isAppAccessAllowed(userId, env = process.env.NODE_ENV, now = new Date()) {
  if (env !== 'production') return true;
  if (userId === MARK_USER_ID || userId === SMOKE_USER_ID) return true;
  if (userId === PAUL_USER_ID) {
    return now.getTime() < new Date(PAUL_ACCESS_UNTIL).getTime();
  }
  return false;
}

export function canCreateQuotes(userId, env = process.env.NODE_ENV, now = new Date()) {
  if (env !== 'production') return true;
  if (!isAppAccessAllowed(userId, env, now)) return false;
  return userId === MARK_USER_ID || userId === SMOKE_USER_ID;
}
