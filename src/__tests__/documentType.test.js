/**
 * Document-type toggle — Quote ↔ Estimate (TRQ-134).
 *
 * Mark renders "Quote" everywhere. Paul wants "Estimate" everywhere.
 * Per-profile toggle; default is 'quote' so Mark's behaviour is
 * unchanged.
 *
 * The helper is the single source of truth — every render path reads
 * through it, so flipping the toggle changes the whole surface coherently.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { documentTerm, DOCUMENT_TYPES } from '../utils/documentType.js';
import { renderClientPortal } from '../../portalRenderer.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

describe('documentTerm helper — Title, UPPER, lower casings + safe default', () => {
  test('exposes the two allowed values', () => {
    expect(DOCUMENT_TYPES).toEqual(['quote', 'estimate']);
  });

  test('default (no profile) returns Quote', () => {
    expect(documentTerm()).toEqual({ title: 'Quote', upper: 'QUOTE', lower: 'quote' });
  });

  test('profile.documentType = "quote" returns Quote', () => {
    expect(documentTerm({ documentType: 'quote' })).toEqual({
      title: 'Quote', upper: 'QUOTE', lower: 'quote',
    });
  });

  test('profile.documentType = "estimate" returns Estimate', () => {
    expect(documentTerm({ documentType: 'estimate' })).toEqual({
      title: 'Estimate', upper: 'ESTIMATE', lower: 'estimate',
    });
  });

  test('any other value falls back to Quote (fail-closed)', () => {
    for (const bad of ['QUOTE', 'ESTIMATE', '', null, undefined, 42, {}, '<script>']) {
      const r = documentTerm({ documentType: bad });
      expect(r.title).toBe('Quote');
      expect(r.upper).toBe('QUOTE');
      expect(r.lower).toBe('quote');
    }
  });
});

describe('reducer — documentType default in initial profile', () => {
  test('initial state.profile.documentType is "quote"', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const state = reducer(initialState, { type: '@@INIT' });
    expect(state.profile.documentType).toBe('quote');
  });

  test('SELECT_USER with documentType="estimate" round-trips', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const initial = reducer(initialState, { type: '@@INIT' });
    const next = reducer(initial, {
      type: 'SELECT_USER',
      userId: 'paul',
      name: 'Paul',
      profile: { documentType: 'estimate' },
      quoteSequence: 1,
    });
    expect(next.profile.documentType).toBe('estimate');
  });

  test('SELECT_USER without documentType → defaults to "quote"', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const initial = reducer(initialState, { type: '@@INIT' });
    const next = reducer(initial, {
      type: 'SELECT_USER',
      userId: 'legacy',
      name: 'Legacy',
      profile: { companyName: 'Old Co' }, // no documentType
      quoteSequence: 1,
    });
    expect(next.profile.documentType).toBe('quote');
  });
});

describe('ProfileSetup.jsx — document-type toggle', () => {
  const src = readFileSync(
    join(repoRoot, 'src/components/steps/ProfileSetup.jsx'),
    'utf8'
  );

  test('renders a toggle / picker for the document type', () => {
    // Either a toggle pill pair (Quote / Estimate) or a radio group —
    // both options must appear as user-visible labels so the tradesman
    // can choose.
    expect(src).toMatch(/Quote/);
    expect(src).toMatch(/Estimate/);
  });

  test('wires the toggle to UPDATE_PROFILE("documentType", …)', () => {
    expect(src).toMatch(/update\s*\(\s*['"]documentType['"]/);
  });
});

describe('server — PUT /profile whitelist on documentType', () => {
  const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

  test('has a DOCUMENT_TYPE_WHITELIST constant', () => {
    expect(serverSrc).toMatch(/DOCUMENT_TYPE_WHITELIST\s*=\s*\[?\{?\s*['"`](quote|estimate)['"`]/);
  });

  test('PUT /api/users/:id/profile validates documentType', () => {
    const block = serverSrc.match(
      /app\.put\(\s*['"`]\/api\/users\/:id\/profile['"`][\s\S]*?\n\}\)/
    );
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/documentType/);
  });
});

describe('Render paths — every customer-facing surface goes through the helper', () => {
  const paths = [
    'src/components/QuoteDocument.jsx',
    'src/components/steps/ReviewEdit.jsx',
    'src/components/steps/QuoteOutput.jsx',
    'portalRenderer.js',
  ];
  test.each(paths)('%s imports or uses documentTerm', (p) => {
    const src = readFileSync(join(repoRoot, p), 'utf8');
    expect(src).toMatch(/documentTerm\s*\(/);
  });
});

describe('renderClientPortal — estimate profile renders estimate-flavoured copy', () => {
  const baseSnapshot = {
    profile: { companyName: 'Doyle Walling', vatRegistered: false, documentType: 'estimate' },
    jobDetails: { quoteReference: 'QT-2026-0047', quoteDate: '2026-04-16', clientName: 'Client', siteAddress: 'Site' },
    reviewData: {
      damageDescription: 'damage',
      measurements: [],
      scheduleOfWorks: [],
      materials: [],
      labourEstimate: { estimatedDays: 1, numberOfWorkers: 1, dayRate: 400 },
      additionalCosts: [],
      notes: [],
    },
  };
  const baseProfile = { companyName: 'Doyle Walling', accent: 'amber', documentType: 'estimate' };
  const baseJob = {
    id: 'j',
    quote_reference: 'QT-1',
    site_address: 'Site',
    client_snapshot: baseSnapshot,
    client_snapshot_profile: baseProfile,
    client_token_expires_at: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
    client_response: null,
  };
  const TOKEN = 'a3f7c091-2e84-4b1a-9f23-8d05e7b61c3a';

  test('eyebrow reads ESTIMATE (uppercase) for an estimate profile', () => {
    const html = renderClientPortal(baseJob, TOKEN);
    expect(html).toMatch(/class="cp-eyebrow"[^>]*>\s*Estimate\s*</i);
  });

  test('Accept CTA reads "Accept this estimate" for an estimate profile', () => {
    const html = renderClientPortal(baseJob, TOKEN);
    expect(html).toMatch(/Accept this estimate/i);
    expect(html).toMatch(/Decline this estimate/i);
  });

  test('quote profile still reads "Accept this quote"', () => {
    const quoteJob = {
      ...baseJob,
      client_snapshot_profile: { ...baseProfile, documentType: 'quote' },
      client_snapshot: {
        ...baseSnapshot,
        profile: { ...baseSnapshot.profile, documentType: 'quote' },
      },
    };
    const html = renderClientPortal(quoteJob, TOKEN);
    expect(html).toMatch(/Accept this quote/i);
    expect(html).not.toMatch(/Accept this estimate/i);
  });
});
