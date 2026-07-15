/**
 * Structural + security tests for the Client Portal HTML renderer.
 *
 * Uses regex/string assertions (no jsdom dep) in the style of the rest
 * of this codebase. We assert on what MATTERS for the portal's contract:
 *   - every dynamic field is HTML-escaped (XSS guard, defence-in-depth
 *     even with CSP in place)
 *   - data-accent flows from client_snapshot_profile.accent and is
 *     whitelisted against the 4 allowed values
 *   - expiry ribbon class escalates with days remaining
 *   - confirmation states replace the response block once a decision
 *     has been recorded (no re-submission path possible)
 *   - the view beacon is bot-safe (3s dwell OR scroll), posts to the
 *     same-origin /q/:token/viewed path, fires at most once
 *   - no "FastQuote" branding leaks onto the customer-facing surface
 *     (design law)
 *   - no banned vocabulary (AI / Claude / agent / confidence / …)
 */
import {
  renderClientPortal,
  renderTokenNotFound,
  renderTokenExpired,
} from '../../portalRenderer.js';

const TOKEN = 'a3f7c091-2e84-4b1a-9f23-8d05e7b61c3a';

const baseProfile = {
  companyName: 'Doyle Walling',
  fullName: 'Mark Doyle',
  phone: '07986 661828',
  email: 'mark@doylewalling.co.uk',
  accent: 'amber',
};

const baseSnapshot = {
  profile: {
    companyName: 'Doyle Walling',
    fullName: 'Mark Doyle',
    phone: '07986 661828',
    email: 'mark@doylewalling.co.uk',
    vatRegistered: true,
  },
  jobDetails: {
    quoteReference: 'QT-2026-0047',
    quoteDate: '2026-04-16',
    clientName: 'James Simcock',
    siteAddress: 'Brink Farm Pott, SK10 5RU',
  },
  reviewData: {
    damageDescription: 'A ten-metre stretch of field wall has collapsed following heavy rain.',
    measurements: [],
    scheduleOfWorks: [
      { id: '1', title: 'Site preparation', description: 'Clear fallen stone and assess the existing courses.' },
      { id: '2', title: 'Dismantling',     description: 'Carefully remove loose stone for reuse.' },
    ],
    materials: [
      { id: 'm1', description: 'Reclaimed walling stone', quantity: '6', unit: 'tonnes', unitCost: 180, totalCost: 1080 },
    ],
    labourEstimate: { estimatedDays: 6, numberOfWorkers: 2, dayRate: 400 },
    additionalCosts: [],
    notes: ['This costing is based on visible damage.', 'Quoted figures are net of any grants.'],
  },
};

function makeJob(overrides = {}) {
  return {
    id: 'job-1',
    quote_reference: 'QT-2026-0047',
    site_address: 'Brink Farm Pott, SK10 5RU',
    client_snapshot: baseSnapshot,
    client_snapshot_profile: baseProfile,
    client_token_expires_at: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    client_response: null,
    client_response_at: null,
    client_decline_reason: null,
    ...overrides,
  };
}

describe('renderClientPortal — structure', () => {
  let html;
  beforeAll(() => { html = renderClientPortal(makeJob(), TOKEN); });

  test('is a complete HTML document with a viewport + robots meta', () => {
    expect(html).toMatch(/<!doctype html>/i);
    expect(html).toMatch(/<meta\s+name="viewport"[^>]*width=device-width[^>]*initial-scale=1/);
    expect(html).toMatch(/<meta\s+name="robots"[^>]*noindex[^>]*nofollow/i);
  });

  test('links /client-portal.css from same origin (CSP-friendly)', () => {
    expect(html).toMatch(/<link\s+rel="stylesheet"\s+href="\/client-portal\.css"/);
  });

  test('root element carries the .cp class and a data-accent attribute', () => {
    expect(html).toMatch(/<div[^>]*class="cp"[^>]*data-accent="/);
  });

  test('renders the tradesman name in the header', () => {
    expect(html).toMatch(/class="cp-tradesman"[^>]*>[^<]*Doyle Walling/);
  });

  test('renders the client name as the hero (TRQ-136 — reference is no longer in the head)', () => {
    // The head used to show the back-office quote reference; Paul's
    // feedback was that it wasn't useful to the client. The hero now
    // carries the client name, with the site address beneath as
    // subtitle and the prepared date as a small meta line.
    expect(html).toMatch(/class="cp-ref"[^>]*>[^<]*James Simcock/);
    const head = html.match(/<div class="cp-quote-head"[^>]*>[\s\S]*?<\/div>/);
    expect(head).not.toBeNull();
    expect(head[0]).not.toMatch(/QT-2026-0047/);
  });

  test('renders the client name and site address in the head (TRQ-136 — no more .cp-meta grid)', () => {
    const head = html.match(/<div class="cp-quote-head"[^>]*>[\s\S]*?<\/div>/);
    expect(head).not.toBeNull();
    expect(head[0]).toMatch(/James Simcock/);
    expect(head[0]).toMatch(/Brink Farm Pott/);
  });

  test('renders the damage description inside .cp-prose', () => {
    expect(html).toMatch(/cp-prose[\s\S]*ten-metre stretch/);
    expect(html).toMatch(/Description of damage/i);
  });

  test('renders the schedule as an ordered list with step titles', () => {
    expect(html).toMatch(/class="cp-schedule"/);
    expect(html).toMatch(/Site preparation/);
    expect(html).toMatch(/Dismantling/);
  });

  test('renders the cost breakdown with a .cp-cost-total', () => {
    expect(html).toMatch(/class="cp-cost-total"/);
    expect(html).toMatch(/class="cp-cost-total-value"[^>]*>[^<]*£/);
  });

  test('renders the notes list', () => {
    expect(html).toMatch(/class="cp-notes"/);
    expect(html).toMatch(/visible damage/);
  });

  test('renders the response block with Accept (primary) and Decline (secondary) actions', () => {
    expect(html).toMatch(/class="cp-respond"/);
    expect(html).toMatch(/class="cp-btn cp-btn-primary"[^>]*>[\s\S]*?Accept/i);
    expect(html).toMatch(/class="cp-btn cp-btn-secondary"[^>]*>[\s\S]*?Decline/i);
  });

  test('renders a hidden decline sheet that the inline JS reveals on demand', () => {
    expect(html).toMatch(/class="cp-decline-sheet"[^>]*style="[^"]*display:\s*none|hidden/);
  });

  test('renders a Save-as-PDF ghost button wired to window.print()', () => {
    expect(html).toMatch(/class="cp-btn cp-btn-ghost"[^>]*>[\s\S]*?Save as PDF/i);
    expect(html).toMatch(/window\.print\s*\(\s*\)/);
  });
});

// Mark's 2026-07-14 feedback: portal (and "Save as PDF" from the
// portal, which is window.print of this HTML) was missing the trading
// address and VAT number that the DOCX + server PDF already carry.
// For a UK-registered trader those are compliance chrome, not
// decoration — the customer needs them on the surface they see.
describe('renderClientPortal — footer chrome (trading address + VAT)', () => {
  test('renders trading address + VAT No when VAT-registered profile has both', () => {
    const html = renderClientPortal(
      makeJob({
        client_snapshot_profile: {
          ...baseProfile,
          tradingAddress: 'Upper Lane House, 22 Upper Lane, Halifax HX3 7EE',
          vatRegistered: true,
          vatNumber: 'GB 437 9344 64',
        },
      }),
      TOKEN,
    );
    expect(html).toMatch(/class="cp-footer-chrome"/);
    expect(html).toMatch(/Upper Lane House, 22 Upper Lane, Halifax HX3 7EE/);
    expect(html).toMatch(/VAT No: GB 437 9344 64/);
  });

  test('falls back to profile.address when tradingAddress missing (matches DOCX)', () => {
    // Same fallback the DOCX footer uses (exportDocx.js:500). Mark's
    // real profile only has `address` populated, not `tradingAddress`.
    const html = renderClientPortal(
      makeJob({
        client_snapshot_profile: {
          ...baseProfile,
          address: 'Upper Lane House, 22 Upper Lane, Halifax HX3 7EE',
          tradingAddress: '',
          vatRegistered: true,
          vatNumber: 'GB 437 9344 64',
        },
      }),
      TOKEN,
    );
    expect(html).toMatch(/Upper Lane House, 22 Upper Lane, Halifax HX3 7EE/);
    expect(html).toMatch(/VAT No: GB 437 9344 64/);
  });

  test('omits VAT No when vatRegistered is not strictly true (Paul-shape)', () => {
    // Paul is not VAT-registered. Fail-closed boolean check — string
    // "true" / 1 / objects must NOT flip VAT on. Matches the totals()
    // isVatRegistered contract.
    const html = renderClientPortal(
      makeJob({
        client_snapshot_profile: {
          ...baseProfile,
          address: '14, Mill Hill Lane, Brighouse HD6 2EL',
          vatRegistered: false,
          vatNumber: '',
        },
      }),
      TOKEN,
    );
    expect(html).toMatch(/class="cp-footer-chrome"/);
    expect(html).toMatch(/14, Mill Hill Lane, Brighouse HD6 2EL/);
    expect(html).not.toMatch(/VAT No:/);
  });

  test('omits the chrome line entirely when neither address nor VAT is present', () => {
    const html = renderClientPortal(
      makeJob({
        client_snapshot_profile: {
          ...baseProfile,
          address: '',
          tradingAddress: '',
          vatRegistered: false,
          vatNumber: '',
        },
      }),
      TOKEN,
    );
    expect(html).not.toMatch(/class="cp-footer-chrome"/);
  });

  test('escapes address + VAT to defend against XSS via a compromised profile', () => {
    const html = renderClientPortal(
      makeJob({
        client_snapshot_profile: {
          ...baseProfile,
          tradingAddress: 'Upper Lane <script>alert(1)</script>',
          vatRegistered: true,
          vatNumber: 'GB "><img src=x>',
        },
      }),
      TOKEN,
    );
    expect(html).not.toMatch(/<script>alert\(1\)<\/script>/);
    expect(html).not.toMatch(/<img\s+src=x>/i);
    expect(html).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test('sits inside .cp-footer, above the disclaimer (so the friendly line stays last)', () => {
    const html = renderClientPortal(
      makeJob({
        client_snapshot_profile: {
          ...baseProfile,
          tradingAddress: 'Upper Lane House',
          vatRegistered: true,
          vatNumber: 'GB 437 9344 64',
        },
      }),
      TOKEN,
    );
    const footer = html.match(/<div class="cp-footer">[\s\S]*?<\/div>\s*<\/div>/);
    expect(footer).not.toBeNull();
    const chromeIdx = footer[0].indexOf('cp-footer-chrome');
    const disclaimerIdx = footer[0].indexOf('cp-footer-disclaimer');
    expect(chromeIdx).toBeGreaterThan(-1);
    expect(disclaimerIdx).toBeGreaterThan(chromeIdx);
  });
});

describe('renderClientPortal — accent whitelist', () => {
  test('defaults to amber when profile.accent is missing', () => {
    const html = renderClientPortal(
      makeJob({ client_snapshot_profile: { ...baseProfile, accent: undefined } }),
      TOKEN
    );
    expect(html).toMatch(/data-accent="amber"/);
  });

  test('passes through the four allowed values (amber, rust, moss, slate)', () => {
    for (const accent of ['amber', 'rust', 'moss', 'slate']) {
      const html = renderClientPortal(
        makeJob({ client_snapshot_profile: { ...baseProfile, accent } }),
        TOKEN
      );
      expect(html).toMatch(new RegExp(`data-accent="${accent}"`));
    }
  });

  test('rejects unknown accent values and falls back to amber — prevents attribute injection', () => {
    const html = renderClientPortal(
      makeJob({ client_snapshot_profile: { ...baseProfile, accent: 'hot-pink" data-injected="evil' } }),
      TOKEN
    );
    expect(html).toMatch(/data-accent="amber"/);
    expect(html).not.toMatch(/data-injected/);
  });
});

describe('renderClientPortal — expiry ribbon escalation', () => {
  const ribbon = (days) => {
    const job = makeJob({
      client_token_expires_at: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    });
    const html = renderClientPortal(job, TOKEN);
    const match = html.match(/<div\s+class="cp-ribbon(?:[^"]*)?"/);
    return match ? match[0] : '';
  };

  test('shows the default ribbon for 15+ days remaining', () => {
    expect(ribbon(20)).toMatch(/cp-ribbon/);
    expect(ribbon(20)).not.toMatch(/--warn|--danger/);
  });

  test('shows the default ribbon for 8–14 days', () => {
    expect(ribbon(10)).toMatch(/cp-ribbon/);
    expect(ribbon(10)).not.toMatch(/--warn|--danger/);
  });

  test('escalates to --warn at 4–7 days', () => {
    expect(ribbon(5)).toMatch(/cp-ribbon--warn/);
  });

  test('escalates to --danger at 1–3 days', () => {
    expect(ribbon(2)).toMatch(/cp-ribbon--danger/);
  });
});

describe('renderClientPortal — confirmation states (already responded)', () => {
  test('renders the Accepted confirmation when client_response = "accepted"', () => {
    const html = renderClientPortal(
      makeJob({
        client_response: 'accepted',
        client_response_at: new Date('2026-04-21T10:25:00Z'),
      }),
      TOKEN
    );
    expect(html).not.toMatch(/class="cp-btn cp-btn-primary"/);
    expect(html).toMatch(/class="[^"]*\bcp-confirm-mark--ok\b/);
    expect(html).toMatch(/recorded/i);
  });

  test('renders the Declined confirmation when client_response = "declined"', () => {
    const html = renderClientPortal(
      makeJob({
        client_response: 'declined',
        client_response_at: new Date('2026-04-21T10:25:00Z'),
      }),
      TOKEN
    );
    expect(html).not.toMatch(/class="cp-btn cp-btn-primary"/);
    expect(html).toMatch(/class="[^"]*\bcp-confirm-mark--(muted|danger)\b/);
  });

  test('"already responded" state does not fire the view beacon again', () => {
    const html = renderClientPortal(
      makeJob({
        client_response: 'accepted',
        client_response_at: new Date('2026-04-21T10:25:00Z'),
      }),
      TOKEN
    );
    // Beacon is unnecessary once a response is recorded — its only
    // purpose is to reflect initial opens on the dashboard. Including
    // it on confirmation pages doesn't break anything but is noise.
    expect(html).not.toMatch(new RegExp(`/q/${TOKEN}/viewed`));
  });
});

describe('renderClientPortal — view beacon (bot-safe)', () => {
  let html;
  beforeAll(() => { html = renderClientPortal(makeJob(), TOKEN); });

  test('POSTs to the same-origin beacon path with the token in the URL', () => {
    expect(html).toMatch(new RegExp(`/q/${TOKEN}/viewed`));
    expect(html).toMatch(/method:\s*['"]POST['"]/);
  });

  test('fires only after real human interaction: 3s dwell OR scroll past cost breakdown', () => {
    expect(html).toMatch(/setTimeout\s*\([^,]+,\s*3\s*0\s*0\s*0\s*\)/);
    expect(html).toMatch(/scroll/i);
  });

  test('guards against duplicate firing with a once flag', () => {
    // Server also protects via COALESCE, but belt-and-braces.
    expect(html).toMatch(/(sent|fired|once)\s*=\s*true|once:\s*true/);
  });
});

describe('renderClientPortal — XSS safety (defence in depth with CSP)', () => {
  const HOSTILE = '<script>alert(1)</script>';
  const HOSTILE_IMG = '<img src=x onerror=alert(1)>';

  function stripScripts(html) {
    // Drop the safe inline script(s) the renderer legitimately emits
    // so we can scan for foreign <script> tags introduced by user data.
    return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
  }

  test('escapes company name, client name, and site address', () => {
    const html = renderClientPortal(
      makeJob({
        client_snapshot_profile: { ...baseProfile, companyName: HOSTILE },
        client_snapshot: {
          ...baseSnapshot,
          jobDetails: {
            ...baseSnapshot.jobDetails,
            clientName: HOSTILE,
            siteAddress: HOSTILE,
          },
        },
      }),
      TOKEN
    );
    const scrubbed = stripScripts(html);
    expect(scrubbed).not.toMatch(/<script[^>]*>alert\(1\)/i);
    // Literal text appears escaped.
    expect(html).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  });

  test('escapes damage description, schedule titles, and notes', () => {
    const html = renderClientPortal(
      makeJob({
        client_snapshot: {
          ...baseSnapshot,
          reviewData: {
            ...baseSnapshot.reviewData,
            damageDescription: HOSTILE_IMG,
            scheduleOfWorks: [{ id: '1', title: HOSTILE_IMG, description: HOSTILE_IMG }],
            notes: [HOSTILE_IMG],
          },
        },
      }),
      TOKEN
    );
    // Hostile <img> must not be live markup.
    expect(html).not.toMatch(/<img\s+src=x\s+onerror=/);
    // Escaped form should be present.
    expect(html).toMatch(/&lt;img\s+src=x\s+onerror=alert\(1\)&gt;/);
  });

  test('rejects non-whitelisted tokens in the beacon URL (attribute injection)', () => {
    // Any token not matching UUID v4 should not be echoed back into the
    // rendered HTML. Defence in depth: the route already rejects at the
    // SQL layer, but the renderer must not itself become an injection
    // vector if a bad token somehow arrives.
    const hostile = '"><script>alert(1)</script>';
    const html = renderClientPortal(makeJob(), hostile);
    const scrubbed = stripScripts(html);
    expect(scrubbed).not.toMatch(/<script[^>]*>alert\(1\)/i);
  });
});

describe('renderClientPortal — design law', () => {
  test('does not mention "FastQuote" anywhere on the customer-facing surface except inside the footer disclaimer', () => {
    const html = renderClientPortal(makeJob(), TOKEN);
    // Grab the disclaimer block; strip it out; assert no FastQuote in
    // what remains. The disclaimer is where the spec permits a single
    // subdued mention per its "indication of intent, not a contract"
    // language.
    const withoutDisclaimer = html.replace(
      /<div class="cp-footer-disclaimer"[\s\S]*?<\/div>/g,
      ''
    );
    expect(withoutDisclaimer.toLowerCase()).not.toContain('fastquote');
  });

  test('does not leak banned vocabulary (AI / Claude / agent / confidence / …)', () => {
    const html = renderClientPortal(makeJob(), TOKEN).toLowerCase();
    for (const banned of [
      ' ai ',
      'claude',
      'llm',
      'sonnet',
      'agent run',
      'self-critique',
      'calibration',
      'diff tracking',
      'confidence',
      'smart estimate',
      'optimised result',
    ]) {
      expect(html).not.toContain(banned);
    }
  });
});

describe('renderTokenNotFound / renderTokenExpired — styled, XSS-safe', () => {
  test('404 page links the branded stylesheet', () => {
    const html = renderTokenNotFound();
    expect(html).toMatch(/<link\s+rel="stylesheet"\s+href="\/client-portal\.css"/);
    expect(html.toLowerCase()).toContain('not found');
  });

  test('410 page escapes site_address', () => {
    const hostile = '<script>alert(1)</script>';
    const html = renderTokenExpired({ site_address: hostile });
    // No live script element introduced.
    expect(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')).not.toMatch(
      /<script[^>]*>alert\(1\)/
    );
    expect(html).toMatch(/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    expect(html.toLowerCase()).toContain('expired');
  });

  test('410 page still renders sensibly when no site_address is available', () => {
    const html = renderTokenExpired({});
    expect(html.toLowerCase()).toContain('expired');
  });
});

// Paul, 2026-05-13: customers were anchoring on the "6 days × 2 workers"
// breakdown and arguing that another tradesman "said 4". The total and
// labour line stay visible; only the day-and-worker count is hidden when
// the tradesman has opted in via profile.hideLabourDays.
describe('renderClientPortal — hideLabourDays profile toggle', () => {
  function jobWithFlag(flagValue) {
    return makeJob({
      client_snapshot_profile: { ...baseProfile, hideLabourDays: flagValue },
    });
  }

  test('default (flag undefined, legacy snapshot) shows the "X days × Y workers" breakdown', () => {
    const html = renderClientPortal(makeJob(), TOKEN);
    expect(html).toMatch(/6\s*days\s*&times;\s*2\s*workers|6\s*days\s*×\s*2\s*workers/);
  });

  test('flag explicitly false shows the breakdown', () => {
    const html = renderClientPortal(jobWithFlag(false), TOKEN);
    expect(html).toMatch(/6\s*days\s*&times;\s*2\s*workers|6\s*days\s*×\s*2\s*workers/);
  });

  test('flag true omits the day-and-worker breakdown', () => {
    const html = renderClientPortal(jobWithFlag(true), TOKEN);
    // The <small> sub-label that holds "X days × Y workers" must not appear.
    expect(html).not.toMatch(/\d+\s*days?\s*(&times;|×)\s*\d+\s*workers?/i);
    // And no bare "days" / "workers" leak in the labour row either.
    const labourRow = html.match(/<div class="cp-cost-label">Labour[\s\S]*?<\/div>/);
    expect(labourRow).not.toBeNull();
    expect(labourRow[0]).not.toMatch(/days?/i);
    expect(labourRow[0]).not.toMatch(/workers?/i);
  });

  test('flag true keeps the labour line itself (label and £ total)', () => {
    const html = renderClientPortal(jobWithFlag(true), TOKEN);
    // Labour label is still rendered — only its <small> sub-line is gone.
    expect(html).toMatch(/<div class="cp-cost-label">Labour/);
    // £4,800 = 6 × 2 × 400. The customer still sees what labour costs.
    expect(html).toMatch(/£4,800\.00/);
  });

  test('flag true does not strip days from material rows or other labels', () => {
    // A material line legitimately uses the unit "days" (e.g. plant hire
    // priced per day). The hide-days toggle must not affect material rows.
    const job = jobWithFlag(true);
    job.client_snapshot = {
      ...baseSnapshot,
      reviewData: {
        ...baseSnapshot.reviewData,
        materials: [
          { id: 'm1', description: 'Mini digger hire', quantity: '3', unit: 'days', unitCost: 150, totalCost: 450 },
        ],
      },
    };
    const html = renderClientPortal(job, TOKEN);
    expect(html).toContain('Mini digger hire');
    expect(html).toContain('days'); // surviving in the material row's unit cell
  });

  test('non-boolean truthy values do NOT enable hiding (fail-closed on tampered snapshot)', () => {
    // Defence-in-depth: the snapshot is frozen JSONB. If something somehow
    // wrote a string "true" or a number, we should still show days unless
    // the value is the literal boolean true. Mirrors normaliseVatRegistered.
    for (const sneaky of ['true', 1, {}, [], 'yes', 'TRUE']) {
      const html = renderClientPortal(jobWithFlag(sneaky), TOKEN);
      expect(html).toMatch(/6\s*days/);
    }
  });

  test('flag true survives a labourEstimate with missing days / workers', () => {
    // Defensive: even if the saved labour shape is partial, the renderer
    // must not crash and must still respect the toggle. Both off and on
    // should produce the labour row without a thrown exception.
    const job = jobWithFlag(true);
    job.client_snapshot = {
      ...baseSnapshot,
      reviewData: {
        ...baseSnapshot.reviewData,
        labourEstimate: { dayRate: 400 }, // no estimatedDays, no numberOfWorkers
      },
    };
    expect(() => renderClientPortal(job, TOKEN)).not.toThrow();
    const html = renderClientPortal(job, TOKEN);
    expect(html).toMatch(/<div class="cp-cost-label">Labour/);
    expect(html).not.toMatch(/\d+\s*days?\s*(&times;|×)\s*\d+\s*workers?/i);
  });

  test('flag false with missing labour shape still renders the breakdown safely', () => {
    const job = jobWithFlag(false);
    job.client_snapshot = {
      ...baseSnapshot,
      reviewData: {
        ...baseSnapshot.reviewData,
        labourEstimate: { dayRate: 400 }, // missing days / workers
      },
    };
    expect(() => renderClientPortal(job, TOKEN)).not.toThrow();
    const html = renderClientPortal(job, TOKEN);
    // Falls back to "0 days × 0 workers" rather than crashing.
    expect(html).toMatch(/0\s*days/);
  });
});
