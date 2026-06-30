/**
 * RedeemReferralBanner — source-level contract guard.
 *
 * History:
 *   - 2026-06-30 (early): the component was a Dashboard banner that
 *     auto-hid when ineligible (subscribed / comped / bonus > 0).
 *   - 2026-06-30 (later, Harry's ask): redeem moved into Profile →
 *     Bonus quotes, alongside the share panel. The component is now
 *     always rendered in that context; gating logic flipped from
 *     "hide unless eligible to redeem" to "show form when bonus=0,
 *     show confirm state when bonus>0".
 *
 * The file name stays so the tests + CLAUDE.md references don't churn.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'components', 'RedeemReferralBanner.jsx'),
  'utf8'
);
const APP_SRC = readFileSync(
  join(__dirname, '..', 'App.jsx'),
  'utf8'
);
const PS_SRC = readFileSync(
  join(__dirname, '..', 'components', 'steps', 'ProfileSetup.jsx'),
  'utf8'
);

describe('RedeemReferralBanner — contract', () => {
  test('default-exports a React component', () => {
    expect(SRC).toMatch(/export default function RedeemReferralBanner/);
  });

  test('renders a confirmation panel when bonusFreeQuotes > 0', () => {
    // Replaces the older "auto-hide when ineligible" gating with a
    // friendlier "you've redeemed" message — Settings context, not a
    // banner.
    expect(SRC).toMatch(/const bonus = Number\(billing\?\.bonusFreeQuotes\) \|\| 0/);
    expect(SRC).toMatch(/if \(bonus > 0\)/);
    expect(SRC).toMatch(/data-testid=["']redeem-referral-redeemed-confirmation["']/);
    expect(SRC).toMatch(/You've redeemed a referral code/);
  });

  test('renders the form (no collapsed toggle) when bonus is 0', () => {
    // Old behaviour was an expand-on-click toggle. The new Settings
    // home means we render the form directly so the field is visible
    // as soon as the user opens the Bonus quotes section.
    expect(SRC).toMatch(/<form onSubmit=\{handleSubmit\}/);
    // Negative — the "Got a referral code?" toggle is gone.
    expect(SRC).not.toMatch(/Got a referral code\?/);
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

  test('shows a specific message when the server rejects the code as self-referral', () => {
    // Server protection is validateRedemption() in src/utils/referrals.js
    // — it returns { reason: 'self' } when codeRow.user_id === userId.
    // The /auth/redeem-referral handler forwards that reason to the
    // client, and the UI surfaces a friendly hint so the user
    // understands WHY their attempt was rejected (rather than
    // suspecting a bug).
    expect(SRC).toMatch(/reason\s*===\s*['"]self['"]/);
    expect(SRC).toMatch(/your own code/i);
  });

  test('shows a specific message when the server rejects as already-redeemed', () => {
    expect(SRC).toMatch(/reason\s*===\s*['"]already-redeemed['"]/);
    expect(SRC).toMatch(/already redeemed/i);
  });

  test('calls onRedeemed callback with the fresh billing block on success', () => {
    expect(SRC).toMatch(/onRedeemed\s*\(\s*j\.billing/);
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
    // Only one button now (Apply) — cancel was removed when the
    // toggle/expand pattern went away.
    const buttonOpens = (SRC.match(/<button\b/g) || []).length;
    const minHeightHits = (SRC.match(/minHeight\s*:\s*44\b/g) || []).length;
    expect(buttonOpens).toBeGreaterThanOrEqual(1);
    expect(minHeightHits).toBeGreaterThanOrEqual(buttonOpens);
  });

  test('uses banned-vocab-safe language only', () => {
    const banned = [
      /\bAI\b/i, /\bClaude\b/i, /\bmodel\b/i, /\bLLM\b/i,
      /\bprompt\b/i, /\bcalibration\b/i, /\baccuracy\b/i,
    ];
    for (const re of banned) expect(SRC).not.toMatch(re);
  });

  test('exposes a stable test-id for the banner root', () => {
    expect(SRC).toMatch(/data-testid=["']redeem-referral-banner["']/);
  });
});

describe('RedeemReferralBanner — mounted in Profile → Bonus quotes', () => {
  test('App.jsx no longer mounts RedeemReferralBanner directly on the Dashboard', () => {
    expect(APP_SRC).not.toMatch(/<RedeemReferralBanner\b/);
  });

  test('ProfileSetup imports + mounts RedeemReferralBanner', () => {
    expect(PS_SRC).toMatch(/import\s+RedeemReferralBanner/);
    expect(PS_SRC).toMatch(/<RedeemReferralBanner[\s\S]{0,200}billing=\{billing\}/);
    expect(PS_SRC).toMatch(/onRedeemed=\{[\s\S]{0,200}onBillingRefresh/);
  });

  test('SECTIONS array surfaces the renamed "Bonus quotes" label', () => {
    expect(PS_SRC).toMatch(/label:\s*['"]Bonus quotes['"]/);
    // The internal id stays 'share' so navigation links + touch-target
    // allow-list don't churn.
    expect(PS_SRC).toMatch(/\{\s*id:\s*['"]share['"]/);
  });

  test('renderShare exposes a "Redeem" and a "Sharing" sub-heading', () => {
    expect(PS_SRC).toMatch(/id=["']ps-redeem-heading["']/);
    expect(PS_SRC).toMatch(/id=["']ps-sharing-heading["']/);
    // JSX is multi-line, so the bracket-text adjacency check would
    // miss a clean format. Look for the section labelledby pairs
    // and the literal subheading words separately.
    expect(PS_SRC).toMatch(/aria-labelledby=["']ps-redeem-heading["']/);
    expect(PS_SRC).toMatch(/aria-labelledby=["']ps-sharing-heading["']/);
    expect(PS_SRC).toMatch(/\bRedeem\b/);
    expect(PS_SRC).toMatch(/\bSharing\b/);
  });

  test('App.jsx forwards billing + onBillingRefresh to BOTH ProfileSetup mounts', () => {
    const mounts = (APP_SRC.match(/<ProfileSetup\b/g) || []).length;
    const billingProps = (APP_SRC.match(/billing=\{billing\}/g) || []).length;
    // Plus other components also receive billing (BillingSection etc.),
    // so the count is at least equal to ProfileSetup mounts.
    expect(mounts).toBeGreaterThanOrEqual(2);
    expect(billingProps).toBeGreaterThanOrEqual(mounts);
    // onBillingRefresh wired to setBilling + refreshBilling fallback.
    expect(APP_SRC).toMatch(/onBillingRefresh=\{[\s\S]{0,300}setBilling[\s\S]{0,300}refreshBilling/);
  });
});
