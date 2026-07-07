/**
 * Duplicate-group grouping (CLIENTS_SPEC_v3, patch 2026-07-07).
 *
 * The server's GET /clients/duplicates returns raw candidate PAIRS —
 * every 2-tuple of clients that share a signal (name, phone, email,
 * name+phone). Three duplicates of the same name become three pairs
 * (AB, AC, BC), which is the correct wire shape but the wrong UI shape:
 * the user shouldn't have to merge in three steps when the semantic
 * intent is "merge all three into one".
 *
 * `computeDuplicateGroups` performs Union-Find over the pairs to
 * collapse the transitive closure into a single group per equivalence
 * class of duplicates. A group of 3 clients renders as ONE card with
 * three "Keep this one" buttons — picking one triggers N-1 sequential
 * merges into the chosen target.
 *
 * Design decisions:
 *   - Grouping is transitive across ALL pair types (name, phone, email,
 *     name+phone). If A~B by name and B~C by phone, {A, B, C} is a
 *     single group. The rendered group lists every matchType/confidence
 *     present in the underlying pairs so the user can see how they
 *     were linked.
 *   - Clients not present in `clientsById` (e.g. one was merged in a
 *     prior action this session) are filtered out. A group whose
 *     surviving membership drops below 2 is discarded.
 *   - Group ordering: highest-confidence group first (a group's
 *     confidence is the max of its pairs), tiebreaker by group size
 *     descending so the "big win" merges rise to the top.
 */

const CONFIDENCE_RANK = { high: 0, medium: 1, low: 2 };

/**
 * @param {Array<{candidateClientIds: [string, string], matchType: string, confidence: string}>} duplicates
 * @param {Map<string, object>} clientsById
 * @returns {Array<{clients: object[], matchTypes: string[], confidences: string[]}>}
 */
export function computeDuplicateGroups(duplicates, clientsById) {
  if (!Array.isArray(duplicates) || duplicates.length === 0) return [];

  const parent = new Map();
  const find = (id) => {
    let cur = id;
    while (parent.get(cur) !== cur) cur = parent.get(cur);
    // Path compression.
    let step = id;
    while (parent.get(step) !== cur) {
      const next = parent.get(step);
      parent.set(step, cur);
      step = next;
    }
    return cur;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const pair of duplicates) {
    const ids = pair?.candidateClientIds;
    if (!Array.isArray(ids) || ids.length !== 2) continue;
    const [a, b] = ids;
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    union(a, b);
  }

  const groups = new Map();
  for (const pair of duplicates) {
    const ids = pair?.candidateClientIds;
    if (!Array.isArray(ids) || ids.length !== 2) continue;
    const [a, b] = ids;
    const root = find(a);
    if (!groups.has(root)) {
      groups.set(root, {
        clientIds: new Set(),
        matchTypes: new Set(),
        confidences: new Set(),
      });
    }
    const g = groups.get(root);
    g.clientIds.add(a);
    g.clientIds.add(b);
    if (pair.matchType) g.matchTypes.add(pair.matchType);
    if (pair.confidence) g.confidences.add(pair.confidence);
  }

  const out = [...groups.values()]
    .map((g) => ({
      clients: [...g.clientIds]
        .map((id) => clientsById?.get?.(id))
        .filter(Boolean),
      matchTypes: [...g.matchTypes],
      confidences: [...g.confidences],
    }))
    .filter((g) => g.clients.length >= 2);

  out.sort((a, b) => {
    const ra = Math.min(...a.confidences.map((c) => CONFIDENCE_RANK[c] ?? 3));
    const rb = Math.min(...b.confidences.map((c) => CONFIDENCE_RANK[c] ?? 3));
    if (ra !== rb) return ra - rb;
    return b.clients.length - a.clients.length;
  });

  return out;
}
