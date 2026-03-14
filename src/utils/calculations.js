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

export function calculateVAT(subtotal, vatRegistered) {
  if (!vatRegistered) return 0;
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
