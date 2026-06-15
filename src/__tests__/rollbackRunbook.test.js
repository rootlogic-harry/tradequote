/**
 * TRQ-154 — guards for docs/ROLLBACK.md + CLAUDE.md cross-reference.
 *
 * The runbook is operator doc for when production is broken. These
 * tests assert:
 *   - Two procedures (app rollback + DB rollback) both present.
 *   - The decision criteria (roll back vs fix forward) is documented.
 *   - The DB-rollback path correctly defers to docs/RESTORE.md from
 *     TRQ-148 rather than duplicating it (single source of truth).
 *   - CLAUDE.md has the incident-path pointer.
 *   - The rehearsal status is honest about being un-rehearsed.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const runbook = readFileSync(join(repoRoot, 'docs/ROLLBACK.md'), 'utf8');
const claudeMd = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');

describe('TRQ-154 — both procedures present', () => {
  test('Procedure 1: app rollback via Railway deploy history', () => {
    expect(runbook).toMatch(/Procedure 1[\s\S]{0,80}App rollback/i);
    expect(runbook).toMatch(/Railway[\s\S]{0,100}Deployments/);
    expect(runbook).toMatch(/Redeploy/);
  });

  test('Procedure 2: DB rollback (links to TRQ-148 RESTORE.md, doesn\'t duplicate)', () => {
    expect(runbook).toMatch(/Procedure 2[\s\S]{0,80}Database rollback/i);
    expect(runbook).toMatch(/docs\/RESTORE\.md/);
    // The runbook should NOT inline the full disaster-recovery
    // procedure — that's RESTORE.md's job. A guard: only one
    // mention of "Disaster recovery" (the cross-reference itself).
    const drMentions = (runbook.match(/Disaster recovery/g) || []).length;
    expect(drMentions).toBeGreaterThanOrEqual(1);
    expect(drMentions).toBeLessThanOrEqual(3);
  });

  test('app rollback procedure targets under 5 minutes (matches TRQ-154 acceptance criterion)', () => {
    expect(runbook).toMatch(/under 5 minutes|<5 min/);
  });

  test('DB rollback procedure honestly admits it is NOT under 5 minutes', () => {
    expect(runbook).toMatch(/NOT under 5 minutes/i);
  });
});

describe('TRQ-154 — decision criteria', () => {
  test('roll-back-vs-fix-forward table is present', () => {
    expect(runbook).toMatch(/roll back vs fix forward/i);
  });

  test('the default is rollback (not fix-forward)', () => {
    // The decision rule should explicitly state which side wins
    // when uncertain. Operators under stress need this pre-decided.
    expect(runbook).toMatch(/Default to rollback/i);
  });

  test('"data appears missing" triggers Stop+Backup, not autonomous rollback', () => {
    // Constitution: never destructive without explicit go-ahead.
    // Lost data → take backup first, investigate before any rollback.
    expect(runbook).toMatch(
      /[Dd]ata appears missing[\s\S]{0,200}Stop[\s\S]{0,200}backup/
    );
  });
});

describe('TRQ-154 — DB rollback safety', () => {
  test('pre-flight requires a fresh backup of the current broken state', () => {
    expect(runbook).toMatch(/FRESH backup of the current \(broken\) state/);
  });

  test('pre-flight requires choosing the right backup, not just newest', () => {
    expect(runbook).toMatch(/[Nn]ewest is\s*usually wrong/);
  });

  test('post-restore: be honest with users about lost writes', () => {
    expect(runbook).toMatch(/Writes since the chosen backup are gone/);
  });

  test('explicit escalation: do NOT attempt DB rollback autonomously', () => {
    expect(runbook).toMatch(/Don't attempt the DB path\s*autonomously/i);
  });
});

describe('TRQ-154 — rehearsal status (honest)', () => {
  test('says the procedure has NOT been rehearsed yet', () => {
    expect(runbook).toMatch(/has NOT been rehearsed yet/i);
  });

  test('rehearsal is gated on TRQ-153 (staging)', () => {
    expect(runbook).toMatch(/TRQ-153/);
  });

  test('flags this runbook as provisional until rehearsed', () => {
    expect(runbook).toMatch(/provisional/i);
  });
});

describe('TRQ-154 — CLAUDE.md cross-reference', () => {
  test('Verification & Self-Healing section includes an incident-path pointer', () => {
    expect(claudeMd).toMatch(/When production is broken/);
    expect(claudeMd).toMatch(/docs\/ROLLBACK\.md/);
  });

  test('cross-ref reminds the agent to escalate on DB rollback', () => {
    // Per the constitution and ROLLBACK.md, DB rollback is
    // human-only. The CLAUDE.md pointer must say so. The phrase
    // wraps across a newline in the rendered markdown so we bridge
    // any whitespace between "stop" and "and escalate".
    expect(claudeMd).toMatch(/DB rollback[\s\S]{0,200}stop\s+and\s+escalate/i);
  });

  test('cross-ref defaults to rollback when in doubt', () => {
    expect(claudeMd).toMatch(/Default to rollback/i);
  });
});

describe('TRQ-154 — runbook respects the safety constitution', () => {
  test('no DROP / TRUNCATE / un-WHERE\'d UPDATE/DELETE instructions', () => {
    // The runbook should reference psql operations only via the
    // RESTORE.md procedure. It must not inline a "DROP TABLE" or
    // similar destructive command.
    expect(runbook).not.toMatch(/^\s*DROP TABLE/m);
    expect(runbook).not.toMatch(/^\s*TRUNCATE\s+/m);
    // Any UPDATE/DELETE in code fences MUST have a WHERE.
    const writeStmts = runbook.match(
      /(UPDATE\s+\w+\s+SET|DELETE\s+FROM\s+\w+)[\s\S]+?;/g
    ) || [];
    for (const stmt of writeStmts) {
      expect(stmt).toMatch(/WHERE/i);
    }
  });

  test('no "git push --force" instructions', () => {
    expect(runbook).not.toMatch(/git push --force[^-]|--force\s+origin/);
  });
});

describe('TRQ-154 — runbook covers app-rollback verification', () => {
  test('verification step uses /health (TRQ-155\'s real endpoint)', () => {
    expect(runbook).toMatch(/curl[\s\S]{0,100}\/health/);
    expect(runbook).toMatch(/status[\s\S]{0,20}ok[\s\S]{0,20}db[\s\S]{0,20}ok|"db":\s*"ok"/);
  });

  test('verification also requires a browser smoke test', () => {
    expect(runbook).toMatch(/load the dashboard|browser/i);
  });

  test('post-rollback comms: tell Mark + Paul', () => {
    expect(runbook).toMatch(/Mark \+ Paul/);
  });

  test('post-rollback follow-up: open an incident ticket in Linear', () => {
    expect(runbook).toMatch(/Linear ticket/i);
  });
});
