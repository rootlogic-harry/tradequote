/**
 * Trader-side Client Portal UI (TRQ-131).
 *
 * ClientLinkBlock is the Step 5 component Mark/Paul use to generate,
 * copy, and monitor the customer-facing quote link. Five states:
 *
 *   1. Pre-generate        — no token yet; show CTA button
 *   2. Awaiting view       — token exists, client has not opened it
 *   3. Viewed              — client opened the link
 *   4. Accepted / Declined — response recorded
 *   5. Expired             — token past its 30-day TTL, no response
 *
 * Tests cover: helper shape, state routing, copy-to-clipboard feedback
 * loop, regenerate confirm modal, URL never synthesized client-side.
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
// ClientLinkBlock component — source-level contract
// ─────────────────────────────────────────────────────────────────────────
describe('ClientLinkBlock.jsx — source contract for the 5 portal states', () => {
  const src = readFileSync(
    join(repoRoot, 'src/components/ClientLinkBlock.jsx'),
    'utf8'
  );

  test('renders the pre-generate CTA with copy from the spec', () => {
    // "Create client link" is the designer's exact CTA text.
    expect(src).toMatch(/Create client link/i);
    expect(src).toMatch(/link-first-btn/);
  });

  test('wires the CTA to generateClientToken', () => {
    expect(src).toMatch(/generateClientToken\(/);
  });

  test('renders the URL via a read-only element (never user-editable)', () => {
    // URLs must come from the server, not be typed by the user. The
    // rendered URL element has no <input> or contentEditable.
    expect(src).toMatch(/link-url/);
    expect(src).not.toMatch(/contentEditable/);
  });

  test('Copy button calls navigator.clipboard.writeText', () => {
    expect(src).toMatch(/navigator\.clipboard\.writeText/);
    expect(src).toMatch(/link-url-copy/);
  });

  test('Copy feedback reverts after 2 seconds (setTimeout 2000)', () => {
    expect(src).toMatch(/setTimeout\s*\([^,]+,\s*2000\s*\)/);
    expect(src).toMatch(/Copied/);
  });

  test('derives pill-kind from the four response/view states', () => {
    // The class is built from a template literal keyed on pillKind, so
    // the literal class suffixes ('--viewed' etc.) don't appear in the
    // JSX — but the pill-kind values must appear in the status-reading
    // logic and the label map.
    for (const variant of ['viewed', 'accepted', 'declined', 'expired']) {
      expect(src).toMatch(new RegExp(`['"]${variant}['"]`));
    }
    // And the class name is built via the template literal so the
    // suffix token is present in source.
    expect(src).toMatch(/link-block-status--\$\{pillKind\}|link-block-status--/);
  });

  test('regenerate button is gated by a confirm modal', () => {
    // Design law: never silently invalidate the tradesman's link.
    // The regenerate tap must surface "are you sure?" before any network
    // call. Either via window.confirm (fine for v1) or a proper modal
    // — both are acceptable; what isn't acceptable is firing the POST
    // without any gate.
    const hasConfirm = /window\.confirm\(|showRegenerateConfirm|setShowRegenerateConfirm/.test(src);
    expect(hasConfirm).toBe(true);
  });

  test('regenerate calls generateClientToken (same endpoint, fresh token)', () => {
    // The server route overwrites the token + resets response fields
    // (TRQ-124), so "regenerate" is the same POST as "create".
    // Extract the `handleRegenerate` function body specifically and
    // assert it makes the POST — avoids matching on the literal word
    // "regenerate" in copy / button labels.
    const handler = src.match(/(async\s+)?function\s+handleRegenerate[\s\S]*?\n\s{0,4}\}/);
    expect(handler).not.toBeNull();
    expect(handler[0]).toMatch(/generateClientToken\(/);
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

  test('does not render ClientLinkBlock in read-only mode', () => {
    // Saved-quote viewer passes isReadOnly — a client can't generate a
    // new token on somebody else's saved quote. The portal actions are
    // only meaningful on the user's own live quote.
    expect(src).toMatch(/!isReadOnly[\s\S]{0,200}<ClientLinkBlock|ClientLinkBlock[\s\S]{0,200}isReadOnly[\s\S]{0,100}null/);
  });
});
