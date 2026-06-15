/**
 * TRQ-147 — guards for the R2 backup script + service.
 *
 * The script handles credentials and an unbounded data stream from
 * production. A regression here either silently breaks the moat
 * safety net (worst) or leaks credentials (almost as bad). Source-level
 * assertions are the right level — the script itself runs in a separate
 * Railway service, not in the deterministic Jest suite.
 *
 * Two layers covered:
 *   1. Script safety properties (env checks, pg_dump invocation,
 *      retention scope, encryption, no credential leakage).
 *   2. Deployment artefacts exist (Dockerfile.backup, BACKUP.md
 *      runbook, the new SDK deps in package.json).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const scriptSrc = readFileSync(join(repoRoot, 'scripts/backup-to-r2.js'), 'utf8');
const backupDockerfile = readFileSync(join(repoRoot, 'Dockerfile.backup'), 'utf8');
const runbook = readFileSync(join(repoRoot, 'docs/BACKUP.md'), 'utf8');
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));

describe('TRQ-147 — required env validation', () => {
  test('refuses to run if any required env var is missing', () => {
    expect(scriptSrc).toMatch(/REQUIRED_ENV\s*=\s*\[/);
    // Every var the runbook lists as required must be in the array.
    for (const name of [
      'DATABASE_URL',
      'R2_ENDPOINT',
      'R2_BUCKET',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
    ]) {
      expect(scriptSrc).toMatch(new RegExp(`'${name}'`));
    }
  });

  test('reports missing env by NAME only — never prints values', () => {
    // The check function joins var names into the error, but must not
    // splice in `process.env[k]` (which would print the actual value
    // if it happened to be truthy in some weird CI run).
    expect(scriptSrc).toMatch(/Missing required env: \$\{missing\.join/);
    expect(scriptSrc).not.toMatch(/process\.env\[k\][\s\S]{0,40}Error/);
  });
});

describe('TRQ-147 — pg_dump invocation', () => {
  test('uses pg_dump (not pg_dumpall, not a custom wrapper)', () => {
    expect(scriptSrc).toMatch(/spawn\('pg_dump'/);
  });

  test('uses --no-owner --no-privileges (portable across DB owners)', () => {
    expect(scriptSrc).toMatch(/'--no-owner'/);
    expect(scriptSrc).toMatch(/'--no-privileges'/);
  });

  test('uses --format=plain (portable across pg minor versions)', () => {
    expect(scriptSrc).toMatch(/'--format=plain'/);
  });

  test('uses --quote-all-identifiers (defends against reserved-word drift)', () => {
    expect(scriptSrc).toMatch(/'--quote-all-identifiers'/);
  });

  test('30-minute wall-clock timeout on pg_dump so a hung dump cannot wedge the cron', () => {
    expect(scriptSrc).toMatch(/30\s*\*\s*60\s*\*\s*1000/);
    expect(scriptSrc).toMatch(/pgDump\.kill\('SIGTERM'\)/);
  });

  test('stderr buffer is capped at 64KB so a noisy dump cannot OOM', () => {
    expect(scriptSrc).toMatch(/64 \* 1024/);
  });

  test('streaming pipeline pg_dump → gzip → upload (nothing on disk)', () => {
    expect(scriptSrc).toMatch(/pgDump\.stdout\.pipe\(gzip\)\.pipe\(body\)/);
    // The Upload (multipart) sends the gzipped stream straight to R2.
    expect(scriptSrc).toMatch(/new Upload\(/);
  });
});

describe('TRQ-147 — R2 upload', () => {
  test('PutObject uses ServerSideEncryption: AES256', () => {
    expect(scriptSrc).toMatch(/ServerSideEncryption:\s*['"]AES256['"]/);
  });

  test('S3Client points at the R2 endpoint with forcePathStyle: true', () => {
    expect(scriptSrc).toMatch(/endpoint:\s*process\.env\.R2_ENDPOINT/);
    expect(scriptSrc).toMatch(/forcePathStyle:\s*true/);
  });

  test('region is `auto` (Cloudflare R2 contract)', () => {
    expect(scriptSrc).toMatch(/region:\s*['"]auto['"]/);
  });

  test('object key embeds an ISO-style UTC timestamp + day-of-week', () => {
    // The day-of-week suffix is what the weekly retention uses to find
    // Sunday anchors. Removing it silently breaks pruning.
    expect(scriptSrc).toMatch(/\['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'\]/);
    expect(scriptSrc).toMatch(/-\$\{dow\}\.sql\.gz/);
  });

  test('default prefix is daily/ — pruning is scoped to it', () => {
    expect(scriptSrc).toMatch(/BACKUP_PREFIX\s*\|\|\s*'daily\/'/);
    expect(scriptSrc).toMatch(/Prefix:\s*PREFIX/);
  });
});

describe('TRQ-147 — retention pruning safety', () => {
  test('list-then-delete: keys to delete come from the listed objects only', () => {
    // We never construct a key from elsewhere. The DeleteObjects payload
    // is built from `objects` which itself comes from ListObjectsV2 with
    // PREFIX. This means a runaway prune cannot touch anything outside
    // the prefix.
    expect(scriptSrc).toMatch(/ListObjectsV2Command/);
    expect(scriptSrc).toMatch(/DeleteObjectsCommand/);
    // Sanity check the structural pattern.
    expect(scriptSrc).toMatch(/Delete:\s*\{\s*Objects:\s*batch/);
  });

  test('newest-first sort — RETAIN_DAILY most recent are always preserved', () => {
    expect(scriptSrc).toMatch(/sort\(\(a, b\) => \(b\.Key < a\.Key \? -1 : 1\)\)/);
  });

  test('weekly retention only considers Sunday dumps', () => {
    expect(scriptSrc).toMatch(/includes\('-sun\.sql\.gz'\)/);
  });

  test('DeleteObjects batched at 1000 keys per request', () => {
    // S3/R2 limit — important to respect.
    expect(scriptSrc).toMatch(/i\s*\+=\s*1000/);
  });

  test('default retention: 7 daily + 4 weekly', () => {
    expect(scriptSrc).toMatch(/BACKUP_RETENTION_DAILY\s*\|\|\s*'7'/);
    expect(scriptSrc).toMatch(/BACKUP_RETENTION_WEEKLY\s*\|\|\s*'4'/);
  });
});

describe('TRQ-147 — failure alerting + exit semantics', () => {
  test('non-zero exit on failure', () => {
    expect(scriptSrc).toMatch(/process\.exit\(1\)/);
  });

  test('posts to BACKUP_ALERT_WEBHOOK on failure (if configured)', () => {
    expect(scriptSrc).toMatch(/postAlert/);
    expect(scriptSrc).toMatch(/BACKUP_ALERT_WEBHOOK/);
    expect(scriptSrc).toMatch(/method:\s*['"]POST['"]/);
  });

  test('alert webhook has its own 10s timeout (cron can never hang on it)', () => {
    expect(scriptSrc).toMatch(/AbortSignal\.timeout\(10[_,]?000\)/);
  });

  test('script never logs credential values', () => {
    // No console.log of R2_*, DATABASE_URL or process.env entries by name
    // of credentials. Allow comment mentions.
    expect(scriptSrc).not.toMatch(/console\.log\([^)]{0,200}R2_SECRET/);
    expect(scriptSrc).not.toMatch(/console\.log\([^)]{0,200}process\.env\.DATABASE_URL/);
  });
});

describe('TRQ-147 — deployment artefacts', () => {
  test('Dockerfile.backup uses node 20 base + installs postgresql-client', () => {
    expect(backupDockerfile).toMatch(/FROM node:20/);
    expect(backupDockerfile).toMatch(/postgresql-client/);
  });

  test('Dockerfile.backup is lean (no Chromium, no ffmpeg install lines)', () => {
    // Comments naming the omissions are allowed. What's banned is the
    // packages actually being installed — anchor on `apt-get install`
    // and `npm install` lines.
    const installLines = backupDockerfile
      .split('\n')
      .filter((l) => /^\s*(RUN apt-get install|RUN npm install|\s+(?:ffmpeg|libnss3|libgbm1|chromium))/i.test(l))
      .join('\n');
    expect(installLines).not.toMatch(/^\s*ffmpeg/im);
    expect(installLines).not.toMatch(/sparticuz/);
    expect(installLines).not.toMatch(/chromium/);
    expect(installLines).not.toMatch(/libnss3|libgbm1/);
  });

  test('Dockerfile.backup CMD invokes the backup script', () => {
    expect(backupDockerfile).toMatch(
      /CMD\s*\[\s*"node",\s*"scripts\/backup-to-r2\.js"\s*\]/
    );
  });

  test('@aws-sdk/client-s3 + @aws-sdk/lib-storage are in package.json deps', () => {
    expect(pkg.dependencies['@aws-sdk/client-s3']).toBeDefined();
    expect(pkg.dependencies['@aws-sdk/lib-storage']).toBeDefined();
  });
});

describe('TRQ-147 — BACKUP.md runbook', () => {
  test('documents required env vars (matches the script)', () => {
    for (const name of [
      'R2_ENDPOINT',
      'R2_BUCKET',
      'R2_ACCESS_KEY_ID',
      'R2_SECRET_ACCESS_KEY',
    ]) {
      expect(runbook).toMatch(new RegExp(name));
    }
  });

  test('documents the cron schedule', () => {
    expect(runbook).toMatch(/0 3 \* \* \*/);
  });

  test('documents the retention policy (7 daily + 4 weekly)', () => {
    expect(runbook).toMatch(/BACKUP_RETENTION_DAILY/);
    expect(runbook).toMatch(/BACKUP_RETENTION_WEEKLY/);
  });

  test('explicitly names the Harry-only setup steps (bucket + token)', () => {
    expect(runbook).toMatch(/Harry — once/);
    expect(runbook).toMatch(/Create R2 bucket/);
    expect(runbook).toMatch(/Create API token/);
  });

  test('warns prod restore is Harry-only', () => {
    expect(runbook).toMatch(/Production restore is a Harry-only operation/);
  });
});
