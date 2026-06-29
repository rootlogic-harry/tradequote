/**
 * Compact currency formatter for the Dashboard stats strip on very-small
 * viewports (≤359px, e.g. iPhone SE / older Android in portrait).
 *
 * The default `formatCurrency` in `quoteBuilder.js` returns the full
 * `£1,200,000.00` form which overflows the ~165px stats cell on 360px
 * (audit item #19 in /tmp/mobile-responsive-plan.md). This helper
 * abbreviates to k / M with one decimal where it adds information.
 *
 * Examples:
 *   1234       -> "£1.2k"
 *   12500      -> "£12.5k"
 *   999500     -> "£999.5k"
 *   1200000    -> "£1.2M"
 *   12500000   -> "£12.5M"
 *   850        -> "£850"      (below 1k threshold — full form, no decimals)
 *   0          -> "£0"
 *   -1500      -> "-£1.5k"
 *
 * Anything below 1,000 returns the integer form (no fractional pence)
 * because that's what stat cells already show fine on small screens —
 * the issue is the 7+ figure cases. Always returns a string, never NaN.
 */
export function formatCurrencyCompact(amount) {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '£0';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);

  if (abs >= 1_000_000) {
    return `${sign}£${trimTrailingZero((abs / 1_000_000).toFixed(1))}M`;
  }
  if (abs >= 1_000) {
    return `${sign}£${trimTrailingZero((abs / 1_000).toFixed(1))}k`;
  }
  // Below 1k — show whole pounds, no pence (stat strip is integer-y here).
  return `${sign}£${Math.round(abs).toLocaleString('en-GB')}`;
}

// "1.0" -> "1", "1.5" -> "1.5". Keeps the compact form visually tight
// when the decimal would just be zero (£1M, not £1.0M).
function trimTrailingZero(s) {
  return s.endsWith('.0') ? s.slice(0, -2) : s;
}
