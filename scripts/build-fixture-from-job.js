#!/usr/bin/env node
/**
 * TRQ-173 — Extract a regression-suite fixture from one completed job.
 *
 * Why this exists
 * ───────────────
 * Mark's COMPLETED jobs in production ARE the ground truth — `jobs.quote_snapshot`
 * holds the measurements/labour/materials the tradesman settled on after
 * editing the AI's draft. Rather than hand-build fixtures, we extract them
 * straight from the DB. Adding a fixture becomes ~30 seconds per job:
 * restore an R2 backup locally, run this script with a job id.
 *
 * What it does NOT do
 * ───────────────────
 * - Does NOT default to production. Defaults to whatever DATABASE_URL points
 *   at, which is expected to be a local restored backup (see docs/RESTORE.md).
 *   The startup log prints `host` + `database` so the operator sees where
 *   the data is coming from BEFORE any output is written.
 * - Does NOT log raw `quote_snapshot` contents or photo bytes. Stdout is a
 *   short summary; anything PII-shaped is sanitised before being written
 *   to the fixture JSON.
 * - Does NOT overwrite an existing fixture without `--force`.
 *
 * Privacy posture
 * ───────────────
 * The fixture JSON gets PII redacted (postcode trimmed, street/name/phone/email
 * sweep). Photos are committed AS-IS to the private regression/fixtures
 * directory — they're real customer property. Trade-off explicitly chosen:
 * the suite is useless without representative imagery, and the photos
 * already live in a private repo. See regression/README.md.
 *
 * Usage
 * ─────
 *   node scripts/build-fixture-from-job.js <job_id>
 *     [--output regression/fixtures]
 *     [--id <fixture-id>]
 *     [--force]
 *
 * Env:
 *   DATABASE_URL — required, points at the restored local DB.
 *
 * Exit codes:
 *   0 — fixture written successfully
 *   2 — config error, job not found, empty snapshot, or fixture already exists
 *       (without --force)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// pg is imported dynamically so unit-tests that only exercise the pure
// helpers (sanitisation, slugify, mime detection, snapshot shaping) don't
// pay the cost of loading pg + creating a connection at import time.

// ────────────────────────── pure helpers ──────────────────────────

/**
 * Magic-byte → file extension. Covers the three formats the user_photos
 * column actually contains in production (JPEG is by far the most common
 * — phone cameras default to it — but the iOS share-sheet sometimes emits
 * PNG or WEBP).
 *
 * Returns 'bin' for unknown headers so the caller still writes the file
 * (operator can inspect it and rename) but the extension makes it clear
 * something is off.
 */
export function detectImageExtension(buf) {
  if (!buf || buf.length < 4) return 'bin';
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png';
  // WEBP: RIFF....WEBP — bytes 0-3 = "RIFF", bytes 8-11 = "WEBP"
  if (
    buf.length >= 12 &&
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) return 'webp';
  // HEIC: ftypheic / ftypheix etc. at offset 4
  if (
    buf.length >= 12 &&
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70 &&
    buf[8] === 0x68 && buf[9] === 0x65 && buf[10] === 0x69 && buf[11] === 0x63
  ) return 'heic';
  return 'bin';
}

/**
 * Convert a site address to a kebab-case fixture id. Used when the operator
 * doesn't pass `--id`. Falls back to the job UUID if the address is empty.
 *
 * "Pro Drive, 221 High Greave, Sheffield S5 9GS"
 *   → "pro-drive-221-high-greave-sheffield-s5-9gs"
 *
 * Returns null for empty/null input so the caller can decide on a UUID fallback.
 */
export function slugifyAddress(address) {
  if (!address || typeof address !== 'string') return null;
  const trimmed = address.trim();
  if (!trimmed) return null;
  const slug = trimmed
    .toLowerCase()
    // Drop apostrophes outright (so "O'Connor" → "oconnor" wouldn't read right;
    // we replace them with a separator instead so it becomes "o-connor").
    .replace(/[’'`]/g, ' ')
    // Replace any run of non-alphanumeric chars with a single dash.
    .replace(/[^a-z0-9]+/g, '-')
    // Trim leading/trailing dashes.
    .replace(/^-+|-+$/g, '');
  return slug || null;
}

/**
 * Trim a UK postcode to its outward code (first half). The outward code is
 * regional context (Sheffield, Manchester, London-NW) and is useful for the
 * comparator + reproducibility, but the inward code is enough to geolocate
 * a single property. Trim it.
 *
 * Accepts both spaced ("S5 9GS") and unspaced ("S59GS"/"SK105RU") forms.
 */
function trimPostcode(text) {
  // Outward code: 1-2 letters + 1-2 digits (+ optional letter).
  // Inward code: 1 digit + 2 letters.
  return text.replace(
    /\b([A-Z]{1,2}[0-9][0-9A-Z]?)\s?[0-9][A-Z]{2}\b/gi,
    (_, outward) => outward.toUpperCase()
  );
}

/**
 * Strip phone/email patterns from any free-text field. Mirrors the patterns
 * used by scripts/sanitise-prod-dump.js so the redaction surface is consistent.
 * The lookarounds are important — without them the phone regex bites into
 * long float values (e.g. `-0.8076923076923077`) and breaks the surrounding
 * text. See pitfall in sanitise-prod-dump.js.
 */
function stripContactPatterns(text) {
  return text
    .replace(/(?<!\w)[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?!\w)/g, '[redacted-email]')
    .replace(/(?<!\d)(?:\+44\s?|0)7\d{3}\s?\d{6}(?!\d)/g, '[redacted-phone]');
}

/**
 * Sanitise a siteAddress field for inclusion in a regression fixture.
 *
 * Steps:
 *   1. Trim UK postcode to its outward half (keeps "S5", drops "9GS").
 *   2. Redact a "<number> <Street Name>" segment — keep the number, redact
 *      the words after it up to the next comma. This loses the specific
 *      street name (which is the address-pinning detail) while preserving
 *      "221 [redacted-street], Sheffield" enough to make the fixture
 *      identifiable to the operator.
 *   3. Sweep emails + phones in case the address field contains them.
 */
export function sanitiseSiteAddress(address) {
  if (!address || typeof address !== 'string') return '';
  let out = trimPostcode(address);
  // Match a sequence of: a number, optional comma/space, then capitalised
  // street name words up to the next comma. The (?<=(?:^|[\s,]))NUMBER
  // boundary stops us redacting the inward postcode digits we just trimmed.
  out = out.replace(
    /(\d+)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/g,
    '$1 [redacted-street]'
  );
  out = stripContactPatterns(out);
  return out.replace(/\s{2,}/g, ' ').trim();
}

/**
 * Sanitise the briefNotes field for a fixture. Strips:
 *   - Customer names supplied via `redactNames` (caller pulls these from
 *     `quote_snapshot.jobDetails.clientName`).
 *   - Email + phone patterns.
 *
 * Does NOT touch measurement-like numbers ("Wall is 1.2m high") — those
 * are exactly the signal the regression suite wants to preserve.
 */
export function sanitiseBriefNotes(notes, { redactNames = [] } = {}) {
  if (!notes || typeof notes !== 'string') return '';
  let out = notes;
  for (const name of redactNames) {
    if (!name) continue;
    // Escape regex metachars in the name.
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(safe, 'gi'), '[redacted-name]');
  }
  out = stripContactPatterns(out);
  return out;
}

/**
 * Parse a measurement display string ("1,200mm", "600", 600) to a mm number.
 * Returns null when the input doesn't contain anything parseable. The
 * comparator wants `valueMm` as a flat number, so this is the bridge from
 * the snapshot's display-string convention to the comparator's contract.
 */
export function parseMeasurementValue(v) {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v !== 'string') return null;
  const cleaned = v.replace(/[,\s]/g, '').replace(/mm$/i, '');
  if (!cleaned) return null;
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ────────────────────────── snapshot → fixture ──────────────────────────

/**
 * Build the fixture JSON object from a job's quote_snapshot.
 *
 * Inputs:
 *   id — kebab-case fixture id (also becomes the directory name for photos)
 *   snapshot — the `jobs.quote_snapshot` JSONB blob
 *   photoSlots — optional { slot: relativePathInFixtureDir, ... } map
 *
 * Output: a fixture object matching the schema in regression/lib/fixtureLoader.js.
 *
 * Tolerances mirror the conventions in regression/fixtures/sample.json:
 *   - totalAmount: ±12%
 *   - measurements: ±15%
 *   - labour days: ±0.5 days absolute
 *   - labour workers: exact (abs 0)
 *
 * Materials are emitted as `{ description }`. The operator can mark some
 * as `forbidden: true` by hand after generation — we don't try to infer that.
 */
export function buildFixtureFromSnapshot({ id, snapshot, photoSlots = {} }) {
  if (!id) throw new Error('buildFixtureFromSnapshot: id is required');
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('buildFixtureFromSnapshot: snapshot is required');
  }

  const jobDetails = snapshot.jobDetails || {};
  const reviewData = snapshot.reviewData || {};
  const clientName = jobDetails.clientName ? String(jobDetails.clientName) : '';

  // Measurements — confirmed only, mapped to { value: <mm>, tolerance: 0.15 }.
  const measurements = {};
  for (const m of reviewData.measurements || []) {
    if (!m || !m.item) continue;
    // Skip unconfirmed: the tradesman hasn't signed off, so we can't
    // ground-truth what they didn't agree to.
    // A measurement counts as confirmed if either:
    //   - confirmed === true, or
    //   - it has a `value` distinct from / equal to aiValue (i.e. populated)
    //     AND a valueMm we can use.
    // Be permissive: prefer the explicit `confirmed` flag but accept rows
    // that look like they were touched (have a non-null `value`).
    const hasConfirmed = m.confirmed === true || (m.value != null && m.value !== '');
    if (!hasConfirmed) continue;
    // Prefer valueMm (already numeric mm); fall back to parsing `value`.
    const mm = typeof m.valueMm === 'number'
      ? m.valueMm
      : parseMeasurementValue(m.value);
    if (mm == null) continue;
    measurements[m.item] = { value: mm, tolerance: 0.15 };
  }

  // Materials — flat list of { description }.
  const materials = (reviewData.materials || [])
    .filter((m) => m && m.description)
    .map((m) => ({ description: String(m.description) }));

  // Labour — keep days + workers when present.
  const labour = {};
  const le = reviewData.labourEstimate || {};
  if (typeof le.estimatedDays === 'number') {
    labour.estimatedDays = { value: le.estimatedDays, abs: 0.5 };
  }
  if (typeof le.numberOfWorkers === 'number') {
    labour.numberOfWorkers = { value: le.numberOfWorkers, abs: 0 };
  }

  // Total amount — keep when present.
  const groundTruth = {};
  if (typeof snapshot.totalAmount === 'number' && snapshot.totalAmount > 0) {
    groundTruth.totalAmount = { value: snapshot.totalAmount, tolerance: 0.12 };
  }
  if (Object.keys(measurements).length > 0) groundTruth.measurements = measurements;
  if (Object.keys(labour).length > 0) groundTruth.labour = labour;
  if (materials.length > 0) groundTruth.materials = materials;

  return {
    id,
    name: `Extracted from job ${id}`,
    description:
      'Auto-generated by scripts/build-fixture-from-job.js. ' +
      'Review groundTruth + add `forbidden: true` to any materials that ' +
      'should NOT appear in a fresh analysis before relying on this fixture.',
    inputs: {
      siteAddress: sanitiseSiteAddress(jobDetails.siteAddress),
      briefNotes: sanitiseBriefNotes(jobDetails.briefNotes, {
        redactNames: clientName ? [clientName] : [],
      }),
      scaleReferences: jobDetails.scaleReferences || '',
      photos: { ...photoSlots },
    },
    groundTruth,
  };
}

// ────────────────────────── DB-touching layer ──────────────────────────

/**
 * Pull the job row + all photo rows for one (job_id) from the database.
 *
 * `client` is anything with a `.query(sql, params)` async method — the
 * production caller passes a pg `Client`; the unit-test caller passes a
 * Jest mock. We don't import pg here — that's the CLI's job.
 *
 * Returns { job, photos } or null when the job is not found / has no
 * quote_snapshot. Throws on malformed photo base64 (with the slot name
 * so the operator knows which row to investigate).
 *
 * Photos are keyed in `user_photos` by (user_id, context, slot) — for a
 * saved job, `context = jobId`. See server.js:2745 (`POST /photos/copy`)
 * for how the draft→jobId rename happens at quote save time.
 */
export async function extractJobAndPhotos(client, jobId) {
  const jobRes = await client.query(
    `SELECT id, user_id, site_address, client_name, status, quote_snapshot
       FROM jobs
      WHERE id = $1`,
    [jobId]
  );
  if (jobRes.rows.length === 0) return null;
  const job = jobRes.rows[0];
  if (!job.quote_snapshot || typeof job.quote_snapshot !== 'object') {
    return null;
  }

  const photosRes = await client.query(
    `SELECT slot, data FROM user_photos WHERE user_id = $1 AND context = $2`,
    [job.user_id, jobId]
  );

  const photos = {};
  for (const row of photosRes.rows) {
    const slot = row.slot;
    // Only the canonical slot names — skip 'extra-N' photos which aren't
    // part of the regression fixture's photo shape.
    if (!['overview', 'closeup', 'sideProfile', 'referenceCard', 'access'].includes(slot)) {
      continue;
    }
    // Decode base64. The data column may be a data: URL or raw base64.
    let raw = row.data || '';
    const m = raw.match(/^data:[^;]+;base64,(.+)$/);
    if (m) raw = m[1];
    // Strict pre-check: Buffer.from(..., 'base64') silently drops disallowed
    // chars rather than throwing. That means "!!! garbage !!!" decodes to a
    // small junk buffer rather than raising. Validate that the input contains
    // ONLY base64 chars (A-Z, a-z, 0-9, +, /, =) plus whitespace before
    // decoding, so a corrupted row raises with the slot name.
    const trimmed = raw.replace(/\s+/g, '');
    if (!trimmed || !/^[A-Za-z0-9+/]+=*$/.test(trimmed)) {
      throw new Error(`Photo decode failed for slot "${slot}": data is not valid base64`);
    }
    let buf;
    try {
      buf = Buffer.from(trimmed, 'base64');
      if (buf.length === 0) {
        throw new Error('decoded buffer is empty');
      }
    } catch (err) {
      throw new Error(`Photo decode failed for slot "${slot}": ${err.message}`);
    }
    const extension = detectImageExtension(buf);
    photos[slot] = { bytes: buf, extension };
  }

  return { job, photos };
}

// ────────────────────────── CLI ──────────────────────────

function parseArgs(argv) {
  const out = { jobId: null, output: 'regression/fixtures', id: null, force: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--id') out.id = argv[++i];
    else if (a === '--force') out.force = true;
    else if (!out.jobId && !a.startsWith('--')) out.jobId = a;
  }
  return out;
}

function printHelpAndExit(code = 0) {
  process.stdout.write(
    'Usage: node scripts/build-fixture-from-job.js <job_id> [--output <dir>] [--id <fixture-id>] [--force]\n' +
    '\n' +
    'Extract a regression-suite fixture from one completed job.\n' +
    '\n' +
    'Reads DATABASE_URL from env. Run against a locally-restored R2 backup\n' +
    '(see docs/RESTORE.md) — never against production. The startup log prints\n' +
    'the connected host/database so you can verify before any output is written.\n'
  );
  process.exit(code);
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.jobId) {
    printHelpAndExit(args.help ? 0 : 2);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write('build-fixture-from-job: DATABASE_URL env var is required.\n');
    process.exit(2);
  }

  // Lazy import: keeps the unit tests independent of pg.
  const pg = await import('pg');
  // Parse URL purely for the startup log — DON'T print credentials.
  let dbHost = 'unknown', dbName = 'unknown';
  try {
    const url = new URL(process.env.DATABASE_URL);
    dbHost = url.hostname;
    dbName = url.pathname.replace(/^\//, '') || 'postgres';
  } catch {
    // ignore — the connect call below will surface a useful error
  }
  process.stderr.write(
    `build-fixture-from-job: connecting to host=${dbHost} database=${dbName}\n`
  );
  // Refuse-to-run guard: if the URL looks like production (railway.app
  // hostnames), bail out. The constitution forbids defaulting to prod and
  // this is a belt-and-braces second check.
  if (/railway\.app|rlwy\.net/.test(dbHost)) {
    process.stderr.write(
      'build-fixture-from-job: DATABASE_URL host looks like production. Refusing to run.\n'
    );
    process.exit(2);
  }

  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  let extracted;
  try {
    extracted = await extractJobAndPhotos(client, args.jobId);
  } finally {
    await client.end();
  }

  if (!extracted) {
    process.stderr.write(
      `build-fixture-from-job: job "${args.jobId}" not found, or quote_snapshot is empty.\n`
    );
    process.exit(2);
  }

  const { job, photos } = extracted;
  const fixtureId =
    args.id ||
    slugifyAddress(job.site_address) ||
    args.jobId.toLowerCase();

  const outputRoot = resolve(args.output);
  const fixtureJsonPath = join(outputRoot, `${fixtureId}.json`);
  const photosDir = join(outputRoot, fixtureId, 'photos');

  if (existsSync(fixtureJsonPath) && !args.force) {
    process.stderr.write(
      `build-fixture-from-job: fixture "${fixtureJsonPath}" already exists. Pass --force to overwrite.\n`
    );
    process.exit(2);
  }

  // Write photos first so we know the on-disk paths to embed in the JSON.
  mkdirSync(photosDir, { recursive: true });
  const photoSlots = {};
  const photoSummary = [];
  for (const [slot, { bytes, extension }] of Object.entries(photos)) {
    const filename = `${slot}.${extension}`;
    const absPath = join(photosDir, filename);
    writeFileSync(absPath, bytes);
    photoSlots[slot] = `${fixtureId}/photos/${filename}`;
    photoSummary.push(`  - ${slot.padEnd(14)} ${(bytes.length / 1024).toFixed(1).padStart(7)} KB  ${filename}`);
  }

  // Warn about missing slots — some real jobs lack a referenceCard. Don't
  // fail; the operator can still use the fixture.
  const expected = ['overview', 'closeup', 'sideProfile', 'referenceCard', 'access'];
  const missingSlots = expected.filter((s) => !photos[s]);
  if (missingSlots.length > 0) {
    process.stderr.write(
      `build-fixture-from-job: warning — missing photo slots: ${missingSlots.join(', ')}\n`
    );
  }

  const fixture = buildFixtureFromSnapshot({
    id: fixtureId,
    snapshot: job.quote_snapshot,
    photoSlots,
  });

  // Pretty-print with 2-space indent — matches the existing sample.json.
  writeFileSync(fixtureJsonPath, JSON.stringify(fixture, null, 2) + '\n');

  // Summary table. Deliberately summarised (counts + totals) — we do NOT
  // print the snapshot or photo bytes to stdout to avoid leaking PII into
  // agent transcripts.
  const measurementCount = Object.keys(fixture.groundTruth.measurements || {}).length;
  const materialCount = (fixture.groundTruth.materials || []).length;
  const total = fixture.groundTruth.totalAmount?.value ?? '(none)';
  const days = fixture.groundTruth.labour?.estimatedDays?.value ?? '(none)';
  const workers = fixture.groundTruth.labour?.numberOfWorkers?.value ?? '(none)';

  process.stdout.write(
    `\nFixture written: ${fixtureJsonPath}\n` +
    `  id              ${fixtureId}\n` +
    `  measurements    ${measurementCount}\n` +
    `  materials       ${materialCount}\n` +
    `  totalAmount     £${total}\n` +
    `  estimatedDays   ${days}\n` +
    `  numberOfWorkers ${workers}\n` +
    `  photos          ${Object.keys(photos).length} / ${expected.length}\n` +
    (photoSummary.length > 0 ? photoSummary.join('\n') + '\n' : '') +
    `  source job_id   ${args.jobId}\n` +
    `\nReview the fixture, mark any forbidden materials, then commit.\n`
  );
}

// Only run the CLI when invoked directly. When imported from tests,
// `main` does not auto-fire.
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(__filename)) {
  main().catch((err) => {
    process.stderr.write(`build-fixture-from-job: ${err.message}\n`);
    process.exit(2);
  });
}
