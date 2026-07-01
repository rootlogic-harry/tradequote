// @ts-check
import { defineConfig, devices } from '@playwright/test';

/**
 * FastQuote smoke-test configuration (Phase 1, 2026-06-30).
 *
 * Background — Harry asked "if you could make 1 improvement to the app, or
 * how we work, what would it be?" and the honest answer was: stop letting
 * me say "ready" on changes I can't actually click through myself. This
 * suite is the structural fix to that bug class. Every PR runs a small set
 * of end-to-end journeys against the live SPA so behavioural regressions
 * (like the SET_VIEW_MODE bug that shipped silent for four days) die in
 * CI rather than in Harry's inbox.
 *
 * Phase 1 covers public surfaces only — no auth required, low cost, runs
 * on every PR. Phase 2 adds an /test/agent-login endpoint + a dedicated
 * smoke user so we can drive Dashboard / Edit details / Redeem flows too.
 * See docs/SMOKE.md for the runbook.
 */
const BASE_URL = process.env.SMOKE_URL || 'https://fastquote.uk';

export default defineConfig({
  testDir: './tests/e2e',
  // Smoke is a fast signal — fail loud if a single spec slow-rolls.
  timeout: 30_000,
  expect: {
    timeout: 8_000,
  },
  // Fail the build on test.only landing on main — same hygiene as Jest.
  forbidOnly: !!process.env.CI,
  // Two retries in CI catches a flaky network without hiding real bugs.
  retries: process.env.CI ? 2 : 0,
  // One worker keeps logs readable + avoids hammering production.
  workers: 1,
  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Always set Accept so the SPA's wildcard route returns the SPA shell
    // for HTML probes (some routes 406 without it under strict configs).
    extraHTTPHeaders: {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    // Honest user-agent so prod analytics can filter smoke traffic out.
    userAgent:
      'FastQuoteSmoke/1.0 (+https://fastquote.uk; smoke-only) Playwright/1.61',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
