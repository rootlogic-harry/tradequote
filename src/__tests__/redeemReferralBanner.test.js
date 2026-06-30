/**
 * RedeemReferralBanner — source-level + gating contract guard.
 *
 * Restores the manual-redemption UI lost when LOGIN_PAGE_HTML was
 * rebuilt for Auth0 Universal Login (2026-06-29). The POST
 * /auth/redeem-referral endpoint had a dead-end with no client caller
 * — this banner is the caller.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'components', 'RedeemReferralBanner.jsx'),
  'utf8'
);

describe('RedeemReferralBanner — source-level contract', () => {
  test('default-exports a React component', () => {
    expect(SRC).toMatch(/export default function RedeemReferralBanner/);
  });

  test('gates on bonusFreeQuotes === 0 AND quotaState in {free-remaining, quota_exhausted}', () => {
    // Bug-hunt 2026-06-30 #5: exhausted users need to see the banner
    // because redeeming a code immediately makes 2 previously-burned
    // quotes spendable (effectiveLimit jumps 3 → 5).
    expect(SRC).toMatch(/Number\(billing\.bonusFreeQuotes\)\s*===\s*0/);
    expect(SRC).toMatch(/billing\.quotaState\s*===\s*['"]free-remaining['"]/);
    expect(SRC).toMatch(/billing\.quotaState\s*===\s*['"]quota_exhausted['"]/);
  });

  test('POSTs to /auth/redeem-referral with a JSON body', () => {
    expect(SRC).toMatch(/fetch\(\s*['"]\/auth\/redeem-referral['"]/);
    expect(SRC).toMatch(/method:\s*['"]POST['"]/);
    expect(SRC).toMatch(/Content-Type['"]\s*:\s*['"]application\/json/);
  });

  test('trims the entered code before sending', () => {
    expect(SRC).toMatch(/\.trim\(\)/);
  });

  test('treats applied:false as a soft "code not recognised" message', () => {
    expect(SRC).toMatch(/applied[\s\S]*?true/);
    expect(SRC).toMatch(/not recognised/i);
  });

  test('calls onRedeemed callback with the fresh billing block on success', () => {
    expect(SRC).toMatch(/onRedeemed\s*\(\s*j\.billing/);
  });

  test('renders a "Got a referral code?" toggle when collapsed', () => {
    expect(SRC).toMatch(/Got a referral code\?/);
  });

  test('input is autoCapitalize="characters" + uppercase + monospace styling', () => {
    expect(SRC).toMatch(/autoCapitalize\s*=\s*["']characters["']/);
    expect(SRC).toMatch(/textTransform:\s*['"]uppercase['"]/);
    expect(SRC).toMatch(/font-mono/);
  });

  test('caps input at 64 chars (matches normaliseReferralCode contract)', () => {
    expect(SRC).toMatch(/maxLength\s*=\s*\{?\s*64\s*\}?/);
  });

  test('every <button> has minHeight: 44 in its style block', () => {
    // Robust to multi-line JSX — count <button> openings, then count
    // minHeight: 44 occurrences. They must match.
    const buttonOpens = (SRC.match(/<button\b/g) || []).length;
    const minHeightHits = (SRC.match(/minHeight\s*:\s*44\b/g) || []).length;
    expect(buttonOpens).toBeGreaterThanOrEqual(3); // open / submit / cancel
    expect(minHeightHits).toBeGreaterThanOrEqual(buttonOpens);
  });

  test('uses banned-vocab-safe language only', () => {
    // "referral", "code", "bonus", "quote" are explicitly allowed.
    // Asserting absence of the obvious offenders.
    const banned = [
      /\bAI\b/i,
      /\bClaude\b/i,
      /\bmodel\b/i,
      /\bLLM\b/i,
      /\bprompt\b/i,
      /\bcalibration\b/i,
    ];
    for (const re of banned) expect(SRC).not.toMatch(re);
  });

  test('exposes a stable test-id for the banner root', () => {
    expect(SRC).toMatch(/data-testid=["']redeem-referral-banner["']/);
  });
});

describe('RedeemReferralBanner — mounted on Dashboard', () => {
  const appSrc = readFileSync(
    join(__dirname, '..', 'App.jsx'),
    'utf8'
  );

  test('App.jsx imports RedeemReferralBanner', () => {
    expect(appSrc).toMatch(/import\s+RedeemReferralBanner/);
  });

  test('App.jsx mounts RedeemReferralBanner with billing + onRedeemed=refreshBilling', () => {
    expect(appSrc).toMatch(
      /<RedeemReferralBanner[\s\S]*?billing=\{billing\}[\s\S]*?onRedeemed=\{refreshBilling\}/
    );
  });
});
