// @ts-check
import { test, expect, SMOKE_USER_ID } from './auth-fixture.js';

/**
 * Redeem self-referral message (PR #113 killer).
 *
 * Server-side validateRedemption() has always rejected
 * codeRow.user_id === userId with reason: 'self'. PR #113 upgraded
 * the client message from a generic "Code not recognised" to a
 * specific "That's your own code — share it with a friend instead."
 *
 * This test:
 *   1. Fetches the smoke user's OWN referral code from the
 *      /api/users/:id/referrals endpoint
 *   2. Submits that code through the redeem-referral endpoint
 *   3. Asserts the server returns applied:false with reason:'self'
 *   4. Asserts bonus_free_quotes is NOT credited
 *
 * The client-side message rendering is separately covered by the
 * Jest source-level test at redeemReferralBanner.test.js. This
 * smoke test is the end-to-end guarantee that the SERVER side of
 * the rejection can never quietly stop working.
 */
test('smoke user redeeming their own code is rejected server-side', async ({ authedPage: page }) => {
  // 1. Fetch the smoke user's own code (lazy-generated on first call).
  const codeRes = await page.request.get(`/api/users/${SMOKE_USER_ID}/referrals`);
  expect(codeRes.status()).toBe(200);
  const { code, bonusFreeQuotes: bonusBefore } = await codeRes.json();
  expect(code).toMatch(/^[A-Z0-9-]+$/);
  expect(bonusBefore).toBeGreaterThanOrEqual(0);

  // 2. Try to redeem it. Server MUST reject.
  const redeemRes = await page.request.post('/auth/redeem-referral', {
    data: { code },
  });
  expect(redeemRes.status()).toBe(200);
  const body = await redeemRes.json();
  expect(body.applied).toBe(false);
  expect(body.reason).toBe('self');

  // 3. Bonus counter must NOT move.
  const afterRes = await page.request.get(`/api/users/${SMOKE_USER_ID}/referrals`);
  const { bonusFreeQuotes: bonusAfter } = await afterRes.json();
  expect(bonusAfter).toBe(bonusBefore);
});

test('unknown code returns applied:false with reason:unknown (not self)', async ({ authedPage: page }) => {
  // Regression guard — the "self" reject must be specifically
  // triggered by an OWN-code match, not by any rejection.
  const res = await page.request.post('/auth/redeem-referral', {
    data: { code: 'NOTACODE-XXXX' },
  });
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.applied).toBe(false);
  expect(body.reason).toBe('unknown');
});
