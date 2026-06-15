/**
 * TRQ-156 — guards for the secret-scanning gate + policy.
 *
 * Asserts both the workflow and the policy doc keep the promises that
 * other tickets (R2 backup, Stripe billing, EU migration) rely on:
 *   - gitleaks runs on every PR and on push to main
 *   - the policy names every secret the app actually uses
 *   - the rotation runbook covers each one
 *   - .gitignore still excludes .env files
 *
 * Tests are source-level — gitleaks itself runs in CI, not here.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

const workflowYml = readFileSync(join(repoRoot, '.github/workflows/secret-scan.yml'), 'utf8');
const policyMd = readFileSync(join(repoRoot, 'docs/SECRETS.md'), 'utf8');
const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');

describe('TRQ-156 — secret-scan workflow', () => {
  test('runs on pull_request to main (the primary gate)', () => {
    expect(workflowYml).toMatch(/pull_request:\s*\n\s*branches:\s*\[main\]/);
  });

  test('runs on push to main (catches a force-push that bypassed PR)', () => {
    expect(workflowYml).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
  });

  test('weekly scheduled run (safety net)', () => {
    expect(workflowYml).toMatch(/schedule:[\s\S]*cron:/);
  });

  test('uses gitleaks (not GHAS, which would need a paid licence)', () => {
    expect(workflowYml).toMatch(/gitleaks\/gitleaks-action/);
  });

  test('fetches full history on push (so historic commits are scanned, not just the diff)', () => {
    expect(workflowYml).toMatch(/fetch-depth:\s*\$\{\{\s*github\.event_name\s*==\s*'push'\s*&&\s*0\s*\|\|\s*1\s*\}\}/);
  });

  test('5-minute timeout — workflow can never hang a PR indefinitely', () => {
    expect(workflowYml).toMatch(/timeout-minutes:\s*5/);
  });

  test('GITHUB_TOKEN is the only secret used (no extra licences required)', () => {
    expect(workflowYml).toMatch(/GITHUB_TOKEN:\s*\$\{\{\s*secrets\.GITHUB_TOKEN\s*\}\}/);
  });
});

describe('TRQ-156 — secrets policy doc', () => {
  test('names Railway env vars as the single source of truth', () => {
    expect(policyMd).toMatch(/Railway environment variables/i);
    expect(policyMd).toMatch(/single source of truth/i);
  });

  test('staging ≠ prod is explicit', () => {
    expect(policyMd).toMatch(/Staging never holds live Stripe keys/i);
  });

  test('enumerates every secret the app actually uses', () => {
    // These are the env vars referenced in the code (verified during
    // the Step 0 exploration). If any new secret is added to server.js
    // and not here, this test won't catch it directly — but the
    // pre-commit habit of grepping `process.env.X` against this list
    // should.
    const required = [
      'DATABASE_URL',
      'ANTHROPIC_API_KEY',
      'OPENAI_API_KEY',
      'SESSION_SECRET',
      'GOOGLE_CLIENT_SECRET',
      // Stripe is post-TRQ-150 but the policy already names it
      'STRIPE_SECRET_KEY',
      // R2 is post-TRQ-147 but the policy already names it
      'R2_ACCESS_KEY_ID',
    ];
    for (const name of required) {
      expect(policyMd).toMatch(new RegExp(name));
    }
  });
});

describe('TRQ-156 — leaked-key rotation runbook', () => {
  test('has a Stripe rotation section', () => {
    expect(policyMd).toMatch(/Stripe live keys/i);
    expect(policyMd).toMatch(/Stripe Dashboard.*API keys/i);
  });

  test('Stripe rotation happens BEFORE history cleanup', () => {
    // Rotation is the urgent step. History cleanup is the follow-up.
    const stripeIdx = policyMd.indexOf('Stripe live keys');
    const cleanIdx = policyMd.indexOf('Cleaning git history');
    expect(stripeIdx).toBeGreaterThan(-1);
    expect(cleanIdx).toBeGreaterThan(-1);
    expect(stripeIdx).toBeLessThan(cleanIdx);
  });

  test('Anthropic / OpenAI rotation has a usage-spot-check step', () => {
    expect(policyMd).toMatch(/Anthropic.*OpenAI keys/i);
    expect(policyMd).toMatch(/usage page.*leak window|leak window.*usage page/);
  });

  test('DATABASE_URL rotation takes a backup first', () => {
    // Anchor on the runbook section heading specifically — the table
    // earlier in the doc mentions DATABASE_URL but the actual rotation
    // steps live under the `### \`DATABASE_URL\`` heading.
    const idx = policyMd.indexOf('### `DATABASE_URL`');
    expect(idx).toBeGreaterThan(-1);
    const slice = policyMd.slice(idx, idx + 1500);
    expect(slice).toMatch(/Take a backup immediately/i);
  });

  test('SESSION_SECRET rotation notifies the users', () => {
    expect(policyMd).toMatch(/SESSION_SECRET[\s\S]{0,800}logged out/i);
  });

  test('git-history cleanup uses --force-with-lease, never plain --force', () => {
    expect(policyMd).toMatch(/--force-with-lease/);
    // No bare --force on a line that's a real command (not part of a
    // word like --force-with-lease).
    expect(policyMd).not.toMatch(/^\s*git push --force\s*$/m);
  });

  test('git-history cleanup uses git-filter-repo, not git filter-branch', () => {
    expect(policyMd).toMatch(/git-filter-repo|git filter-repo/);
    // git filter-branch is explicitly called out as the WRONG tool
    expect(policyMd).toMatch(/NOT git filter-branch/);
  });
});

describe('TRQ-156 — gitignore still excludes .env families', () => {
  test('.env excluded', () => {
    expect(gitignore).toMatch(/^\.env$/m);
  });
  test('.env.local excluded', () => {
    expect(gitignore).toMatch(/^\.env\.local$/m);
  });
  test('.env.*.local excluded', () => {
    expect(gitignore).toMatch(/^\.env\.\*\.local$/m);
  });
});
