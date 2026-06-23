/**
 * Behavioural critique fixtures (TRQ-177).
 *
 * Companion to selfCritique.test.js. That suite asserts the CRITIQUE
 * PROMPT contains the right strings — it catches accidental prompt
 * deletions. THIS suite asserts the prompt is actually being FOLLOWED
 * by Haiku — it catches the case where Haiku 4.5 (or a future Haiku)
 * silently stops detecting a planted failure mode.
 *
 * Gated on RUN_CRITIQUE_FIXTURES=1. Default `npm test` skips the suite
 * so we don't burn Haiku tokens on every push. CI / on-demand runs
 * invoke `npm run regression:critique`, which sets the flag.
 *
 * Each fixture under regression/critique-fixtures/*.json is a pre-baked
 * Sonnet analysis that planted one failure mode. We run the real
 * production runSelfCritique with a stub Postgres pool (no agent_runs
 * writes), let Haiku produce the critique, then assert
 * critique.corrections contains an entry matching the planted category
 * at the expected severity floor.
 *
 * Do NOT touch src/__tests__/selfCritique.test.js — TRQ-175 owns it.
 */
import { describe, test, expect } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runSelfCritique } from '../../agents/selfCritique.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', '..', 'regression', 'critique-fixtures');

// ---- Gating -----------------------------------------------------------------

const ENABLED = process.env.RUN_CRITIQUE_FIXTURES === '1';
const HAS_API_KEY = Boolean(process.env.ANTHROPIC_API_KEY);
const RUN = ENABLED && HAS_API_KEY;
const describeIfRun = RUN ? describe : describe.skip;

// Surface why we're skipping so CI doesn't silently green-light a no-op run.
if (ENABLED && !HAS_API_KEY) {
  // eslint-disable-next-line no-console
  console.warn(
    '[selfCritiqueBehavioural] RUN_CRITIQUE_FIXTURES=1 set but ANTHROPIC_API_KEY missing — skipping. ' +
      'These fixtures require a live Haiku call.'
  );
}

// ---- Fixture loader ---------------------------------------------------------

function loadFixtures() {
  const entries = readdirSync(FIXTURES_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'));
  if (entries.length < 4) {
    throw new Error(
      `Expected ≥4 critique fixtures in ${FIXTURES_DIR}, found ${entries.length}. ` +
        `TRQ-177 commits four canonical fixtures; deleting one is a regression.`
    );
  }
  return entries.map((e) => {
    const raw = readFileSync(join(FIXTURES_DIR, e.name), 'utf8');
    const fixture = JSON.parse(raw);
    if (!fixture.id || !fixture.analysis || !fixture.expected) {
      throw new Error(
        `Fixture ${e.name} missing required keys (id, analysis, expected). See regression/critique-fixtures/README.md.`
      );
    }
    return fixture;
  });
}

// ---- Stub pool --------------------------------------------------------------

/**
 * runSelfCritique → runAgent inserts/updates rows in `agent_runs`. We
 * don't have a Postgres in the behavioural-fixture environment (and
 * don't want one — these tests should run in any worktree with just an
 * ANTHROPIC_API_KEY). The stub satisfies the three queries runAgent
 * makes: INSERT...RETURNING id, then UPDATE on completion (or failure).
 */
function stubPool() {
  return {
    query: async (sql) => {
      // createAgentRun is the only path that needs a row back.
      if (/INSERT INTO agent_runs/i.test(sql)) {
        return { rows: [{ id: 'stub-run-id' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
}

// ---- Matching helpers -------------------------------------------------------

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };

function severityAtLeast(actual, min) {
  const a = SEVERITY_RANK[String(actual || '').toLowerCase()] || 0;
  const m = SEVERITY_RANK[String(min || '').toLowerCase()] || 0;
  return a >= m;
}

function correctionMatches(correction, keywords) {
  const field = String(correction.field || '').toLowerCase();
  const issue = String(correction.issue || '').toLowerCase();
  const suggested = String(correction.suggestedFix || '').toLowerCase();
  return keywords.some((kw) => {
    const k = String(kw || '').toLowerCase();
    return k.length > 0 && (field.includes(k) || issue.includes(k) || suggested.includes(k));
  });
}

function findMatchingCorrection(critique, expected) {
  const corrections = Array.isArray(critique?.corrections) ? critique.corrections : [];
  return corrections.find(
    (c) => correctionMatches(c, expected.categoryKeywords) && severityAtLeast(c.severity, expected.minSeverity)
  );
}

// ---- Test wiring ------------------------------------------------------------

describeIfRun('selfCritique — behavioural fixtures (TRQ-177)', () => {
  const fixtures = loadFixtures();

  test.each(fixtures.map((f) => [f.id, f]))(
    'fixture %s: critique catches the planted failure',
    async (_id, fixture) => {
      const { critique } = await runSelfCritique({
        pool: stubPool(),
        userId: 'trq-177-behavioural',
        jobId: null,
        analysis: fixture.analysis,
        briefNotes: fixture.briefNotes || '',
      });

      const match = findMatchingCorrection(critique, fixture.expected);

      if (!match) {
        // Show the full critique so a CI failure is debuggable without
        // having to re-run locally with logging.
        // eslint-disable-next-line no-console
        console.error(
          `[${fixture.id}] no matching correction at severity ≥ ${fixture.expected.minSeverity}.\n` +
            `Expected one of keywords: ${JSON.stringify(fixture.expected.categoryKeywords)}\n` +
            `Critique returned:\n${JSON.stringify(critique, null, 2)}`
        );
      }

      expect(match).toBeDefined();
      expect(severityAtLeast(match.severity, fixture.expected.minSeverity)).toBe(true);
    },
    60_000 // Haiku is fast but the network round-trip + agent overhead can take ~5–15s; allow 60.
  );

  test('all four canonical fixtures are present', () => {
    const ids = fixtures.map((f) => f.id).sort();
    expect(ids).toEqual(
      [
        'arithmetic-mismatch',
        'labour-50-days',
        'mortar-without-trigger',
        'tonnage-20t-1sqm',
      ].sort()
    );
  });
});

// When neither flag nor key are set, the suite is intentionally inert
// — that's the default `npm test` path. We surface ONE green assertion
// so Jest doesn't report the file as zero-tests and so the gating
// contract is documented.
//
// When the flag IS set but the key is missing, we hard-fail. Otherwise
// CI silently green-lights critique regressions whenever a key
// rotation slipped through unnoticed — exactly the failure mode the
// 100%-locked pass rate is meant to prevent.
if (!ENABLED && !HAS_API_KEY) {
  describe('selfCritique — behavioural fixtures (skipped)', () => {
    test('default `npm test` skips this suite — set RUN_CRITIQUE_FIXTURES=1 to run', () => {
      expect(ENABLED).toBe(false);
      expect(HAS_API_KEY).toBe(false);
    });
  });
} else if (ENABLED && !HAS_API_KEY) {
  describe('selfCritique — behavioural fixtures (misconfigured)', () => {
    test('RUN_CRITIQUE_FIXTURES=1 requires ANTHROPIC_API_KEY — fail loud, not silent', () => {
      throw new Error(
        'RUN_CRITIQUE_FIXTURES=1 was set but ANTHROPIC_API_KEY is missing. ' +
          'These fixtures must hit Haiku — refusing to silently pass. ' +
          'Either set the key, or drop the RUN_CRITIQUE_FIXTURES flag to skip the suite.'
      );
    });
  });
}
