/**
 * Client rollup helper — pure function.
 *
 * Given a list of `jobs` rows for a single client (typically fetched
 * via a JOIN through the client's sites), compute the four numbers
 * that make the Client detail page useful:
 *
 *   - totalWon           = sum(total_amount) WHERE status IN ('accepted', 'completed')
 *   - outstanding        = sum(total_amount) WHERE status = 'sent'
 *   - livePipeline       = sum(total_amount) WHERE status = 'accepted' AND completed_at IS NULL
 *   - lifetimeQuoteCount = count(*) — every job regardless of status
 *
 * Callers pass an array of plain objects with { status, totalAmount,
 * completedAt } — the field names match the columns returned from a
 * standard jobs SELECT. Any missing/null fields are treated as
 * zero/absent per §4 of CLIENTS_SPEC_v3.md.
 *
 * TDD: implementation lands with PR #3 (routes + rollup). Tests in
 * `src/__tests__/clientsRollup.test.js` define the contract.
 */
export function resolveClientRollup(_jobs) {
  throw new Error(
    'resolveClientRollup not yet implemented — TDD stub for PR #3. See docs/CLIENTS_SPEC_v3.md § 4.'
  );
}
