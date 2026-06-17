/**
 * TRQ-153 follow-up — guards for scripts/download-r2-backup.js.
 *
 * The script is the head of the staging-seed pipeline. If it ever
 * starts writing logs to stdout, or stops respecting the R2 env
 * contract, the whole `download | gunzip | sanitise | psql` chain
 * silently corrupts. Tests pin the structural promises.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const scriptPath = join(repoRoot, 'scripts/download-r2-backup.js');
const scriptSrc = readFileSync(scriptPath, 'utf8');

describe('TRQ-153 (follow-up) — download-r2-backup script', () => {
  test('script exists', () => {
    expect(existsSync(scriptPath)).toBe(true);
  });

  test('refuses to run without the four R2 env vars', () => {
    expect(scriptSrc).toMatch(/R2_ENDPOINT/);
    expect(scriptSrc).toMatch(/R2_BUCKET/);
    expect(scriptSrc).toMatch(/R2_ACCESS_KEY_ID/);
    expect(scriptSrc).toMatch(/R2_SECRET_ACCESS_KEY/);
    // Exits with code 2 on missing env (distinguishes config error from runtime).
    expect(scriptSrc).toMatch(/process\.exit\(2\)/);
  });

  // Reusable: keep PATH so `node` resolves, but strip R2_* so checkEnv fails.
  function strippedEnv() {
    const out = { PATH: process.env.PATH };
    for (const k of ['HOME', 'USER', 'NODE_PATH']) {
      if (process.env[k]) out[k] = process.env[k];
    }
    return out;
  }

  test('exits 2 on missing env when invoked without R2_ vars', () => {
    const r = spawnSync('node', [scriptPath, '--r2-key', 'daily/foo.sql.gz'], {
      env: strippedEnv(),
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/missing env/);
  });

  test('--help exits 0 without requiring env', () => {
    const r = spawnSync('node', [scriptPath, '--help'], {
      env: strippedEnv(),
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Usage:/);
  });

  test('unknown arg exits 2 with a clear error', () => {
    const r = spawnSync('node', [scriptPath, '--frobnicate'], {
      env: strippedEnv(),
      encoding: 'utf8',
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/unknown arg: --frobnicate/);
  });

  test('streaming output goes to stdout, logs go to stderr', () => {
    // The whole pipeline depends on stdout being CLEAN (just the .sql.gz
    // bytes) so it can pipe into gunzip / sanitiser / psql. Logs that
    // accidentally leak to stdout corrupt the stream.
    //
    // Source-level guard: every console.log inside main() is for --list
    // (informational), and every status / error line uses console.error.
    const main = scriptSrc.split('async function main')[1] || '';
    // Find all console.log calls outside the --list block.
    const beforeList = main.split('if (args.list)')[0];
    const afterListClose = main.split('process.exit(0);')[1] || '';
    // Outside the --list branch, there should be NO console.log.
    expect(beforeList).not.toMatch(/console\.log/);
    expect(afterListClose).not.toMatch(/console\.log/);
  });

  test('newest-first sort is preserved (same as restore-test.js)', () => {
    expect(scriptSrc).toMatch(/sort\(\(a, b\) => \(b\.Key < a\.Key \? -1 : 1\)\)/);
  });

  test('R2_PREFIX defaults to daily/ (matches backup-to-r2.js)', () => {
    expect(scriptSrc).toMatch(/R2_PREFIX[\s\S]{0,30}\|\|\s*['"]daily\/['"]/);
  });

  test('treats EPIPE / premature-close as a graceful exit (downstream closed)', () => {
    // When the downstream consumer exits early (e.g. `head -c 100`), the
    // pipe closes and EPIPE fires. Treating it as a hard error would
    // produce confusing stack traces; instead, log a short message and
    // exit 1 so the wrapper script's `set -e` still catches it.
    expect(scriptSrc).toMatch(/EPIPE|ERR_STREAM_PREMATURE_CLOSE/);
  });

  test('--output writes to a file instead of stdout', () => {
    expect(scriptSrc).toMatch(/createWriteStream\(args\.output\)/);
  });

  test('--list mode prints object inventory to stdout', () => {
    // The one case where stdout is informational rather than data.
    expect(scriptSrc).toMatch(/--list/);
    // Inside the --list branch we expect a console.log per object.
    const main = scriptSrc.split('async function main')[1] || '';
    const listBranch = main.split('if (args.list)')[1]?.split('process.exit(0)')[0] || '';
    expect(listBranch).toMatch(/console\.log/);
  });

  test('uses streaming pipeline (no buffer-the-whole-object)', () => {
    // A 300 MB dump must not be held in memory. Pipeline from
    // node:stream/promises is the structural promise.
    expect(scriptSrc).toMatch(/from 'node:stream\/promises'/);
    expect(scriptSrc).toMatch(/await pipeline\(obj\.Body, dest\)/);
  });
});
