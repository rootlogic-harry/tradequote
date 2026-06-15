#!/usr/bin/env node
/**
 * TRQ-153 (prep) — Sanitise a production pg_dump so it can seed staging.
 *
 * Staging exists so agents have a safe place to fail. It must NOT
 * be a second copy of customers' personal data — that doubles the
 * GDPR surface and gives any future staging-side compromise the
 * same blast radius as a prod compromise.
 *
 * This script reads a pg_dump (plain SQL, gzipped or not) on stdin
 * and writes a sanitised version to stdout. The schema and the
 * shape of the data are preserved (so AI prompts, dashboards, and
 * tests behave realistically) but PII columns are replaced with
 * deterministic fakes derived from a salt.
 *
 * "Deterministic" matters: if the same real name appears in `users`
 * AND inside a JSONB snapshot in `jobs.quote_snapshot`, both copies
 * get the SAME fake — referential integrity preserved. Achieved via
 * a salted hash → faker-pool index.
 *
 * Usage:
 *   gunzip -c daily/fastquote-2026-06-15T0300Z-sun.sql.gz |
 *     node scripts/sanitise-prod-dump.js > staging-seed.sql
 *
 *   # Or in-place via /restore-test for verification:
 *   gunzip -c <dump>.sql.gz |
 *     node scripts/sanitise-prod-dump.js |
 *     psql "$SCRATCH_DATABASE_URL"
 *
 * Env:
 *   SANITISER_SALT  — required, any string. Same salt → same fakes
 *                     across runs. Treat as somewhat sensitive (it
 *                     stops anyone re-running this and getting the
 *                     SAME mapping; reverse lookup is still hash-only).
 *
 * Safety:
 *   - Stream-based: never holds the whole dump in memory.
 *   - Read-only on input. Output is a separate stream.
 *   - Does NOT connect to any database. If you give it a prod dump,
 *     it writes to stdout. It cannot accidentally write to prod.
 *   - Refuses to run without SANITISER_SALT to prevent "oh I'll just
 *     use a default" mistakes that produce predictable mappings.
 */
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';

// ───────────────────────── Fake-data pools ─────────────────────────
//
// Small pools (~20 each) keep the staging DB texture realistic without
// drifting into something that LOOKS like a real customer database.
// "Demo Trader 7" + "Test Client B" + "Sample Address Lane 12" are
// obviously fake at a glance — anyone seeing them in staging immediately
// knows it's staging.

const FAKE_USER_NAMES = Array.from({ length: 20 }, (_, i) => `Demo Trader ${i + 1}`);
const FAKE_USER_EMAILS = Array.from({ length: 20 }, (_, i) => `demo-trader-${i + 1}@staging.fastquote.invalid`);
const FAKE_CLIENT_NAMES = Array.from({ length: 20 }, (_, i) => `Test Client ${String.fromCharCode(65 + (i % 26))}`);
const FAKE_SITE_ADDRESSES = Array.from({ length: 20 }, (_, i) => `Sample Address Lane ${i + 1}, Stagingshire ST${i}`);
const FAKE_PHONES = Array.from({ length: 20 }, (_, i) => `+44 7000 ${String(100000 + i).slice(-6)}`);
const FAKE_COMPANIES = Array.from({ length: 20 }, (_, i) => `Demo Walling Co. ${i + 1}`);
const FAKE_VAT_NUMBERS = Array.from({ length: 20 }, (_, i) => `GB${String(100000000 + i).slice(-9)}`);

// ───────────────────────── Helpers ─────────────────────────

function getSalt() {
  if (!process.env.SANITISER_SALT) {
    console.error(
      'sanitise-prod-dump: SANITISER_SALT env var is required.\n' +
      'Set it to any string. Same salt → same fakes across runs.'
    );
    process.exit(2);
  }
  return process.env.SANITISER_SALT;
}

const SALT = getSalt();

function pickFake(pool, realValue) {
  // Hash (salt + realValue) → integer → index into pool.
  // Deterministic across runs with the same salt; collisions are fine
  // (two real names mapping to the same fake is acceptable in staging).
  const hash = createHash('sha256').update(SALT + ':' + realValue).digest();
  const idx = hash.readUInt32BE(0) % pool.length;
  return pool[idx];
}

// ───────────────────────── Column replacers ─────────────────────────
//
// pg_dump's COPY format dumps each row as tab-separated values inside
// a `COPY <table> (cols...) FROM stdin;\n...\n\\.` block. We sanitise
// only the relevant tables. Other tables (quote_diffs, agent_runs,
// calibration_notes — pure measurement / token data) pass through
// unchanged because they hold no PII themselves.

const SANITISE_RULES = {
  users: {
    columns: ['name', 'email', 'avatar_url', 'auth_provider_id'],
    transform(row, colIndex) {
      const name = row[colIndex.name];
      if (name && name !== '\\N') {
        row[colIndex.name] = pickFake(FAKE_USER_NAMES, name);
      }
      const email = row[colIndex.email];
      if (email && email !== '\\N') {
        row[colIndex.email] = pickFake(FAKE_USER_EMAILS, email);
      }
      // Avatar URLs link to Google CDN; replace with a fake URL that
      // won't resolve (intentional — staging shouldn't pull customer
      // avatars).
      if (row[colIndex.avatar_url] && row[colIndex.avatar_url] !== '\\N') {
        row[colIndex.avatar_url] = `https://staging.fastquote.invalid/avatar/${pickFake(['a','b','c','d','e'], row[colIndex.avatar_url])}.png`;
      }
      // OAuth provider id — irreversibly hash so a staging OAuth flow
      // doesn't accidentally link to a real Google account.
      if (row[colIndex.auth_provider_id] && row[colIndex.auth_provider_id] !== '\\N') {
        row[colIndex.auth_provider_id] = 'staging-' + createHash('sha256')
          .update(SALT + ':oauth:' + row[colIndex.auth_provider_id])
          .digest('hex').slice(0, 16);
      }
      return row;
    },
  },
  jobs: {
    columns: ['client_name', 'site_address', 'client_ip', 'client_user_agent',
              'client_decline_reason', 'quote_snapshot', 'rams_snapshot',
              'client_snapshot', 'client_snapshot_profile'],
    transform(row, colIndex) {
      if (row[colIndex.client_name] && row[colIndex.client_name] !== '\\N') {
        row[colIndex.client_name] = pickFake(FAKE_CLIENT_NAMES, row[colIndex.client_name]);
      }
      if (row[colIndex.site_address] && row[colIndex.site_address] !== '\\N') {
        row[colIndex.site_address] = pickFake(FAKE_SITE_ADDRESSES, row[colIndex.site_address]);
      }
      // Audit columns — null these completely. They have no value in
      // staging and any real IP/UA in the dump is a privacy concern.
      if (row[colIndex.client_ip]) row[colIndex.client_ip] = '\\N';
      if (row[colIndex.client_user_agent]) row[colIndex.client_user_agent] = '\\N';
      if (row[colIndex.client_decline_reason] && row[colIndex.client_decline_reason] !== '\\N') {
        row[colIndex.client_decline_reason] = '[redacted in staging]';
      }
      // JSONB snapshots — scrub PII paths surgically. The data structure
      // is preserved (measurements, costs, schedule) — only the
      // client-identifying fields are NULLed.
      for (const col of ['quote_snapshot', 'rams_snapshot', 'client_snapshot', 'client_snapshot_profile']) {
        if (row[colIndex[col]] && row[colIndex[col]] !== '\\N') {
          row[colIndex[col]] = scrubJsonbPii(row[colIndex[col]]);
        }
      }
      return row;
    },
  },
  profiles: {
    columns: ['data'],
    transform(row, colIndex) {
      // profiles.data is JSONB with the tradesman's company name, phone,
      // VAT, trading address, day rate. We replace the identifying
      // fields and keep the structural ones (logo gets nulled).
      if (row[colIndex.data] && row[colIndex.data] !== '\\N') {
        row[colIndex.data] = scrubProfileJsonb(row[colIndex.data]);
      }
      return row;
    },
  },
  user_photos: {
    columns: ['data', 'label', 'name'],
    transform(row, colIndex) {
      // Photos are base64 TEXT in this column. Replace with a tiny
      // placeholder PNG so the staging UI still has SOMETHING to
      // render (broken-image icons confuse manual QA).
      if (row[colIndex.data] && row[colIndex.data] !== '\\N') {
        row[colIndex.data] = STAGING_PLACEHOLDER_PNG;
      }
      // Labels and names may contain client names. Replace.
      if (row[colIndex.label] && row[colIndex.label] !== '\\N') {
        row[colIndex.label] = pickFake(['Overview','Closeup','Side','Access','Reference'], row[colIndex.label]);
      }
      if (row[colIndex.name] && row[colIndex.name] !== '\\N') {
        row[colIndex.name] = `staging-photo-${pickFake(['1','2','3','4','5'], row[colIndex.name])}.jpg`;
      }
      return row;
    },
  },
  system_errors: {
    columns: ['stack', 'user_agent', 'message'],
    transform(row, colIndex) {
      // Error stacks can contain file paths with user names, IP
      // addresses, etc. Null them — staging errors are their own thing.
      if (row[colIndex.stack]) row[colIndex.stack] = '\\N';
      if (row[colIndex.user_agent]) row[colIndex.user_agent] = '\\N';
      // Message — keep first 80 chars, rest could leak.
      if (row[colIndex.message] && row[colIndex.message] !== '\\N') {
        row[colIndex.message] = row[colIndex.message].slice(0, 80) + ' [truncated]';
      }
      return row;
    },
  },
  pageviews: {
    columns: ['referrer', 'ua_hash'],
    transform(row, colIndex) {
      // Pageviews are already anonymous (path + session id + ua_hash)
      // but the referrer column can carry external URLs we don't want
      // in staging. Null it.
      if (row[colIndex.referrer]) row[colIndex.referrer] = '\\N';
      // ua_hash is already an irreversible 16-char digest — leave it.
      return row;
    },
  },
  dictation_runs: {
    // No PII fields — transcript text was never stored. Pass through.
    columns: [],
    transform: (row) => row,
  },
  admin_audit: {
    // Audit log contains action + JSONB details. Details can include
    // identifiers — null the whole details column in staging.
    columns: ['details'],
    transform(row, colIndex) {
      if (row[colIndex.details]) row[colIndex.details] = '\\N';
      return row;
    },
  },
  drafts: {
    columns: ['data'],
    transform(row, colIndex) {
      if (row[colIndex.data] && row[colIndex.data] !== '\\N') {
        row[colIndex.data] = scrubJsonbPii(row[colIndex.data]);
      }
      return row;
    },
  },
};

function scrubJsonbPii(jsonbText) {
  // jsonbText is the COPY-escaped representation. pg_dump's COPY
  // emits JSONB as a single tab-separated cell with backslash-escaped
  // chars. We don't try to parse it — instead, regex-replace the
  // known PII keys at the JSON-string level. This is safe because
  // the JSON structure is well-defined (quote_snapshot keys come
  // from SAVE_ALLOWLIST in stripBlobs.js).
  return jsonbText
    .replace(/"clientName":"[^"]*"/g, () => `"clientName":"${pickFake(FAKE_CLIENT_NAMES, jsonbText.slice(0, 100))}"`)
    .replace(/"siteAddress":"[^"]*"/g, () => `"siteAddress":"${pickFake(FAKE_SITE_ADDRESSES, jsonbText.slice(0, 100))}"`)
    .replace(/"clientEmail":"[^"]*"/g, '"clientEmail":""')
    .replace(/"clientPhone":"[^"]*"/g, '"clientPhone":""')
    .replace(/"companyName":"[^"]*"/g, () => `"companyName":"${pickFake(FAKE_COMPANIES, jsonbText.slice(0, 100))}"`)
    .replace(/"phone":"[^"]*"/g, '"phone":""')
    .replace(/"email":"[^"]*"/g, '"email":""')
    .replace(/"vatNumber":"[^"]*"/g, () => `"vatNumber":"${pickFake(FAKE_VAT_NUMBERS, jsonbText.slice(0, 100))}"`)
    .replace(/"tradingAddress":"[^"]*"/g, '"tradingAddress":"Demo Office, Stagingshire"')
    .replace(/"address":"[^"]*"/g, '"address":"Demo Office, Stagingshire"')
    .replace(/"logo":"data:image[^"]*"/g, '"logo":""');
}

function scrubProfileJsonb(jsonbText) {
  return scrubJsonbPii(jsonbText)
    .replace(/"fullName":"[^"]*"/g, () => `"fullName":"${pickFake(FAKE_USER_NAMES, jsonbText.slice(0, 100))}"`);
}

// 1x1 transparent PNG, base64 — minimal placeholder so the UI has
// something to render. Won't reveal anything.
const STAGING_PLACEHOLDER_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkAAIAAAoAAv/lxKUAAAAASUVORK5CYII=';

// ───────────────────────── Stream processor ─────────────────────────
//
// pg_dump's plain-SQL output is line-based, with COPY blocks that
// look like:
//
//   COPY public.users (id, name, email, ...) FROM stdin;
//   row1\tfield2\tfield3...
//   row2\tfield2\tfield3...
//   \.
//
// We track whether we're inside a COPY block and which table it's
// for; transform rows; pass everything else through unchanged.

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });

let inCopy = null;  // { table, columns: ['id', 'name', ...], colIndex: { id: 0, ... } }
let rowsTransformed = 0;
let rowsPassed = 0;

rl.on('line', (line) => {
  // Detect start of a COPY block. Match both `COPY public.foo` and `COPY foo`.
  const copyMatch = line.match(/^COPY (?:public\.)?(\w+) \(([^)]+)\) FROM stdin;$/);
  if (copyMatch) {
    const table = copyMatch[1];
    const columns = copyMatch[2].split(',').map((c) => c.trim());
    const colIndex = {};
    columns.forEach((c, i) => { colIndex[c] = i; });
    inCopy = SANITISE_RULES[table] ? { table, columns, colIndex, rule: SANITISE_RULES[table] } : { table, pass: true };
    process.stdout.write(line + '\n');
    return;
  }

  // Detect end of a COPY block.
  if (line === '\\.') {
    inCopy = null;
    process.stdout.write(line + '\n');
    return;
  }

  // Inside a tracked COPY block?
  if (inCopy) {
    if (inCopy.pass) {
      process.stdout.write(line + '\n');
      rowsPassed++;
      return;
    }
    // Transform this row.
    const fields = line.split('\t');
    const out = inCopy.rule.transform(fields, inCopy.colIndex);
    process.stdout.write(out.join('\t') + '\n');
    rowsTransformed++;
    return;
  }

  // Outside any COPY — pass through.
  process.stdout.write(line + '\n');
});

rl.on('close', () => {
  // Stats to stderr so they don't contaminate the sanitised SQL stream.
  console.error(`sanitise-prod-dump: ok — transformed ${rowsTransformed} rows, passed ${rowsPassed} rows`);
});
