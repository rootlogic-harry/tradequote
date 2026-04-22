/**
 * Portal head — client + site as hero (TRQ-136).
 *
 * Paul asked us to drop the back-office reference (QT-2026-0002) and
 * the QUOTE eyebrow from the top of /q/:token. The client-facing hero
 * is now the client name + site address. Prepared date stays as a
 * small meta line beneath.
 */
import { renderClientPortal } from '../../portalRenderer.js';

const TOKEN = 'a3f7c091-2e84-4b1a-9f23-8d05e7b61c3a';

const baseSnapshot = {
  profile: { companyName: 'Doyle Walling', vatRegistered: false, documentType: 'quote' },
  jobDetails: {
    quoteReference: 'QT-2026-0002',
    quoteDate: '2026-04-21',
    clientName: 'James Simcock',
    siteAddress: 'Brink Farm Pott, Macclesfield, SK10 5RU',
  },
  reviewData: {
    damageDescription: 'd',
    measurements: [],
    scheduleOfWorks: [],
    materials: [],
    labourEstimate: { estimatedDays: 1, numberOfWorkers: 1, dayRate: 400 },
    additionalCosts: [],
    notes: [],
  },
};

const baseProfile = { companyName: 'Doyle Walling', accent: 'amber', documentType: 'quote' };

function job(overrides = {}) {
  return {
    id: 'j',
    quote_reference: 'QT-2026-0002',
    site_address: 'Brink Farm Pott, Macclesfield, SK10 5RU',
    client_snapshot: baseSnapshot,
    client_snapshot_profile: baseProfile,
    client_token_expires_at: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    client_response: null,
    ...overrides,
  };
}

describe('Portal head — reference + eyebrow dropped', () => {
  test('QUOTE eyebrow is NOT rendered', () => {
    const html = renderClientPortal(job(), TOKEN);
    expect(html).not.toMatch(/class="cp-eyebrow"[^>]*>\s*QUOTE/);
    expect(html).not.toMatch(/class="cp-eyebrow"[^>]*>\s*Quote/);
  });

  test('ESTIMATE eyebrow is NOT rendered for estimate-profile', () => {
    const html = renderClientPortal(
      job({
        client_snapshot: {
          ...baseSnapshot,
          profile: { ...baseSnapshot.profile, documentType: 'estimate' },
        },
        client_snapshot_profile: { ...baseProfile, documentType: 'estimate' },
      }),
      TOKEN
    );
    expect(html).not.toMatch(/class="cp-eyebrow"[^>]*>\s*ESTIMATE/);
    expect(html).not.toMatch(/class="cp-eyebrow"[^>]*>\s*Estimate/);
  });

  test('quote reference (QT-...) is NOT rendered in the head', () => {
    const html = renderClientPortal(job(), TOKEN);
    // The head block should not contain the QT-2026-0002 reference. The
    // reference can still live deeper in the DOM (e.g. inside a hidden
    // admin field, though currently it doesn't) — just not in the hero.
    const head = html.match(/<div class="cp-quote-head"[^>]*>[\s\S]*?<\/div>/);
    expect(head).not.toBeNull();
    expect(head[0]).not.toMatch(/QT-2026-0002/);
  });
});

describe('Portal head — client name + site promoted', () => {
  test('clientName is the .cp-ref hero', () => {
    const html = renderClientPortal(job(), TOKEN);
    expect(html).toMatch(/class="cp-ref"[^>]*>[^<]*James Simcock/);
  });

  test('siteAddress appears in the head, beneath the name', () => {
    const html = renderClientPortal(job(), TOKEN);
    const head = html.match(/<div class="cp-quote-head"[^>]*>[\s\S]*?<\/div>/);
    expect(head[0]).toMatch(/Brink Farm Pott/);
  });

  test('prepared date still renders as a small meta line', () => {
    const html = renderClientPortal(job(), TOKEN);
    expect(html).toMatch(/Prepared[\s\S]*?2026/);
  });
});

describe('Portal head — defensive fallbacks', () => {
  test('empty clientName falls back to siteAddress in the hero', () => {
    const html = renderClientPortal(
      job({
        client_snapshot: {
          ...baseSnapshot,
          jobDetails: { ...baseSnapshot.jobDetails, clientName: '' },
        },
      }),
      TOKEN
    );
    expect(html).toMatch(/class="cp-ref"[^>]*>[^<]*Brink Farm Pott/);
  });

  test('both empty → generic "Your {term}" hero so the layout does not collapse', () => {
    const html = renderClientPortal(
      job({
        client_snapshot: {
          ...baseSnapshot,
          jobDetails: { ...baseSnapshot.jobDetails, clientName: '', siteAddress: '' },
        },
      }),
      TOKEN
    );
    expect(html).toMatch(/class="cp-ref"[^>]*>[^<]*Your quote/i);
  });
});

describe('Portal head — XSS safety on the promoted fields', () => {
  test('hostile clientName is escaped in the hero', () => {
    const hostile = '<script>alert(1)</script>';
    const html = renderClientPortal(
      job({
        client_snapshot: {
          ...baseSnapshot,
          jobDetails: { ...baseSnapshot.jobDetails, clientName: hostile },
        },
      }),
      TOKEN
    );
    const scrubbed = html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    expect(scrubbed).not.toMatch(/<script[^>]*>alert\(1\)/);
    expect(html).toMatch(/&lt;script&gt;alert\(1\)/);
  });

  test('hostile siteAddress is escaped in the subtitle', () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const html = renderClientPortal(
      job({
        client_snapshot: {
          ...baseSnapshot,
          jobDetails: { ...baseSnapshot.jobDetails, siteAddress: hostile },
        },
      }),
      TOKEN
    );
    expect(html).not.toMatch(/<img\s+src=x\s+onerror=/);
  });
});
