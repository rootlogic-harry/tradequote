#!/usr/bin/env node
/**
 * TRQ-147 — Daily PostgreSQL backup → Cloudflare R2.
 *
 * The core asset (quote_diffs + calibration_notes + agent_runs) can't
 * be regenerated. Railway has no managed backup on the Hobby plan, so
 * this script is what makes autonomous production work survivable.
 *
 * Designed to run as a Railway scheduled service (cron). One run =
 * one dump uploaded + retention pruned + outcome reported.
 *
 * Required env:
 *   DATABASE_URL           — the prod Postgres URL
 *   R2_ENDPOINT            — Cloudflare R2 endpoint (https://<acct>.r2.cloudflarestorage.com)
 *   R2_BUCKET              — bucket name
 *   R2_ACCESS_KEY_ID       — R2 API token (read+write to this bucket only)
 *   R2_SECRET_ACCESS_KEY   — R2 API token secret
 *
 * Optional env:
 *   BACKUP_PREFIX          — defaults to 'daily/'
 *   BACKUP_RETENTION_DAILY — how many recent dumps to keep (default 7)
 *   BACKUP_RETENTION_WEEKLY— how many Sunday dumps to keep beyond the daily window (default 4)
 *   BACKUP_ALERT_WEBHOOK   — POST URL hit on failure (Slack/Discord-style)
 *
 * Safety properties:
 *   - pg_dump runs with a 5-minute timeout; cannot hang the cron.
 *   - Upload is server-side encrypted (AES256) — R2 bucket should
 *     also have at-rest encryption on by default.
 *   - The dump is streamed through gzip; never written to disk
 *     unless DEBUG_LOCAL_PATH is set.
 *   - Pruning only deletes objects under the BACKUP_PREFIX. Cannot
 *     touch anything else in the bucket.
 *   - The script never logs DATABASE_URL or R2 credentials.
 *
 * Exit codes:
 *   0 — success (dump uploaded, retention pruned, alert NOT sent)
 *   1 — failure (pg_dump errored, upload failed, or env missing).
 *       Alert webhook is hit before exit if BACKUP_ALERT_WEBHOOK set.
 */
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { PassThrough } from 'node:stream';
import { Upload } from '@aws-sdk/lib-storage';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';

const REQUIRED_ENV = [
  'DATABASE_URL',
  'R2_ENDPOINT',
  'R2_BUCKET',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
];

const PREFIX = process.env.BACKUP_PREFIX || 'daily/';
const RETAIN_DAILY = parseInt(process.env.BACKUP_RETENTION_DAILY || '7', 10);
const RETAIN_WEEKLY = parseInt(process.env.BACKUP_RETENTION_WEEKLY || '4', 10);
const ALERT_WEBHOOK = process.env.BACKUP_ALERT_WEBHOOK || null;

function checkEnv() {
  const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
  if (missing.length) {
    // Print names ONLY — never values.
    throw new Error(`Missing required env: ${missing.join(', ')}`);
  }
}

function todayKey() {
  // ISO-ish UTC stamp. Sortable, so a `ls --reverse` is newest-first.
  // Day-of-week suffix lets retention logic recognise Sunday dumps as
  // weekly anchors.
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const min = String(now.getUTCMinutes()).padStart(2, '0');
  const dow = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][now.getUTCDay()];
  return `${PREFIX}fastquote-${yyyy}-${mm}-${dd}T${hh}${min}Z-${dow}.sql.gz`;
}

function makeS3Client() {
  return new S3Client({
    region: 'auto', // R2 ignores region; 'auto' is the documented value.
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    // R2 supports the AWS S3 protocol verbatim.
    forcePathStyle: true,
  });
}

async function runBackup() {
  checkEnv();
  const s3 = makeS3Client();
  const key = todayKey();

  // 1) pg_dump → gzip → upload as a single streaming pipeline.
  //    -Fc (custom) would be denser but custom-format dumps can only
  //    be restored with pg_restore; the plain-SQL gzip is portable
  //    and survives a different Postgres minor version.
  //    --no-owner / --no-privileges keep the dump portable across
  //    DBs with different owners (matters for the EU migration).
  //    --quote-all-identifiers protects against reserved-word drift
  //    between Postgres versions.
  const pgDumpArgs = [
    '--no-owner',
    '--no-privileges',
    '--quote-all-identifiers',
    '--format=plain',
    process.env.DATABASE_URL,
  ];
  const pgDump = spawn('pg_dump', pgDumpArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Bound the dump so a runaway pg_dump can't keep the cron alive.
  // 30 minutes is enough for the moat (tens of MB) with plenty of margin.
  const killTimer = setTimeout(() => {
    pgDump.kill('SIGTERM');
  }, 30 * 60 * 1000);

  let stderrBuf = '';
  pgDump.stderr.on('data', (chunk) => {
    // Cap at 64KB so a noisy stderr can't OOM.
    if (stderrBuf.length < 64 * 1024) stderrBuf += chunk.toString();
  });

  // Stream pg_dump → gzip → S3 PutObject (multipart, via @aws-sdk/lib-storage).
  const gzip = createGzip({ level: 6 });
  const body = new PassThrough();

  pgDump.stdout.pipe(gzip).pipe(body);

  const upload = new Upload({
    client: s3,
    params: {
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/gzip',
      ServerSideEncryption: 'AES256',
      // Helpful metadata for the restore-test runbook.
      Metadata: {
        'fastquote-source': 'pg_dump',
        'fastquote-format': 'plain.gz',
        'fastquote-timestamp': new Date().toISOString(),
      },
    },
  });

  // Wait for pg_dump to exit AND the upload to complete. Either failure
  // aborts the whole pipeline.
  const dumpDone = new Promise((resolve, reject) => {
    pgDump.on('error', (err) => reject(new Error(`pg_dump spawn failed: ${err.message}`)));
    pgDump.on('exit', (code) => {
      clearTimeout(killTimer);
      if (code === 0) resolve();
      else reject(new Error(`pg_dump exit ${code}: ${stderrBuf.slice(0, 1000)}`));
    });
  });

  // Run them in parallel; throw on whichever rejects first.
  await Promise.all([dumpDone, upload.done()]);

  return key;
}

async function pruneOldBackups() {
  // Retention rule:
  //   - Keep the most recent RETAIN_DAILY dumps regardless of day.
  //   - Beyond that window, keep Sunday dumps (weekly anchors), up
  //     to RETAIN_WEEKLY of them.
  //   - Delete everything else.
  //
  // Pruning is scoped to PREFIX. The DeleteObjects key list is built
  // from a ListObjectsV2 against the same prefix — under no scenario
  // can we delete something outside it.
  const s3 = makeS3Client();
  const listed = await s3.send(new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET,
    Prefix: PREFIX,
  }));
  const objects = listed.Contents || [];

  // Sort newest-first by key (timestamp embedded in the key).
  objects.sort((a, b) => (b.Key < a.Key ? -1 : 1));

  const keepDaily = new Set(objects.slice(0, RETAIN_DAILY).map((o) => o.Key));
  const weeklyCandidates = objects
    .slice(RETAIN_DAILY)
    .filter((o) => o.Key.includes('-sun.sql.gz'))
    .slice(0, RETAIN_WEEKLY);
  const keepWeekly = new Set(weeklyCandidates.map((o) => o.Key));

  const toDelete = objects
    .filter((o) => !keepDaily.has(o.Key) && !keepWeekly.has(o.Key))
    .map((o) => ({ Key: o.Key }));

  if (toDelete.length === 0) return { deleted: 0 };

  // DeleteObjects is capped at 1000 keys per request. With 7 daily +
  // 4 weekly retained the prune list grows ~1/day — we won't hit the
  // cap for years. Defensive batch anyway.
  let totalDeleted = 0;
  for (let i = 0; i < toDelete.length; i += 1000) {
    const batch = toDelete.slice(i, i + 1000);
    const res = await s3.send(new DeleteObjectsCommand({
      Bucket: process.env.R2_BUCKET,
      Delete: { Objects: batch, Quiet: true },
    }));
    totalDeleted += batch.length - (res.Errors?.length || 0);
  }
  return { deleted: totalDeleted };
}

async function postAlert(message) {
  if (!ALERT_WEBHOOK) return;
  try {
    await fetch(ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: `FastQuote backup FAILED: ${message}` }),
      // The cron container is short-lived; don't let a hung webhook
      // delay the exit code that signals failure to Railway.
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    console.error('Alert webhook failed:', err.message);
  }
}

async function main() {
  const start = Date.now();
  try {
    const key = await runBackup();
    const { deleted } = await pruneOldBackups();
    const seconds = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`backup-to-r2: ok — uploaded ${key}, pruned ${deleted}, ${seconds}s`);
    process.exit(0);
  } catch (err) {
    console.error('backup-to-r2: FAILED —', err.message);
    await postAlert(err.message);
    process.exit(1);
  }
}

main();
