#!/usr/bin/env node
/**
 * TRQ-148 / TRQ-162 — Verify the latest R2 backup is actually restorable.
 *
 * "A backup you have never restored is not a backup — it's a hope."
 * This script proves the moat is recoverable BEFORE we rely on it
 * as the safety net for the EU migration.
 *
 * Two scratch-DB backends are supported:
 *   - Docker (default): spins up `postgres:18` on a random port.
 *   - `--no-docker`: spins up brew's `postgresql@18` cluster in
 *     /tmp via `initdb` + `pg_ctl`. Useful on hosts without Docker.
 *     The first TRQ-148 drill ran this path because Harry's Mac
 *     didn't (and may still not) have Docker installed.
 *
 * Pipeline:
 *   1. Pick a backup: --file <path> OR --r2-key <key> OR newest in R2.
 *   2. Download (if R2) into the host /tmp.
 *   3. Spin up a throwaway Postgres on a random ephemeral port.
 *   4. Wait for it to be ready.
 *   5. Stream gunzip + psql restore.
 *   6. Run scripts/check-moat.js --fresh against the restored DB.
 *   7. Tear it down (unless --keep).
 *
 * HARD RULE — encoded mechanically, not just documented:
 *   The DATABASE_URL pointed at by this script is ALWAYS
 *   `postgres://restore-test:restore-test@localhost:<ephemeral>/postgres`
 *   (Docker path) or `postgres://restore-test@localhost:<ephemeral>/postgres`
 *   (no-Docker path — trust auth on a Unix socket, no password needed).
 *   It can never accidentally resolve to a production host. If anything
 *   about that URL changes, the script refuses to run.
 *
 * Usage:
 *   node scripts/restore-test.js                                   # newest R2 backup (Docker)
 *   node scripts/restore-test.js --file /path/to/dump.sql.gz       # local file
 *   node scripts/restore-test.js --r2-key daily/<key>.sql.gz       # specific R2 object
 *   node scripts/restore-test.js --keep                            # don't tear down
 *   node scripts/restore-test.js --no-docker --file <path>         # use brew Postgres
 *
 * No-Docker env vars (only required with --no-docker):
 *   PG_BIN (default: /opt/homebrew/opt/postgresql@18/bin)
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
import { mkdtempSync, writeFileSync, createWriteStream, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
} from '@aws-sdk/client-s3';

const PG_IMAGE = 'postgres:18';
const SCRATCH_USER = 'restore-test';
const SCRATCH_PASS = 'restore-test';
const SCRATCH_DB = 'postgres';

// No-Docker path uses brew's postgresql@18 binaries by default. Caller
// can override via PG_BIN (e.g. an apt install, a CI machine, etc.).
const DEFAULT_PG_BIN = '/opt/homebrew/opt/postgresql@18/bin';

function parseArgs(argv) {
  const out = { file: null, r2Key: null, keep: false, noDocker: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') out.file = argv[++i];
    else if (a === '--r2-key') out.r2Key = argv[++i];
    else if (a === '--keep') out.keep = true;
    else if (a === '--no-docker') out.noDocker = true;
    else if (a === '--help' || a === '-h') {
      console.log('Usage: node scripts/restore-test.js [--file <path>|--r2-key <key>] [--keep] [--no-docker]');
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

// ───────── No-Docker scratch Postgres (brew postgresql@18) ─────────
//
// Same shape as the Docker path — spin up a throwaway cluster, return
// a { name, port, dataDir } handle, tear it down on exit. The "name"
// here is the data dir path (we don't have container names without
// Docker; the dir doubles as the identifier).

async function spawnScratchPostgresNoDocker() {
  const pgBin = process.env.PG_BIN || DEFAULT_PG_BIN;
  if (!check(join(pgBin, 'initdb'), ['--version'])) {
    throw new Error(
      `postgresql@18 binaries not found at ${pgBin}. Install with ` +
      `\`brew install postgresql@18\` or set PG_BIN to a directory ` +
      `containing initdb/pg_ctl/psql.`
    );
  }
  const port = ephemeralPort();
  const dataDir = mkdtempSync(join(tmpdir(), 'fq-restore-pg-'));
  // -k <dir> tells Postgres to put the Unix socket in dataDir (not
  // /tmp/.s.PGSQL.* where it could collide with brew's normal cluster).
  // -p <port> binds TCP localhost only (default). Trust auth means no
  // password — safe because nothing else can dial the socket dir.
  const log = join(dataDir, 'pg.log');
  console.log(`pg18: initdb in ${dataDir}…`);
  const init = spawnSync(join(pgBin, 'initdb'), [
    '-D', dataDir,
    '-U', SCRATCH_USER,
    '-E', 'UTF-8',
    '--locale=en_US.UTF-8',
    '--auth=trust',
  ], { encoding: 'utf8' });
  if (init.status !== 0) {
    throw new Error(`initdb failed: ${init.stderr || init.stdout}`);
  }
  console.log(`pg18: pg_ctl start on port ${port} (sock: ${dataDir})…`);
  const start = spawnSync(join(pgBin, 'pg_ctl'), [
    '-D', dataDir, '-l', log,
    '-o', `-p ${port} -k ${dataDir}`,
    'start',
  ], { encoding: 'utf8' });
  if (start.status !== 0) {
    throw new Error(`pg_ctl start failed: ${start.stderr || start.stdout}`);
  }
  for (let i = 0; i < 30; i++) {
    const ready = spawnSync(join(pgBin, 'pg_isready'),
      ['-h', dataDir, '-p', String(port), '-U', SCRATCH_USER, '-q']);
    if (ready.status === 0) {
      // initdb creates the 'postgres' database by default — no extra
      // createdb needed. If SCRATCH_DB were ever changed away from
      // 'postgres' this would need a createdb step.
      console.log(`pg18: ready on :${port}`);
      return { name: dataDir, port, dataDir, noDocker: true, pgBin };
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`pg18 cluster at ${dataDir} never became ready (30s)`);
}

function tearDownNoDocker(handle) {
  if (!handle || !handle.dataDir) return;
  console.log(`pg18: stopping ${handle.dataDir}…`);
  spawnSync(join(handle.pgBin, 'pg_ctl'),
    ['-D', handle.dataDir, '-m', 'immediate', 'stop'],
    { stdio: 'ignore' });
  try {
    rmSync(handle.dataDir, { recursive: true, force: true });
  } catch (err) {
    console.warn(`pg18: failed to remove ${handle.dataDir}: ${err.message}`);
  }
}

async function restoreInto(handle, dumpPath) {
  // Stream gunzip → psql so we don't have to copy the whole dump
  // into the container's tmpfs (Docker path) or rewrite it to disk
  // (no-Docker path). ON_ERROR_STOP fails fast on any SQL error so
  // we don't end up with a half-restored DB.
  //
  // `handle` shape:
  //   Docker: { name, port }
  //   No-Docker: { name, port, dataDir, noDocker: true, pgBin }
  const target = handle.noDocker ? handle.dataDir : handle.name;
  console.log(`restore: streaming ${dumpPath} into ${target}…`);
  return new Promise((resolve, reject) => {
    const gz = spawn('gunzip', ['-c', dumpPath]);
    const psql = handle.noDocker
      ? spawn(join(handle.pgBin, 'psql'), [
          '-h', handle.dataDir, '-p', String(handle.port),
          '-v', 'ON_ERROR_STOP=1',
          '-U', SCRATCH_USER,
          '-d', SCRATCH_DB,
          '--quiet',
        ], { stdio: ['pipe', 'inherit', 'pipe'] })
      : spawn('docker', [
          'exec', '-i', handle.name,
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

async function runMoatCheck(handle) {
  // Same project's check-moat.js — exec it in --fresh mode (we don't
  // expect the prod floor on a freshly-restored DB; we just want to
  // confirm the schema is there and parseable).
  //
  // Docker path uses password auth (postgres://user:pass@…).
  // No-Docker path uses trust auth on a Unix socket — no password.
  const databaseUrl = handle.noDocker
    ? `postgres://${SCRATCH_USER}@localhost:${handle.port}/${SCRATCH_DB}`
    : `postgres://${SCRATCH_USER}:${SCRATCH_PASS}@localhost:${handle.port}/${SCRATCH_DB}`;
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
  let handle = null;
  try {
    const dumpPath = args.file
      ? (() => {
          if (!statSync(args.file).isFile()) throw new Error(`Not a file: ${args.file}`);
          return args.file;
        })()
      : await downloadFromR2(args.r2Key);

    handle = args.noDocker
      ? await spawnScratchPostgresNoDocker()
      : await spawnScratchPostgres();

    await restoreInto(handle, dumpPath);
    await runMoatCheck(handle);

    if (args.keep) {
      if (handle.noDocker) {
        console.log(`--keep: cluster left running at ${handle.dataDir}:${handle.port}. Tear down manually:`);
        console.log(`  ${join(handle.pgBin, 'pg_ctl')} -D ${handle.dataDir} -m immediate stop`);
        console.log(`  rm -rf ${handle.dataDir}`);
      } else {
        console.log('--keep: container left running. Tear down manually:');
        console.log(`  docker stop ${handle.name}`);
      }
    } else {
      if (handle.noDocker) tearDownNoDocker(handle);
      else tearDown(handle.name);
    }
    console.log('');
    console.log('✓ restore-test passed: backup restored cleanly, moat tables present.');
    process.exit(0);
  } catch (err) {
    console.error('restore-test: FAILED —', err.message);
    if (!args.keep && handle) {
      if (handle.noDocker) tearDownNoDocker(handle);
      else tearDown(handle.name);
    }
    const setupErr = err.message.includes('Missing')
      || err.message.includes('Docker is not')
      || err.message.includes('postgresql@18 binaries not found');
    process.exit(setupErr ? 2 : 1);
  }
}

main();
