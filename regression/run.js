#!/usr/bin/env node
/**
 * Regression suite entry point.
 *
 *   npm run regression
 *   npm run regression -- --iterations 5
 *   npm run regression -- --fixture sample
 *   npm run regression -- --base-url https://fastquote.uk --user-id markdoyle
 *   npm run regression -- --bless                       # capture baseline
 *   npm run regression -- --strict                      # fail-loud on skipped
 *   npm run regression -- --require-min-fixtures 1      # floor on runnable
 *
 * Default: 3 iterations × every fixture in regression/fixtures/.
 * Writes a markdown report under regression/reports/.
 *
 * COST WARNING: this hits the real /analyse endpoint, which calls
 * Anthropic. 3 iters × 5 fixtures ≈ ~£0.50 of Sonnet tokens. Don't
 * run on every push — run on prompt/model changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAllFixtures, loadFixture } from './lib/fixtureLoader.js';
import { runFixture } from './lib/runner.js';
import { summariseRuns } from './lib/compare.js';
import { renderReport } from './lib/reporter.js';
import { parseArgs, helpText, decideExitCode } from './lib/cli.js';
import {
  buildBaselinePayload,
  computeDeltas,
  loadBaseline,
  writeBaseline,
} from './lib/baseline.js';
import { SYSTEM_PROMPT, computePromptVersion } from '../prompts/systemPrompt.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const REPORTS_DIR = path.join(__dirname, 'reports');
const BASELINES_DIR = path.join(__dirname, 'baselines');

// A fixture is "runnable" when every photo it references exists on disk.
// Photos aren't committed (they're customer-specific or large binaries),
// so a freshly-checked-out repo will have fixture JSON without photos.
// The action skips these silently instead of failing — the suite stays
// passive until someone populates real fixture data.
//
// With --strict, the skip becomes a hard failure as soon as at least one
// other fixture IS runnable (see cli.js decideExitCode).
function fixtureRunnable(fixture) {
  const photos = fixture._photosResolved || {};
  for (const p of Object.values(photos)) {
    if (!fs.existsSync(p)) return { runnable: false, missing: p };
  }
  return { runnable: true };
}

async function runOne(fixture, opts) {
  const check = fixtureRunnable(fixture);
  if (!check.runnable) {
    return {
      fixture,
      summary: { totalRuns: 0, passRate: 0, fields: [], perRun: [] },
      skipped: true,
      skipReason: `photos not present on disk (e.g. ${path.basename(check.missing)})`,
    };
  }

  const runs = [];
  for (let i = 0; i < opts.iterations; i++) {
    try {
      const out = await runFixture(fixture, opts);
      runs.push(out);
    } catch (err) {
      // Capture and continue — one bad iteration doesn't kill the fixture
      runs.push({ _error: err.message });
    }
  }
  const goodRuns = runs.filter((r) => !r._error);
  const errored = runs.length - goodRuns.length;
  if (goodRuns.length === 0) {
    return {
      fixture,
      summary: { totalRuns: 0, passRate: 0, fields: [], perRun: [] },
      error: `All ${runs.length} iterations failed — ${runs[0]._error || 'unknown'}`,
    };
  }
  const summary = summariseRuns(goodRuns, fixture.groundTruth);

  // Attach the raw model output from each good run onto its perRun
  // entry so the reporter can surface raw JSON for any failing iteration
  // (item 3). summariseRuns built perRun by comparing each run; we
  // splice in the matching raw payload by index so the reporter can
  // pair them up without needing to know about runs[].
  if (Array.isArray(summary.perRun)) {
    summary.perRun = summary.perRun.map((p, i) => ({
      ...p,
      raw: goodRuns[i]?.raw ?? null,
    }));
  }

  return {
    fixture,
    summary,
    error: errored > 0 ? `${errored}/${runs.length} iterations failed` : null,
  };
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv, process.env);
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.helpRequested) {
    console.log(helpText());
    process.exit(0);
  }

  // Stamp the prompt version so the report shows what we tested against
  // (item 6). Empty calNotes — the regression suite doesn't load the live
  // calibration_notes table, so we hash the base prompt only. Different
  // baseline runs WILL drift in calNotes content, but this stamp tells
  // us when the base prompt itself changed.
  const promptVersion = computePromptVersion(SYSTEM_PROMPT, '');

  let fixtures;
  if (opts.fixtureId) {
    const p = path.join(FIXTURES_DIR, `${opts.fixtureId}.json`);
    if (!fs.existsSync(p)) {
      console.error(`Fixture not found: ${p}`);
      process.exit(2);
    }
    fixtures = [loadFixture(p)];
  } else {
    fixtures = loadAllFixtures(FIXTURES_DIR);
  }

  if (fixtures.length === 0) {
    console.error(`No fixtures found in ${FIXTURES_DIR}. See regression/README.md.`);
    // Honour --require-min-fixtures when no fixtures exist at all
    if (opts.requireMinFixtures > 0) {
      console.error(`--require-min-fixtures ${opts.requireMinFixtures}: failing because no fixtures exist.`);
      process.exit(1);
    }
    process.exit(2);
  }

  console.log(`Running ${fixtures.length} fixture(s) × ${opts.iterations} iteration(s) against ${opts.baseUrl}`);
  if (opts.strict) console.log('  mode: STRICT (any skipped fixture is a failure)');
  if (opts.bless) console.log(`  mode: BLESS (will write baselines to ${path.relative(process.cwd(), BASELINES_DIR)})`);
  if (opts.requireMinFixtures > 0) console.log(`  floor: ≥${opts.requireMinFixtures} runnable fixture(s) required`);

  const fixtureReports = [];
  for (const f of fixtures) {
    process.stdout.write(`  ${f.id} ... `);
    const r = await runOne(f, opts);
    // Attach deltas against any saved baseline (item 2 + 6).
    if (!r.skipped && !r.error) {
      const baseline = loadBaseline(BASELINES_DIR, f.id);
      r.deltas = computeDeltas(baseline, r.summary, { currentPromptVersion: promptVersion });
    }
    if (r.skipped) {
      process.stdout.write(`skipped (${r.skipReason})\n`);
    } else if (r.error) {
      process.stdout.write(`error: ${r.error}\n`);
    } else {
      process.stdout.write(`${(r.summary.passRate * 100).toFixed(0)}% pass\n`);
    }
    fixtureReports.push(r);
  }

  const runnableReports = fixtureReports.filter((r) => !r.skipped);

  // Bless mode: write a baseline for each runnable, non-errored fixture.
  // Always honours --no-write — `--bless --no-write` is a dry-run that
  // shows what would be written without touching disk.
  if (opts.bless && opts.write) {
    fs.mkdirSync(BASELINES_DIR, { recursive: true });
    for (const r of runnableReports) {
      if (r.error) continue;
      const payload = buildBaselinePayload({
        fixtureId: r.fixture.id,
        iterations: opts.iterations,
        promptVersion,
        summary: r.summary,
      });
      writeBaseline(BASELINES_DIR, payload);
      console.log(`  blessed: regression/baselines/${r.fixture.id}.json`);
    }
  } else if (opts.bless && !opts.write) {
    console.log('  bless dry-run (--no-write): would write baselines for:');
    for (const r of runnableReports) {
      if (!r.error) console.log(`    - ${r.fixture.id}`);
    }
  }

  // If every fixture was skipped (no photos on disk yet), keep the
  // "wired but inert" passive state — exit 0 with a friendly message
  // UNLESS --strict + ≥1 runnable fixture or --require-min-fixtures
  // says otherwise (decideExitCode handles that).
  if (runnableReports.length === 0) {
    console.log('\nNo runnable fixtures (none have photos on disk). Suite skipped.');
    console.log('See regression/README.md for how to add real fixtures.');
    const exitCode = decideExitCode(fixtureReports, opts);
    process.exit(exitCode);
  }

  const md = renderReport({
    generatedAt: new Date().toISOString(),
    baseUrl: opts.baseUrl,
    iterations: opts.iterations,
    fixtureReports,
    promptVersion,
  });

  if (opts.write) {
    fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const outPath = path.join(REPORTS_DIR, `${stamp}.md`);
    fs.writeFileSync(outPath, md);
    console.log(`\nReport: ${path.relative(process.cwd(), outPath)}`);
  } else {
    console.log('\n' + md);
  }

  process.exit(decideExitCode(fixtureReports, opts));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
