/**
 * Referrals Phase 1 (2026-06-23) — React component source-scan tests.
 *
 * Jest config uses `transform: {}` so we can't render JSX. We scan
 * the source for the contract guarantees that matter:
 *  - Components self-hide when their dependencies aren't ready
 *  - Banned vocabulary stays out of user-facing copy
 *  - Defensive defaults for nullable props
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const componentsDir = join(__dirname, '../components');

const panelSrc = readFileSync(join(componentsDir, 'ReferralPanel.jsx'), 'utf8');
const welcomeSrc = readFileSync(join(componentsDir, 'ReferralWelcome.jsx'), 'utf8');
const dashboardSrc = readFileSync(join(componentsDir, 'Dashboard.jsx'), 'utf8');
const profileSetupSrc = readFileSync(
  join(componentsDir, 'steps/ProfileSetup.jsx'),
  'utf8'
);

describe('ReferralPanel', () => {
  test('fetches from /api/users/:id/referrals', () => {
    expect(panelSrc).toMatch(/\/api\/users\/\$\{currentUserId\}\/referrals/);
  });

  test('self-hides while loading and when no code yet', () => {
    expect(panelSrc).toMatch(/loading \|\| !data \|\| !data\.code/);
  });

  test('share URL uses ?ref= (matches /auth/google redirect contract)', () => {
    expect(panelSrc).toMatch(/\?ref=/);
  });

  test('share text computes total quotes from FREE_QUOTES_LIMIT + REFERRAL_REFEREE_BONUS', () => {
    // 2026-06-30 fix: was hardcoded `for 5 free quotes`. Now sourced
    // from constants so a tweak to either flows through.
    expect(panelSrc).toMatch(
      /import\s+\{\s*FREE_QUOTES_LIMIT\s*\}\s+from\s+['"]\.\.\/utils\/quotaGate\.js['"]/
    );
    expect(panelSrc).toMatch(
      /import\s+\{\s*REFERRAL_REFEREE_BONUS\s*\}\s+from\s+['"]\.\.\/utils\/referrals\.js['"]/
    );
    expect(panelSrc).toMatch(/FREE_QUOTES_LIMIT\s*\+\s*REFERRAL_REFEREE_BONUS/);
    expect(panelSrc).toMatch(/for \$\{totalQuotes\} free quotes/);
    // Must NOT hardcode the value any more.
    expect(panelSrc).not.toMatch(/for 5 free quotes/);
  });

  test('prefers Web Share API on mobile, falls back to clipboard', () => {
    expect(panelSrc).toMatch(/navigator\.share/);
    expect(panelSrc).toMatch(/navigator\.clipboard/);
  });

  test('does not leak banned vocabulary in copy', () => {
    // The locked spec lists safe words: referral, code, invite, share,
    // earn, bonus, free quote, credit. Banned: AI / model / LLM / Claude /
    // prompt / confidence / calibration / accuracy / bias / drift / agent.
    // We scan only the JSX text nodes (between `>` and `<`) and the
    // string literals — comments are allowed to mention "agent_runs" etc.
    const userFacing = panelSrc
      // Strip comments
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(userFacing).not.toMatch(/\bAI\b/);
    expect(userFacing).not.toMatch(/\bClaude\b/);
    expect(userFacing).not.toMatch(/\bLLM\b/);
    expect(userFacing).not.toMatch(/\bcalibration\b/i);
    expect(userFacing).not.toMatch(/\baccuracy\b/i);
  });
});

describe('ReferralWelcome', () => {
  test('self-hides unless eligible (bonus quotes > 0 AND used == 0)', () => {
    expect(welcomeSrc).toMatch(/bonusFreeQuotes/);
    expect(welcomeSrc).toMatch(/freeQuotesUsed/);
    expect(welcomeSrc).toMatch(/!eligible/);
  });

  test('persists dismissal via sessionStorage', () => {
    expect(welcomeSrc).toMatch(/sessionStorage/);
    expect(welcomeSrc).toMatch(/DISMISS_KEY/);
  });

  test('handles missing sessionStorage gracefully (private browsing)', () => {
    expect(welcomeSrc).toMatch(/try\s*\{[\s\S]*?sessionStorage[\s\S]*?\}\s*catch/);
  });

  test('no banned vocab in user-facing copy', () => {
    const userFacing = welcomeSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(userFacing).not.toMatch(/\bAI\b/);
    expect(userFacing).not.toMatch(/\bClaude\b/);
    expect(userFacing).not.toMatch(/\bcalibration\b/i);
    expect(userFacing).not.toMatch(/\baccuracy\b/i);
    expect(userFacing).not.toMatch(/\bagent\b/i);
  });

  test('uses "invited" + "free quotes" (locked-spec safe vocabulary)', () => {
    expect(welcomeSrc).toMatch(/invited/);
    expect(welcomeSrc).toMatch(/free quotes/);
  });
});

// Harry's 2026-06-25 ask: relocate ReferralPanel out of Dashboard (a
// quote-management surface) and into ProfileSetup (where personal
// settings like the accent colour already live). These source-level
// scans pin the move so a future refactor doesn't silently put the
// panel back on the wrong surface.
describe('ReferralPanel mount location', () => {
  test('is imported by ProfileSetup', () => {
    // Relative path differs because ProfileSetup lives in steps/. Either
    // ../ReferralPanel or ../../components/ReferralPanel forms are
    // acceptable depending on which import root the dev picked, so the
    // regex is generous.
    expect(profileSetupSrc).toMatch(
      /import\s+ReferralPanel\s+from\s+['"][^'"]*ReferralPanel(?:\.jsx)?['"]/
    );
  });

  test('is rendered inside ProfileSetup', () => {
    expect(profileSetupSrc).toMatch(/<ReferralPanel\b/);
  });

  test('ProfileSetup mounts ReferralPanel AFTER the Quote Accent Colour section', () => {
    const accentIdx = profileSetupSrc.indexOf('Quote Accent Colour');
    const panelIdx = profileSetupSrc.indexOf('<ReferralPanel');
    expect(accentIdx).toBeGreaterThan(-1);
    expect(panelIdx).toBeGreaterThan(-1);
    expect(panelIdx).toBeGreaterThan(accentIdx);
  });

  test('is NOT imported by Dashboard (moved out per 2026-06-25 ask)', () => {
    expect(dashboardSrc).not.toMatch(
      /import\s+ReferralPanel\s+from/
    );
  });

  test('is NOT rendered by Dashboard', () => {
    expect(dashboardSrc).not.toMatch(/<ReferralPanel\b/);
  });
});
