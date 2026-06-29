/**
 * Quota-exhausted modal (2026-06-29).
 *
 * Source-level guard for the new modal. The lockout UI was previously
 * only rendered inline on AIAnalysis (Step 3) — but exhausted users
 * stopped at Step 1 / Dashboard never saw it. The dispatch became a
 * silent dead-end. This modal renders globally whenever
 * state.quotaLockout is set, so the lockout surfaces wherever the user
 * is, with both forward paths (Buy 5 / Subscribe) plus a Cancel.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modalSrc = readFileSync(
  join(__dirname, '../components/QuotaExhaustedModal.jsx'),
  'utf8',
);
const appSrc = readFileSync(join(__dirname, '../App.jsx'), 'utf8');

describe('QuotaExhaustedModal component', () => {
  test('exports a default React component', () => {
    expect(modalSrc).toMatch(/export default function QuotaExhaustedModal/);
  });

  test('accepts lockout + onDismiss props', () => {
    expect(modalSrc).toMatch(/function QuotaExhaustedModal\(\{\s*lockout,\s*onDismiss\s*\}\)/);
  });

  test('renders null when lockout is null (no flash on mount)', () => {
    expect(modalSrc).toMatch(/if \(!lockout\) return null/);
  });

  test('has dialog role + aria-modal for accessibility', () => {
    expect(modalSrc).toMatch(/role="dialog"/);
    expect(modalSrc).toMatch(/aria-modal="true"/);
    expect(modalSrc).toMatch(/aria-labelledby=/);
  });

  test('Buy 5 quotes button posts to /api/billing/buy-quote-pack', () => {
    expect(modalSrc).toMatch(/Buy 5 quotes — £9\.99/);
    expect(modalSrc).toMatch(/'\/api\/billing\/buy-quote-pack'/);
  });

  test('Subscribe button posts to /api/billing/checkout', () => {
    expect(modalSrc).toMatch(/Subscribe — £19\.99 \/ month/);
    expect(modalSrc).toMatch(/'\/api\/billing\/checkout'/);
  });

  test('both checkout handlers redirect to the Stripe-returned URL', () => {
    // Both endpoints return { url } — modal uses window.location.href.
    const matches = modalSrc.match(/window\.location\.href = url/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('"Maybe later" cancel button calls onDismiss', () => {
    expect(modalSrc).toMatch(/Maybe later/);
    expect(modalSrc).toMatch(/onClick=\{onDismiss\}/);
  });

  test('uses the effective freeQuotesLimit from the lockout payload', () => {
    // Referrals Phase 1 — referees see 5, cold signups see 3.
    expect(modalSrc).toMatch(/lockout\.freeQuotesLimit/);
  });

  test('no banned vocabulary in user-visible copy', () => {
    const stripped = modalSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\b(AI|agent|confidence|calibration|model|prompt|LLM|Claude|Sonnet)\b/i);
  });

  test('all buttons meet the 44px touch target rule', () => {
    // Buy + Subscribe + Cancel — three interactive elements. Each has
    // minHeight: 44 (or larger).
    const inlineMatches = modalSrc.match(/minHeight:\s*\d+/g) || [];
    // 3 buttons + nothing else uses minHeight in this component. All
    // should be ≥ 44.
    for (const m of inlineMatches) {
      const n = parseInt(m.replace(/minHeight:\s*/, ''), 10);
      expect(n).toBeGreaterThanOrEqual(44);
    }
    expect(inlineMatches.length).toBeGreaterThanOrEqual(3);
  });
});

describe('App.jsx wires the QuotaExhaustedModal globally', () => {
  test('imports QuotaExhaustedModal', () => {
    expect(appSrc).toMatch(/import QuotaExhaustedModal from '\.\/components\/QuotaExhaustedModal\.jsx'/);
  });

  test('mounts the modal gated on state.quotaLockout', () => {
    expect(appSrc).toMatch(/state\.quotaLockout && \(\s*<QuotaExhaustedModal/);
  });

  test('modal onDismiss dispatches CLEAR_QUOTA_LOCKOUT', () => {
    expect(appSrc).toMatch(/onDismiss=\{\(\) => dispatch\(\{ type: ['"]CLEAR_QUOTA_LOCKOUT['"] \}\)\}/);
  });

  test('passes the lockout payload through to the modal', () => {
    expect(appSrc).toMatch(/lockout=\{state\.quotaLockout\}/);
  });
});
