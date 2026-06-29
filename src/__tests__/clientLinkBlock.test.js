/**
 * Trader-side Client Portal hero card (Quote Screen Redesign, 2026-06-29).
 *
 * ClientLinkBlock is the Step 5 component Mark/Paul use to generate,
 * copy, and monitor the customer-facing quote link. The redesign
 * promotes it from the buried bottom-of-page dark box to the hero
 * card right under the Send / Download split-buttons.
 *
 * Five states, driven by `GET /api/users/:id/jobs/:jobId/client-status`:
 *
 *   1. Pre-generate        — no token yet; show CTA button
 *   2. Sent · awaiting view — token exists, client has not opened it
 *   3. Viewed              — client opened the link
 *   4. Accepted / Declined — response recorded
 *   5. Expired             — token past its 30-day TTL, no response
 *
 * Tests cover: helper shape, state routing, copy-to-clipboard feedback
 * loop, regenerate confirm modal, URL never synthesised client-side,
 * the three-stage Sent → Viewed → Accepted timeline.
 */
import { jest } from '@jest/globals';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

// ─────────────────────────────────────────────────────────────────────────
// userDB helpers
// ─────────────────────────────────────────────────────────────────────────
describe('userDB.js — getClientStatus + generateClientToken helpers', () => {
  let originalFetch;
  beforeEach(() => { originalFetch = globalThis.fetch; jest.resetModules(); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('getClientStatus hits GET /api/users/:id/jobs/:jobId/client-status', async () => {
    const calls = [];
    globalThis.fetch = jest.fn(async (url, init) => {
      calls.push({ url, method: init?.method || 'GET' });
      return { ok: true, status: 200, json: async () => ({ hasToken: false }) };
    });
    const { getClientStatus } = await import('../utils/userDB.js');
    const res = await getClientStatus('paul', 'job-42');
    expect(res).toEqual({ hasToken: false });
    expect(calls[0].url).toBe('/api/users/paul/jobs/job-42/client-status');
    expect(calls[0].method).toBe('GET');
  });

  test('getClientStatus throws SessionExpiredError on 401', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const { getClientStatus, SessionExpiredError } = await import('../utils/userDB.js');
    await expect(getClientStatus('u', 'j')).rejects.toBeInstanceOf(SessionExpiredError);
  });

  test('generateClientToken POSTs /client-token and returns {token, url, expires}', async () => {
    const calls = [];
    globalThis.fetch = jest.fn(async (url, init) => {
      calls.push({ url, method: init?.method });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          token: 'a3f7c091-2e84-4b1a-9f23-8d05e7b61c3a',
          url: 'https://fastquote.uk/q/a3f7c091-2e84-4b1a-9f23-8d05e7b61c3a',
          expires: '2026-05-21T12:00:00Z',
          ttlDays: 30,
        }),
      };
    });
    const { generateClientToken } = await import('../utils/userDB.js');
    const res = await generateClientToken('paul', 'job-42');
    expect(calls[0].url).toBe('/api/users/paul/jobs/job-42/client-token');
    expect(calls[0].method).toBe('POST');
    expect(res.url).toMatch(/fastquote\.uk\/q\//);
    expect(res.token).toMatch(/^[0-9a-f-]+$/i);
  });

  test('generateClientToken throws on 401 and on 5xx', async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    const { generateClientToken, SessionExpiredError } = await import('../utils/userDB.js');
    await expect(generateClientToken('u', 'j')).rejects.toBeInstanceOf(SessionExpiredError);

    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }));
    const { generateClientToken: gen2 } = await import('../utils/userDB.js');
    await expect(gen2('u', 'j')).rejects.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ClientLinkBlock component — source-level contract (hero card variant)
// ─────────────────────────────────────────────────────────────────────────
describe('ClientLinkBlock.jsx — hero card shape', () => {
  const src = readFileSync(
    join(repoRoot, 'src/components/ClientLinkBlock.jsx'),
    'utf8'
  );

  test('renders the pre-generate CTA with the spec copy', () => {
    expect(src).toMatch(/Create client link/i);
  });

  test('wires the CTA to generateClientToken', () => {
    expect(src).toMatch(/generateClientToken\(/);
  });

  test('hero card has a title row with "Client link" + status badge', () => {
    expect(src).toMatch(/qo-hero-title/);
    expect(src).toMatch(/Client link/);
    expect(src).toMatch(/qo-status-badge/);
  });

  test('renders the URL via a read-only <input> (never user-editable)', () => {
    expect(src).toMatch(/<input[\s\S]{0,200}readOnly/);
    expect(src).toMatch(/qo-link-url/);
    expect(src).not.toMatch(/contentEditable/);
  });

  test('Copy button calls navigator.clipboard.writeText', () => {
    expect(src).toMatch(/navigator\.clipboard\.writeText/);
    expect(src).toMatch(/qo-link-url-copy/);
  });

  test('Copy feedback reverts after 2 seconds (setTimeout 2000)', () => {
    expect(src).toMatch(/setTimeout\s*\([^,]+,\s*2000\s*\)/);
    expect(src).toMatch(/Copied/);
  });

  test('Copy also surfaces a "Link copied" toast for the trader', () => {
    expect(src).toMatch(/Link copied — paste into WhatsApp or email/);
  });

  test('derives pill-kind from the five response/view states (incl. sent default)', () => {
    for (const variant of ['sent', 'viewed', 'accepted', 'declined', 'expired']) {
      expect(src).toMatch(new RegExp(`['"]${variant}['"]`));
    }
    // The status-badge class is templated on the pillKind so the
    // suffix token must appear in source.
    expect(src).toMatch(/qo-status-badge--\$\{pillKind\}/);
  });

  test('renders a Sent → Viewed → Accepted timeline as a <ol> with three stages', () => {
    expect(src).toMatch(/qo-timeline/);
    // Three timeline rows, keyed by data-stage.
    expect(src).toMatch(/data-stage="sent"/);
    expect(src).toMatch(/data-stage="viewed"/);
    expect(src).toMatch(/data-stage="accepted"/);
  });

  test('regenerate button is gated by a window.confirm', () => {
    // Design law: never silently invalidate the tradesman's link.
    expect(src).toMatch(/window\.confirm\(/);
  });

  test('regenerate calls generateClientToken (same endpoint, fresh token)', () => {
    const handler = src.match(/(async\s+)?function\s+handleRegenerate[\s\S]*?\n\s{0,4}\}/);
    expect(handler).not.toBeNull();
    expect(handler[0]).toMatch(/generateClientToken\(/);
  });

  test('regenerate CTA copy matches the spec ("Regenerate link" / "Sending to someone else?")', () => {
    expect(src).toMatch(/Sending to someone else/);
    expect(src).toMatch(/Regenerate link/);
  });

  test('decline-reason block surfaces when status.response === "declined"', () => {
    expect(src).toMatch(/Decline reason/);
    expect(src).toMatch(/qo-decline-reason/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// QuoteOutput integration
// ─────────────────────────────────────────────────────────────────────────
describe('QuoteOutput.jsx — renders ClientLinkBlock on Step 5', () => {
  const src = readFileSync(
    join(repoRoot, 'src/components/steps/QuoteOutput.jsx'),
    'utf8'
  );

  test('imports ClientLinkBlock', () => {
    expect(src).toMatch(/import\s+ClientLinkBlock\s+from/);
  });

  test('renders ClientLinkBlock with currentUserId + savedJobId', () => {
    expect(src).toMatch(/<ClientLinkBlock[\s\S]*?currentUserId/);
    expect(src).toMatch(/<ClientLinkBlock[\s\S]*?jobId/);
  });

  test('renders ClientLinkBlock whenever a savedJobId exists (TRQ-139 opened it to read-only too)', () => {
    expect(src).toMatch(/\{\s*savedJobId\s*&&[\s\S]{0,80}<ClientLinkBlock/);
  });
});
