/**
 * Q5 (2026-06-26) — the "You've used your N free quotes" lockout copy in
 * App.jsx must interpolate the user's effective limit, not a hardcoded "3".
 *
 * Referred users get +2 bonus quotes (referrals Phase 1) so their effective
 * limit is 5. Showing "3" to a 5-quote user is both wrong and a bad UX
 * signal — they think the counter undercounted. Same bug shape as Pitfall
 * #17: a literal where the dynamic value was wanted.
 *
 * This is a source-level guard. The pattern catches the regression cheaply
 * without needing to mount App.jsx + mock billing state. Same shape as
 * aiTextRemoval.test.js.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JSX = path.resolve(__dirname, '..', 'App.jsx');

describe('Q5: dynamic free-quote copy in App.jsx', () => {
  const src = fs.readFileSync(APP_JSX, 'utf8');

  test('no hardcoded "N free quotes. Subscribe" lockout message', () => {
    // Match: "You've used your 3 free quotes." (or any single digit)
    // Allowed: `You've used your ${freeLimit} free quotes.` (template literal)
    const hardcoded = /You(?:'|\\?')ve used your \d+ free quotes/g;
    const matches = src.match(hardcoded) || [];
    expect(matches).toEqual([]);
  });

  test('the lockout dispatches use a template literal with the dynamic limit', () => {
    // Confirms the corrected pattern is present at least twice
    // (handleStartNewQuote + handleStartQuickQuote).
    const dynamicSites = src.match(
      /message: `You(?:'|\\?')ve used your \$\{freeLimit\} free quotes/g,
    ) || [];
    expect(dynamicSites.length).toBeGreaterThanOrEqual(2);
  });
});
