import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import https from 'https';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.set('trust proxy', 1); // trust first proxy (Railway)
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

      CREATE TABLE IF NOT EXISTS user_photos (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        context TEXT NOT NULL DEFAULT 'draft',
        slot TEXT NOT NULL,
        data TEXT NOT NULL,
        label TEXT,
        name TEXT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, context, slot)
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

    // TRQ-10: OAuth columns on users table + sessions table
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'local';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'basic';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN DEFAULT false;
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS session (
        sid    VARCHAR NOT NULL PRIMARY KEY,
        sess   JSON NOT NULL,
        expire TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS session_expire_idx ON session (expire);
    `);

    // quote_diffs table — learning engine (4.1b)
    await client.query(`
      CREATE TABLE IF NOT EXISTS quote_diffs (
        id                   TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        job_id               TEXT REFERENCES jobs(id) ON DELETE CASCADE,
        user_id              TEXT REFERENCES users(id) ON DELETE CASCADE,
        field_type           TEXT NOT NULL,
        field_label          TEXT NOT NULL,
        ai_value             TEXT NOT NULL,
        confirmed_value      TEXT NOT NULL,
        was_edited           BOOLEAN NOT NULL,
        edit_magnitude       DECIMAL(8,4),
        reference_card_used  BOOLEAN,
        stone_type           TEXT,
        wall_height_mm       INTEGER,
        wall_length_mm       INTEGER,
        ai_accuracy_score    DECIMAL(4,3),
        created_at           TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS quote_diffs_user_id_idx    ON quote_diffs (user_id);
      CREATE INDEX IF NOT EXISTS quote_diffs_field_type_idx ON quote_diffs (field_type, field_label);
      CREATE INDEX IF NOT EXISTS quote_diffs_was_edited_idx ON quote_diffs (was_edited);
      CREATE INDEX IF NOT EXISTS quote_diffs_created_at_idx ON quote_diffs (created_at DESC);
    `);

    // Add completion_feedback column (4.5)
    await client.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS completion_feedback TEXT;
    `);

    // Terminology migration: full→admin, standard→basic
    await client.query(`
      UPDATE users SET plan = 'admin' WHERE plan = 'full';
      UPDATE users SET plan = 'basic' WHERE plan = 'standard';
      ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'basic';
    `);

    // Bootstrap: mark and harry get admin plan and are already onboarded
    await client.query(`
      UPDATE users SET plan = 'admin', auth_provider = 'local', profile_complete = true
      WHERE id IN ('mark', 'harry');
    `);

    console.log('Database schema initialised, default users bootstrapped.');
  } finally {
    client.release();
  }
}

// --- Session + Passport ---

const PgSession = connectPgSimple(session);

app.use(session({
  store: new PgSession({
    pool,
    tableName: 'session',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 60, // prune expired sessions every hour
  }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  },
  name: 'tq_session',
}));

passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID || 'missing',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'missing',
  callbackURL: '/auth/google/callback',
},
async (accessToken, refreshToken, profile, done) => {
  try {
    const googleId = profile.id;
    const email = profile.emails?.[0]?.value ?? null;
    const name = profile.displayName ?? email ?? 'User';
    const avatar = profile.photos?.[0]?.value ?? null;

    // Existing user by Google ID
    const existing = await pool.query(
      'SELECT * FROM users WHERE auth_provider = $1 AND auth_provider_id = $2',
      ['google', googleId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        'UPDATE users SET last_login_at = NOW(), avatar_url = $1, email = COALESCE(email, $2) WHERE id = $3',
        [avatar, email, existing.rows[0].id]
      );
      return done(null, existing.rows[0]);
    }

    // New user — provision account with unique, URL-safe ID
    const baseId = (name || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20) || 'user';
    let userId = baseId;
    const clash = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (clash.rows.length > 0) {
      userId = `${baseId}_${Math.random().toString(36).slice(2, 6)}`;
    }

    const inserted = await pool.query(
      `INSERT INTO users (id, name, email, avatar_url, auth_provider, auth_provider_id,
        plan, profile_complete, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, 'google', $5, 'standard', false, NOW(), NOW())
       RETURNING *`,
      [userId, name, email, avatar, googleId]
    );
    return done(null, inserted.rows[0]);
  } catch (err) {
    return done(err, null);
  }
}));

passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    done(null, result.rows[0] ?? false);
  } catch (err) {
    done(err, null);
  }
});

app.use(passport.initialize());
app.use(passport.session());

// --- Auth Routes ---

app.get('/auth/google',
  passport.authenticate('google', {
    scope: ['openid', 'profile', 'email'],
    prompt: 'select_account',
  })
);

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=auth_failed' }),
  (req, res) => {
    if (!req.user.profile_complete) {
      return res.redirect('/?onboarding=true');
    }
    res.redirect('/');
  }
);

app.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy(() => {
      res.clearCookie('tq_session');
      res.redirect('/login');
    });
  });
});

app.get('/auth/me', async (req, res) => {
  // Google OAuth session
  if (req.user) {
    return res.json({
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        avatarUrl: req.user.avatar_url,
        plan: req.user.plan || 'standard',
        profileComplete: !!req.user.profile_complete,
      },
      legacy: false,
    });
  }
  // Legacy switcher session (Mark / Harry)
  if (req.session?.legacyUserId) {
    try {
      const r = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.legacyUserId]);
      const u = r.rows[0];
      if (!u) return res.json({ user: null });
      return res.json({
        user: {
          id: u.id,
          name: u.name,
          email: u.email,
          avatarUrl: u.avatar_url,
          plan: u.plan || 'standard',
          profileComplete: !!u.profile_complete,
        },
        legacy: true,
      });
    } catch {
      return res.json({ user: null });
    }
  }
  res.json({ user: null });
});

// Temporary legacy-session endpoint for Mark and Harry transition
const LEGACY_USERS = ['mark', 'harry'];
app.post('/api/session/legacy', (req, res) => {
  const { userId } = req.body || {};
  if (!LEGACY_USERS.includes(userId)) {
    return res.status(403).json({ error: 'Not a legacy user' });
  }
  req.session.legacyUserId = userId;
  res.json({ ok: true });
});

// --- Login page (static HTML served directly by Express) ---

const LOGIN_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FastQuote &mdash; Sign In</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'IBM Plex Sans', sans-serif;
      background: #1a1714;
      color: #f0ede8;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
    }
    .card {
      background: #222018;
      border: 1px solid #3a3630;
      border-radius: 14px;
      padding: 48px 40px;
      text-align: center;
      max-width: 400px;
      width: 90%;
    }
    .logo {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 32px;
      font-weight: 800;
      color: #e8a838;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .tagline { color: #7a6f5e; font-size: 14px; margin-bottom: 40px; }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 14px 28px;
      background: #fff;
      color: #1a1714;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      font-family: 'IBM Plex Sans', sans-serif;
      transition: background 0.15s;
      width: 100%;
    }
    .btn:hover { background: #f0ede8; }
    .error {
      color: #f87171;
      font-size: 13px;
      margin-bottom: 20px;
      padding: 10px 14px;
      background: rgba(248,113,113,0.08);
      border-radius: 6px;
      border: 1px solid rgba(248,113,113,0.2);
    }
    .footer { margin-top: 32px; font-size: 12px; color: #4a4640; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">FASTQUOTE</div>
    <div class="tagline">Professional quoting for tradespeople</div>
    \${ERROR_HTML}
    <a href="/auth/google" class="btn">
      <svg width="20" height="20" viewBox="0 0 48 48">
        <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      Sign in with Google
    </a>
    <div class="footer">Your data is private and never shared</div>
  </div>
</body>
</html>`;

app.get('/login', (req, res) => {
  if (req.isAuthenticated?.() || req.session?.legacyUserId) {
    return res.redirect('/');
  }
  const errorMsg = req.query.error === 'auth_failed'
    ? "<div class='error'>Sign-in failed. Please try again.</div>"
    : '';
  const html = LOGIN_PAGE_HTML.replace('${ERROR_HTML}', errorMsg);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// --- Landing page for unauthenticated visitors at / ---

const LANDING_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FastQuote &mdash; Professional Quoting for Tradespeople</title>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'IBM Plex Sans', sans-serif;
      background: #1a1714;
      color: #f0ede8;
      min-height: 100vh;
    }
    .nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 20px 32px;
      max-width: 1100px;
      margin: 0 auto;
    }
    .brand {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: 26px;
      font-weight: 800;
      color: #e8a838;
      letter-spacing: 0.05em;
      text-decoration: none;
    }
    .login-link {
      color: #f0ede8;
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      padding: 10px 24px;
      border: 1px solid #3a3630;
      border-radius: 8px;
      transition: all 0.15s;
    }
    .login-link:hover { border-color: #e8a838; color: #e8a838; }
    .hero {
      max-width: 700px;
      margin: 80px auto 0;
      text-align: center;
      padding: 0 24px;
    }
    h1 {
      font-family: 'Barlow Condensed', sans-serif;
      font-size: clamp(36px, 6vw, 56px);
      font-weight: 800;
      line-height: 1.1;
      margin-bottom: 20px;
    }
    h1 span { color: #e8a838; }
    .subtitle {
      font-size: 18px;
      color: #7a6f5e;
      line-height: 1.6;
      margin-bottom: 48px;
      max-width: 520px;
      margin-left: auto;
      margin-right: auto;
    }
    .cta {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 16px 36px;
      background: #e8a838;
      color: #1a1714;
      border-radius: 8px;
      text-decoration: none;
      font-weight: 600;
      font-size: 16px;
      font-family: 'IBM Plex Sans', sans-serif;
      transition: background 0.15s;
    }
    .cta:hover { background: #d49a30; }
    .features {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 24px;
      max-width: 900px;
      margin: 80px auto 60px;
      padding: 0 24px;
    }
    .feature {
      background: #222018;
      border: 1px solid #3a3630;
      border-radius: 12px;
      padding: 28px 24px;
    }
    .feature-icon { font-size: 28px; margin-bottom: 12px; }
    .feature h3 {
      font-family: 'Barlow Condensed', sans-serif;
      font-weight: 700;
      font-size: 18px;
      margin-bottom: 8px;
    }
    .feature p { color: #7a6f5e; font-size: 14px; line-height: 1.5; }
    .footer-bar {
      text-align: center;
      padding: 32px;
      font-size: 12px;
      color: #4a4640;
    }
  </style>
</head>
<body>
  <nav class="nav">
    <span class="brand">FASTQUOTE</span>
    <a href="/login" class="login-link">Log In</a>
  </nav>
  <div class="hero">
    <h1>Professional quotes<br>in <span>under 5 minutes</span></h1>
    <p class="subtitle">
      Upload photos of the job, get measurements and materials calculated,
      then review and send a polished quote your client can trust.
    </p>
    <a href="/login" class="cta">Get Started &rarr;</a>
  </div>
  <div class="features">
    <div class="feature">
      <div class="feature-icon">&#128247;</div>
      <h3>Photo Analysis</h3>
      <p>Upload site photos and get measurements, stone type, and damage assessment extracted automatically.</p>
    </div>
    <div class="feature">
      <div class="feature-icon">&#128200;</div>
      <h3>Accurate Costing</h3>
      <p>Materials, labour, and schedule of works calculated from real trade data. Every figure editable.</p>
    </div>
    <div class="feature">
      <div class="feature-icon">&#128196;</div>
      <h3>PDF Quotes</h3>
      <p>Generate professional, print-ready quotes with your branding. Download or email directly.</p>
    </div>
  </div>
  <div class="footer-bar">&copy; 2026 FastQuote</div>
</body>
</html>`;

app.get('/', (req, res, next) => {
  // Authenticated users get the React SPA
  if (req.isAuthenticated?.() || req.session?.legacyUserId) {
    return next();
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(LANDING_PAGE_HTML);
});

// --- Auth Middleware ---

function requireAuth(req, res, next) {
  // Test bypass — only active when NODE_ENV=test AND a header is provided
  if (process.env.NODE_ENV === 'test' && req.headers['x-test-user-id']) {
    req.user = {
      id: req.headers['x-test-user-id'],
      plan: req.headers['x-test-plan'] || 'admin',
    };
    return next();
  }
  // Google OAuth session
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  // Legacy switcher session
  if (req.session?.legacyUserId) {
    req.user = { id: req.session.legacyUserId, plan: 'admin' };
    return next();
  }
  res.status(401).json({ error: 'Not authenticated' });
}

function requireOwner(req, res, next) {
  const sessionUserId = req.user?.id;
  const routeUserId = req.params.id;
  if (sessionUserId !== routeUserId) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

function requireAdminPlan(req, res, next) {
  if (req.user?.plan !== 'admin') {
    return res.status(403).json({ error: 'This feature is not available on your plan.' });
  }
  next();
}

// Protect all user-scoped routes
app.use('/api/users/:id', requireAuth, requireOwner);

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
    // Also update users.profile_complete column so passport deserialization sees it
    if (req.params.key === 'profile_complete') {
      await pool.query(
        'UPDATE users SET profile_complete = $2 WHERE id = $1',
        [req.params.id, !!req.body.value]
      );
    }
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

app.put('/api/users/:id/jobs/:jobId/rams', requireAdminPlan, async (req, res) => {
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

app.put('/api/users/:id/jobs/:jobId/rams-not-required', requireAdminPlan, async (req, res) => {
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
    if (!['sent', 'accepted', 'declined', 'completed'].includes(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}. Must be sent, accepted, declined, or completed.` });
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

// --- Diffs Routes (Learning Engine 4.1b) ---

app.post('/api/users/:id/jobs/:jobId/diffs', async (req, res) => {
  try {
    const { diffs, aiAccuracyScore } = req.body;
    if (!Array.isArray(diffs)) {
      return res.status(400).json({ error: 'diffs must be an array' });
    }
    if (diffs.length === 0) {
      return res.json({ ok: true, inserted: 0 });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      for (const d of diffs) {
        const result = await client.query(
          `INSERT INTO quote_diffs (
            job_id, user_id, field_type, field_label,
            ai_value, confirmed_value, was_edited, edit_magnitude,
            reference_card_used, stone_type, wall_height_mm, wall_length_mm,
            ai_accuracy_score, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          ON CONFLICT DO NOTHING`,
          [
            req.params.jobId,
            req.params.id,
            d.fieldType,
            d.fieldLabel,
            String(d.aiValue),
            String(d.confirmedValue),
            !!d.wasEdited,
            d.editMagnitude ?? null,
            d.referenceCardUsed ?? null,
            d.stoneType ?? null,
            d.wallHeightMm ?? null,
            d.wallLengthMm ?? null,
            aiAccuracyScore ?? null,
            d.createdAt ? new Date(d.createdAt) : new Date(),
          ]
        );
        if (result.rowCount > 0) inserted++;
      }
      await client.query('COMMIT');
      res.json({ ok: true, inserted });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Admin Learning Dashboard (4.1g) ---

app.get('/api/admin/learning', requireAuth, requireAdminPlan, async (req, res) => {
  try {
    // Field bias
    const fieldBias = await pool.query(`
      SELECT field_type, field_label,
        COUNT(*) AS total,
        ROUND(AVG(CASE WHEN was_edited THEN 1.0 ELSE 0.0 END) * 100, 1) AS edit_rate_pct,
        ROUND(AVG(edit_magnitude) * 100, 1) AS avg_bias_pct,
        ROUND(AVG(ABS(edit_magnitude)) * 100, 1) AS avg_error_pct
      FROM quote_diffs
      WHERE field_type IN ('measurement','material_unit_cost','labour_days')
        AND edit_magnitude IS NOT NULL
      GROUP BY field_type, field_label
      ORDER BY edit_rate_pct DESC
    `);

    // Weekly accuracy trend
    const weeklyTrend = await pool.query(`
      SELECT DATE_TRUNC('week', created_at) AS week,
        ROUND(AVG(ai_accuracy_score), 3) AS avg_accuracy,
        COUNT(DISTINCT job_id) AS quote_count
      FROM quote_diffs
      WHERE ai_accuracy_score IS NOT NULL
      GROUP BY DATE_TRUNC('week', created_at)
      ORDER BY week DESC LIMIT 12
    `);

    // Reference card impact
    const refCardImpact = await pool.query(`
      SELECT reference_card_used,
        ROUND(AVG(CASE WHEN was_edited THEN 1.0 ELSE 0.0 END) * 100, 1) AS edit_rate_pct,
        COUNT(*) AS total
      FROM quote_diffs WHERE field_type = 'measurement'
      GROUP BY reference_card_used
    `);

    // Per-user accuracy
    const userAccuracy = await pool.query(`
      SELECT user_id,
        ROUND(AVG(ai_accuracy_score), 3) AS avg_accuracy,
        COUNT(DISTINCT job_id) AS quote_count
      FROM quote_diffs
      WHERE ai_accuracy_score IS NOT NULL
      GROUP BY user_id
    `);

    res.json({
      fieldBias: fieldBias.rows.map(r => ({
        ...r, total: Number(r.total),
        editRatePct: Number(r.edit_rate_pct), avgBiasPct: Number(r.avg_bias_pct),
        avgErrorPct: Number(r.avg_error_pct),
      })),
      weeklyTrend: weeklyTrend.rows.map(r => ({
        week: r.week, avgAccuracy: Number(r.avg_accuracy), quoteCount: Number(r.quote_count),
      })),
      refCardImpact: refCardImpact.rows.map(r => ({
        referenceCardUsed: r.reference_card_used, editRatePct: Number(r.edit_rate_pct),
        total: Number(r.total),
      })),
      userAccuracy: userAccuracy.rows.map(r => ({
        userId: r.user_id, avgAccuracy: Number(r.avg_accuracy), quoteCount: Number(r.quote_count),
        isOutlier: Number(r.avg_accuracy) < 0.4 && Number(r.quote_count) >= 3,
      })),
    });
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

// --- Photo Routes ---

app.put('/api/users/:id/photos/:context/:slot', async (req, res) => {
  try {
    const { data, label, name } = req.body;
    if (!data) return res.status(400).json({ error: 'data is required' });
    await pool.query(
      `INSERT INTO user_photos (user_id, context, slot, data, label, name, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id, context, slot)
       DO UPDATE SET data = $4, label = $5, name = $6, updated_at = NOW()`,
      [req.params.id, req.params.context, req.params.slot, data, label || null, name || null]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/users/:id/photos/:context', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT slot, data, label, name FROM user_photos WHERE user_id = $1 AND context = $2',
      [req.params.id, req.params.context]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id/photos/:context', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM user_photos WHERE user_id = $1 AND context = $2',
      [req.params.id, req.params.context]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/users/:id/photos/:context/:slot', async (req, res) => {
  try {
    await pool.query(
      'DELETE FROM user_photos WHERE user_id = $1 AND context = $2 AND slot = $3',
      [req.params.id, req.params.context, req.params.slot]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/users/:id/photos/copy', async (req, res) => {
  try {
    const { fromContext, toContext } = req.body;
    if (!fromContext || !toContext) {
      return res.status(400).json({ error: 'fromContext and toContext required' });
    }
    // Delete existing target photos first
    await pool.query(
      'DELETE FROM user_photos WHERE user_id = $1 AND context = $2',
      [req.params.id, toContext]
    );
    // Copy from source to target
    await pool.query(
      `INSERT INTO user_photos (user_id, context, slot, data, label, name, updated_at)
       SELECT user_id, $2, slot, data, label, name, NOW()
       FROM user_photos WHERE user_id = $1 AND context = $3`,
      [req.params.id, toContext, fromContext]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GDPR Routes ---

app.delete('/api/users/:id/data', async (req, res) => {
  try {
    const userId = req.params.id;
    // CASCADE handles profiles, settings, jobs, drafts, user_photos, quote_diffs
    await pool.query('DELETE FROM quote_diffs WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_photos WHERE user_id = $1', [userId]);
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
    const [profileRes, settingsRes, jobsRes, draftsRes, photosRes, diffsRes] = await Promise.all([
      pool.query('SELECT data FROM profiles WHERE user_id = $1', [userId]),
      pool.query('SELECT key, value FROM settings WHERE user_id = $1', [userId]),
      pool.query('SELECT quote_snapshot AS "quoteSnapshot", rams_snapshot AS "ramsSnapshot", saved_at AS "savedAt", client_name AS "clientName" FROM jobs WHERE user_id = $1', [userId]),
      pool.query('SELECT data FROM drafts WHERE user_id = $1', [userId]),
      pool.query('SELECT context, slot, label, name, updated_at AS "updatedAt" FROM user_photos WHERE user_id = $1', [userId]),
      pool.query('SELECT field_type, field_label, ai_value, confirmed_value, was_edited, edit_magnitude, created_at FROM quote_diffs WHERE user_id = $1', [userId]),
    ]);

    res.json({
      userId,
      exportedAt: new Date().toISOString(),
      profile: profileRes.rows.map(r => r.data),
      settings: settingsRes.rows,
      jobs: jobsRes.rows,
      drafts: draftsRes.rows.map(r => r.data),
      photos: photosRes.rows,
      diffs: diffsRes.rows,
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
      timeout: 150000, // 2.5 minutes — Anthropic with images can be slow
    },
    (proxyRes) => {
      res.status(proxyRes.statusCode);
      for (const [key, value] of Object.entries(proxyRes.headers)) {
        if (key.toLowerCase() !== 'transfer-encoding') {
          res.setHeader(key, value);
        }
      }
      proxyRes.on('error', (err) => {
        console.error('Anthropic response stream error:', err.message);
        if (!res.headersSent) {
          res.status(502).json({ error: `Anthropic response error: ${err.message}` });
        } else {
          res.end();
        }
      });
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('timeout', () => {
    console.error('Anthropic proxy request timed out after 150s');
    proxyReq.destroy(new Error('Request timed out'));
  });

  proxyReq.on('error', (err) => {
    console.error('Anthropic proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: `Anthropic proxy error: ${err.message}` });
    }
  });

  proxyReq.write(body);
  proxyReq.end();
});

// --- Error handler for body-parser / payload too large ---

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') {
    console.error(`Payload too large on ${req.method} ${req.path}: ${err.message}`);
    return res.status(413).json({
      error: 'Request too large — try reducing the number or size of photos.',
    });
  }
  next(err);
});

// --- Static Files + SPA Fallback ---

app.use(express.static(join(__dirname, 'dist')));

app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// --- Start Server ---

const PORT = process.env.PORT || 3000;

const dbReady = initDB()
  .then(() => {
    // Don't auto-listen when imported by test runner
    if (process.env.NODE_ENV !== 'test') {
      app.listen(PORT, () => {
        console.log(`FastQuote server running on port ${PORT}`);
      });
    }
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err);
    if (process.env.NODE_ENV !== 'test') process.exit(1);
  });

export { app, pool, dbReady };
