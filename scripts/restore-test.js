#!/usr/bin/env node
/**
 * TRQ-148 — Verify the latest R2 backup is actually restorable.
 *
 * "A backup you have never restored is not a backup — it's a hope."
 * This script proves the moat is recoverable BEFORE we rely on it
 * as the safety net for the EU migration.
 *
 * Pipeline:
 *   1. Pick a backup: --file <path> OR --r2-key <key> OR newest in R2.
 *   2. Download (if R2) into the host /tmp.
 *   3. Spin up a throwaway Postgres container (postgres:15) on a
 *      random ephemeral port. Container name is restore-test-<rand>.
 *   4. Wait for the container to be ready.
 *   5. Stream gunzip + psql restore INSIDE the container.
 *   6. Run scripts/check-moat.js --fresh against the restored DB.
 *   7. Tear the container down (unless --keep).
 *
 * HARD RULE — encoded mechanically, not just documented:
 *   The DATABASE_URL pointed at by this script is ALWAYS
 *   `postgres://restore-test:restore-test@localhost:<ephemeral>/postgres`.
 *   It can never accidentally resolve to a production host. If anything
 *   about that URL changes, the script refuses to run.
 *
 * Usage:
 *   node scripts/restore-test.js                                   # newest R2 backup
 *   node scripts/restore-test.js --file /path/to/dump.sql.gz       # local file
 *   node scripts/restore-test.js --r2-key daily/<key>.sql.gz       # specific R2 object
 *   node scripts/restore-test.js --keep                            # don't tear down
 *
 * R2 env vars (only required if reading from R2):
 *   R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
 *   R2_PREFIX (optional, defaults to 'daily/')
 *
 * Exit codes:
 *   0 — restore + moat check passed
 *   1 — restore failed OR moat check failed against the restored DB
 *   2 — config / setup error (Docker missing, env missing, etc.)
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, createWriteStream, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

const PG_IMAGE = 'postgres:15';
const SCRATCH_USER = 'restore-test';
const SCRATCH_PASS = 'restore-test';
const SCRATCH_DB = 'postgres';

function parseArgs(argv) {
  const out = { file: null, r2Key: null, keep: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--r2-key') out.r2Key = argv[++i];
    else if (a === '--keep') out.keep = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/restore-test.js [--file <path>|--r2-key <key>] [--keep]');
      process.exit(0);
    }
  }
  return out;
}

function check(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'ignore' });
  return r.status === 0;
}

function ephemeralPort() {
  // 49152–65535 is the IANA dynamic/private range. We don't probe for
  // free ports — docker will fail loudly if it's taken and we'll
  // retry / report.
  return 49152 + Math.floor(Math.random() * 16000);
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

async function pickNewestR2Backup(s3) {
  const prefix = process.env.R2_PREFIX || 'daily/';
  const r = await s3.send(new ListObjectsV2Command({
    Bucket: process.env.R2_BUCKET,
    Prefix: prefix,
  }));
  const objects = (r.Contents || []).filter((o) => o.Key.endsWith('.sql.gz'));
  if (objects.length === 0) {
    throw new Error(`No backups found under ${prefix} in bucket ${process.env.R2_BUCKET}`);
  }
  // Filename embeds an ISO-style timestamp so lexical sort matches
  // chronological sort.
  objects.sort((a, b) => (b.Key < a.Key ? -1 : 1));
  return objects[0].Key;
}

async function downloadFromR2(key) {
  const required = ['R2_ENDPOINT', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length) {
    throw new Error(`Missing R2 env: ${missing.join(', ')}`);
  }
  const s3 = makeS3Client();
  const objectKey = key || await pickNewestR2Backup(s3);
  console.log(`R2: downloading ${objectKey}…`);
  const obj = await s3.send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: objectKey,
  }));
  const dir = mkdtempSync(join(tmpdir(), 'fq-restore-'));
  const path = join(dir, 'backup.sql.gz');
  await pipeline(obj.Body, createWriteStream(path));
  const { size } = statSync(path);
  console.log(`R2: downloaded ${(size / 1024 / 1024).toFixed(2)} MB → ${path}`);
  return path;
}

async function spawnScratchPostgres() {
  if (!check('docker', ['version'])) {
    throw new Error('Docker is not available on this host. Install Docker Desktop and retry.');
  }
  const port = ephemeralPort();
  const name = `restore-test-${randomBytes(4).toString('hex')}`;
  console.log(`docker: starting ${PG_IMAGE} on port ${port} (name ${name})…`);
  const run = spawnSync('docker', [
    'run', '-d', '--rm',
    '--name', name,
    '-e', `POSTGRES_USER=${SCRATCH_USER}`,
    '-e', `POSTGRES_PASSWORD=${SCRATCH_PASS}`,
    '-e', `POSTGRES_DB=${SCRATCH_DB}`,
    '-p', `${port}:5432`,
    PG_IMAGE,
  ], { encoding: 'utf8' });
  if (run.status !== 0) {
    throw new Error(`docker run failed: ${run.stderr}`);
  }
  // Wait for pg_isready inside the container.
  for (let i = 0; i < 30; i++) {
    const ready = spawnSync('docker', ['exec', name, 'pg_isready', '-U', SCRATCH_USER, '-q']);
    if (ready.status === 0) {
      console.log(`docker: ${name} ready on :${port}`);
      return { name, port };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Postgres container ${name} never became ready (30s)`);
}

function tearDown(name) {
  if (!name) return;
  console.log(`docker: stopping ${name}…`);
  spawnSync('docker', ['stop', name], { stdio: 'ignore' });
}

async function restoreInto(name, dumpPath) {
  // Stream gunzip → docker exec psql so we don't have to copy the
  // whole dump into the container's tmpfs. ON_ERROR_STOP fails fast on
  // any SQL error so we don't end up with a half-restored DB.
  console.log(`restore: streaming ${dumpPath} into ${name}…`);
  return new Promise((resolve, reject) => {
    const gz = spawn('gunzip', ['-c', dumpPath]);
    const psql = spawn('docker', [
      'exec', '-i', name,
      'psql',
      '-v', 'ON_ERROR_STOP=1',
      '-U', SCRATCH_USER,
      '-d', SCRATCH_DB,
      '--quiet',
    ], { stdio: ['pipe', 'inherit', 'pipe'] });

    gz.stdout.pipe(psql.stdin);

    let psqlErr = '';
    psql.stderr.on('data', (chunk) => {
      // Bound it. A noisy psql stderr (NOTICE lines on column types, etc.)
      // shouldn't OOM us.
      if (psqlErr.length < 32 * 1024) psqlErr += chunk.toString();
    });

    gz.on('error', reject);
    psql.on('error', reject);
    psql.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exit ${code}: ${psqlErr.slice(0, 2000)}`));
    });
  });
}

async function runMoatCheck(port) {
  // Same project's check-moat.js — exec it in --fresh mode (we don't
  // expect the prod floor on a freshly-restored DB; we just want to
  // confirm the schema is there and parseable).
  const databaseUrl = `postgres://${SCRATCH_USER}:${SCRATCH_PASS}@localhost:${port}/${SCRATCH_DB}`;
  // Mechanical hard rule: the host MUST be localhost. Anything else =
  // refuse to run. Catches a future copy-paste that swaps in a prod URL.
  if (!databaseUrl.includes('@localhost:')) {
    throw new Error('restore-test: refused to run check-moat against a non-localhost target');
  }
  console.log('check-moat: running --fresh against the restored DB…');
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['scripts/check-moat.js', '--fresh'], {
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    });
    proc.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`check-moat exited ${code}`));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv);
  let containerName;
  try {
    const dumpPath = args.file
      ? (() => {
          if (!statSync(args.file).isFile()) throw new Error(`Not a file: ${args.file}`);
          return args.file;
        })()
      : await downloadFromR2(args.r2Key);

    const scratch = await spawnScratchPostgres();
    containerName = scratch.name;

    await restoreInto(scratch.name, dumpPath);
    await runMoatCheck(scratch.port);

    if (args.keep) {
      console.log('--keep: container left running. Tear down manually:');
      console.log(`  docker stop ${scratch.name}`);
    } else {
      tearDown(scratch.name);
    }
    console.log('');
    console.log('✓ restore-test passed: backup restored cleanly, moat tables present.');
    process.exit(0);
  } catch (err) {
    console.error('restore-test: FAILED —', err.message);
    if (!args.keep) tearDown(containerName);
    process.exit(err.message.includes('Missing') || err.message.includes('Docker is not') ? 2 : 1);
  }
}

main();
