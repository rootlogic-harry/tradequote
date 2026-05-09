const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function isThisMonth(dateStr, now = new Date()) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export function isThisYear(dateStr, now = new Date()) {
  if (!dateStr) return false;
  return new Date(dateStr).getFullYear() === now.getFullYear();
}

// 12 entries — one per calendar month of the supplied year — so the
// breakdown panel can render months with £0 without gaps.
export function buildMonthlyTotals(jobs, now = new Date()) {
  const totals = Array.from({ length: 12 }, (_, i) => ({
    month: i,
    label: MONTH_LABELS[i],
    total: 0,
    count: 0,
  }));
  for (const job of jobs) {
    if (!isThisYear(job.savedAt, now)) continue;
    const m = new Date(job.savedAt).getMonth();
    totals[m].total += job.totalAmount ?? 0;
    totals[m].count += 1;
  }
  return totals;
}
