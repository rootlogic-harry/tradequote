/**
 * TRQ-149 — guards for the EU-migration runbook + dry-run script.
 *
 * The runbook is what makes the migration safe to attempt
 * autonomously up to (but not including) the irreversible step.
 * Tests assert the contract that protects that boundary:
 *   - Path B (dump+restore) is the recommended path.
 *   - The irreversible step is clearly marked as Harry-only.
 *   - The dry-run script never touches production.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const runbook = readFileSync(join(repoRoot, 'docs/EU-MIGRATION.md'), 'utf8');
const dryrun = readFileSync(join(repoRoot, 'scripts/eu-migration-dryrun.js'), 'utf8');

describe('TRQ-149 — EU migration runbook contract', () => {
  test('runbook exists at docs/EU-MIGRATION.md', () => {
    expect(existsSync(join(repoRoot, 'docs/EU-MIGRATION.md'))).toBe(true);
  });

  test('declares the two paths and recommends Path B (dump+restore)', () => {
    expect(runbook).toMatch(/Path A — Region dropdown/);
    expect(runbook).toMatch(/Path B — Dump \+ restore/);
    expect(runbook).toMatch(/Recommended path: B/);
  });

  test('names europe-west4 (Amsterdam) as the target region', () => {
    expect(runbook).toMatch(/europe-west4/);
    expect(runbook).toMatch(/Amsterdam/);
  });

  test('flags the irreversible step (DATABASE_URL repointing) as Harry-only', () => {
    // The step header MUST contain the warning emoji + IRREVERSIBLE so
    // it's hard to miss when skimming.
    expect(runbook).toMatch(/⚠️ IRREVERSIBLE/);
    // And explicitly call out that it's Harry's job.
    expect(runbook).toMatch(/the irreversible cutover/i);
    expect(runbook).toMatch(/Harry executes/i);
  });

  test('repoints DATABASE_URL on BOTH services (tradequote + backup)', () => {
    // A common failure mode in past prod cutovers is forgetting the
    // backup service still points at the old DB → silent backup-from-
    // wrong-source for days. This sentence is the structural guard.
    expect(runbook).toMatch(/fastquote-backup-service/);
    expect(runbook).toMatch(/tradequote.*service.*Variables.*DATABASE_URL/i);
  });

  test('rollback procedure exists and has two windows (before / after step 5)', () => {
    expect(runbook).toMatch(/Rollback/i);
    expect(runbook).toMatch(/Before step 5/);
    expect(runbook).toMatch(/After step 5/);
  });

  test('keeps the old US DB for 7 days post-cutover as rollback target', () => {
    expect(runbook).toMatch(/Keep the US DB for 7 days/i);
  });

  test('pre-cutover checklist includes a fresh restore-test drill', () => {
    expect(runbook).toMatch(/restore-test/i);
    expect(runbook).toMatch(/node scripts\/restore-test\.js --no-docker/);
  });

  test('references the related docs (BACKUP / RESTORE / ROLLBACK)', () => {
    expect(runbook).toMatch(/docs\/BACKUP\.md/);
    expect(runbook).toMatch(/docs\/RESTORE\.md/);
    expect(runbook).toMatch(/docs\/ROLLBACK\.md/);
  });

  test('reports the verified current state (us-west2, Hobby plan, PG 18)', () => {
    // The runbook captures what we observed via Railway GraphQL on
    // the day it was written. If prod state changes meaningfully
    // before cutover, this is a tripwire to re-verify.
    expect(runbook).toMatch(/us-west2/);
    expect(runbook).toMatch(/Hobby/);
    expect(runbook).toMatch(/Postgres 18|postgres-ssl:18/i);
  });
});

describe('TRQ-149 — dry-run script contract', () => {
  test('exists at scripts/eu-migration-dryrun.js', () => {
    expect(existsSync(join(repoRoot, 'scripts/eu-migration-dryrun.js'))).toBe(true);
  });

  test('delegates to scripts/restore-test.js (reuses verified machinery)', () => {
    expect(dryrun).toMatch(/restore-test\.js/);
    expect(dryrun).toMatch(/spawn/);
  });

  test('explicitly states it does NOT touch production', () => {
    // Tone matters in scripts like this — anyone reading the source
    // should understand the safety story in the first 40 lines.
    const head = dryrun.split('\n').slice(0, 60).join('\n');
    expect(head).toMatch(/does NOT touch production/);
    expect(head).toMatch(/Harry-only/);
  });

  test('on success prints "EU-migration dry-run passed"', () => {
    expect(dryrun).toMatch(/EU-migration dry-run passed/);
  });

  test('on failure prints "Do not attempt cutover"', () => {
    expect(dryrun).toMatch(/Do not attempt cutover/);
  });
});
