// @ts-check
import { test, expect, SMOKE_USER_ID } from './auth-fixture.js';

/**
 * PATCH /api/users/:id/jobs/:jobId/details — Edit details journey
 * (PR #111 killer).
 *
 * Paul Clough's real-world ask (2026-06-30): "Is there any way I
 * could edit job details without having to regenerate. The address
 * is wrong and if I regenerate it might alter details or figures
 * which are spot on."
 *
 * PR #111 added the metadata-only PATCH route. This smoke test
 * verifies the promise end-to-end:
 *   1. Seed a saved job with a known clientName + siteAddress
 *   2. Save the "before" totals + reviewData hash
 *   3. PATCH just the siteAddress via the new endpoint
 *   4. Re-GET the job — confirm siteAddress updated AND totals /
 *      reviewData / diffs are byte-identical to the "before" state
 *
 * If a future refactor accidentally lets PATCH write reviewData
 * or blow away diffs, this test fails and Paul's trust is preserved.
 */

const SEED_SNAPSHOT = {
  profile: {
    companyName: 'Smoke Co',
    fullName: 'Agent Smoke',
    phone: '01234 567890',
    address: 'Smoke Test, YO1 1AA',
    dayRate: 300,
  },
  jobDetails: {
    clientName: 'Smoke Client A',
    siteAddress: 'Original site address',
    quoteReference: 'QT-2026-SMOKE',
    quoteDate: '2026-07-01',
    briefNotes: 'Original brief notes',
  },
  reviewData: {
    measurements: [
      { id: 'm1', item: 'Wall length', valueMm: 5000, aiValue: '5000', value: '5000', confirmed: true },
    ],
    materials: [
      { id: 'mat1', description: 'Sandstone', quantity: 2, unit: 't', unitCost: 180, totalCost: 360, aiUnitCost: 180, aiTotalCost: 360, aiQuantity: 2 },
    ],
    labourEstimate: { estimatedDays: 2, numberOfWorkers: 1, dayRate: 300, aiEstimatedDays: 2 },
    scheduleOfWorks: [{ stepNumber: 1, title: 'Rebuild', description: 'Reconstruct wall to original height' }],
    damageDescription: 'Collapsed section',
  },
  quotePayload: {
    totals: { total: 960, materialsSubtotal: 360, labourTotal: 600 },
  },
  diffs: [
    { fieldType: 'measurement', fieldLabel: 'Wall length', aiValue: '5000', confirmedValue: '5000', wasEdited: false, editMagnitude: 0 },
  ],
  quoteSequence: 9999,
  quoteMode: 'standard',
  captureMode: 'photos',
  quoteToken: 'smoke-token-edit-details',
};

/** Create a job via POST; return { jobId }. */
async function createSmokeJob(page) {
  const res = await page.request.post(`/api/users/${SMOKE_USER_ID}/jobs`, {
    data: SEED_SNAPSHOT,
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.id).toMatch(/^sq-/);
  return body.id;
}

/** Read the job back, return the full row. */
async function fetchJob(page, jobId) {
  const res = await page.request.get(`/api/users/${SMOKE_USER_ID}/jobs/${jobId}`);
  expect(res.status()).toBe(200);
  return res.json();
}

/** Best-effort cleanup so smoke jobs don't pile up on the dashboard. */
async function deleteSmokeJob(page, jobId) {
  await page.request.delete(`/api/users/${SMOKE_USER_ID}/jobs/${jobId}`).catch(() => {});
}

test('PATCH /details updates siteAddress WITHOUT touching reviewData or diffs', async ({ authedPage: page }) => {
  const jobId = await createSmokeJob(page);
  try {
    const before = await fetchJob(page, jobId);
    // Snapshot fingerprint on the fields Paul cares about — if any
    // of these change after the metadata-only PATCH, we've regressed.
    const reviewBefore = JSON.stringify(before.quoteSnapshot?.reviewData || null);
    const totalsBefore = JSON.stringify(before.quoteSnapshot?.quotePayload?.totals || null);
    const diffsBefore = JSON.stringify(before.quoteSnapshot?.diffs || []);
    expect(before.siteAddress).toBe(SEED_SNAPSHOT.jobDetails.siteAddress);

    // The actual metadata-only patch.
    const patchRes = await page.request.patch(
      `/api/users/${SMOKE_USER_ID}/jobs/${jobId}/details`,
      { data: { siteAddress: 'Updated smoke address, LS1 1AA' } }
    );
    expect(patchRes.status()).toBe(200);
    const patchBody = await patchRes.json();
    expect(patchBody.ok).toBe(true);
    expect(patchBody.jobDetails.siteAddress).toBe('Updated smoke address, LS1 1AA');

    const after = await fetchJob(page, jobId);
    // siteAddress updated in BOTH the denormalised column AND the
    // JSONB jobDetails.
    expect(after.siteAddress).toBe('Updated smoke address, LS1 1AA');
    expect(after.quoteSnapshot?.jobDetails?.siteAddress).toBe('Updated smoke address, LS1 1AA');

    // reviewData / totals / diffs — byte-identical to before.
    expect(JSON.stringify(after.quoteSnapshot?.reviewData || null)).toBe(reviewBefore);
    expect(JSON.stringify(after.quoteSnapshot?.quotePayload?.totals || null)).toBe(totalsBefore);
    expect(JSON.stringify(after.quoteSnapshot?.diffs || [])).toBe(diffsBefore);
  } finally {
    await deleteSmokeJob(page, jobId);
  }
});

test('PATCH /details with only clientPhone leaves siteAddress alone (partial patch)', async ({ authedPage: page }) => {
  const jobId = await createSmokeJob(page);
  try {
    const patchRes = await page.request.patch(
      `/api/users/${SMOKE_USER_ID}/jobs/${jobId}/details`,
      { data: { clientPhone: '07777 111 222' } }
    );
    expect(patchRes.status()).toBe(200);
    const body = await patchRes.json();
    expect(body.jobDetails.clientPhone).toBe('07777 111 222');
    expect(body.jobDetails.siteAddress).toBe(SEED_SNAPSHOT.jobDetails.siteAddress);
  } finally {
    await deleteSmokeJob(page, jobId);
  }
});

test('PATCH /details with empty body returns 400 (no silent no-op)', async ({ authedPage: page }) => {
  const jobId = await createSmokeJob(page);
  try {
    const res = await page.request.patch(
      `/api/users/${SMOKE_USER_ID}/jobs/${jobId}/details`,
      { data: {} }
    );
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/no editable fields/i);
  } finally {
    await deleteSmokeJob(page, jobId);
  }
});

test('PATCH /details refuses non-whitelisted fields (reviewData is silently dropped, not written)', async ({ authedPage: page }) => {
  const jobId = await createSmokeJob(page);
  try {
    const before = await fetchJob(page, jobId);
    const reviewBefore = JSON.stringify(before.quoteSnapshot?.reviewData || null);

    // Hostile body — try to write reviewData through the metadata endpoint.
    const patchRes = await page.request.patch(
      `/api/users/${SMOKE_USER_ID}/jobs/${jobId}/details`,
      {
        data: {
          siteAddress: 'Legit address change',
          reviewData: { measurements: [] }, // must be ignored
          quotePayload: { totals: { total: 0 } }, // must be ignored
          diffs: [], // must be ignored
        },
      }
    );
    expect(patchRes.status()).toBe(200);

    const after = await fetchJob(page, jobId);
    // Legit change lands.
    expect(after.siteAddress).toBe('Legit address change');
    // Non-whitelisted keys silently dropped — reviewData untouched.
    expect(JSON.stringify(after.quoteSnapshot?.reviewData || null)).toBe(reviewBefore);
  } finally {
    await deleteSmokeJob(page, jobId);
  }
});
