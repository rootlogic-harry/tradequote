#!/usr/bin/env node
/**
 * Regression suite entry point.
 *
 *   npm run regression
 *   npm run regression -- --iterations 5
 *   npm run regression -- --fixture sample
 *   npm run regression -- --base-url https://fastquote.uk --user-id markdoyle
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const REPORTS_DIR = path.join(__dirname, 'reports');

function parseArgs(argv) {
  const out = {
    iterations: 3,
    baseUrl: process.env.FASTQUOTE_BASE_URL || 'http://localhost:3000',
    testUserId: process.env.FASTQUOTE_TEST_USER || 'markdoyle',
    fixtureId: null,
    write: true,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--iterations') out.iterations = Number(argv[++i]);
    else if (a === '--base-url') out.baseUrl = argv[++i];
    else if (a === '--user-id') out.testUserId = argv[++i];
    else if (a === '--fixture') out.fixtureId = argv[++i];
    else if (a === '--no-write') out.write = false;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage: node regression/run.js [options]

  --iterations N    Iterations per fixture (default 3)
  --base-url URL    FastQuote endpoint (default http://localhost:3000)
  --user-id ID      User to impersonate via x-test-user-id (default markdoyle)
  --fixture ID      Run only the named fixture
  --no-write        Don't write a report file (stdout only)
`);
      process.exit(0);
    }
  }
  return out;
}

async function runOne(fixture, opts) {
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
      summary: { totalRuns: 0, passRate: 0, fields: [] },
      error: `All ${runs.length} iterations failed — ${runs[0]._error || 'unknown'}`,
    };
  }
  const summary = summariseRuns(goodRuns, fixture.groundTruth);
  return {
    fixture,
    summary,
    error: errored > 0 ? `${errored}/${runs.length} iterations failed` : null,
  };
}

async function main() {
  const opts = parseArgs(process.argv);
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
    process.exit(2);
  }

  console.log(`Running ${fixtures.length} fixture(s) × ${opts.iterations} iteration(s) against ${opts.baseUrl}`);
  const fixtureReports = [];
  for (const f of fixtures) {
    process.stdout.write(`  ${f.id} ... `);
    const r = await runOne(f, opts);
    process.stdout.write(r.error ? `error: ${r.error}\n` : `${(r.summary.passRate * 100).toFixed(0)}% pass\n`);
    fixtureReports.push(r);
  }

  const md = renderReport({
    generatedAt: new Date().toISOString(),
    baseUrl: opts.baseUrl,
    iterations: opts.iterations,
    fixtureReports,
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

  const allPassed = fixtureReports.every((r) => r.summary.passRate === 1 && !r.error);
  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
