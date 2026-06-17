#!/usr/bin/env node
/**
 * TRQ-153 (follow-up) — Stream an R2 backup object to stdout.
 *
 * Why this exists: `docs/STAGING.md` documents the staging-seed flow as
 *
 *   node scripts/download-r2-backup.js --r2-key daily/<key>.sql.gz |
 *     gunzip -c |
 *     node scripts/sanitise-prod-dump.js |
 *     psql "$STAGING_DATABASE_URL"
 *
 * — but the helper didn't exist as a standalone yet. This is it. The
 * three other scripts (`backup-to-r2.js`, `restore-test.js`,
 * `sanitise-prod-dump.js`) all read R2 env vars the same way; this one
 * matches that contract so the pipeline composes cleanly.
 *
 * Streaming semantics matter:
 *   - The object can be ~300 MB. We pipe straight from R2 → stdout
 *     without buffering. The consumer can gunzip / sanitise / restore
 *     concurrently.
 *   - All progress / log output goes to **stderr** so it doesn't
 *     contaminate the stdout SQL stream.
 *   - On error, partial output may already be on stdout (the consumer
 *     will fail downstream). Exit code is non-zero so a `set -e` wrapper
 *     catches the failure.
 *
 * Usage:
 *   node scripts/download-r2-backup.js                         # newest in daily/
 *   node scripts/download-r2-backup.js --r2-key daily/<k>.sql.gz
 *   node scripts/download-r2-backup.js --output /tmp/d.sql.gz  # write to file instead of stdout
 *   node scripts/download-r2-backup.js --list                  # list daily/, exit 0
 *
 * Env (required unless --list):
 *   R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_PREFIX (optional, defaults to 'daily/')
 *
 * Exit codes:
 *   0 — object streamed successfully (or listed successfully)
 *   1 — download failed
 *   2 — config / env missing or invalid args
 */
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

function parseArgs(argv) {
  const out = { r2Key: null, output: null, list: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--r2-key') out.r2Key = argv[++i];
    else if (a === '--output') out.output = argv[++i];
    else if (a === '--list') out.list = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/download-r2-backup.js [--r2-key <key>] [--output <path>] [--list]');
      process.exit(0);
    } else {
      console.error(`download-r2-backup: unknown arg: ${a}`);
      process.exit(2);
    }
  }
  return out;
}

function checkEnv() {
  const required = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(`download-r2-backup: missing env: ${missing.join(', ')}`);
    process.exit(2);
  }
}

function makeS3Client() {
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });
}

async function listDaily(s3) {
  const prefix = process.env.R2_PREFIX || 'daily/';
  const r = await s3.send(new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET,
    Prefix: prefix,
  }));
  const objects = (r.Contents || []).filter((o) => o.Key.endsWith('.sql.gz'));
  // Filename embeds an ISO-style timestamp so lexical sort matches
  // chronological sort. Newest first.
  objects.sort((a, b) => (b.Key < a.Key ? -1 : 1));
  return objects;
}

async function main() {
  const args = parseArgs(process.argv);
  checkEnv();
  const s3 = makeS3Client();

  // --list: print the daily/ contents to stdout (this is the one case
  // where stdout is informational, not data).
  if (args.list) {
    const objects = await listDaily(s3);
    if (objects.length === 0) {
      console.error(`No backups found under ${process.env.R2_PREFIX || 'daily/'} in ${process.env.R2_BUCKET}`);
      process.exit(1);
    }
    for (const o of objects) {
      const sizeMb = (o.Size / 1024 / 1024).toFixed(2).padStart(8);
      console.log(`${o.LastModified.toISOString()}  ${sizeMb} MB  ${o.Key}`);
    }
    process.exit(0);
  }

  // Pick the key — explicit --r2-key wins; otherwise newest.
  let key = args.r2Key;
  if (!key) {
    const objects = await listDaily(s3);
    if (objects.length === 0) {
      console.error(`No backups found under ${process.env.R2_PREFIX || 'daily/'} in ${process.env.R2_BUCKET}`);
      process.exit(1);
    }
    key = objects[0].Key;
    console.error(`download-r2-backup: picked newest: ${key}`);
  } else {
    console.error(`download-r2-backup: streaming ${key}`);
  }

  // Fetch + stream. Body is a Web ReadableStream in modern node; we
  // pipe it through stream/promises#pipeline so backpressure works
  // correctly against either stdout or a file.
  const obj = await s3.send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
  }));

  const dest = args.output ? createWriteStream(args.output) : process.stdout;
  try {
    await pipeline(obj.Body, dest);
    if (args.output) {
      console.error(`download-r2-backup: ok — wrote ${args.output}`);
    } else {
      console.error(`download-r2-backup: ok — streamed ${key} to stdout`);
    }
    process.exit(0);
  } catch (err) {
    // EPIPE is the normal "downstream closed early" case — don't treat
    // it as a stack-trace-worthy error. Anything else is a real fault.
    if (err.code === 'EPIPE' || err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      console.error(`download-r2-backup: downstream closed early (${err.code}) — partial stream`);
      process.exit(1);
    }
    console.error(`download-r2-backup: FAILED — ${err.message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`download-r2-backup: FAILED — ${err.message}`);
  process.exit(1);
});
