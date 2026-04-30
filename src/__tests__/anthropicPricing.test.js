/**
 * Pricing helper for the Analytics dashboard (TRQ-173).
 */
import {
  tokensToGbp,
  whisperBytesToGbp,
  knownModels,
  getPriceMap,
  PRICES_LAST_REVIEWED,
  USD_TO_GBP,
} from '../utils/anthropicPricing.js';

describe('tokensToGbp', () => {
  test('Sonnet 4: 1M input + 1M output → £14.22', () => {
    // 1M × $3 + 1M × $15 = $18; × 0.79 = £14.22
    const gbp = tokensToGbp('claude-sonnet-4-20250514', 1_000_000, 1_000_000);
    expect(gbp).toBeCloseTo(14.22, 2);
  });

  test('Haiku 4.5: 1M input + 1M output → £4.74', () => {
    // 1M × $1 + 1M × $5 = $6; × 0.79 = £4.74
    const gbp = tokensToGbp('claude-haiku-4-5-20251001', 1_000_000, 1_000_000);
    expect(gbp).toBeCloseTo(4.74, 2);
  });

  test('typical analyse call (10k input, 2k output) on Sonnet 4 → ~£0.05', () => {
    const gbp = tokensToGbp('claude-sonnet-4-20250514', 10_000, 2_000);
    // 10k × $3/1M + 2k × $15/1M = $0.03 + $0.03 = $0.06; × 0.79 = £0.0474
    expect(gbp).toBeCloseTo(0.0474, 4);
  });

  test('zero tokens returns 0', () => {
    expect(tokensToGbp('claude-sonnet-4-20250514', 0, 0)).toBe(0);
  });

  test('unknown model returns 0 (does NOT throw)', () => {
    // A row written before a model was added shouldn't blow up Analytics.
    expect(tokensToGbp('claude-future-9000', 1000, 1000)).toBe(0);
  });

  test('handles undefined input/output gracefully', () => {
    expect(tokensToGbp('claude-sonnet-4-20250514')).toBe(0);
  });
});

describe('whisperBytesToGbp', () => {
  test('approximately 1 minute of audio (240 KB) → ~£0.005', () => {
    // 1 min × $0.006 × 0.79 = $0.00474
    const gbp = whisperBytesToGbp(240 * 1024);
    expect(gbp).toBeCloseTo(0.00474, 4);
  });

  test('zero bytes returns 0', () => {
    expect(whisperBytesToGbp(0)).toBe(0);
  });
});

describe('metadata exports', () => {
  test('knownModels lists current allowlist', () => {
    const models = knownModels();
    expect(models).toContain('claude-sonnet-4-20250514');
    expect(models).toContain('claude-haiku-4-5-20251001');
  });

  test('PRICES_LAST_REVIEWED is an ISO date string', () => {
    expect(PRICES_LAST_REVIEWED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('getPriceMap returns shape Analytics dashboard reads', () => {
    const map = getPriceMap();
    expect(map.pricesLastReviewed).toBe(PRICES_LAST_REVIEWED);
    expect(map.usdToGbp).toBe(USD_TO_GBP);
    expect(map.anthropicUsdPerMtok).toBeDefined();
    expect(map.whisperUsdPerMinute).toBeGreaterThan(0);
  });
});
