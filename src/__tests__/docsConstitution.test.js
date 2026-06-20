/**
 * TRQ-141 + TRQ-145 — docs drift + safety constitution guards.
 *
 * Asserts CLAUDE.md and README.md keep pointing at reality. These are
 * the first thing both humans and autonomous agents read before touching
 * unfamiliar code (per the Explore-Before-Edit loop), so they have to
 * be right.
 *
 * The matches are loose enough to survive small wording changes but
 * tight enough to catch silent drift (a version bump, a stale fact, a
 * deleted section).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const claudeMd = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');
const readmeMd = readFileSync(join(repoRoot, 'README.md'), 'utf8');
const railwayToml = readFileSync(join(repoRoot, 'railway.toml'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

describe('TRQ-145 — safety constitution at top of CLAUDE.md', () => {
  test('opens with the Agent Operating Rules block', () => {
    // The constitution must appear before "What FastQuote Is", because
    // an agent's attention falls off the further down the file it reads.
    const rulesIdx = claudeMd.indexOf('Agent Operating Rules');
    const whatIdx = claudeMd.indexOf('What FastQuote Is');
    expect(rulesIdx).toBeGreaterThan(-1);
    expect(whatIdx).toBeGreaterThan(-1);
    expect(rulesIdx).toBeLessThan(whatIdx);
  });

  test('Safety layer enumerates the hard prohibitions', () => {
    // Every one of these has been a real footgun or could be one.
    expect(claudeMd).toMatch(/Safety layer/);
    expect(claudeMd).toMatch(/destructive DB operations/i);
    expect(claudeMd).toMatch(/Never read, print, log, or commit live secrets/i);
    expect(claudeMd).toMatch(/git push --force/);
    expect(claudeMd).toMatch(/Never commit\s*\n?\s*to `main` directly|commit to `main` directly/);
    // Moat preservation. Allow the three table names to appear in any
    // order across line breaks (the constitution paragraph wraps).
    expect(claudeMd).toMatch(/quote_diffs[\s\S]{0,200}calibration_notes[\s\S]{0,200}agent_runs/);
    expect(claudeMd).toMatch(/cannot be regenerated/i);
  });

  test('Competence layer establishes the key facts an agent needs', () => {
    expect(claudeMd).toMatch(/Competence layer/);
    // server.js line count (approximate match — survives small changes)
    expect(claudeMd).toMatch(/server\.js[^.]*4,?\d{3}\s+lines/);
    // FK graph correction
    expect(claudeMd).toMatch(/tree rooted at `users`/);
    expect(claudeMd).not.toMatch(/Circular FKs exist between/);
    // PDF path note. Originally TRQ-142 documented two paths (primary
    // Puppeteer + legacy html2canvas fallback); TRQ-180 deleted the
    // legacy fallback as dead code, so the constitution now describes
    // one live path with window.print() as the runtime fallback.
    expect(claudeMd).toMatch(/PDF has ONE live path/);
    expect(claudeMd).toMatch(/Puppeteer/);
    expect(claudeMd).toMatch(/@sparticuz\/chromium/);
    expect(claudeMd).toMatch(/window\.print\(\)/);
    // Status enum lock (TRQ-140 land area)
    expect(claudeMd).toMatch(/agent_runs\.status` enum/);
    expect(claudeMd).toMatch(/One canonical success string/);
    // Build system (TRQ-143)
    expect(claudeMd).toMatch(/Build is a `Dockerfile`/);
    // Node version (TRQ-144)
    expect(claudeMd).toMatch(/Node 20\+/);
  });

  test('Definition-of-done layer covers the standing rules', () => {
    expect(claudeMd).toMatch(/Definition-of-done/);
    expect(claudeMd).toMatch(/`npm test` passes/);
    expect(claudeMd).toMatch(/PR is opened against `main`|branch \+ PR/);
    expect(claudeMd).toMatch(/rootvaluation\/trq-NNN/);
  });
});

describe('TRQ-141 — CLAUDE.md tech-stack table is current', () => {
  test('React 19, not 18', () => {
    expect(claudeMd).toMatch(/React 19/);
    expect(claudeMd).not.toMatch(/\| Frontend \| React 18/);
  });

  test('Node 20+, not 18', () => {
    expect(claudeMd).not.toMatch(/Node 18\+/);
    expect(claudeMd).toMatch(/Node 20\+/);
  });

  test('PDF table row describes BOTH paths (primary Puppeteer + fallback)', () => {
    expect(claudeMd).toMatch(/PDF \(primary\)/);
    expect(claudeMd).toMatch(/PDF \(fallback\)/);
    expect(claudeMd).toMatch(/Puppeteer/);
    expect(claudeMd).toMatch(/@sparticuz\/chromium/);
  });

  test('Build row points at Dockerfile, not Nixpacks', () => {
    expect(claudeMd).toMatch(/`Dockerfile`/);
    expect(claudeMd).toMatch(/No `nixpacks\.toml`/);
  });

  test('Test count reflects current scale (not the stale 1154)', () => {
    expect(claudeMd).not.toMatch(/1154 tests across 56 suites/);
    // Match ~thousands and ~hundreds — wide enough not to break on every
    // commit, narrow enough to catch drift if we 10x.
    expect(claudeMd).toMatch(/~\d{1,2},\d{3} tests across ~\d{2,3} suites/);
  });

  test('Known-limitations page-break note attributes pagination to the server-side Puppeteer path', () => {
    // Was: "(html2canvas limitation)" as if it applied to all PDF output.
    // Reality: server-side Puppeteer paginates fine. TRQ-180 deleted the
    // legacy client-side html2canvas+jsPDF fallback (it was dead code);
    // the current fallback when the /pdf endpoint fails is window.print()
    // which uses the same public/print.css and inherits the same page
    // breaks. The constitution note now describes that explicitly.
    expect(claudeMd).toMatch(/server-side Puppeteer/);
    expect(claudeMd).toMatch(/window\.print\(\)/);
  });
});

describe('TRQ-141 — README.md is current', () => {
  test('React 19', () => {
    expect(readmeMd).toMatch(/React 19/);
  });

  test('PDF table rows describe both paths', () => {
    expect(readmeMd).toMatch(/PDF \(primary\)/);
    expect(readmeMd).toMatch(/PDF \(fallback\)/);
    expect(readmeMd).toMatch(/puppeteer-core/);
  });

  test('Deployment section names the Dockerfile, not Nixpacks', () => {
    expect(readmeMd).toMatch(/Build uses the repo `Dockerfile`/);
    expect(readmeMd).not.toMatch(/Build uses Nixpacks/);
  });

  test('Test count updated (not the stale 1154)', () => {
    expect(readmeMd).not.toMatch(/1154 tests/);
    expect(readmeMd).toMatch(/~\d{1,2},\d{3} tests/);
  });

  test('Project-structure file tree lists Dockerfile, not nixpacks.toml', () => {
    expect(readmeMd).toMatch(/^Dockerfile\b/m);
    expect(readmeMd).not.toMatch(/^nixpacks\.toml\b/m);
  });
});

describe('TRQ-143 — railway.toml builder matches reality', () => {
  test('declares Dockerfile builder', () => {
    expect(railwayToml).toMatch(/builder\s*=\s*"dockerfile"/);
  });

  test('no longer declares Nixpacks', () => {
    expect(railwayToml).not.toMatch(/builder\s*=\s*"nixpacks"/);
  });

  test('keeps the healthcheck pointing at /health', () => {
    // TRQ-155 will upgrade /health itself to actually check the DB; for
    // now just guard the route name so the rename can't silently happen.
    expect(railwayToml).toMatch(/healthcheckPath\s*=\s*"\/health"/);
  });
});

describe('TRQ-144 — Node version in code matches docs', () => {
  test('package.json engines.node is the source of truth', () => {
    // If this changes, docs MUST change too. CLAUDE.md/README assertions
    // above will start failing the moment the engines field moves.
    expect(packageJson.engines?.node).toMatch(/>=20/);
  });
});
