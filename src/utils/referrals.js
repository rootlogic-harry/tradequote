/**
 * Referrals Phase 1 (2026-06-23) — pure helpers.
 *
 * The product mechanic (locked in spec dated 2026-06-23):
 *  - Referred signup → +2 bonus quotes (5 total).
 *  - Referrer reward → +2 bonus quotes per successful referral, where
 *    "successful" means the referee completed their first AI analysis.
 *  - Single-level only (no cascading).
 *  - No claw-back on churn.
 *  - Codes are human-readable (e.g. `PAULJULY` for seeded users;
 *    `<USERFIRST6>-<RAND4>` for the lazy generator).
 *
 * This file is the pure-function half — all I/O lives in the
 * `getOrCreateReferralCode`, `redeemReferralCode`, and analyse-route
 * credit-trigger code in server.js. Keep the dep graph one-way so the
 * helpers can be unit-tested without touching pg.
 */

const CODE_BODY_LEN = 6;
const CODE_RAND_LEN = 4;
// Crockford-style alphabet — no 0/O, no 1/I, no L. Avoids confusion
// in spoken sharing ("PAUL-O7K9" vs "PAUL-0K79") which matters because
// referrers will read these aloud on WhatsApp voice messages.
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/**
 * Pure code-generator. Accepts an injectable `rand` for tests so
 * we don't depend on global randomness.
 *
 * Shape: `<USERFIRST6>-<RAND4>` (e.g. `MARKDO-X7K9`).
 *  - If the user-derived prefix is empty (e.g. name has no
 *    alphanumerics), falls back to "USER".
 *  - Always uppercase, A-Z + digits from the safe alphabet.
 */
export function generateReferralCode(seed, rand = randomChar) {
  const prefix = (typeof seed === 'string' ? seed : '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_BODY_LEN);
  const body = prefix.length > 0 ? prefix : 'USER';
  let suffix = '';
  for (let i = 0; i < CODE_RAND_LEN; i++) suffix += rand();
  return `${body}-${suffix}`;
}

function randomChar() {
  // Math.random is fine here — these codes are NOT a security
  // primitive (the URL token in /q/:token is). The DB has UNIQUE on
  // (code) and the caller retries on conflict, so the bar is just
  // "low probability of immediate collision". 31^4 ≈ 900k suffixes
  // per prefix is plenty for our scale.
  return CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
}

/**
 * Normalise a referral code from a query param or form field.
 * Uppercase, trim, strip whitespace. Empty string → null so the
 * caller can branch cleanly on "no code provided".
 */
export function normaliseReferralCode(raw) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.trim().toUpperCase();
  if (cleaned.length === 0) return null;
  // Allow letters, digits, hyphen. Anything else → reject as
  // malformed (the caller treats this the same as "unknown code"
  // and falls through to default signup).
  if (!/^[A-Z0-9-]+$/.test(cleaned)) return null;
  // Hard cap on length so a hostile signup URL can't ship
  // 10kB of "code" through the validation path.
  if (cleaned.length > 64) return null;
  return cleaned;
}

/**
 * Decide whether a code redemption is valid for a given user.
 * Pure — takes the already-looked-up code row.
 *
 *   - code row not found → invalid, reason 'unknown'
 *   - code belongs to the same user → invalid, reason 'self'
 *   - otherwise → valid
 *
 * The caller follows up with the INSERT into `referrals` (which has
 * UNIQUE on referee_user_id so double-redemption is impossible).
 */
export function validateRedemption({ codeRow, userId }) {
  if (!codeRow) return { valid: false, reason: 'unknown' };
  if (codeRow.user_id === userId) return { valid: false, reason: 'self' };
  return { valid: true, referrerUserId: codeRow.user_id };
}

/**
 * The signup bonus — referee gets +2 quotes when they sign up via a
 * valid referral code. Centralised here so the OAuth callback and
 * the /auth/redeem-referral endpoint agree on the exact value.
 */
export const REFERRAL_REFEREE_BONUS = 2;

/**
 * The completion reward — referrer gets +2 quotes when the referee
 * finishes their first analysis. Same value as REFERRAL_REFEREE_BONUS
 * per the locked spec, but separately named so a future tweak (e.g.
 * different referrer-vs-referee bonuses) is a one-line change.
 */
export const REFERRAL_REFERRER_REWARD = 2;
