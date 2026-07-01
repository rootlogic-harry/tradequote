// @ts-check
import { test as base, expect } from '@playwright/test';

/**
 * Playwright fixture — logs in as the dedicated `tq_agent_smoke` user
 * via POST /test/agent-login. Any spec that needs an authenticated
 * session imports { test } from this file instead of @playwright/test.
 *
 * Fixture design: `smokeContext` is WORKER-SCOPED — the browser
 * context is created once per worker and reused across all tests in
 * that worker. This matters because every rate-limited endpoint
 * (/test/agent-login itself, PATCH /details, /auth/redeem-referral)
 * shares the same 10/min/IP `billingRateLimit`. A per-test login
 * would burn ~half that budget on nothing but authentication and
 * trip 429s well before the suite finishes. One login per worker
 * keeps the whole suite under the limit and runs faster too.
 *
 * The `authedPage` fixture opens a fresh page inside the shared
 * context per test so state (URL, dialogs) is per-test-isolated.
 *
 * Gating:
 *   - process.env.AGENT_SMOKE_SECRET must be set (Playwright process
 *     env — sourced from GitHub Actions secret in CI, or exported
 *     locally when running ad-hoc).
 *   - If unset, every auth-gated test is auto-skipped with a clear
 *     "SKIPPED: AGENT_SMOKE_SECRET not set" message. This is how
 *     the suite stays green in environments that haven't configured
 *     the smoke user yet.
 *
 * See docs/SMOKE.md § Phase 2 for the runbook.
 */

const SMOKE_SECRET = process.env.AGENT_SMOKE_SECRET;
export const SMOKE_USER_ID = 'tq_agent_smoke';
export const SMOKE_ENABLED = Boolean(SMOKE_SECRET);

export const test = base.extend({
  /**
   * Worker-scoped shared browser context, authenticated once.
   * @type {import('@playwright/test').BrowserContext}
   */
  smokeContext: [async ({ browser }, use) => {
    const context = await browser.newContext();
    if (SMOKE_ENABLED) {
      // Login via the controlled auth bypass. We do the login on a
      // one-off request page and let cookies land in the context.
      const bootstrapPage = await context.newPage();
      const res = await bootstrapPage.request.post('/test/agent-login', {
        headers: { 'X-Agent-Secret': SMOKE_SECRET },
      });
      if (res.status() !== 200) {
        throw new Error(
          `POST /test/agent-login failed at worker startup (${res.status()}). ` +
          `Check that AGENT_SMOKE_SECRET matches Railway env AND the smoke user ` +
          `row exists in the DB. See docs/SMOKE.md.`
        );
      }
      await bootstrapPage.close();
    }
    await use(context);
    await context.close();
  }, { scope: 'worker' }],

  /**
   * Per-test authenticated page. Fresh navigation state; shared cookies.
   * Auto-skips when AGENT_SMOKE_SECRET is unset.
   * @type {import('@playwright/test').Page}
   */
  authedPage: async ({ smokeContext }, use) => {
    test.skip(
      !SMOKE_ENABLED,
      'AGENT_SMOKE_SECRET not set — set it locally or wire the GitHub Actions secret to enable auth-gated smoke journeys.'
    );
    const page = await smokeContext.newPage();
    await use(page);
    await page.close();
  },
});

export { expect };
