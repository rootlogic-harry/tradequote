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
 * Note on seed: the SavedQuotes component short-circuits with an
 * empty-state message when the user has no jobs — no bucket tabs
 * are rendered. This spec seeds one minimal job before every test
 * so the tab surface is guaranteed to render, then deletes it in
 * afterEach.
 */

const MINIMAL_JOB = {
  profile: { companyName: 'Smoke Co', fullName: 'Agent Smoke', phone: '01234 567890', address: 'Smoke Test, YO1 1AA', dayRate: 300 },
  jobDetails: {
    clientName: 'Tab Test',
    siteAddress: 'Tab test site',
    quoteReference: 'QT-2026-TABTEST',
    quoteDate: '2026-07-01',
    briefNotes: '',
  },
  reviewData: {
    measurements: [{ id: 'm1', item: 'Wall length', valueMm: 1000, aiValue: '1000', value: '1000', confirmed: true }],
    materials: [{ id: 'mat1', description: 'Stone', quantity: 1, unit: 't', unitCost: 100, totalCost: 100, aiUnitCost: 100, aiTotalCost: 100, aiQuantity: 1 }],
    labourEstimate: { estimatedDays: 1, numberOfWorkers: 1, dayRate: 300, aiEstimatedDays: 1 },
    scheduleOfWorks: [{ stepNumber: 1, title: 'Build', description: 'Build wall' }],
    damageDescription: 'Tab test',
  },
  quotePayload: { totals: { total: 400 } },
  diffs: [],
  quoteSequence: 9998,
  quoteMode: 'standard',
  captureMode: 'photos',
  quoteToken: 'smoke-token-tab-test',
};

async function navigateToSavedJobs(page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });

  // Sidebar "My quotes" (always present) → SavedQuotes surface.
  await page.getByRole('button', { name: /^my quotes$/i }).click();
  // Wait for the tablist to render — that's the surest signal that
  // SavedQuotes with bucket tabs (not the empty-state) is showing.
  await expect(page.getByRole('tablist', { name: /job list view/i })).toBeVisible({ timeout: 15_000 });
}

test.describe('Saved Jobs tab switching', () => {
  let seededJobId = null;

  test.beforeEach(async ({ authedPage: page }) => {
    // Seed one job so SavedQuotes renders bucket tabs (empty state
    // short-circuits before them).
    const res = await page.request.post(`/api/users/${SMOKE_USER_ID}/jobs`, {
      data: MINIMAL_JOB,
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    seededJobId = body.id;

    await navigateToSavedJobs(page);
  });

  test.afterEach(async ({ authedPage: page }) => {
    if (seededJobId) {
      await page.request.delete(`/api/users/${SMOKE_USER_ID}/jobs/${seededJobId}`).catch(() => {});
      seededJobId = null;
    }
  });

  test('Active is the initial view (aria-selected)', async ({ authedPage: page }) => {
    // Match by "Active" prefix — the button text now includes a
    // "(N)" count (PR #134, 2026-07-08 count unification).
    const activeTab = page.getByRole('tab', { name: /^active\b/i });
    await expect(activeTab).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking Completed moves aria-selected to Completed (SET_VIEW_MODE regression)', async ({ authedPage: page }) => {
    // Match by "Completed" prefix — the button text may include a
    // "(N)" count when there are completed jobs.
    const completedTab = page.getByRole('tab', { name: /^completed/i });
    await completedTab.click();
    // The regression assertion — reducer's SET_VIEW_MODE guard must
    // accept 'completed' or this stays false.
    await expect(completedTab).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking Archived moves aria-selected to Archived', async ({ authedPage: page }) => {
    const archiveTab = page.getByRole('tab', { name: /^archived/i });
    await archiveTab.click();
    await expect(archiveTab).toHaveAttribute('aria-selected', 'true');
  });

  test('clicking Active returns aria-selected to Active after a detour', async ({ authedPage: page }) => {
    const completedTab = page.getByRole('tab', { name: /^completed/i });
    // Match by "Active" prefix — the button text now includes a
    // "(N)" count (PR #134, 2026-07-08 count unification).
    const activeTab = page.getByRole('tab', { name: /^active\b/i });

    await completedTab.click();
    await expect(completedTab).toHaveAttribute('aria-selected', 'true');

    await activeTab.click();
    await expect(activeTab).toHaveAttribute('aria-selected', 'true');
    await expect(completedTab).toHaveAttribute('aria-selected', 'false');
  });
});

/**
 * Sanity check that all three bucket tabs render together — mirrors
 * the VIEW_MODES lockstep test in Jest so a UI drift can't silently
 * remove a tab without the smoke suite noticing.
 */
test('SavedQuotes bucket-tab count matches VIEW_MODES (3 tabs)', async ({ authedPage: page }) => {
  // Seed + cleanup inline since this test lives outside the describe.
  const seedRes = await page.request.post(`/api/users/${SMOKE_USER_ID}/jobs`, {
    data: { ...MINIMAL_JOB, jobDetails: { ...MINIMAL_JOB.jobDetails, quoteReference: 'QT-2026-COUNTTEST' } },
  });
  expect(seedRes.status()).toBe(200);
  const seededId = (await seedRes.json()).id;

  try {
    await navigateToSavedJobs(page);
    const tabs = page.getByRole('tab', { name: /^(active|completed|archived)/i });
    await expect(tabs).toHaveCount(3);
  } finally {
    await page.request.delete(`/api/users/${SMOKE_USER_ID}/jobs/${seededId}`).catch(() => {});
  }
});
