export function calculateMaterialsSubtotal(materials) {
  return materials.reduce((sum, m) => sum + (m.totalCost || 0), 0);
}

export function calculateLabourTotal(days, workers, dayRate) {
  return days * workers * dayRate;
}

export function calculateAdditionalCostsTotal(additionalCosts) {
  return additionalCosts.reduce((sum, c) => sum + (c.amount || 0), 0);
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
