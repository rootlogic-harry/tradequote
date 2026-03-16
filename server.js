import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(express.json({ limit: '50mb' }));

// --- Postgres Pool ---

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

// --- Schema Init ---

async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        data JSONB NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS settings (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value JSONB,
        PRIMARY KEY (user_id, key)
      );

      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        saved_at TIMESTAMPTZ DEFAULT NOW(),
        client_name TEXT,
        site_address TEXT,
        quote_reference TEXT,
        quote_date TEXT,
        total_amount NUMERIC DEFAULT 0,
        has_rams BOOLEAN DEFAULT FALSE,
        quote_snapshot JSONB,
        rams_snapshot JSONB
      );

      CREATE TABLE IF NOT EXISTS drafts (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        saved_at TIMESTAMPTZ DEFAULT NOW(),
        data JSONB NOT NULL
      );
    `);

    // Bootstrap default users
    await client.query(`
      INSERT INTO users (id, name) VALUES ('mark', 'Mark')
      ON CONFLICT (id) DO NOTHING;
    `);
    await client.query(`
      INSERT INTO users (id, name) VALUES ('harry', 'Harry')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Add rams_not_required column if missing
    await client.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS rams_not_required BOOLEAN DEFAULT FALSE;
    `);

    // Add quote lifecycle columns
    await client.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'draft';
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS decline_reason TEXT;
    `);

    console.log('Database schema initialised, default users bootstrapped.');
  } finally {
    client.release();
  }
}

// --- User Registry Routes ---

app.get('/api/users', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, created_at AS "createdAt" FROM users ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, created_at AS "createdAt" FROM users WHERE id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json(null);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users', async (req, res) => {
  try {
    const { id, name } = req.body;
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });
    await pool.query(
      'INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = $2',
      [id, name]
    );
    res.json({ id, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Profile Routes ---

app.get('/api/users/:id/profile', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT data FROM profiles WHERE user_id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.json(null);
    res.json(rows[0].data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/profile', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO profiles (user_id, data) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET data = $2`,
      [req.params.id, JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Settings Routes ---

app.get('/api/users/:id/settings/:key', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT value FROM settings WHERE user_id = $1 AND key = $2',
      [req.params.id, req.params.key]
    );
    if (rows.length === 0) return res.json(null);
    res.json(rows[0].value);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/settings/:key', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = $3`,
      [req.params.id, req.params.key, JSON.stringify(req.body.value)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Theme Routes ---

app.get('/api/users/:id/theme', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM settings WHERE user_id = $1 AND key = 'theme'",
      [req.params.id]
    );
    if (rows.length === 0) return res.json(null);
    res.json(rows[0].value);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/theme', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1, 'theme', $2)
       ON CONFLICT (user_id, key) DO UPDATE SET value = $2`,
      [req.params.id, JSON.stringify(req.body.theme)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Quote Sequence Routes ---

app.get('/api/users/:id/quote-sequence', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT value FROM settings WHERE user_id = $1 AND key = 'quoteSequence'",
      [req.params.id]
    );
    if (rows.length === 0) return res.json(1);
    res.json(rows[0].value || 1);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/:id/quote-sequence/increment', async (req, res) => {
  try {
    // Get current value
    const { rows } = await pool.query(
      "SELECT value FROM settings WHERE user_id = $1 AND key = 'quoteSequence'",
      [req.params.id]
    );
    const current = (rows.length > 0 && rows[0].value) || 1;
    const next = current + 1;

    await pool.query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1, 'quoteSequence', $2)
       ON CONFLICT (user_id, key) DO UPDATE SET value = $2`,
      [req.params.id, JSON.stringify(next)]
    );
    res.json(next);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Job Routes ---

app.get('/api/users/:id/jobs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, saved_at AS "savedAt", client_name AS "clientName",
              site_address AS "siteAddress", quote_reference AS "quoteReference",
              quote_date AS "quoteDate", total_amount AS "totalAmount",
              has_rams AS "hasRams", rams_not_required AS "ramsNotRequired",
              quote_snapshot AS "quoteSnapshot",
              rams_snapshot AS "ramsSnapshot",
              status, sent_at AS "sentAt", expires_at AS "expiresAt",
              accepted_at AS "acceptedAt", declined_at AS "declinedAt",
              decline_reason AS "declineReason"
       FROM jobs WHERE user_id = $1 ORDER BY saved_at DESC`,
      [req.params.id]
    );
    // Add snapshot alias for backward compatibility
    const jobs = rows.map(r => ({
      ...r,
      totalAmount: Number(r.totalAmount),
      snapshot: r.quoteSnapshot,
    }));
    res.json(jobs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/:id/jobs', async (req, res) => {
  try {
    const {
      profile, jobDetails, photos, extraPhotos, reviewData, diffs,
      quotePayload, quoteSequence, aiRawResponse,
    } = req.body;

    const id = `sq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totals = quotePayload?.totals;

    const quoteSnapshot = {
      profile, jobDetails, photos, extraPhotos, reviewData,
      diffs, quotePayload, quoteSequence, aiRawResponse,
    };

    await pool.query(
      `INSERT INTO jobs (id, user_id, saved_at, client_name, site_address,
        quote_reference, quote_date, total_amount, has_rams, quote_snapshot)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, FALSE, $8)`,
      [
        id,
        req.params.id,
        jobDetails?.clientName || '',
        jobDetails?.siteAddress || '',
        jobDetails?.quoteReference || '',
        jobDetails?.quoteDate || '',
        totals?.total ?? 0,
        JSON.stringify(quoteSnapshot),
      ]
    );
    res.json({ id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id/jobs/:jobId', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, saved_at AS "savedAt", client_name AS "clientName",
              site_address AS "siteAddress", quote_reference AS "quoteReference",
              quote_date AS "quoteDate", total_amount AS "totalAmount",
              has_rams AS "hasRams", rams_not_required AS "ramsNotRequired",
              quote_snapshot AS "quoteSnapshot",
              rams_snapshot AS "ramsSnapshot",
              status, sent_at AS "sentAt", expires_at AS "expiresAt",
              accepted_at AS "acceptedAt", declined_at AS "declinedAt",
              decline_reason AS "declineReason"
       FROM jobs WHERE id = $1 AND user_id = $2`,
      [req.params.jobId, req.params.id]
    );
    if (rows.length === 0) return res.json(null);
    const job = rows[0];
    job.totalAmount = Number(job.totalAmount);
    job.snapshot = job.quoteSnapshot;
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id/jobs/:jobId', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM jobs WHERE id = $1 AND user_id = $2',
      [req.params.jobId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/jobs/:jobId/rams', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id FROM jobs WHERE id = $1 AND user_id = $2',
      [req.params.jobId, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: `Job ${req.params.jobId} not found` });
    }
    await pool.query(
      'UPDATE jobs SET rams_snapshot = $1, has_rams = $2 WHERE id = $3 AND user_id = $4',
      [JSON.stringify(req.body), !!req.body, req.params.jobId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/jobs/:jobId/rams-not-required', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id FROM jobs WHERE id = $1 AND user_id = $2',
      [req.params.jobId, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: `Job ${req.params.jobId} not found` });
    }
    const value = !!req.body.value;
    await pool.query(
      'UPDATE jobs SET rams_not_required = $1 WHERE id = $2 AND user_id = $3',
      [value, req.params.jobId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/jobs/:jobId/status', async (req, res) => {
  try {
    const { status, sentAt, expiresAt, acceptedAt, declinedAt, declineReason } = req.body;
    if (!['sent', 'accepted', 'declined'].includes(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}. Must be sent, accepted, or declined.` });
    }
    const { rows } = await pool.query(
      'SELECT id FROM jobs WHERE id = $1 AND user_id = $2',
      [req.params.jobId, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: `Job ${req.params.jobId} not found` });
    }
    await pool.query(
      `UPDATE jobs SET status = $1, sent_at = $2, expires_at = $3,
       accepted_at = $4, declined_at = $5, decline_reason = $6
       WHERE id = $7 AND user_id = $8`,
      [status, sentAt || null, expiresAt || null, acceptedAt || null,
       declinedAt || null, declineReason || null, req.params.jobId, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Draft Routes ---

app.get('/api/users/:id/drafts', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT data, saved_at AS "savedAt" FROM drafts WHERE user_id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.json(null);
    res.json(rows[0].data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/users/:id/drafts', async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO drafts (user_id, saved_at, data) VALUES ($1, NOW(), $2)
       ON CONFLICT (user_id) DO UPDATE SET saved_at = NOW(), data = $2`,
      [req.params.id, JSON.stringify(req.body)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id/drafts', async (req, res) => {
  try {
    await pool.query('DELETE FROM drafts WHERE user_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GDPR Routes ---

app.delete('/api/users/:id/data', async (req, res) => {
  try {
    const userId = req.params.id;
    // CASCADE handles profiles, settings, jobs, drafts
    await pool.query('DELETE FROM drafts WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM jobs WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM settings WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM profiles WHERE user_id = $1', [userId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id/export', async (req, res) => {
  try {
    const userId = req.params.id;
    const [profileRes, settingsRes, jobsRes, draftsRes] = await Promise.all([
      pool.query('SELECT data FROM profiles WHERE user_id = $1', [userId]),
      pool.query('SELECT key, value FROM settings WHERE user_id = $1', [userId]),
      pool.query('SELECT quote_snapshot AS "quoteSnapshot", rams_snapshot AS "ramsSnapshot", saved_at AS "savedAt", client_name AS "clientName" FROM jobs WHERE user_id = $1', [userId]),
      pool.query('SELECT data FROM drafts WHERE user_id = $1', [userId]),
    ]);

    res.json({
      userId,
      exportedAt: new Date().toISOString(),
      profile: profileRes.rows.map(r => r.data),
      settings: settingsRes.rows,
      jobs: jobsRes.rows,
      drafts: draftsRes.rows.map(r => r.data),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Anthropic Proxy Route ---

app.post('/api/anthropic/messages', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  const body = JSON.stringify(req.body);

  const proxyReq = https.request(
    {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode);
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (key.toLowerCase() !== 'transfer-encoding') {
          res.setHeader(key, value);
        }
      }
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    res.status(502).json({ error: `Anthropic proxy error: ${err.message}` });
  });

  proxyReq.write(body);
  proxyReq.end();
});

// --- Static Files + SPA Fallback ---

app.use(express.static(join(__dirname, 'dist')));

app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// --- Start Server ---

const PORT = process.env.PORT || 3000;

initDB()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`TradeQuote server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err);
    process.exit(1);
  });

export { app, pool };
