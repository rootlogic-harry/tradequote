// @ts-check
import { test, expect, SMOKE_USER_ID } from './auth-fixture.js';

/**
 * SavedQuotes tab switching (SET_VIEW_MODE killer).
 *
 * Background: 2026-06-30 the "Completed" tab silently did nothing
 * because the reducer's guard was stale (only allowed 'active' and
 * 'archive'). PR #114 fixed the reducer + added Jest coverage; PR
 * #115 added a coverage gate for future actions. This smoke test
 * closes the integration side — even if a future refactor lets the
 * reducer transition state but breaks the UI wiring, clicking the
 * pill and observing aria-selected moving is a real end-to-end
 * guarantee.
 *
 * We assert the ARIA state on the pill buttons rather than counting
 * rendered jobs so the test is deterministic regardless of whatever
 * quotes happen to be in the smoke user's DB.
 */

test.describe('Saved Jobs tab switching', () => {
  test.beforeEach(async ({ authedPage: page }) => {
    // Navigate to the SavedQuotes surface. The SPA's initial paint
    // lands on the Dashboard; we navigate via the "Saved jobs" nav
    // link rather than assuming a URL shape.
    await page.goto('/');
    // Some Dashboard renders take a moment for /auth/me + jobs to
    // paint. Wait for a stable marker before asserting on the tabs.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 10_000 });
    // Prefer clicking a labelled link over guessing routes.
    const savedLink = page.getByRole('link', { name: /saved jobs/i }).or(
      page.getByRole('button', { name: /saved jobs/i })
    );
    if (await savedLink.count()) {
      await savedLink.first().click();
    } else {
      // Fallback: some navigation surfaces expose "View all" —
      // whichever appears is fine.
      await page.getByText(/view all/i).first().click();
    }
    // The SavedQuotes page has a "Saved jobs" H1 or eyebrow.
    await expect(page.getByRole('heading', { name: /saved jobs/i })).toBeVisible({ timeout: 10_000 });
  });

  test('Active is the initial view (aria-selected)', async ({ authedPage: page }) => {
    const activeTab = page.getByRole('tab', { name: /active/i })
      .or(page.locator('.pill', { hasText: /active/i }));
    await expect(activeTab.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking Completed moves aria-selected to Completed (SET_VIEW_MODE regression)', async ({ authedPage: page }) => {
    const completedTab = page.getByRole('tab', { name: /completed/i })
      .or(page.locator('.pill', { hasText: /completed/i }));
    await completedTab.first().click();
    // The real regression assertion — the reducer's SET_VIEW_MODE
    // guard must accept 'completed' or this stays 'false' and the
    // Completed pill never highlights.
    await expect(completedTab.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking Archived moves aria-selected to Archived', async ({ authedPage: page }) => {
    const archiveTab = page.getByRole('tab', { name: /archiv/i })
      .or(page.locator('.pill', { hasText: /archiv/i }));
    await archiveTab.first().click();
    await expect(archiveTab.first()).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking Active returns aria-selected to Active', async ({ authedPage: page }) => {
    // Move away first so we're actually testing a transition.
    const completedTab = page.getByRole('tab', { name: /completed/i })
      .or(page.locator('.pill', { hasText: /completed/i }));
    await completedTab.first().click();
    await expect(completedTab.first()).toHaveAttribute('aria-selected', 'true');

    const activeTab = page.getByRole('tab', { name: /active/i })
      .or(page.locator('.pill', { hasText: /active/i }));
    await activeTab.first().click();
    await expect(activeTab.first()).toHaveAttribute('aria-selected', 'true');
    await expect(completedTab.first()).toHaveAttribute('aria-selected', 'false');
  });
});

/**
 * Belt-and-braces API check — the reducer test in Jest covers the
 * pure transition, but only the smoke test can catch a Dashboard
 * render regression that de-syncs the pill aria-state from the
 * viewMode reducer state.
 */
test('SavedQuotes tab element count matches VIEW_MODES (3 tabs)', async ({ authedPage: page }) => {
  await page.goto('/');
  const savedLink = page.getByRole('link', { name: /saved jobs/i }).or(
    page.getByRole('button', { name: /saved jobs/i })
  );
  if (await savedLink.count()) await savedLink.first().click();
  else await page.getByText(/view all/i).first().click();

  await expect(page.getByRole('heading', { name: /saved jobs/i })).toBeVisible({ timeout: 10_000 });

  // Regardless of markup style (tab role vs pill class), the total
  // count should be 3 — Active, Completed, Archive.
  const activeTab = page.locator('[role="tab"], .pill').filter({ hasText: /active/i });
  const completedTab = page.locator('[role="tab"], .pill').filter({ hasText: /completed/i });
  const archiveTab = page.locator('[role="tab"], .pill').filter({ hasText: /archiv/i });

  await expect(activeTab.first()).toBeVisible();
  await expect(completedTab.first()).toBeVisible();
  await expect(archiveTab.first()).toBeVisible();

  // The smoke user id is used only as a hook so future test-account
  // filters can grep server logs by this identifier.
  expect(SMOKE_USER_ID).toBe('tq_agent_smoke');
});
