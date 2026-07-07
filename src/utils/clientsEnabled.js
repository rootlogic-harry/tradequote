/**
 * Clients + Sites feature flag (2026-07-07).
 *
 * Gates the routes + UI added by CLIENTS_SPEC_v3. The schema itself
 * ships unconditionally (additive tables, zero cost when unused) — this
 * flag only controls whether users can SEE or USE the feature.
 *
 * Contract (deliberately stricter than the video/email flags):
 *
 *   env var value    → result
 *   -----------------|--------
 *   'true'           | ENABLED
 *   anything else    | DISABLED (including unset, 'false', '1', empty)
 *
 * The stricter check exists because the Clients feature is new-and-
 * unproven surface. Video/email default open in non-prod because we
 * want staging iteration to be frictionless. Clients defaults CLOSED
 * everywhere so a Railway config wipe or a mis-typed value fails
 * closed the same way in every environment — including Harry's own
 * dev machine. When we flip it on, we do so deliberately.
 *
 * See docs/CLIENTS_SPEC_v3.md § 2 and docs/CLIENTS_ROLLBACK.md
 * for the operator runbook.
 *
 * No coupling to process.env inside the pure function — callers pass
 * the flag value so tests don't have to mutate global state.
 *
 * @param {object} env
 * @param {string} [env.flag] — value of process.env.CLIENTS_ENABLED
 * @returns {boolean}
 */
export function isClientsEnabled({ flag } = {}) {
  return flag === 'true';
}

/**
 * Convenience wrapper that reads process.env directly. Use inside
 * route handlers; use isClientsEnabled() directly in tests.
 *
 * Named `isClientsEnabledFromProcessEnv` for symmetry with
 * `isVideoAnalysisEnabledFromProcessEnv` and
 * `isEmailIntegrationEnabledFromProcessEnv`.
 */
export function isClientsEnabledFromProcessEnv() {
  return process.env.CLIENTS_ENABLED === 'true';
}
