// @ts-check
import { test as base, expect } from '@playwright/test';

/**
 * Playwright fixture — logs in as the dedicated `tq_agent_smoke` user
 * via POST /test/agent-login. Any spec that needs an authenticated
 * session imports { test } from this file instead of @playwright/test.
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
   * @type {import('@playwright/test').Page}
   *
   * Authenticated Playwright page for the smoke user. Cookies from
   * the login POST are shared with subsequent page.goto/request calls
   * because both use the same browser context.
   */
  authedPage: async ({ browser }, use) => {
    test.skip(
      !SMOKE_ENABLED,
      'AGENT_SMOKE_SECRET not set — set it locally or wire the GitHub Actions secret to enable auth-gated smoke journeys.'
    );

    const context = await browser.newContext();
    const page = await context.newPage();

    // Login via the controlled auth bypass. Fixture asserts a 200 —
    // if the endpoint returns 404 (secret not configured server-side)
    // or 401 (mismatch), fail loud so the smoke user setup is visible.
    const res = await page.request.post('/test/agent-login', {
      headers: { 'X-Agent-Secret': SMOKE_SECRET },
    });
    expect(
      res.status(),
      `POST /test/agent-login failed (${res.status()}). Check that AGENT_SMOKE_SECRET matches Railway env AND the smoke user row exists in the DB. See docs/SMOKE.md.`
    ).toBe(200);

    await use(page);
    await context.close();
  },
});

export { expect };
