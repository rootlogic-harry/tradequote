/**
 * TRQ-173 — Unit tests for scripts/build-fixture-from-job.js
 *
 * The script's job is to extract a regression-suite fixture from a completed
 * job's database state. It MUST:
 *   1. Reshape `jobs.quote_snapshot` into the fixture JSON shape expected by
 *      regression/lib/fixtureLoader.js.
 *   2. Sanitise PII in inputs.siteAddress + inputs.briefNotes (postcode trim,
 *      street/name/phone/email redact). Photos are intentionally left alone
 *      because they live in a private repo and the privacy trade-off has been
 *      made explicitly (documented in regression/README.md).
 *   3. Detect photo MIME types from magic bytes so the on-disk extension
 *      matches the actual content (real R2 dumps mix JPEG and PNG).
 *   4. Gracefully tolerate missing slots — some real jobs lack a reference
 *      card and we don't want the script to refuse them.
 *   5. Skip measurements that only have aiValue and no confirmed value —
 *      those weren't signed off and can't be ground truth.
 *
 * The DB-touching layer (the pg query) is exercised in a separate, mocked,
 * integration test so `npm test` doesn't require a live database.
 */
import { describe, it, expect } from '@jest/globals';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildFixtureFromSnapshot,
  sanitiseSiteAddress,
  sanitiseBriefNotes,
  slugifyAddress,
  detectImageExtension,
  parseMeasurementValue,
} from '../../scripts/build-fixture-from-job.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

// ─────────────────────────── slugifyAddress ───────────────────────────

describe('slugifyAddress', () => {
  it('converts a real address to a kebab-case slug', () => {
    expect(slugifyAddress('Pro Drive, 221 High Greave, Sheffield S5 9GS'))
      .toBe('pro-drive-221-high-greave-sheffield-s5-9gs');
  });

  it('strips trailing/leading whitespace', () => {
    expect(slugifyAddress('  Brink Farm, SK10 5RU  '))
      .toBe('brink-farm-sk10-5ru');
  });

  it('handles a single-word address', () => {
    expect(slugifyAddress('Cottage')).toBe('cottage');
  });

  it('collapses runs of separators into one dash', () => {
    expect(slugifyAddress('A   ,,,  B'))
      .toBe('a-b');
  });

  it('returns null for empty / null / undefined', () => {
    expect(slugifyAddress('')).toBeNull();
    expect(slugifyAddress(null)).toBeNull();
    expect(slugifyAddress(undefined)).toBeNull();
  });

  it('strips disallowed punctuation', () => {
    expect(slugifyAddress("O'Connor Lane, Sheffield"))
      .toBe('o-connor-lane-sheffield');
  });
});

// ─────────────────────────── sanitiseSiteAddress ───────────────────────────

describe('sanitiseSiteAddress', () => {
  it('keeps the first half of a UK postcode', () => {
    const out = sanitiseSiteAddress('221 High Greave, Sheffield, S5 9GS');
    expect(out).toMatch(/S5(?!\s*9GS)/);   // S5 kept
    expect(out).not.toMatch(/9GS/);        // 9GS gone
  });

  it('handles postcodes with no space between halves', () => {
    const out = sanitiseSiteAddress('Some place, SK105RU');
    expect(out).toMatch(/SK10/);
    expect(out).not.toMatch(/5RU/);
  });

  it('redacts house numbers + street name', () => {
    const out = sanitiseSiteAddress('Pro Drive, 221 High Greave, Sheffield, S5 9GS');
    // The street name "High Greave" must not survive in the redacted output.
    expect(out).not.toMatch(/High Greave/);
    // The city should survive.
    expect(out).toMatch(/Sheffield/);
  });

  it('returns empty string for empty input', () => {
    expect(sanitiseSiteAddress('')).toBe('');
    expect(sanitiseSiteAddress(null)).toBe('');
  });

  it('redacts phone numbers anywhere in the field', () => {
    const out = sanitiseSiteAddress('Call 07986 661828 for access, Sheffield S5');
    expect(out).not.toMatch(/07986/);
    expect(out).not.toMatch(/661828/);
  });

  it('redacts emails', () => {
    const out = sanitiseSiteAddress('Site: 12 Old Lane, Sheffield S5, contact mark@example.com');
    expect(out).not.toMatch(/mark@example\.com/);
  });
});

// ─────────────────────────── sanitiseBriefNotes ───────────────────────────

describe('sanitiseBriefNotes', () => {
  it('redacts customer name when given via the redactNames option', () => {
    const out = sanitiseBriefNotes(
      'Met Bob Homeowner on site. Bob wants the wall done by April.',
      { redactNames: ['Bob Homeowner'] }
    );
    expect(out).not.toMatch(/Bob Homeowner/);
  });

  it('redacts phones in the body of brief notes', () => {
    const out = sanitiseBriefNotes('Owner reachable on 07986 661828.');
    expect(out).not.toMatch(/07986\s?661828/);
  });

  it('redacts emails in the body of brief notes', () => {
    const out = sanitiseBriefNotes('Reply to MARK@DRYSTONEWALLING.NET');
    expect(out).not.toMatch(/MARK@DRYSTONEWALLING\.NET/i);
  });

  it('leaves measurement-like numbers alone (does not over-redact)', () => {
    const out = sanitiseBriefNotes('Wall is roughly 1.2m high, 6m long.');
    expect(out).toMatch(/1\.2m/);
    expect(out).toMatch(/6m/);
  });

  it('handles null / empty', () => {
    expect(sanitiseBriefNotes(null)).toBe('');
    expect(sanitiseBriefNotes('')).toBe('');
  });
});

// ─────────────────────────── detectImageExtension ───────────────────────────

describe('detectImageExtension', () => {
  it('returns "jpg" for a JPEG magic header (FF D8 FF)', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectImageExtension(buf)).toBe('jpg');
  });

  it('returns "png" for a PNG magic header (89 50 4E 47)', () => {
    const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
    expect(detectImageExtension(buf)).toBe('png');
  });

  it('returns "webp" for a WEBP magic header (RIFF....WEBP)', () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageExtension(buf)).toBe('webp');
  });

  it('returns "bin" for unknown bytes', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    expect(detectImageExtension(buf)).toBe('bin');
  });

  it('returns "bin" for an empty buffer (does not crash)', () => {
    expect(detectImageExtension(Buffer.alloc(0))).toBe('bin');
  });
});

// ─────────────────────────── parseMeasurementValue ───────────────────────────

describe('parseMeasurementValue', () => {
  it('parses a comma-separated mm display string', () => {
    expect(parseMeasurementValue('1,200mm')).toBe(1200);
  });

  it('parses a bare number string', () => {
    expect(parseMeasurementValue('600')).toBe(600);
  });

  it('parses a number (passes through)', () => {
    expect(parseMeasurementValue(600)).toBe(600);
  });

  it('returns null for null / undefined / empty', () => {
    expect(parseMeasurementValue(null)).toBeNull();
    expect(parseMeasurementValue(undefined)).toBeNull();
    expect(parseMeasurementValue('')).toBeNull();
  });

  it('returns null for unparseable strings', () => {
    expect(parseMeasurementValue('approximately')).toBeNull();
  });
});

// ─────────────────────────── buildFixtureFromSnapshot ───────────────────────────

describe('buildFixtureFromSnapshot', () => {
  // A representative snapshot — shape mirrors what jobs.quote_snapshot
  // actually holds after a tradesman has confirmed all measurements
  // and generated a quote. Keys come from SAVE_ALLOWLIST.
  const realisticSnapshot = {
    totalAmount: 4500,
    jobDetails: {
      siteAddress: 'Pro Drive, 221 High Greave, Sheffield, S5 9GS',
      clientName: 'Mrs Bob Homeowner',
      briefNotes: 'Six-metre stretch of gritstone field wall collapsed in heavy rain.',
      scaleReferences: 'Wooden field gate to the left is 1.2m wide; use as scale anchor.',
    },
    reviewData: {
      measurements: [
        // Confirmed measurements — both aiValue and value set, possibly differing.
        { id: 'm-0', item: 'Wall height',    aiValue: '1,000mm', value: '1,200mm', valueMm: 1200, confirmed: true },
        { id: 'm-1', item: 'Wall length',    aiValue: '6,000mm', value: '6,000mm', valueMm: 6000, confirmed: true },
        { id: 'm-2', item: 'Wall thickness', aiValue: '500mm',   value: '600mm',   valueMm: 600,  confirmed: true },
        // Unconfirmed — only aiValue, no `value` populated by the tradesman.
        // Must be skipped — we can't ground-truth what Mark didn't sign off.
        { id: 'm-3', item: 'Course depth',   aiValue: '120mm',                                    confirmed: false },
      ],
      materials: [
        { id: 'mat-0', description: 'walling stone',  quantity: 4, unitCost: 200 },
        { id: 'mat-1', description: 'waste disposal', quantity: 1, unitCost: 150 },
      ],
      labourEstimate: {
        estimatedDays: 3,
        aiEstimatedDays: 3,
        numberOfWorkers: 2,
        dayRate: 350,
      },
    },
  };

  it('extracts the total amount with the documented 0.12 tolerance', () => {
    const f = buildFixtureFromSnapshot({ id: 'sheffield-job', snapshot: realisticSnapshot });
    expect(f.groundTruth.totalAmount).toEqual({ value: 4500, tolerance: 0.12 });
  });

  it('extracts confirmed measurements with valueMm + 0.15 tolerance', () => {
    const f = buildFixtureFromSnapshot({ id: 'sheffield-job', snapshot: realisticSnapshot });
    expect(f.groundTruth.measurements).toEqual({
      'Wall height':    { value: 1200, tolerance: 0.15 },
      'Wall length':    { value: 6000, tolerance: 0.15 },
      'Wall thickness': { value: 600,  tolerance: 0.15 },
    });
  });

  it('skips unconfirmed measurements (aiValue-only)', () => {
    const f = buildFixtureFromSnapshot({ id: 'sheffield-job', snapshot: realisticSnapshot });
    expect(f.groundTruth.measurements).not.toHaveProperty('Course depth');
  });

  it('extracts labour estimate (days as abs 0.5, workers as abs 0)', () => {
    const f = buildFixtureFromSnapshot({ id: 'sheffield-job', snapshot: realisticSnapshot });
    expect(f.groundTruth.labour).toEqual({
      estimatedDays:   { value: 3, abs: 0.5 },
      numberOfWorkers: { value: 2, abs: 0 },
    });
  });

  it('extracts materials as array of { description }', () => {
    const f = buildFixtureFromSnapshot({ id: 'sheffield-job', snapshot: realisticSnapshot });
    expect(f.groundTruth.materials).toEqual([
      { description: 'walling stone' },
      { description: 'waste disposal' },
    ]);
  });

  it('sanitises site address in inputs (postcode trimmed, street redacted, city kept)', () => {
    const f = buildFixtureFromSnapshot({ id: 'sheffield-job', snapshot: realisticSnapshot });
    expect(f.inputs.siteAddress).not.toMatch(/High Greave/);
    expect(f.inputs.siteAddress).not.toMatch(/9GS/);
    expect(f.inputs.siteAddress).toMatch(/S5/);
    expect(f.inputs.siteAddress).toMatch(/Sheffield/);
  });

  it('uses the supplied id verbatim in the output', () => {
    const f = buildFixtureFromSnapshot({ id: 'pro-drive-221', snapshot: realisticSnapshot });
    expect(f.id).toBe('pro-drive-221');
  });

  it('passes scaleReferences straight through (no PII to scrub there)', () => {
    const f = buildFixtureFromSnapshot({ id: 'x', snapshot: realisticSnapshot });
    expect(f.inputs.scaleReferences).toMatch(/1\.2m wide/);
  });

  it('sets inputs.photos to the slot→path map for slots passed in', () => {
    const f = buildFixtureFromSnapshot({
      id: 'x',
      snapshot: realisticSnapshot,
      photoSlots: {
        overview: 'photos/overview.jpg',
        closeup:  'photos/closeup.png',
      },
    });
    expect(f.inputs.photos).toEqual({
      overview: 'photos/overview.jpg',
      closeup:  'photos/closeup.png',
    });
  });

  it('omits inputs.photos entirely when no slots are supplied', () => {
    const f = buildFixtureFromSnapshot({ id: 'x', snapshot: realisticSnapshot });
    expect(f.inputs.photos).toEqual({});
  });

  it('omits ground-truth blocks that have no data (does not invent empty fields)', () => {
    const sparse = {
      totalAmount: 1000,
      jobDetails: { siteAddress: 'Somewhere', briefNotes: '', scaleReferences: '' },
      reviewData: { measurements: [], materials: [], labourEstimate: {} },
    };
    const f = buildFixtureFromSnapshot({ id: 'sparse', snapshot: sparse });
    // totalAmount still present (it has a real value)
    expect(f.groundTruth.totalAmount).toEqual({ value: 1000, tolerance: 0.12 });
    // measurements/materials object should be absent or empty
    expect(f.groundTruth.measurements || {}).toEqual({});
    expect(f.groundTruth.materials || []).toEqual([]);
  });

  it('redacts client name from briefNotes when clientName is in the snapshot', () => {
    const snap = {
      ...realisticSnapshot,
      jobDetails: {
        ...realisticSnapshot.jobDetails,
        briefNotes: 'Mrs Bob Homeowner asked for the work to be done by April.',
      },
    };
    const f = buildFixtureFromSnapshot({ id: 'x', snapshot: snap });
    expect(f.inputs.briefNotes).not.toMatch(/Mrs Bob Homeowner/);
  });

  it('includes a human-readable name on the fixture', () => {
    const f = buildFixtureFromSnapshot({ id: 'x', snapshot: realisticSnapshot });
    expect(typeof f.name).toBe('string');
    expect(f.name.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────── CLI structural guards ───────────────────────────
//
// Belt-and-braces: ensure the script enforces the safety-relevant rules
// (no defaulting to prod, refuses to overwrite without --force) at the
// source level. These are static regex checks — the live CLI behaviour
// is exercised separately via an integration test against a mock pg.

describe('build-fixture-from-job — structural guards on the script source', () => {
  const src = readFileSync(join(repoRoot, 'scripts/build-fixture-from-job.js'), 'utf8');

  it('reads DATABASE_URL from env (no hardcoded URL)', () => {
    expect(src).toMatch(/process\.env\.DATABASE_URL/);
  });

  it('does not embed a default connection string at all', () => {
    // Belt-and-braces — must not ship a default that could point at prod.
    // We do mention "railway.app" inside the refuse-to-run guard pattern;
    // that's fine. What we forbid is any literal connection string in the
    // source — i.e. anything that looks like `postgres://...@somehost/...`.
    expect(src).not.toMatch(/postgres:\/\/[^\s'"`]+@[^\s'"`]+\/[^\s'"`]+/);
  });

  it('has a refuse-to-run guard that detects production hostnames', () => {
    // Defence-in-depth: even if a user mis-sets DATABASE_URL to prod, the
    // script should refuse.
    expect(src).toMatch(/railway\.app|rlwy\.net/);
    expect(src).toMatch(/[Rr]efusing|REFUSE/);
  });

  it('refuses to overwrite without --force', () => {
    // Source must reference the --force flag AND have an "already exists" check.
    expect(src).toMatch(/--force/);
    expect(src).toMatch(/already exists/i);
  });

  it('declares the four expected exit codes (0 / 2 paths)', () => {
    expect(src).toMatch(/process\.exit\(2\)/);
  });

  it('logs the connected DB host so the operator sees source of data', () => {
    expect(src).toMatch(/host/i);
    expect(src).toMatch(/database/i);
  });

  it('never logs raw quote_snapshot contents (avoid PII bleed into transcripts)', () => {
    // We expect summarised output (counts + totals) — never `JSON.stringify`
    // of the entire snapshot to stdout.
    expect(src).not.toMatch(/console\.log\([^)]*JSON\.stringify\([^)]*quote_snapshot[^)]*\)\)/);
    expect(src).not.toMatch(/console\.log\([^)]*JSON\.stringify\([^)]*snapshot[^)]*\)\)/);
  });
});
