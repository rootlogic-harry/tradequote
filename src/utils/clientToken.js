/**
 * Client-portal token helper.
 *
 * The token is the client's only credential to view a quote — there is no
 * account or password. It MUST have enough entropy that brute-force
 * guessing is computationally infeasible. UUID v4 gives 122 bits of
 * effective randomness (128 bits with 6 fixed version/variant bits), which
 * makes guessing any specific token infeasible even at internet scale.
 *
 * Rules, in priority order:
 *   1. Tokens come from crypto.randomUUID() — never Math.random, never
 *      timestamps, never concatenated IDs.
 *   2. Tokens expire 30 days after generation (spec CLAUDE_CLIENT_PORTAL
 *      "Security Model").
 *   3. isClientTokenExpired fails closed: any non-parseable / missing
 *      value is treated as already expired.
 */

export const CLIENT_TOKEN_TTL_DAYS = 30;
const TTL_MS = CLIENT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;

export function generateClientToken() {
  return globalThis.crypto.randomUUID();
}

export function computeClientTokenExpiry(now = new Date()) {
  const base = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return new Date(base + TTL_MS);
}

export function isClientTokenExpired(expiresAt, now = new Date()) {
  if (expiresAt == null) return true;
  const ts = expiresAt instanceof Date ? expiresAt.getTime() : new Date(expiresAt).getTime();
  if (Number.isNaN(ts)) return true;
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  return ts <= nowMs;
}
