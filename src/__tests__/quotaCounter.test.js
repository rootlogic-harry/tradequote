/**
 * Persistent quotes-remaining counter (2026-06-23, PR B).
 *
 * Tests cover:
 *   1. Pure helpers — selectCounterState, compedMonthCopy, counterCopy.
 *   2. Source-level guards on QuotaCounter.jsx (data-testid, no
 *      banned vocab, no buy button, TODO for PR C).
 *   3. App-level wiring — refreshBilling callback exists and is wired
 *      to analyseJob's onAnalysisSuccess; QuotaCounter is mounted
 *      above SubscriptionBanner.
 *   4. analyseJob calls onAnalysisSuccess on success but NOT on
 *      failure paths.
 *
 * Jest config uses `transform: {}` so we can't render JSX. The pure
 * helpers carry the decision logic; the JSX is a thin presentation
 * layer asserted via source-scan.
 */
import { jest, describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  selectCounterState,
  compedMonthCopy,
  counterCopy,
  counterBreakdown,
} from '../utils/quotaCounter.js';
import { runAnalysis } from '../utils/analyseJob.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const counterSrc = readFileSync(
  join(repoRoot, 'src/components/QuotaCounter.jsx'),
  'utf8'
);
const helperSrc = readFileSync(
  join(repoRoot, 'src/utils/quotaCounter.js'),
  'utf8'
);
const appSrc = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');
const jobDetailsSrc = readFileSync(
  join(repoRoot, 'src/components/steps/JobDetails.jsx'),
  'utf8'
);
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

// ─────────────────── pure helpers ───────────────────

describe('selectCounterState — maps /auth/me billing to UI state', () => {
  test('null / undefined billing → null (render nothing)', () => {
    expect(selectCounterState(null)).toBe(null);
    expect(selectCounterState(undefined)).toBe(null);
  });

  test('subscribed → "subscribed"', () => {
    expect(selectCounterState({ quotaState: 'subscribed' })).toBe('subscribed');
  });

  test('comped → "comped"', () => {
    expect(selectCounterState({ quotaState: 'comped' })).toBe('comped');
  });

  test('free-remaining → "free-remaining"', () => {
    expect(
      selectCounterState({
        quotaState: 'free-remaining',
        freeQuotesUsed: 1,
        freeQuotesLimit: 3,
      })
    ).toBe('free-remaining');
  });

  test('"exhausted" (from /auth/me) maps to quota_exhausted', () => {
    expect(selectCounterState({ quotaState: 'exhausted' })).toBe(
      'quota_exhausted'
    );
  });

  test('unknown quotaState → null (defensive)', () => {
    expect(selectCounterState({ quotaState: 'mystery' })).toBe(null);
  });

  test('purchased-remaining → "purchased-remaining" (2026-06-24 PR C state)', () => {
    expect(
      selectCounterState({
        quotaState: 'purchased-remaining',
        purchasedQuotesRemaining: 4,
      })
    ).toBe('purchased-remaining');
  });
});

describe('compedMonthCopy — derives "Free during/through {month}" from comp_until', () => {
  test('comp_until in current month → "Free during {month}"', () => {
    const now = new Date('2026-07-10T12:00:00Z');
    const compUntil = '2026-07-31T23:59:59Z';
    expect(compedMonthCopy(compUntil, now)).toBe('Free during July');
  });

  test('comp_until in a future month → "Free through {month}" (Paul example)', () => {
    // Paul's comp 2026-07-31 viewed on 2026-06-24.
    const now = new Date('2026-06-24T12:00:00Z');
    const compUntil = '2026-07-31T23:59:59Z';
    expect(compedMonthCopy(compUntil, now)).toBe('Free through July');
  });

  test('comp_until in the past → null (caller falls back to "Free")', () => {
    const now = new Date('2026-08-01T12:00:00Z');
    const compUntil = '2026-07-31T23:59:59Z';
    expect(compedMonthCopy(compUntil, now)).toBe(null);
  });

  test('comp_until invalid string → null', () => {
    expect(compedMonthCopy('not-a-date')).toBe(null);
  });

  test('comp_until null → null', () => {
    expect(compedMonthCopy(null)).toBe(null);
    expect(compedMonthCopy(undefined)).toBe(null);
  });

  test('does not hardcode "July" — December still works', () => {
    const now = new Date('2026-09-01T12:00:00Z');
    const compUntil = '2026-12-31T23:59:59Z';
    expect(compedMonthCopy(compUntil, now)).toBe('Free through December');
  });

  test('month name uses en-GB long form (no "Jul" abbreviation)', () => {
    const now = new Date('2026-07-01T12:00:00Z');
    expect(compedMonthCopy('2026-07-20T00:00:00Z', now)).toMatch(/July/);
    expect(compedMonthCopy('2026-07-20T00:00:00Z', now)).not.toMatch(/Jul\b\s/);
  });
});

describe('counterCopy — load-bearing per-state strings', () => {
  test('subscribed → "Unlimited" (no number, no scarcity)', () => {
    expect(counterCopy({ quotaState: 'subscribed' })).toBe('Unlimited');
  });

  test('comped with future compUntil → "Free through July" (Paul on 2026-06-24)', () => {
    const now = new Date('2026-06-24T12:00:00Z');
    expect(
      counterCopy(
        { quotaState: 'comped', compUntil: '2026-07-31T23:59:59Z' },
        now
      )
    ).toBe('Free through July');
  });

  test('comped with current-month compUntil → "Free during {month}"', () => {
    const now = new Date('2026-07-05T12:00:00Z');
    expect(
      counterCopy(
        { quotaState: 'comped', compUntil: '2026-07-30T23:59:59Z' },
        now
      )
    ).toBe('Free during July');
  });

  test('comped with missing compUntil → "Free" (defensive fallback)', () => {
    expect(counterCopy({ quotaState: 'comped', compUntil: null })).toBe('Free');
    expect(counterCopy({ quotaState: 'comped' })).toBe('Free');
  });

  test('free-remaining — exact "{remaining} of {limit} free quotes left"', () => {
    expect(
      counterCopy({
        quotaState: 'free-remaining',
        freeQuotesUsed: 1,
        freeQuotesLimit: 3,
      })
    ).toBe('2 of 3 free quotes left');
  });

  test('free-remaining respects bonus quotes (referee — 5 limit)', () => {
    // Referee with +2 bonus, used 1 → 4 of 5 left.
    expect(
      counterCopy({
        quotaState: 'free-remaining',
        freeQuotesUsed: 1,
        freeQuotesLimit: 5,
        bonusFreeQuotes: 2,
      })
    ).toBe('4 of 5 free quotes left');
  });

  test('free-remaining clamps negative remaining to 0', () => {
    expect(
      counterCopy({
        quotaState: 'free-remaining',
        freeQuotesUsed: 10,
        freeQuotesLimit: 3,
      })
    ).toBe('0 of 3 free quotes left');
  });

  test('exhausted → "0 quotes left"', () => {
    expect(counterCopy({ quotaState: 'exhausted' })).toBe('0 quotes left');
    expect(counterCopy({ quotaState: 'quota_exhausted' })).toBe('0 quotes left');
  });

  test('null billing → null (render nothing)', () => {
    expect(counterCopy(null)).toBe(null);
    expect(counterCopy(undefined)).toBe(null);
  });

  // ─────── pay-as-you-go pack (2026-06-24) ───────

  test('purchased-remaining → "{n} quotes left" (free exhausted, pack only)', () => {
    expect(
      counterCopy({
        quotaState: 'purchased-remaining',
        purchasedQuotesRemaining: 4,
      })
    ).toBe('4 quotes left');
  });

  test('purchased-remaining defaults to 0 when value missing', () => {
    expect(counterCopy({ quotaState: 'purchased-remaining' })).toBe('0 quotes left');
  });

  test('mixed state (free + purchased > 0) shows TOTAL in main copy', () => {
    // Locked-spec choice: ONE big number for "quotes I can run right
    // now" with a breakdown rendered separately via counterBreakdown.
    // Used 1 of 3 → 2 free remaining; +3 paid → 5 total.
    expect(
      counterCopy({
        quotaState: 'free-remaining',
        freeQuotesUsed: 1,
        freeQuotesLimit: 3,
        purchasedQuotesRemaining: 3,
      })
    ).toBe('5 quotes left');
  });

  test('free-only state keeps the existing "{r} of {l} free quotes left" copy', () => {
    // Regression guard — pre-pack copy must still hold when no pack.
    expect(
      counterCopy({
        quotaState: 'free-remaining',
        freeQuotesUsed: 1,
        freeQuotesLimit: 3,
        purchasedQuotesRemaining: 0,
      })
    ).toBe('2 of 3 free quotes left');
  });
});

describe('counterBreakdown — mixed-state secondary line', () => {
  test('null billing → null', () => {
    expect(counterBreakdown(null)).toBe(null);
    expect(counterBreakdown(undefined)).toBe(null);
  });

  test('free-only → null (no breakdown needed)', () => {
    expect(
      counterBreakdown({
        quotaState: 'free-remaining',
        freeQuotesUsed: 1,
        freeQuotesLimit: 3,
        purchasedQuotesRemaining: 0,
      })
    ).toBe(null);
  });

  test('purchased-only → null (main label IS the breakdown)', () => {
    expect(
      counterBreakdown({
        quotaState: 'purchased-remaining',
        purchasedQuotesRemaining: 5,
      })
    ).toBe(null);
  });

  test('mixed (2 free + 3 paid) → "2 free + 3 paid"', () => {
    expect(
      counterBreakdown({
        quotaState: 'free-remaining',
        freeQuotesUsed: 1,
        freeQuotesLimit: 3,
        purchasedQuotesRemaining: 3,
      })
    ).toBe('2 free + 3 paid');
  });

  test('mixed (1 free + 1 paid) → "1 free + 1 paid"', () => {
    expect(
      counterBreakdown({
        quotaState: 'free-remaining',
        freeQuotesUsed: 2,
        freeQuotesLimit: 3,
        purchasedQuotesRemaining: 1,
      })
    ).toBe('1 free + 1 paid');
  });

  test('subscribed → null', () => {
    expect(counterBreakdown({ quotaState: 'subscribed' })).toBe(null);
  });

  test('comped → null', () => {
    expect(counterBreakdown({ quotaState: 'comped' })).toBe(null);
  });
});

// ─────────────────── source-level component guards ───────────────────

describe('QuotaCounter.jsx — unified banner source contract (2026-06-25)', () => {
  test('exports a default React component', () => {
    expect(counterSrc).toMatch(/export default function QuotaCounter/);
  });

  test('imports the pure helpers (selectCounterState + counterCopy + counterBreakdown)', () => {
    expect(counterSrc).toMatch(/selectCounterState/);
    expect(counterSrc).toMatch(/counterCopy/);
    expect(counterSrc).toMatch(/counterBreakdown/);
  });

  test('exposes a data-testid="quota-counter" hook for downstream tests', () => {
    expect(counterSrc).toMatch(/data-testid="quota-counter"/);
  });

  test('exposes a data-state attribute so e2e tests can read the active state', () => {
    expect(counterSrc).toMatch(/data-state=\{state\}/);
  });

  test('renders the Buy button for the £9.99 pack', () => {
    // Locked-spec label: "Buy 5 quotes — £9.99".
    expect(counterSrc).toMatch(/data-testid="quota-counter-buy"/);
    expect(counterSrc).toMatch(/Buy 5 quotes/);
    expect(counterSrc).toMatch(/£9\.99/);
    expect(counterSrc).toMatch(/\/api\/billing\/buy-quote-pack/);
  });

  test('renders the Subscribe button alongside Buy (unified dual-CTA strip)', () => {
    // 2026-06-25 unified-banner spec: Subscribe now lives in the
    // QuotaCounter strip too, not only in the (removed) Subscription-
    // Banner exhausted variant. Locked-spec label includes the price.
    expect(counterSrc).toMatch(/data-testid="quota-counter-subscribe"/);
    expect(counterSrc).toMatch(/Subscribe[\s\S]{0,80}£19\.99/);
    expect(counterSrc).toMatch(/\/api\/billing\/checkout/);
  });

  test('Buy + Subscribe flags reference free-remaining / purchased-remaining / quota_exhausted', () => {
    // Source-level: the showBuyButton / showSubscribeButton flags
    // must reference all three quota-spending states. Subscribed /
    // comped are suppressed (table in spec) and the runtime branches
    // are covered by the pure selector tests above.
    expect(counterSrc).toMatch(/showBuyButton[\s\S]{0,400}free-remaining[\s\S]{0,200}purchased-remaining[\s\S]{0,200}quota_exhausted/);
    expect(counterSrc).toMatch(/showSubscribeButton[\s\S]{0,400}free-remaining[\s\S]{0,200}purchased-remaining[\s\S]{0,200}quota_exhausted/);
  });

  test('uses fq: breakpoint classes for mobile-vs-desktop stack', () => {
    // Locked spec — stack vertically on mobile, inline on desktop.
    expect(counterSrc).toMatch(/fq:flex-row/);
    expect(counterSrc).toMatch(/flex-col/);
  });

  test('uses --tq-* CSS vars (no hardcoded fallback colours for theme text)', () => {
    // TRQ-168's lesson: no hardcoded fallbacks for theme colours.
    expect(counterSrc).toMatch(/var\(--tq-/);
  });

  test('renders the breakdown line when both free + purchased quotes exist', () => {
    // Mixed-state secondary line — "{free} free + {purchased} paid".
    expect(counterSrc).toMatch(/counterBreakdown/);
    expect(counterSrc).toMatch(/data-testid="quota-counter-breakdown"/);
  });

  test('CTA buttons meet the 44px mobile touch-target minimum', () => {
    // CLAUDE.md Mobile rule — 44px min on all interactive elements.
    // The Buy + Subscribe buttons both set minHeight: 44.
    expect(counterSrc).toMatch(/minHeight:\s*44/);
  });

  test('quota_exhausted gets the urgent tone (red palette)', () => {
    // Urgent palette anchors on the same #f87171 SubscriptionBanner
    // uses, so the visual language stays consistent.
    expect(counterSrc).toMatch(/urgent/);
    expect(counterSrc).toMatch(/#f87171/);
  });
});

describe('QuotaCounter.jsx — CTA handler contract', () => {
  // Both CTAs follow the same pattern: POST → read { url } from
  // JSON → window.location.href = url. Pin both so neither silently
  // regresses to a plain GET or a missing redirect.

  test('Subscribe handler POSTs to /api/billing/checkout', () => {
    expect(counterSrc).toMatch(
      /handleSubscribeClick[\s\S]{0,400}fetch\(['"]\/api\/billing\/checkout['"][\s\S]{0,80}method:\s*['"]POST['"]/
    );
  });

  test('Subscribe handler reads url from JSON and redirects', () => {
    expect(counterSrc).toMatch(
      /handleSubscribeClick[\s\S]{0,500}window\.location\.href\s*=\s*url/
    );
  });

  test('Buy handler POSTs to /api/billing/buy-quote-pack', () => {
    expect(counterSrc).toMatch(
      /handleBuyClick[\s\S]{0,400}fetch\(['"]\/api\/billing\/buy-quote-pack['"][\s\S]{0,80}method:\s*['"]POST['"]/
    );
  });

  test('Buy handler reads url from JSON and redirects', () => {
    expect(counterSrc).toMatch(
      /handleBuyClick[\s\S]{0,500}window\.location\.href\s*=\s*url/
    );
  });
});

// ─────────────────── banned-vocab guard ───────────────────

describe('QuotaCounter — banned vocabulary', () => {
  // The product banishes any language that implies "AI system" or
  // "trial" — see CLAUDE.md Visibility Rules. Strip comments + import
  // identifiers, then guard against the load-bearing terms.
  const stripped = counterSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  // Strings + JSX content (not import statements / identifiers).
  // Keep this loose — we're catching English-word leaks, not symbols.
  const userFacing = stripped;

  test('no AI / model / LLM / Claude / prompt leak', () => {
    expect(userFacing).not.toMatch(/\bAI\b/);
    expect(userFacing).not.toMatch(/\bClaude\b/);
    expect(userFacing).not.toMatch(/\bLLM\b/);
    expect(userFacing).not.toMatch(/\bmodel\b/i);
    expect(userFacing).not.toMatch(/\bprompt\b/i);
  });

  test('no confidence / calibration / accuracy / bias / drift', () => {
    expect(userFacing).not.toMatch(/\bconfidence\b/i);
    expect(userFacing).not.toMatch(/\bcalibration\b/i);
    expect(userFacing).not.toMatch(/\baccuracy\b/i);
    expect(userFacing).not.toMatch(/\bbias\b/i);
    expect(userFacing).not.toMatch(/\bdrift\b/i);
  });

  test('no agent / smart / debug', () => {
    expect(userFacing).not.toMatch(/\bagent\b/i);
    expect(userFacing).not.toMatch(/\bsmart\b/i);
    expect(userFacing).not.toMatch(/\bdebug\b/i);
  });

  test('no "credit" or "trial" leak (both off the safe list)', () => {
    // Strip imports + identifiers to avoid catching things like
    // useCallback or React itself. We're scanning JSX text + strings.
    // "credit" was reserved for the £9.99 pack (this PR); the
    // pack's CTA uses "Buy" and the breakdown uses "paid", so the
    // banned-word guard still holds.
    const jsxAndStrings = userFacing.replace(/^import[^;]+;/gm, '');
    expect(jsxAndStrings).not.toMatch(/\bcredit\b/i);
    expect(jsxAndStrings).not.toMatch(/\btrial\b/i);
  });

  test('safe vocabulary is present (quote / free / unlimited / remaining)', () => {
    // counterCopy strings live in the helper — check there too.
    const combined = counterSrc + helperSrc;
    expect(combined).toMatch(/quote/i);
    expect(combined).toMatch(/free/i);
    expect(combined).toMatch(/unlimited/i);
    expect(combined).toMatch(/remaining|left/i);
  });
});

// ─────────────────── App + JobDetails wiring ───────────────────

describe('QuotaCounter wiring — App.jsx + JobDetails', () => {
  test('App.jsx imports QuotaCounter', () => {
    expect(appSrc).toMatch(/import\s+QuotaCounter\s+from\s+['"]\.\/components\/QuotaCounter\.jsx['"]/);
  });

  test('App.jsx mounts <QuotaCounter billing={billing} />', () => {
    expect(appSrc).toMatch(/<QuotaCounter\s+billing=\{billing\}\s*\/>/);
  });

  test('App.jsx mounts QuotaCounter above SubscriptionBanner', () => {
    const counterIdx = appSrc.indexOf('<QuotaCounter');
    const bannerIdx = appSrc.indexOf('<SubscriptionBanner');
    expect(counterIdx).toBeGreaterThan(0);
    expect(bannerIdx).toBeGreaterThan(0);
    expect(counterIdx).toBeLessThan(bannerIdx);
  });

  test('App.jsx defines refreshBilling callback', () => {
    expect(appSrc).toMatch(/refreshBilling\s*=\s*useCallback/);
    expect(appSrc).toMatch(/fetch\(['"`]\/auth\/me['"`]\)/);
  });

  test('App.jsx passes refreshBilling as onAnalysisSuccess to JobDetails', () => {
    expect(appSrc).toMatch(/<JobDetails[\s\S]+?onAnalysisSuccess=\{refreshBilling\}/);
  });

  test('App.jsx passes refreshBilling to runAnalysis on retry', () => {
    expect(appSrc).toMatch(
      /runAnalysis\(\{[\s\S]+?onAnalysisSuccess:\s*refreshBilling[\s\S]+?\}\)/
    );
  });

  test('JobDetails forwards onAnalysisSuccess into runAnalysis', () => {
    expect(jobDetailsSrc).toMatch(/onAnalysisSuccess/);
    expect(jobDetailsSrc).toMatch(
      /runAnalysis\(\{[\s\S]+?onAnalysisSuccess[\s\S]+?\}\)/
    );
  });
});

// ─────────────────── server.js — compUntil in billing block ───────────────────

describe('server.js — /auth/me billing block exposes compUntil', () => {
  test('loadBilling attaches comp_until as ISO string', () => {
    expect(serverSrc).toMatch(/billing\.compUntil\s*=\s*u\.comp_until/);
  });

  test('null comp_until → null (not undefined, not missing key)', () => {
    expect(serverSrc).toMatch(
      /billing\.compUntil\s*=\s*u\.comp_until[\s\S]{0,200}null/
    );
  });
});

// ─────────────────── analyseJob refresh contract ───────────────────

describe('runAnalysis — onAnalysisSuccess callback (counter refresh)', () => {
  let origFetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    globalThis.fetch = origFetch;
  });

  const VALID_AI_JSON = {
    referenceCardDetected: true,
    stoneType: 'gritstone',
    damageDescription: '1 — Wall section\nCollapsed.',
    measurements: [
      { item: 'Height', valueMm: 1200, displayValue: '1,200mm', confidence: 'high', note: null },
    ],
    scheduleOfWorks: [{ stepNumber: 1, title: 'Clear site', description: 'Clear debris.' }],
    materials: [
      { description: 'Stone', quantity: '2', unit: 't', unitCost: 180, totalCost: 360 },
    ],
    labourEstimate: { description: 'Rebuild', estimatedDays: 3, numberOfWorkers: 2, calculationBasis: '6/3=2' },
    siteConditions: { accessDifficulty: 'normal', accessNote: null, foundationCondition: 'sound', foundationNote: null, adjacentStructureRisk: false, adjacentStructureNote: null },
    additionalNotes: 'None',
  };

  const baseArgs = () => ({
    photos: { overview: { data: 'data:image/jpeg;base64,FAKE' } },
    extraPhotos: [],
    jobDetails: { siteAddress: '10 Main St', briefNotes: '', quoteReference: 'QT-001', quoteDate: '2026-04-01' },
    profile: { dayRate: 400 },
    abortRef: { current: null },
    userId: 'mark',
    dispatch: () => {},
  });

  test('calls onAnalysisSuccess once when /analyse succeeds', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: JSON.stringify(VALID_AI_JSON) }] }),
    });
    const onAnalysisSuccess = jest.fn();
    await runAnalysis({ ...baseArgs(), onAnalysisSuccess });
    expect(onAnalysisSuccess).toHaveBeenCalledTimes(1);
  });

  test('does NOT call onAnalysisSuccess on 5xx server error', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'server error' }),
    });
    const onAnalysisSuccess = jest.fn();
    await runAnalysis({ ...baseArgs(), onAnalysisSuccess });
    expect(onAnalysisSuccess).not.toHaveBeenCalled();
  });

  test('does NOT call onAnalysisSuccess on 402 quota_exhausted', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => JSON.stringify({
        error: 'quota_exhausted',
        freeQuotesUsed: 3,
        freeQuotesLimit: 3,
        message: "You've used your 3 free quotes. Subscribe to continue.",
      }),
    });
    const onAnalysisSuccess = jest.fn();
    await runAnalysis({ ...baseArgs(), onAnalysisSuccess });
    expect(onAnalysisSuccess).not.toHaveBeenCalled();
  });

  test('does NOT call onAnalysisSuccess on network error (TypeError)', async () => {
    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError('NetworkError'));
    const onAnalysisSuccess = jest.fn();
    await runAnalysis({ ...baseArgs(), onAnalysisSuccess });
    expect(onAnalysisSuccess).not.toHaveBeenCalled();
  });

  test('does NOT call onAnalysisSuccess when AI returns an unparseable response', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: 'not-json-not-anything' }] }),
    });
    const onAnalysisSuccess = jest.fn();
    await runAnalysis({ ...baseArgs(), onAnalysisSuccess });
    expect(onAnalysisSuccess).not.toHaveBeenCalled();
  });

  test('is backward compatible when callback is omitted', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: JSON.stringify(VALID_AI_JSON) }] }),
    });
    // No onAnalysisSuccess — should not throw.
    await expect(runAnalysis(baseArgs())).resolves.not.toThrow();
  });

  test('swallows callback errors without crashing the analysis flow', async () => {
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ text: JSON.stringify(VALID_AI_JSON) }] }),
    });
    const onAnalysisSuccess = jest.fn(() => {
      throw new Error('refresh blew up');
    });
    await expect(
      runAnalysis({ ...baseArgs(), onAnalysisSuccess })
    ).resolves.not.toThrow();
    expect(onAnalysisSuccess).toHaveBeenCalledTimes(1);
  });
});
