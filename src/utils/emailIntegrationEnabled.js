/**
 * Email integration feature flag.
 *
 * The Quote Screen's "Send via Email" / "Send via Outlook" entry points
 * are gated by this flag. The user-experience reality (Harry's screenshot
 * review 2026-06-29):
 *
 *   • Most wallers don't have Outlook configured at all.
 *   • Mobile users have no Outlook flow to begin with.
 *   • The .eml file path is brittle across desktop mail clients.
 *
 * In practice the waller's workflow is: copy the client link → paste
 * into WhatsApp / SMS / their own email → done. The Email / Outlook
 * items in the caret menu mislead more than they help.
 *
 * This flag hides the Email + Outlook menu items in production while
 * leaving the underlying code (`handleEmail`, `handleSendViaOutlook`,
 * `buildEmlMessage` — CLAUDE.md Pitfall #15) untouched, so the surface
 * can be flipped back on with no redeploy when the email path is
 * reworked.
 *
 * Contract (mirrors VIDEO_ANALYSIS_ENABLED — see docs/VIDEO_FLAG.md):
 *
 *   Environment           | env var unset    | env var = "true" | env var = "false"
 *   ----------------------|------------------|------------------|------------------
 *   production            | DISABLED         | ENABLED          | DISABLED
 *   non-production        | ENABLED          | ENABLED          | DISABLED
 *
 * The asymmetry is deliberate. In production, an accidentally-cleared
 * Railway variable must NOT silently re-enable a surface Harry has
 * judged confusing — it should fail closed. Staging / dev default
 * open so the path can be iterated on.
 *
 * Truthy values: "true", "1", "yes" (case-insensitive, trimmed).
 * Falsy values:  anything else, including empty string and missing.
 *
 * No coupling to `process.env` inside the function — callers pass the
 * relevant env values so tests don't have to mutate global state.
 *
 * @param {object} env
 * @param {string} [env.flag]    — value of process.env.EMAIL_INTEGRATION_ENABLED
 * @param {string} [env.nodeEnv] — value of process.env.NODE_ENV
 * @returns {boolean} whether the email integration entry points should be shown
 */
export function isEmailIntegrationEnabled({ flag, nodeEnv } = {}) {
  const normalisedFlag = typeof flag === 'string' ? flag.trim().toLowerCase() : '';
  const isProd = nodeEnv === 'production';

  if (normalisedFlag === 'true' || normalisedFlag === '1' || normalisedFlag === 'yes') {
    return true;
  }
  if (normalisedFlag === 'false' || normalisedFlag === '0' || normalisedFlag === 'no') {
    return false;
  }
  // Unset / unrecognised value: prod fails closed, non-prod defaults open.
  return !isProd;
}

/**
 * Convenience wrapper that reads from `process.env` directly. Use this
 * in route handlers and the /auth/me payload; use `isEmailIntegrationEnabled`
 * directly in tests so you don't have to mutate process.env.
 */
export function isEmailIntegrationEnabledFromProcessEnv() {
  return isEmailIntegrationEnabled({
    flag: process.env.EMAIL_INTEGRATION_ENABLED,
    nodeEnv: process.env.NODE_ENV,
  });
}
