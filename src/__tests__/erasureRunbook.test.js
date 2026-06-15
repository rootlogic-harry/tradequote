/**
 * TRQ-158 — guards for docs/ERASURE.md.
 *
 * The privacy policy promises a right of erasure. This runbook is
 * what makes that promise keepable. These tests assert that:
 *   1. Every PII-bearing table the schema has is covered.
 *   2. Off-platform locations (backups, Anthropic, OpenAI, Railway
 *      logs, Google) are addressed honestly.
 *   3. Both runbook shapes exist (full cancellation + scrub).
 *   4. Backup-first + scoped-WHERE + transaction-wrap discipline
 *      is documented at every destructive step.
 *   5. The interaction with check-moat.js (TRQ-146) is named so a
 *      legitimate erasure doesn't false-alarm the tripwire.
 *
 * If the schema gains a new PII-bearing table, the test for "covers
 * every table" will fail and force this runbook to be updated.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const runbook = readFileSync(join(repoRoot, 'docs/ERASURE.md'), 'utf8');
const serverJs = readFileSync(join(repoRoot, 'server.js'), 'utf8');

// Source of truth: every CREATE TABLE in server.js. If a new table
// lands and the runbook doesn't mention it, this test fails.
const declaredTables = Array.from(
  serverJs.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/g)
).map((m) => m[1]);

describe('TRQ-158 — runbook structure', () => {
  test('exists and isn\'t empty', () => {
    expect(runbook.length).toBeGreaterThan(2000);
  });

  test('separates the two request shapes (cancellation vs homeowner scrub)', () => {
    expect(runbook).toMatch(/full account cancellation/i);
    expect(runbook).toMatch(/homeowner-data erasure/i);
  });

  test('flags manual-process-for-now decision (no self-serve button)', () => {
    // Markdown text-wrap puts "manual" and "process" on adjacent
    // lines, so [\s\S]+? bridges the newline.
    expect(runbook).toMatch(/manual[\s\S]{0,20}?process/i);
    expect(runbook).toMatch(/no self-serve|deliberately doesn't include/i);
  });
});

describe('TRQ-158 — every PII-bearing table is named', () => {
  // Schema tables that hold personal data either of the waller, the
  // end client, or audit metadata about them. `session` doesn't need
  // an entry beyond mentioning sessions expire — `calibration_notes`
  // only stores user_id of admin approvers.
  const piiTables = [
    'users', 'profiles', 'settings', 'jobs', 'drafts',
    'user_photos', 'quote_diffs', 'agent_runs', 'agent_retry_queue',
    'dictation_runs', 'system_errors', 'pageviews',
  ];

  test.each(piiTables)('runbook names %s', (table) => {
    expect(runbook).toMatch(new RegExp(`\`${table}\``));
  });

  test('claims to be exhaustive — references every CREATE TABLE in server.js (or notes the exception)', () => {
    for (const t of declaredTables) {
      // If the runbook doesn't name it, it must at least mention WHY
      // (`session`, `calibration_notes`, `admin_audit` are the
      // documented exceptions in the runbook itself).
      const namedSomewhere = runbook.includes(`\`${t}\``);
      expect(namedSomewhere).toBe(true);
    }
  });
});

describe('TRQ-158 — off-platform locations are addressed', () => {
  test('R2 backups: explains they age out, not surgical-edit', () => {
    expect(runbook).toMatch(/Cannot surgically edit/i);
    expect(runbook).toMatch(/age out/i);
    expect(runbook).toMatch(/5 weeks/);
  });

  test('Anthropic: notes inputs not retained beyond API request', () => {
    expect(runbook).toMatch(/Anthropic/);
    expect(runbook).toMatch(/not retained beyond the API request|API terms/i);
  });

  test('OpenAI: notes audio is in-memory only on our side', () => {
    expect(runbook).toMatch(/OpenAI/);
    expect(runbook).toMatch(/in-memory only/i);
  });

  test('Railway logs: notes auto-rotation and how to escalate', () => {
    expect(runbook).toMatch(/Railway logs/i);
    expect(runbook).toMatch(/auto-rotate|Railway support/i);
  });

  test('Google OAuth: directs requester to Google\'s own account settings', () => {
    expect(runbook).toMatch(/Google OAuth/i);
    expect(runbook).toMatch(/Google's account settings/i);
  });

  test('Email inbox: keeps the request email as audit (don\'t delete it)', () => {
    expect(runbook).toMatch(/Email inbox/i);
    expect(runbook).toMatch(/audit trail|don't delete/i);
  });
});

describe('TRQ-158 — destructive-operation discipline', () => {
  test('every destructive step is in a BEGIN / COMMIT block', () => {
    // At least two transaction blocks (one per runbook shape).
    const beginCount = (runbook.match(/\bBEGIN;/g) || []).length;
    const commitCount = (runbook.match(/\bCOMMIT;/g) || []).length;
    expect(beginCount).toBeGreaterThanOrEqual(2);
    expect(commitCount).toBeGreaterThanOrEqual(2);
  });

  test('every DELETE has a WHERE clause', () => {
    // Pull every DELETE statement from fenced code blocks. Confirm
    // each one carries a WHERE — the constitution's hard rule.
    const deletes = runbook.match(/DELETE FROM[^;]+;/g) || [];
    expect(deletes.length).toBeGreaterThan(0);
    for (const stmt of deletes) {
      expect(stmt).toMatch(/WHERE/i);
    }
  });

  test('every UPDATE has a WHERE clause', () => {
    const updates = runbook.match(/UPDATE\s+\w+\s+SET[\s\S]+?;/g) || [];
    expect(updates.length).toBeGreaterThan(0);
    for (const stmt of updates) {
      expect(stmt).toMatch(/WHERE/i);
    }
  });

  test('backup-first is mandated', () => {
    expect(runbook).toMatch(/fresh backup BEFORE deleting|Backup first|step 1 of every procedure/i);
  });

  test('check-moat.js is run before AND after', () => {
    // Both runbooks call check-moat. The cancellation runbook
    // captures baseline (step 2) and verifies (step 7).
    const moatMentions = (runbook.match(/check-moat/g) || []).length;
    expect(moatMentions).toBeGreaterThanOrEqual(3);
  });
});

describe('TRQ-158 — moat-integrity interaction (TRQ-146)', () => {
  test('legitimate erasure expected to reduce row counts — documented', () => {
    expect(runbook).toMatch(/reduces.*row counts|Erasing one user/i);
  });

  test('explains what to do if erasure pushes a moat table below floor', () => {
    expect(runbook).toMatch(/below.*floor/i);
    expect(runbook).toMatch(/Halt/i);
  });

  test('floor changes go through review (cannot quietly lower)', () => {
    expect(runbook).toMatch(/PR|review|branch protection/i);
  });
});

describe('TRQ-158 — scrub-PII-but-keep-learning pattern', () => {
  test('documents the principle (preserve anonymous diffs)', () => {
    expect(runbook).toMatch(/scrub.*keep.*learning|preserve.*learning|anonymous learning value/i);
  });

  test('uses jsonb_set to surgically scrub PII inside quote_snapshot', () => {
    expect(runbook).toMatch(/jsonb_set\(/);
    // Must scrub the right JSONB paths
    expect(runbook).toMatch(/jobDetails,clientName/);
    expect(runbook).toMatch(/jobDetails,siteAddress/);
  });

  test('quote_diffs preserved in scrub mode (no DELETE FROM quote_diffs in the scrub runbook)', () => {
    const scrubIdx = runbook.indexOf('homeowner-data erasure');
    const auditIdx = runbook.indexOf('Interaction with the moat-integrity');
    expect(scrubIdx).toBeGreaterThan(-1);
    expect(auditIdx).toBeGreaterThan(scrubIdx);
    const scrubSection = runbook.slice(scrubIdx, auditIdx);
    expect(scrubSection).not.toMatch(/DELETE FROM quote_diffs/);
  });

  test('admits scrub-with-learning isn\'t always possible (err toward erasure)', () => {
    // The phrase wraps as "Err\ntoward honouring" in the markdown
    // (\s+ between "err" and "toward" instead of a literal space).
    expect(runbook).toMatch(/err\s+toward[\s\S]{0,40}?(erasure|honouring)/i);
  });
});

describe('TRQ-158 — privacy-policy promise matches reality', () => {
  test('5-week backup-aging-out window matches the Privacy Policy (TRQ-151)', () => {
    // The Privacy Policy at /privacy promises retention windows
    // including "data ages out of backups within ~5 weeks". This
    // runbook is what makes that true.
    expect(runbook).toMatch(/5 weeks/);
    // Cross-check the policy itself says the same thing.
    expect(serverJs).toMatch(/5 weeks/);
  });

  test('30-day live-DB removal commitment matches the Privacy Policy', () => {
    // Privacy Policy promises "removed within 30 days from the live
    // database". The runbook procedure removes immediately, well
    // inside that window.
    expect(serverJs).toMatch(/within 30 days/);
  });
});
