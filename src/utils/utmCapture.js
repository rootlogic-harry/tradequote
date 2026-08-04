/**
 * UTM capture — pure helper (no I/O, no session, no DB).
 *
 * Given an Express req.query object, extracts the three UTM parameters
 * FastQuote persists on new users for ad-attribution analytics:
 *
 *   ?utm_source=meta        → { source: 'meta', ... }
 *   ?utm_campaign=test1     → { campaign: 'test1', ... }
 *   ?utm_medium=paid_social → { medium: 'paid_social', ... }
 *
 * Returns `null` if NONE of the three are present with a valid value —
 * callers use the null to skip the session-stash / DB-write path.
 *
 * If any of the three is present but INVALID (too long / bad chars /
 * wrong type), that field alone is dropped. Others still return. This
 * matches how real-world tracking works — a broken campaign param
 * shouldn't take out the source it arrived with.
 *
 * Validation:
 *   - Type: must be a string. Arrays (?utm_source=a&utm_source=b) →
 *     Express hands us an array, drop it — attackers can weaponise
 *     duplicated params to smuggle payloads.
 *   - Length: ≤64 chars. Real UTM values are short slugs; anything
 *     longer is either garbage or an injection attempt.
 *   - Alphabet: /^[A-Za-z0-9._-]+$/ — matches the character set used
 *     by Meta / Google / LinkedIn ad managers. Rejects whitespace,
 *     angle brackets, quotes, newlines — the standard XSS + header-
 *     injection defences applied at the earliest possible layer.
 *
 * The same defensive shape is used by `normaliseReferralCode` in
 * src/utils/referrals.js — same threat model, same treatment.
 */

const UTM_MAX_LEN = 64;
const UTM_ALLOWED = /^[A-Za-z0-9._-]+$/;

function normaliseOne(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > UTM_MAX_LEN) return null;
  if (!UTM_ALLOWED.test(trimmed)) return null;
  return trimmed;
}

/**
 * pickUtms(query) — Extract + validate the three UTM params from a
 * request query object. Returns an object with { source, campaign,
 * medium } (each nullable) or `null` if none of the three yielded a
 * valid value.
 *
 * Callers should treat a null return as "no attribution to record"
 * and skip session write + DB write.
 */
export function pickUtms(query) {
  if (!query || typeof query !== 'object') return null;
  const source = normaliseOne(query.utm_source);
  const campaign = normaliseOne(query.utm_campaign);
  const medium = normaliseOne(query.utm_medium);
  if (!source && !campaign && !medium) return null;
  return { source, campaign, medium };
}

export const UTM_MAX_LENGTH = UTM_MAX_LEN;
export const UTM_ALLOWED_ALPHABET = UTM_ALLOWED;
