import express from 'express';
import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import https from 'https';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import rateLimit from 'express-rate-limit';

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

    // Agent runs table — tracks every agentic AI loop execution
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        job_id TEXT REFERENCES jobs(id) ON DELETE SET NULL,
        agent_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running',
        input_summary JSONB,
        output_summary JSONB,
        error TEXT,
        model TEXT,
        prompt_tokens INTEGER,
        completion_tokens INTEGER,
        duration_ms INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_type ON agent_runs(agent_type);
      CREATE INDEX IF NOT EXISTS idx_agent_runs_created ON agent_runs(created_at DESC);
    `);

    // Calibration notes table — proposed/approved calibration adjustments
    await client.query(`
      CREATE TABLE IF NOT EXISTS calibration_notes (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        field_type TEXT NOT NULL,
        field_label TEXT NOT NULL,
        note TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'proposed',
        proposed_by TEXT,
        approved_by TEXT REFERENCES users(id),
        evidence JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        approved_at TIMESTAMPTZ
      );
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
  callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
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
    <div class="footer"><a href="/privacy" style="color:#4a4640;text-decoration:none">Privacy</a> &middot; <a href="/terms" style="color:#4a4640;text-decoration:none">Terms</a></div>
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

// --- Legal pages ---

const LEGAL_PAGE_STYLE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'IBM Plex Sans', sans-serif; background: #1a1714; color: #f0ede8; min-height: 100vh; }
  .wrap { max-width: 680px; margin: 0 auto; padding: 40px 24px 60px; }
  .brand { font-family: 'Barlow Condensed', sans-serif; font-size: 26px; font-weight: 800; color: #e8a838; letter-spacing: 0.05em; text-decoration: none; }
  h1 { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 28px; margin: 32px 0 8px; color: #f0ede8; }
  h2 { font-family: 'Barlow Condensed', sans-serif; font-weight: 700; font-size: 20px; margin: 28px 0 8px; color: #f0ede8; }
  p, li { font-size: 14px; line-height: 1.7; color: #b5ae9e; margin-bottom: 12px; }
  ul { padding-left: 20px; margin-bottom: 16px; }
  .updated { font-size: 12px; color: #4a4640; margin-bottom: 24px; }
  a { color: #e8a838; text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

app.get('/privacy', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>FastQuote &mdash; Privacy Policy</title><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet"><style>${LEGAL_PAGE_STYLE}</style></head><body><div class="wrap">
  <a href="/" class="brand">FASTQUOTE</a>
  <h1>Privacy Policy</h1>
  <p class="updated">Last updated: April 2026</p>

  <h2>What we collect</h2>
  <p>When you use FastQuote, we collect and store:</p>
  <ul>
    <li>Your name, email address, and business details (company name, phone, address)</li>
    <li>Job photographs you upload for AI analysis</li>
    <li>Quote data including measurements, materials, labour estimates, and generated documents</li>
    <li>Learning data: the differences between AI suggestions and your confirmed values</li>
  </ul>

  <h2>How we use it</h2>
  <p>Your data is used solely to provide the FastQuote quoting service. Specifically:</p>
  <ul>
    <li>To generate, store, and retrieve your quotes</li>
    <li>To improve the AI's accuracy over time using anonymised learning data</li>
    <li>To authenticate your account</li>
  </ul>

  <h2>Who can see your data</h2>
  <p>Only you. Your data is completely isolated from other users. No other FastQuote user can access your quotes, photos, or business details.</p>

  <h2>Third parties</h2>
  <ul>
    <li><strong>Anthropic</strong> &mdash; your job photographs are sent to Anthropic's Claude API for AI analysis. Photos are processed and not retained by Anthropic beyond the API request.</li>
    <li><strong>Railway</strong> &mdash; our hosting provider. Your data is stored on Railway's infrastructure.</li>
    <li><strong>Google</strong> &mdash; used for sign-in authentication only. We receive your name and email.</li>
  </ul>

  <h2>What we don't do</h2>
  <ul>
    <li>We do not sell your data</li>
    <li>We do not use advertising or tracking</li>
    <li>We do not share your data with anyone beyond the services listed above</li>
  </ul>

  <h2>Data retention</h2>
  <p>Your data is retained until you request its deletion. You can request access to or deletion of all your data at any time.</p>

  <h2>Your rights</h2>
  <p>You have the right to access, correct, or delete your personal data. To exercise these rights, contact Harry at the email address provided during onboarding.</p>

  <h2>Contact</h2>
  <p>For privacy questions, contact the FastQuote team via the email used during your invitation.</p>
  </div></body></html>`);
});

app.get('/terms', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>FastQuote &mdash; Terms of Service</title><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet"><style>${LEGAL_PAGE_STYLE}</style></head><body><div class="wrap">
  <a href="/" class="brand">FASTQUOTE</a>
  <h1>Terms of Service</h1>
  <p class="updated">Last updated: April 2026</p>

  <h2>What FastQuote is</h2>
  <p>FastQuote is an AI-assisted quoting tool for tradespeople. It helps you generate professional quotes from job photographs. It is provided as a free, invite-only service.</p>

  <h2>Access</h2>
  <p>Access to FastQuote is by invitation only. We reserve the right to withdraw access at any time without notice. There is no guarantee of continued availability.</p>

  <h2>Your responsibility</h2>
  <p>You are solely responsible for the accuracy of any quote you send to a client. FastQuote provides AI-generated suggestions that you must review, confirm, and adjust before issuing. Every measurement and cost figure must be verified by you before the quote leaves the system.</p>

  <h2>Limitation of liability</h2>
  <p>FastQuote is not liable for errors in AI-generated content, including incorrect measurements, material estimates, labour calculations, or any other suggested values. The AI is a tool to assist your professional judgement, not a replacement for it.</p>

  <h2>Your data</h2>
  <p>You retain ownership of all data you enter into FastQuote. See our <a href="/privacy">Privacy Policy</a> for how we handle your data.</p>

  <h2>Acceptable use</h2>
  <p>You agree to use FastQuote only for its intended purpose: generating professional quotes for legitimate trade work. You must not attempt to access other users' data or interfere with the service.</p>

  <h2>Changes to terms</h2>
  <p>We may update these terms from time to time. Continued use of FastQuote after changes constitutes acceptance of the updated terms.</p>

  <h2>Governing law</h2>
  <p>These terms are governed by the laws of England and Wales.</p>
  </div></body></html>`);
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

app.put('/api/users/:id/jobs/:jobId', async (req, res) => {
  try {
    const { profile, jobDetails, reviewData, diffs, quotePayload, quoteSequence } = req.body;
    const totals = quotePayload?.totals;
    const quoteSnapshot = { profile, jobDetails, reviewData, diffs, quotePayload, quoteSequence };

    const { rowCount } = await pool.query(
      `UPDATE jobs SET saved_at = NOW(), client_name = $1, site_address = $2,
       quote_reference = $3, quote_date = $4, total_amount = $5, quote_snapshot = $6
       WHERE id = $7 AND user_id = $8`,
      [
        jobDetails?.clientName || '',
        jobDetails?.siteAddress || '',
        jobDetails?.quoteReference || '',
        jobDetails?.quoteDate || '',
        totals?.total ?? 0,
        JSON.stringify(quoteSnapshot),
        req.params.jobId,
        req.params.id,
      ]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Job not found' });
    res.json({ ok: true });
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
              decline_reason AS "declineReason",
              completion_feedback AS "completionFeedback"
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
    const { status, sentAt, expiresAt, acceptedAt, declinedAt, declineReason, completionFeedback } = req.body;
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
       accepted_at = $4, declined_at = $5, decline_reason = $6,
       completion_feedback = $7
       WHERE id = $8 AND user_id = $9`,
      [status, sentAt || null, expiresAt || null, acceptedAt || null,
       declinedAt || null, declineReason || null, completionFeedback || null,
       req.params.jobId, req.params.id]
    );

    // Fire feedback agent async when a job is completed with feedback
    if (status === 'completed' && completionFeedback) {
      (async () => {
        try {
          const { rows: jobRows } = await pool.query(
            'SELECT quote_snapshot FROM jobs WHERE id = $1',
            [req.params.jobId]
          );
          if (jobRows.length > 0 && jobRows[0].quote_snapshot) {
            await runFeedbackAgent({
              pool,
              userId: req.params.id,
              jobId: req.params.jobId,
              quoteSnapshot: jobRows[0].quote_snapshot,
              completionFeedback,
              completionNotes: req.body.completionNotes || '',
            });
            console.log(`[FeedbackAgent] Completed for job ${req.params.jobId}`);
          }
        } catch (err) {
          console.error(`[FeedbackAgent] Error for job ${req.params.jobId}:`, err.message);
        }
      })();
    }

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
      // Delete existing diffs for this job so re-generates replace them
      await client.query(
        'DELETE FROM quote_diffs WHERE job_id = $1 AND user_id = $2',
        [req.params.jobId, req.params.id]
      );
      let inserted = 0;
      for (const d of diffs) {
        await client.query(
          `INSERT INTO quote_diffs (
            job_id, user_id, field_type, field_label,
            ai_value, confirmed_value, was_edited, edit_magnitude,
            reference_card_used, stone_type, wall_height_mm, wall_length_mm,
            ai_accuracy_score, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
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
        inserted++;
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

// --- Admin User Management ---

app.get('/api/admin/users', requireAuth, requireAdminPlan, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT u.id, u.name, u.email, u.auth_provider, u.plan, u.profile_complete,
        u.last_login_at, u.created_at,
        (SELECT COUNT(*) FROM jobs WHERE user_id = u.id) AS job_count,
        (SELECT COUNT(*) FROM quote_diffs WHERE user_id = u.id) AS diff_count,
        (SELECT COUNT(*) FROM user_photos WHERE user_id = u.id) AS photo_count,
        (EXISTS (SELECT 1 FROM profiles WHERE user_id = u.id)) AS has_profile
      FROM users u ORDER BY u.created_at
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/users/:id/set-plan', requireAuth, requireAdminPlan, async (req, res) => {
  try {
    const { plan } = req.body;
    if (!['admin', 'basic'].includes(plan)) {
      return res.status(400).json({ error: 'Plan must be admin or basic' });
    }
    const { rowCount } = await pool.query('UPDATE users SET plan = $1 WHERE id = $2', [plan, req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true, id: req.params.id, plan });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/migrate-data', requireAuth, requireAdminPlan, async (req, res) => {
  const { fromUserId, toUserId } = req.body;
  if (!fromUserId || !toUserId) {
    return res.status(400).json({ error: 'fromUserId and toUserId required' });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Verify both users exist
    const fromUser = await client.query('SELECT id, name FROM users WHERE id = $1', [fromUserId]);
    const toUser = await client.query('SELECT id, name FROM users WHERE id = $1', [toUserId]);
    if (fromUser.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: `Source user '${fromUserId}' not found` }); }
    if (toUser.rows.length === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: `Target user '${toUserId}' not found` }); }

    // Migrate jobs
    const jobs = await client.query('UPDATE jobs SET user_id = $1 WHERE user_id = $2', [toUserId, fromUserId]);
    // Migrate quote_diffs
    const diffs = await client.query('UPDATE quote_diffs SET user_id = $1 WHERE user_id = $2', [toUserId, fromUserId]);
    // Migrate photos (skip duplicates — PK is user_id, context, slot)
    const photos = await client.query(`
      UPDATE user_photos SET user_id = $1
      WHERE user_id = $2
        AND (context, slot) NOT IN (SELECT context, slot FROM user_photos WHERE user_id = $1)
    `, [toUserId, fromUserId]);
    // Migrate profile (upsert — keep target's if exists, else move source's)
    const targetProfile = await client.query('SELECT 1 FROM profiles WHERE user_id = $1', [toUserId]);
    if (targetProfile.rows.length === 0) {
      await client.query('UPDATE profiles SET user_id = $1 WHERE user_id = $2', [toUserId, fromUserId]);
    }
    // Migrate drafts (upsert — keep target's if exists)
    const targetDraft = await client.query('SELECT 1 FROM drafts WHERE user_id = $1', [toUserId]);
    if (targetDraft.rows.length === 0) {
      await client.query('UPDATE drafts SET user_id = $1 WHERE user_id = $2', [toUserId, fromUserId]);
    }
    // Migrate settings
    await client.query('UPDATE settings SET user_id = $1 WHERE user_id = $2 AND key NOT IN (SELECT key FROM settings WHERE user_id = $1)', [toUserId, fromUserId]);

    await client.query('COMMIT');
    res.json({
      ok: true,
      from: { id: fromUserId, name: fromUser.rows[0].name },
      to: { id: toUserId, name: toUser.rows[0].name },
      migrated: {
        jobs: jobs.rowCount,
        diffs: diffs.rowCount,
        photos: photos.rowCount,
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Data migration error:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
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

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 529]);
const ANTHROPIC_MAX_RETRIES = 3;
const ANTHROPIC_RETRY_DELAYS = [1000, 2000, 4000]; // exponential backoff

function makeAnthropicRequest(body, apiKey) {
  return new Promise((resolve, reject) => {
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
        const chunks = [];
        proxyRes.on('data', (chunk) => chunks.push(chunk));
        proxyRes.on('end', () => {
          resolve({
            statusCode: proxyRes.statusCode,
            headers: proxyRes.headers,
            body: Buffer.concat(chunks).toString(),
          });
        });
        proxyRes.on('error', reject);
      }
    );
    proxyReq.on('timeout', () => {
      proxyReq.destroy(new Error('Request timed out'));
    });
    proxyReq.on('error', reject);
    proxyReq.write(body);
    proxyReq.end();
  });
}

const aiRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  keyGenerator: (req) => req.user?.id ?? req.ip,
  message: { error: 'Too many analyses. Please wait before trying again.' },
});

app.post('/api/anthropic/messages', aiRateLimit, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  const body = JSON.stringify(req.body);

  for (let attempt = 0; attempt < ANTHROPIC_MAX_RETRIES; attempt++) {
    try {
      const result = await makeAnthropicRequest(body, apiKey);

      if (RETRYABLE_STATUS_CODES.has(result.statusCode) && attempt < ANTHROPIC_MAX_RETRIES - 1) {
        const delay = result.statusCode === 429
          ? Math.max(ANTHROPIC_RETRY_DELAYS[attempt], parseInt(result.headers['retry-after'] || '0', 10) * 1000)
          : ANTHROPIC_RETRY_DELAYS[attempt];
        console.warn(`Anthropic returned ${result.statusCode}, retrying in ${delay}ms (attempt ${attempt + 1}/${ANTHROPIC_MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      res.status(result.statusCode);
      for (const [key, value] of Object.entries(result.headers)) {
        const lk = key.toLowerCase();
        if (lk !== 'transfer-encoding' && lk !== 'content-length') {
          res.setHeader(key, value);
        }
      }
      res.send(result.body);
      return;
    } catch (err) {
      if (attempt < ANTHROPIC_MAX_RETRIES - 1) {
        console.warn(`Anthropic proxy error: ${err.message}, retrying in ${ANTHROPIC_RETRY_DELAYS[attempt]}ms (attempt ${attempt + 1}/${ANTHROPIC_MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, ANTHROPIC_RETRY_DELAYS[attempt]));
        continue;
      }
      console.error('Anthropic proxy error after all retries:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: `Anthropic proxy error: ${err.message}` });
      }
      return;
    }
  }
});

// --- Admin Agent Observability Routes ---

app.get('/api/admin/agent-runs', requireAuth, requireAdminPlan, async (req, res) => {
  try {
    const { type, limit = 50 } = req.query;
    const params = [];
    let where = '';
    if (type) {
      params.push(type);
      where = `WHERE agent_type = $${params.length}`;
    }
    params.push(Math.min(parseInt(limit, 10) || 50, 250));
    const { rows } = await pool.query(
      `SELECT id, user_id, job_id, agent_type, status, input_summary, output_summary,
              error, model, prompt_tokens, completion_tokens, duration_ms, created_at
       FROM agent_runs ${where}
       ORDER BY created_at DESC
       LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/agent-runs/:runId', requireAuth, requireAdminPlan, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id, job_id, agent_type, status, input_summary, output_summary,
              error, model, prompt_tokens, completion_tokens, duration_ms, created_at
       FROM agent_runs WHERE id = $1`,
      [req.params.runId]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Agent run not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/admin/calibration-notes', requireAuth, requireAdminPlan, async (req, res) => {
  try {
    const { status } = req.query;
    const params = [];
    let where = '';
    if (status) {
      params.push(status);
      where = `WHERE cn.status = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT cn.*, u.name AS approved_by_name
       FROM calibration_notes cn
       LEFT JOIN users u ON cn.approved_by = u.id
       ${where}
       ORDER BY cn.created_at DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/admin/calibration-notes/:noteId', requireAuth, requireAdminPlan, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }
    const { rowCount } = await pool.query(
      `UPDATE calibration_notes
       SET status = $1, approved_by = $2, approved_at = ${status === 'approved' ? 'NOW()' : 'NULL'}
       WHERE id = $3`,
      [status, req.user.id, req.params.noteId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Calibration note not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin: trigger calibration agent run
app.post('/api/admin/calibration/run', requireAuth, requireAdminPlan, async (req, res) => {
  try {
    const { runId, proposals } = await runCalibrationAgent({
      pool,
      userId: req.user.id,
    });
    res.json({ ok: true, runId, proposals });
  } catch (err) {
    console.error('[CalibrationRun] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Public endpoint: approved calibration notes for system prompt assembly
app.get('/api/calibration-notes/approved', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT field_type, field_label, note, evidence, approved_at
       FROM calibration_notes
       WHERE status = 'approved'
       ORDER BY approved_at ASC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Server-side Analysis Endpoint (with self-critique) ---

import { runSelfCritique } from './agents/selfCritique.js';
import { runFeedbackAgent } from './agents/feedbackAgent.js';
import { runCalibrationAgent } from './agents/calibrationAgent.js';
import { callAnthropicRaw } from './agents/agentUtils.js';

app.post('/api/users/:id/analyse', aiRateLimit, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  const { systemPrompt, messages, model, max_tokens } = req.body;
  if (!systemPrompt || !messages) {
    return res.status(400).json({ error: 'systemPrompt and messages are required' });
  }

  try {
    // Fetch approved calibration notes and append to system prompt
    let augmentedPrompt = systemPrompt;
    try {
      const { rows: calNotes } = await pool.query(
        `SELECT field_type, field_label, note FROM calibration_notes WHERE status = 'approved' ORDER BY approved_at ASC`
      );
      if (calNotes.length > 0) {
        const dynamicSection = calNotes.map((n, i) =>
          `${i + 1}. [${n.field_type}/${n.field_label}] ${n.note}`
        ).join('\n');
        augmentedPrompt += `\n\nDYNAMIC CALIBRATION NOTES (auto-generated from completed job data):\n${dynamicSection}`;
      }
    } catch (err) {
      console.warn('[Analyse] Failed to load calibration notes:', err.message);
    }

    // Call 1: Primary analysis
    const analysisResponse = await callAnthropicRaw({
      systemPrompt: augmentedPrompt,
      messages,
      model: model || 'claude-sonnet-4-20250514',
      maxTokens: max_tokens || 4000,
      apiKey,
    });

    const rawText = analysisResponse.content?.[0]?.text || '';

    // Try to parse the analysis JSON
    let analysisJson = null;
    try {
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const toParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
      analysisJson = JSON.parse(toParse);
    } catch {
      // Return raw response if not parseable — let client handle it
      return res.json({
        content: [{ type: 'text', text: rawText }],
        usage: analysisResponse.usage,
        critiqueNotes: null,
      });
    }

    // Call 2: Self-critique (fire-and-forget safe — if it fails, return original)
    let finalAnalysis = analysisJson;
    let critiqueNotes = null;
    try {
      const critiqueResult = await runSelfCritique({
        pool,
        userId: req.params.id,
        jobId: null, // job not created yet at this point
        analysis: analysisJson,
        briefNotes: req.body.briefNotes || '',
      });
      finalAnalysis = critiqueResult.analysis;
      critiqueNotes = critiqueResult.critique;
    } catch (err) {
      console.warn('[SelfCritique] Failed, returning original analysis:', err.message);
    }

    // Return in same format as Anthropic API response for backward compatibility
    res.json({
      content: [{ type: 'text', text: JSON.stringify(finalAnalysis) }],
      usage: analysisResponse.usage,
      critiqueNotes,
    });
  } catch (err) {
    console.error('[Analyse] Error:', err.message);
    res.status(502).json({ error: `Analysis error: ${err.message}` });
  }
});

// --- Error handler for body-parser / payload too large ---

app.use((err, req, res, _next) => {
  if (err.type === 'entity.too.large') {
    console.error(`Payload too large on ${req.method} ${req.path}: ${err.message}`);
    return res.status(413).json({
      error: 'Request too large — try reducing the number or size of photos.',
    });
  }
  console.error(`Server error on ${req.method} ${req.path}:`, err.message);
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.status(500).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>FastQuote</title><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'IBM Plex Sans',sans-serif;background:#1a1714;color:#f0ede8;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px}.brand{font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:800;color:#e8a838;letter-spacing:.05em;margin-bottom:24px}h1{font-size:20px;font-weight:500;margin-bottom:8px}p{color:#999;font-size:14px;margin-bottom:24px}a{color:#e8a838;text-decoration:none;font-size:14px;padding:10px 24px;border:1px solid #3a3630;border-radius:8px;transition:all .15s}a:hover{border-color:#e8a838}</style></head><body><div class="brand">FASTQUOTE</div><h1>Something went wrong</h1><p>Please try again in a moment.</p><a href="/">Go to Dashboard</a></body></html>`);
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
