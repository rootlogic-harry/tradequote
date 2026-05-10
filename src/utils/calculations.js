// Sum line totals in pence (integer arithmetic) so the final subtotal
// matches the per-row displayed totals to the penny. Floating-point sums
// of 99.96 + 99.97 + 99.98 produce 299.91 → we round once at the end.
export function calculateMaterialsSubtotal(materials) {
  const pence = materials.reduce(
    (sum, m) => sum + Math.round(((m.totalCost || 0) + Number.EPSILON) * 100),
    0
  );
  return pence / 100;
}

// NaN-safe: undefined/null inputs collapse to 0 instead of propagating
// NaN through the subtotal and into the rendered quote ("£NaN").
// The validators block NaN labour from saving, but a missing dayRate
// during analysis loadout would still show NaN in the live preview
// without this guard.
export function calculateLabourTotal(days, workers, dayRate) {
  const safe = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return safe(days) * safe(workers) * safe(dayRate);
}

export function calculateAdditionalCostsTotal(additionalCosts) {
  // Negative amounts are not allowed (validation belongs upstream, but
  // we floor at 0 here so a stray "-100" can't silently understate a quote).
  return additionalCosts.reduce(
    (sum, c) => sum + Math.max(0, c.amount || 0),
    0
  );
}

export function calculateSubtotal(materialsSubtotal, labourTotal, additionalCostsTotal) {
  return materialsSubtotal + labourTotal + additionalCostsTotal;
}

/**
 * Normalise the VAT-registered flag to a strict boolean.
 *
 * This is the SINGLE PLACE in the codebase that decides "is this profile
 * VAT-registered?". Every calculation path (calculateVAT / calculateAllTotals)
 * and every render path (QuoteDocument, ReviewEdit, QuoteOutput PDF +
 * DOCX + email footer) reads through this function.
 *
 * The bug it prevents: profile.vatRegistered being used with a truthy
 * check (`if (!vatRegistered)` or `{profile.vatRegistered && <row />}`)
 * treats non-boolean truthy values — string "false", number 1, any
 * object — as if the tradesman were registered. That was the root of
 * Paul's "VAT applied to a not-VAT-registered profile" regression.
 *
 * Fail-closed: only the literal boolean `true` turns VAT on. Anything
 * else (undefined, null, strings, numbers, objects) → not registered.
 * A tradesman can always re-tick the box to opt in; we never silently
 * promote a suspicious value to true.
 */
export function normaliseVatRegistered(v) {
  return v === true;
}

export function calculateVAT(subtotal, vatRegistered) {
  if (!normaliseVatRegistered(vatRegistered)) return 0;
  return Math.round(subtotal * 0.2 * 100) / 100;
}

export function calculateTotal(subtotal, vatAmount) {
  return subtotal + vatAmount;
}

export function calculateAllTotals(materials, labour, additionalCosts, vatRegistered) {
  const materialsSubtotal = calculateMaterialsSubtotal(materials);
  const labourTotal = calculateLabourTotal(labour.days, labour.workers, labour.dayRate);
  const additionalCostsTotal = calculateAdditionalCostsTotal(additionalCosts);
  const subtotal = calculateSubtotal(materialsSubtotal, labourTotal, additionalCostsTotal);
  const vatAmount = calculateVAT(subtotal, vatRegistered);
  const total = calculateTotal(subtotal, vatAmount);
  return { materialsSubtotal, labourTotal, additionalCostsTotal, subtotal, vatAmount, total };
}
