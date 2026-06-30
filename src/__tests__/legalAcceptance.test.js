/**
 * TRQ-151 — Privacy / Terms / DPA pages + signup-time acceptance.
 *
 * Four layers covered:
 *   1. Schema additions to `users` (six new columns: version + at, ×3 docs).
 *   2. OAuth signup writes the current versions + timestamps.
 *   3. Pages exist, link cross-references work, footer carries DPA.
 *   4. Inline upload-consent line is present in JobDetails (no modal).
 *
 * Anchored at source level — these are HTML strings inside a Node
 * module, so running them via supertest would require a live DB.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverJs = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const jobDetailsJsx = readFileSync(
  join(repoRoot, 'src/components/steps/JobDetails.jsx'), 'utf8'
);

describe('TRQ-151 — schema additions for legal acceptance', () => {
  test('users gains terms_accepted_version + _at columns', () => {
    expect(serverJs).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_version TEXT/);
    expect(serverJs).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ/);
  });

  test('users gains privacy_accepted_version + _at columns', () => {
    expect(serverJs).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_version TEXT/);
    expect(serverJs).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ/);
  });

  test('users gains dpa_accepted_version + _at columns', () => {
    expect(serverJs).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS dpa_accepted_version TEXT/);
    expect(serverJs).toMatch(/ALTER TABLE users ADD COLUMN IF NOT EXISTS dpa_accepted_at TIMESTAMPTZ/);
  });

  test('migration leaves legacy users untouched (no UPDATE clause)', () => {
    // We deliberately don't backfill — see the comment in initDB.
    // This regex checks there's no `UPDATE users SET terms_accepted_*`
    // anywhere in the file, which would force existing users into the
    // new audit trail and surface a "you must accept" moment.
    expect(serverJs).not.toMatch(/UPDATE users SET terms_accepted/);
    expect(serverJs).not.toMatch(/UPDATE users SET privacy_accepted/);
    expect(serverJs).not.toMatch(/UPDATE users SET dpa_accepted/);
  });
});

describe('TRQ-151 — LEGAL_VERSIONS constant', () => {
  test('declared and frozen', () => {
    expect(serverJs).toMatch(/const LEGAL_VERSIONS = Object\.freeze\(/);
  });

  test('covers all three documents', () => {
    // Bound widened 2026-06-30 (bug-hunt #2) — the LEGAL_VERSIONS
    // comment block grew with the re-acceptance audit-trail note.
    const block = serverJs.match(/const LEGAL_VERSIONS = Object\.freeze\([\s\S]{0,2000}\);/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/privacy:/);
    expect(block[0]).toMatch(/terms:/);
    expect(block[0]).toMatch(/dpa:/);
  });
});

describe('TRQ-151 — OAuth signup records acceptance', () => {
  // Slice the OAuth INSERT INTO users statement.
  const start = serverJs.indexOf('INSERT INTO users (id, name, email, avatar_url, auth_provider');
  const end = serverJs.indexOf('return done(null, inserted.rows[0]);', start);
  const block = serverJs.slice(start, end);

  test('the OAuth INSERT carries the version columns', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toMatch(/terms_accepted_version/);
    expect(block).toMatch(/privacy_accepted_version/);
    expect(block).toMatch(/dpa_accepted_version/);
  });

  test('all three timestamps default to NOW()', () => {
    // Three NOW()s in the VALUES clause for the three _at columns
    // (plus the two existing NOW()s for created_at + last_login_at).
    // Total: at least 5 NOW()s in this single INSERT.
    const nowCount = (block.match(/NOW\(\)/g) || []).length;
    expect(nowCount).toBeGreaterThanOrEqual(5);
  });

  test('LEGAL_VERSIONS values are bound to parameters (not interpolated)', () => {
    // The version strings must be bound as $6 / $7 / $8 — never
    // template-string-interpolated into the SQL.
    expect(block).toMatch(/LEGAL_VERSIONS\.terms, LEGAL_VERSIONS\.privacy, LEGAL_VERSIONS\.dpa/);
  });
});

describe('TRQ-151 — Privacy Policy page', () => {
  const start = serverJs.indexOf("app.get('/privacy'");
  const end = serverJs.indexOf("app.get('/dpa'", start);
  const block = serverJs.slice(start, end);

  test('page is mounted', () => {
    expect(start).toBeGreaterThan(-1);
  });

  test('declares the controller (Harry as sole trader)', () => {
    expect(block).toMatch(/Harry Doyle/);
    expect(block).toMatch(/sole trader/i);
  });

  test('distinguishes waller (controller) from end clients (processor)', () => {
    expect(block).toMatch(/two distinct groups|Two groups of people/i);
    expect(block).toMatch(/end client/i);
    expect(block).toMatch(/You are the controller of their data\. FastQuote is your processor\./);
  });

  test('lists every real processor by name', () => {
    for (const p of ['Anthropic', 'OpenAI', 'Railway', 'Cloudflare', 'Google', 'Stripe']) {
      expect(block).toMatch(new RegExp(p));
    }
  });

  test('explains the US→EU transition honestly (current US, migration in progress)', () => {
    expect(block).toMatch(/US West|United States/);
    expect(block).toMatch(/EU region/);
    expect(block).toMatch(/SCCs|UK Addendum/);
  });

  test('lists every data-subject right (UK GDPR)', () => {
    expect(block).toMatch(/access, correct, port, restrict, or delete/i);
    expect(block).toMatch(/ico\.org\.uk/i);
  });

  test('explicitly names what we do NOT do (no tracking, no resale)', () => {
    expect(block).toMatch(/do not sell/i);
    expect(block).toMatch(/Google Analytics|tracking SDK/i);
  });

  test('the printed version label matches LEGAL_VERSIONS.privacy', () => {
    expect(block).toMatch(/Version \$\{LEGAL_VERSIONS\.privacy\}/);
  });
});

describe('TRQ-151 — Terms of Service page', () => {
  const start = serverJs.indexOf("app.get('/terms'");
  const end = serverJs.indexOf('// --- Landing page', start);
  const block = serverJs.slice(start, end);

  test('page is mounted', () => {
    expect(start).toBeGreaterThan(-1);
  });

  test('signup section references all three documents + version recording', () => {
    expect(block).toMatch(/Terms.*Privacy Policy.*Data Processing Agreement|Terms.*Privacy.*DPA/);
    expect(block).toMatch(/record the version and timestamp/i);
  });

  test('upload-confirmation clause is present', () => {
    expect(block).toMatch(/right to upload photographs/i);
    expect(block).toMatch(/inform your end client/i);
  });

  test('liability is bounded but not zeroed (nothing limits unlimitable liability)', () => {
    expect(block).toMatch(/total liability/i);
    expect(block).toMatch(/cannot be limited by law/i);
  });

  test('subscription pricing matches the brief (£19.99 + 1-month trial)', () => {
    expect(block).toMatch(/£19\.99|&pound;19\.99/);
    expect(block).toMatch(/1-month no-card trial/i);
  });

  test('the printed version label matches LEGAL_VERSIONS.terms', () => {
    expect(block).toMatch(/Version \$\{LEGAL_VERSIONS\.terms\}/);
  });
});

describe('TRQ-151 — DPA page', () => {
  const start = serverJs.indexOf("app.get('/dpa'");
  const end = serverJs.indexOf("app.get('/terms'", start);
  const block = serverJs.slice(start, end);

  test('page is mounted', () => {
    expect(start).toBeGreaterThan(-1);
  });

  test('defines the controller/processor roles formally', () => {
    expect(block).toMatch(/Controller/);
    expect(block).toMatch(/Processor/);
    expect(block).toMatch(/Article 28/);
  });

  test('enumerates sub-processors (matches Privacy Policy)', () => {
    for (const p of ['Anthropic', 'OpenAI', 'Railway', 'Cloudflare', 'Google', 'Stripe']) {
      expect(block).toMatch(new RegExp(p));
    }
  });

  test('72-hour breach-notification commitment', () => {
    expect(block).toMatch(/72 hours?/i);
    expect(block).toMatch(/personal data breach/i);
  });

  test('controller obligations include "tell your clients a digital tool is used"', () => {
    expect(block).toMatch(/inform your end clients that a digital tool is used/i);
  });

  test('the printed version label matches LEGAL_VERSIONS.dpa', () => {
    expect(block).toMatch(/Version \$\{LEGAL_VERSIONS\.dpa\}/);
  });
});

describe('TRQ-151 — landing footer now links DPA', () => {
  test('foot-links carries /privacy + /terms + /dpa', () => {
    // The single footer block in LANDING_PAGE_HTML.
    expect(serverJs).toMatch(
      /<div class="foot-links">[\s\S]{0,300}\/privacy[\s\S]{0,80}\/terms[\s\S]{0,80}\/dpa/
    );
  });
});

describe('TRQ-151 — inline upload-consent line in JobDetails', () => {
  test('line is present in the photo upload area', () => {
    expect(jobDetailsJsx).toMatch(/By uploading, you confirm you have permission/i);
  });

  test('uses plain text (no modal, no required click)', () => {
    // No "I agree" checkbox, no setState for a consent boolean.
    expect(jobDetailsJsx).not.toMatch(/setAccepted|hasAcceptedUpload|uploadConsentGiven/);
  });

  test('links out to /terms and /dpa (target=_blank, rel=noreferrer)', () => {
    // Anchor on the upload-consent test-id so we don't false-positive
    // against unrelated /terms links.
    const idx = jobDetailsJsx.indexOf('data-testid="upload-consent-line"');
    expect(idx).toBeGreaterThan(-1);
    const slice = jobDetailsJsx.slice(idx, idx + 1000);
    expect(slice).toMatch(/href="\/terms"[\s\S]{0,100}target="_blank"/);
    expect(slice).toMatch(/href="\/dpa"[\s\S]{0,100}target="_blank"/);
    expect(slice).toMatch(/rel="noreferrer"/);
  });

  test('test-id is present so a future end-to-end test can target it', () => {
    expect(jobDetailsJsx).toMatch(/data-testid="upload-consent-line"/);
  });
});
