import express from 'express';
import pg from 'pg';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import https from 'https';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import rateLimit from 'express-rate-limit';
import { safeError, setSystemErrorLogger } from './safeError.js';
import {
  PRICE_GBP, TRIAL_DAYS,
  QUOTE_PACK_PRICE_PENCE, QUOTE_PACK_SIZE, QUOTE_PACK_DESCRIPTION,
  hasStripeKey,
  createCheckoutSession,
  createPortalSession,
  createQuotePackCheckoutSession,
  parseWebhookEvent,
  applySubscriptionEventToDb,
  applyQuotePackEventToDb,
  currentSubscriptionState,
  daysOfTrialRemaining,
} from './billing.js';
import { classifyAnalysisError } from './src/utils/friendlyError.js';
import { isTransientInfrastructureError } from './src/utils/transientError.js';
import { pickAllowedKeys } from './serverSaveAllowlist.js';
import multer from 'multer';
import { transcribe } from './src/utils/whisperClient.js';
import { processVideo } from './src/utils/videoProcessor.js';
import {
  isVideoAnalysisEnabledFromProcessEnv,
  VIDEO_DISABLED_MESSAGE,
} from './src/utils/videoAnalysisEnabled.js';
import { buildTradesmanProfileBlock } from './src/utils/tradesmanProfileBlock.js';
import {
  parseAIResponse,
  validateAIResponse,
  normalizeAIResponse,
  applyMeasurementPlausibilityBounds,
} from './src/utils/aiParser.js';
import { SYSTEM_PROMPT, computePromptVersion } from './prompts/systemPrompt.js';
import { computeFieldBiasFromRows } from './src/utils/computeFieldBias.js';
import { VideoProgressEmitter } from './src/utils/videoProgress.js';
import { renderQuotePdf, sanitiseQuoteHtml } from './pdfRenderer.js';
import { buildQuickbooksCSV } from './src/utils/quickbooksExport.js';
import { fileTypeFromFile } from 'file-type';
import {
  generateClientToken,
  computeClientTokenExpiry,
  isClientTokenExpired,
  CLIENT_TOKEN_TTL_DAYS,
} from './src/utils/clientToken.js';
import {
  renderClientPortal,
  renderTokenNotFound as renderPortalNotFound,
  renderTokenExpired as renderPortalExpired,
  renderServiceUnavailable as renderPortalServiceUnavailable,
} from './portalRenderer.js';
import {
  tokensToGbp,
  whisperBytesToGbp,
  getPriceMap,
} from './src/utils/anthropicPricing.js';
import { summariseWeightedAccuracy } from './src/utils/weightedAccuracy.js';
import {
  quotaGate,
  resolveQuotaState,
  FREE_QUOTES_LIMIT,
} from './src/utils/quotaGate.js';
import {
  generateReferralCode,
  normaliseReferralCode,
  validateRedemption,
  REFERRAL_REFEREE_BONUS,
  REFERRAL_REFERRER_REWARD,
} from './src/utils/referrals.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── Boot-time secret check (sec-audit H-3) ───────────────────────────
// Any of these missing in production = ship a known-broken app: cookie
// signing falls back to a public default, OAuth fails open, DB calls
// throw at first request. Fail-closed at boot so ops sees it instantly
// rather than us ending up with a forge-able session secret in prod.
const REQUIRED_PROD_ENV = [
  'SESSION_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'DATABASE_URL',
];
if (process.env.NODE_ENV === 'production') {
  const missing = REQUIRED_PROD_ENV.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `Refusing to start in production with missing secrets: ${missing.join(', ')}. ` +
      `Set them on the deploy platform.`
    );
  }
}

const app = express();
app.set('trust proxy', 1); // trust first proxy (Railway)

// --- Healthcheck (before any middleware — must respond fast for Railway) ---
//
// TRQ-155: actually probes the DB. The previous trivial
// `res.json({ status: 'ok' })` returned 200 even when Postgres was
// unreachable, which would have made any uptime monitor pointed at it
// say "up" during an outage.
//
// Cheap: one `SELECT 1` with a 2-second timeout. No AI calls, no
// heavy queries. The 2s upper bound is well under Railway's
// 60s healthcheckTimeout so a slow probe still passes.
//
// Returns 200 {status:'ok'} on a healthy DB, 503 {status:'degraded'}
// otherwise. The 503 payload carries a category ('timeout' vs
// 'unreachable') so a monitor's alert can distinguish slow PG from
// gone PG — useful triage signal at 3 AM.
//
// `pool` is declared further down with const, but this handler closes
// over it lazily — by the time any HTTP request hits the route, the
// pool is initialised.
app.get('/health', async (_req, res) => {
  const t0 = Date.now();
  try {
    await Promise.race([
      pool.query('SELECT 1'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('db-timeout')), 2000)
      ),
    ]);
    res.json({ status: 'ok', db: 'ok', latency_ms: Date.now() - t0 });
  } catch (err) {
    // Server-side log for diagnostics; client gets the category only.
    console.warn('[/health] DB probe failed:', err?.message || err);
    res.status(503).json({
      status: 'degraded',
      db: err?.message === 'db-timeout' ? 'timeout' : 'unreachable',
      latency_ms: Date.now() - t0,
    });
  }
});

// Analytics Phase 1 (2026-06-29) — small helpers used by the webhook
// handler to attribute pack_purchased / subscription_started events.
// Kept route-local since they only matter for the fan-out below; the
// recordEvent INSERT itself lives further down with the other event
// infrastructure.
function extractUserIdFromStripeEvent(event) {
  if (!event) return null;
  const obj = event.data?.object || {};
  if (event.type === 'checkout.session.completed') {
    return obj.metadata?.fastquote_user_id || obj.client_reference_id || null;
  }
  if (event.type?.startsWith('customer.subscription.')) {
    return obj.metadata?.fastquote_user_id || null;
  }
  if (event.type === 'payment_intent.succeeded') {
    return obj.metadata?.fastquote_user_id || null;
  }
  return null;
}
function extractPriceIdFromStripeEvent(event) {
  if (!event) return null;
  const obj = event.data?.object || {};
  // Subscription objects carry items.data[].price.id.
  if (event.type?.startsWith('customer.subscription.')) {
    return obj.items?.data?.[0]?.price?.id || null;
  }
  // Checkout sessions don't carry the price id directly; the metadata
  // we set at session creation is the most reliable source. Fall back
  // to null rather than guess.
  return obj.metadata?.fastquote_price_id || null;
}

// TRQ-150 — Stripe webhook. MUST be mounted BEFORE express.json so
// the raw body is available for HMAC signature verification. If we
// let express.json parse it first, Stripe's signature check fails
// every time. Body is small (Stripe events) so the per-route raw
// parser doesn't risk OOMing.
app.post('/api/billing/webhook',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    const signature = req.get('stripe-signature');
    if (!signature) {
      // Reject silently with 400; we don't want to leak whether the
      // endpoint exists to a probe.
      return res.status(400).json({ error: 'missing signature' });
    }
    let event;
    try {
      event = parseWebhookEvent(req.body, signature);
    } catch (err) {
      // Signature verification failed OR webhook secret missing.
      // Server-log it; client gets a generic 400.
      console.warn('[stripe webhook] verify failed:', err?.message || err);
      return res.status(400).json({ error: 'invalid signature' });
    }
    try {
      // Fan-out (2026-06-24): a single webhook secret handles both
      // subscription lifecycle (TRQ-150) AND one-time quote-pack
      // payments. Routing keys are disjoint:
      //   • applySubscriptionEventToDb cares about
      //     customer.subscription.* and invoice.payment_failed.
      //     It treats checkout.session.completed as subscription-mode
      //     only (sets users.subscription_status = 'active').
      //   • applyQuotePackEventToDb cares about
      //     checkout.session.completed (mode=payment +
      //     metadata.fastquote_product='quote_pack') and
      //     payment_intent.succeeded. It writes quote_purchases +
      //     bumps users.purchased_quotes.
      // The subscription handler ignores payment-mode checkouts
      // implicitly (no subscription id on the session). The quote-pack
      // handler ignores subscription events. They can't double-fire
      // on the same event.
      //
      // For a quote-pack checkout.session.completed, BOTH handlers
      // see the event:
      //   • applySubscriptionEventToDb checks session.mode and SKIPS
      //     payment-mode sessions entirely. This guard was added
      //     2026-06-25 after Harry's £9.99 pack purchase incorrectly
      //     promoted his subscription_status to 'active' — the previous
      //     "COALESCE keeps the existing value" claim was wrong (the
      //     'active' literal is non-null so COALESCE returns it
      //     regardless). See billing.js applySubscriptionEventToDb.
      //   • applyQuotePackEventToDb credits the pack.
      // Analytics Phase 1 — capture the prior subscription_status BEFORE
      // applySubscriptionEventToDb runs, so we can detect the FIRST
      // false→active transition for the subscription_started event.
      // Pitfall #17 (CLAUDE.md) reminds us COALESCE re-asserts 'active'
      // on every webhook redelivery — without this pre-read we'd fire
      // subscription_started on every status update.
      const subUserId = extractUserIdFromStripeEvent(event);
      let priorSubStatus = null;
      if (subUserId) {
        try {
          const { rows: subRows } = await pool.query(
            'SELECT subscription_status FROM users WHERE id = $1',
            [subUserId]
          );
          priorSubStatus = subRows[0]?.subscription_status ?? null;
        } catch (e) {
          // Best-effort — log and continue. If the read fails we just
          // won't fire subscription_started for this delivery (cheap cost).
          console.warn('[stripe webhook] prior-status read failed:', e?.message || e);
        }
      }

      const subResult = await applySubscriptionEventToDb(pool, event);
      let packResult = { applied: false };
      try {
        packResult = await applyQuotePackEventToDb(pool, event);
      } catch (err) {
        // Surface as 500 — Stripe will retry. Logging is best-effort.
        console.error('[stripe webhook] quote pack apply failed:', err?.message || err);
        return res.status(500).json({ error: 'apply failed' });
      }

      // Analytics Phase 1 — fire pack_purchased only when the webhook
      // actually credited a new pack (credited > 0). Redeliveries of
      // the same payment_intent dedupe at the SQL layer via the
      // UNIQUE stripe_payment_id; the credited count reflects that,
      // so we never double-fire on a Stripe retry.
      if (packResult.applied && packResult.credited > 0 && packResult.userId) {
        recordEvent('pack_purchased', packResult.userId, {
          pence: QUOTE_PACK_PRICE_PENCE,
        }).catch(() => {});
      }
      // Analytics Phase 1 — fire subscription_started ONLY when the
      // status genuinely flipped to 'active' from something else
      // (null, 'past_due', 'canceled', etc.). Stripe re-asserts
      // 'active' on every renewal webhook so we MUST gate on the
      // pre-read above. Status comes from subResult.status when the
      // handler set one explicitly. priceId is best-effort from the
      // event payload.
      if (
        subResult.applied
        && subResult.status === 'active'
        && priorSubStatus !== 'active'
        && subResult.userId
      ) {
        const priceId = extractPriceIdFromStripeEvent(event);
        recordEvent('subscription_started', subResult.userId, { priceId }).catch(() => {});
      }

      // 200 ACKs the event; Stripe stops retrying. Even if we couldn't
      // apply the event (e.g. unhandled type), ACK — otherwise Stripe
      // re-delivers the same event endlessly.
      res.json({
        received: true,
        applied: subResult.applied || packResult.applied,
      });
    } catch (err) {
      // Real failure (DB unreachable etc.) — 500 so Stripe retries.
      console.error('[stripe webhook] apply failed:', err?.message || err);
      res.status(500).json({ error: 'apply failed' });
    }
  }
);

app.use(express.json({ limit: '50mb' }));

// --- Security Headers ---
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '0'); // modern browsers — CSP replaces this
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  // sec-audit L-2 — HSTS in production. 2-year max-age with preload
  // tells browsers to never load tradequote-production.up.railway.app
  // over plain HTTP again. Skipped in dev so localhost still works.
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
  next();
});

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

    // TRQ-124: Client Portal columns — all additive. Once written,
    // client_snapshot + client_snapshot_profile are frozen (Do-Not-Touch).
    await client.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_token            TEXT UNIQUE;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_token_expires_at TIMESTAMPTZ;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_snapshot         JSONB;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_snapshot_profile JSONB;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_viewed_at        TIMESTAMPTZ;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_response         TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_response_at      TIMESTAMPTZ;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_decline_reason   TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_ip               TEXT;
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS client_user_agent       TEXT;
    `);
    // Partial index: only rows with an active token are indexed. Keeps
    // inserts cheap (draft jobs don't touch the index) and the GET /q/:token
    // lookup is still an index seek.
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_client_token ON jobs(client_token)
        WHERE client_token IS NOT NULL;
    `);

    // TRQ-10: OAuth columns on users table + sessions table
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT DEFAULT 'local';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider_id TEXT;
      -- TRQ-151: legal-acceptance audit trail. version + timestamp
      -- recorded at OAuth callback when a new user record is inserted.
      -- Existing users (Mark / Paul / Harry) stay NULL — we don't
      -- retroactively force them to re-accept because that would log
      -- them out, and they predate the formal text. New signups must
      -- carry these.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_version TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_version TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS privacy_accepted_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS dpa_accepted_version TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS dpa_accepted_at TIMESTAMPTZ;
      -- TRQ-150: Stripe subscription state. All nullable — users who
      -- predate billing stay NULL; new signups get trial_ends_at set
      -- by the OAuth callback. subscription_status mirrors Stripe's
      -- enum so a webhook delete or invoice failure is visible to
      -- the app immediately.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT UNIQUE;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS current_period_end TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT FALSE;
      -- TRQ-150: Stripe's customer.subscription.trial_will_end fires
      -- ~3 days before the trial ends. We capture the timestamp so the
      -- in-app banner can switch from "trial in progress" to "ends soon"
      -- without round-tripping to Stripe.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_will_end_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'basic';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_complete BOOLEAN DEFAULT false;
      -- Quota-based free tier (2026-06-22): replaces the time-based
      -- trial above with a 3-free-quote allowance. trial_ends_at stays
      -- in the schema for the next release window in case we need to
      -- roll back, but it is no longer read by the analyse gate.
      --   free_quotes_used: incremented atomically on a successful
      --     analyse call, keyed on a per-draft quote_token so retries
      --     and re-analyses don't double-charge. See free_quote_grants.
      --   comp_until: trusted-user override (Paul gets 6 months at
      --     deploy via a one-line UPDATE — see the PR body). Bypasses
      --     both the quota AND the subscription requirement.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS free_quotes_used INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS comp_until TIMESTAMPTZ;
      -- Referrals Phase 1 (2026-06-23): bonus quotes earned through
      -- referrals (referee gets +2 at signup; referrer gets +2 per
      -- referee who completes their first analysis). Read by the
      -- quotaGate as effectiveLimit = FREE_QUOTES_LIMIT + bonus.
      -- During an active comp the bonus is invisible (gate order:
      -- subscribed > comped > counter) so it simply accumulates and
      -- becomes spendable when the comp ends — no special handling.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus_free_quotes INTEGER NOT NULL DEFAULT 0;
      -- Pay-as-you-go quote pack (2026-06-24): separate bucket from
      -- free + bonus quotes. Tracked separately for analytics integrity
      -- (so we can answer "how many quotes were paid for?" with one
      -- column). quotaGate spends FREE first, then this — never burns a
      -- paid quote while a free one is available. Decremented atomically
      -- on a successful analyse call when the gate's reason was
      -- 'purchased-remaining'. NOT decremented on refund — refund policy
      -- is manual; see docs/REFUNDS.md.
      ALTER TABLE users ADD COLUMN IF NOT EXISTS purchased_quotes INTEGER NOT NULL DEFAULT 0;
    `);

    // free_quote_grants: per-(user, quote_token) record of which
    // analyse calls counted against the 3-free-quote allowance. The
    // SPA generates a UUID quoteToken when starting a new quote
    // (NEW_QUOTE / initial state); retries and re-analyses on the
    // same draft reuse it, so the unique key naturally collapses
    // double-counts. The video route uses `job:${jobId}` as a stable
    // token — same effect, no schema dependency on the draft.
    //
    // Why a dedicated table rather than reusing agent_runs:
    //   • agent_runs is on the do-not-touch moat list. Stashing a
    //     quoteToken in input_summary would technically mutate it,
    //     and the analytics queries don't expect that key.
    //   • This table is conceptually about billing/quota, not about
    //     agent execution. Separating concerns keeps the moat clean.
    await client.query(`
      CREATE TABLE IF NOT EXISTS free_quote_grants (
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        quote_token TEXT NOT NULL,
        counted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (user_id, quote_token)
      );
      CREATE INDEX IF NOT EXISTS idx_free_quote_grants_user
        ON free_quote_grants (user_id, counted_at DESC);
    `);

    // Referrals Phase 1 (2026-06-23): per-spec locked schema.
    //
    //  • referral_codes — one human-readable code per user (lazy).
    //    Paul's PAULJULY is seeded explicitly via a post-deploy SQL
    //    snippet so it bypasses the lazy generator.
    //
    //  • referrals — one row per (referrer, referee) pair. UNIQUE on
    //    referee so a user can only be referred once (first signup
    //    code wins; manual entry from a non-referred user works too).
    //    `first_analysis_at` is the trigger timestamp — the referrer
    //    earns +2 bonus quotes the first time the referee completes
    //    an analysis (not signup, not first payment). Per spec:
    //    single-level only (no cascading), no claw-back on churn.
    await client.query(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        code        TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (user_id)
      );
      CREATE TABLE IF NOT EXISTS referrals (
        id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        referrer_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        referee_user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
        code_used           TEXT NOT NULL,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        first_analysis_at   TIMESTAMPTZ,
        reward_credited_at  TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_user_id);
      CREATE INDEX IF NOT EXISTS idx_referrals_referee  ON referrals(referee_user_id);
    `);

    // Pay-as-you-go quote-pack audit table (2026-06-24).
    //
    //  • stripe_payment_id UNIQUE — webhook idempotency. Stripe
    //    redelivers events; the UNIQUE constraint + INSERT ... ON
    //    CONFLICT DO NOTHING means a double-fire credits exactly once.
    //  • amount_paid_pence — captured for audit / reconciliation. We
    //    DON'T compute the per-quote cost from this; QUOTE_PACK_SIZE
    //    is the canonical unit.
    //  • created_at — the source of truth for "when was this pack
    //    bought". Refund handling is manual (docs/REFUNDS.md) and
    //    doesn't write back here.
    await client.query(`
      CREATE TABLE IF NOT EXISTS quote_purchases (
        id                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        user_id           TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        stripe_payment_id TEXT NOT NULL UNIQUE,
        quotes_added      INTEGER NOT NULL,
        amount_paid_pence INTEGER NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_quote_purchases_user ON quote_purchases(user_id);
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

    // sec-audit I-2 — admin audit trail. Every privileged action
    // (set-plan, migrate-data, future admin tools) writes a row here.
    // Append-only: never UPDATE or DELETE except for retention pruning.
    await client.query(`
      CREATE TABLE IF NOT EXISTS admin_audit (
        id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        actor_id     TEXT REFERENCES users(id),
        action       TEXT NOT NULL,
        target_id    TEXT,
        details      JSONB,
        ip           TEXT,
        user_agent   TEXT,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_audit_actor ON admin_audit(actor_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_admin_audit_action ON admin_audit(action, created_at DESC);
    `);

    // Missing indexes for common query patterns
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_jobs_user_id ON jobs(user_id);
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
      -- Dashboard / Saved-Quotes list sorts by saved_at DESC; without this
      -- index Postgres does a seq-scan + sort on the whole jobs table.
      CREATE INDEX IF NOT EXISTS idx_jobs_user_saved_at ON jobs(user_id, saved_at DESC);
      CREATE INDEX IF NOT EXISTS idx_calibration_notes_status ON calibration_notes(status);
      CREATE INDEX IF NOT EXISTS idx_users_auth_provider ON users(auth_provider, auth_provider_id);
      -- Case-insensitive unique email index (2026-06-29, from auth spec).
      -- Prevents the bug-shape behind Pitfall #17: the same human signing
      -- up twice via different paths (e.g. Google + a future email flow,
      -- or two Google accounts with case-variant aliases) and creating
      -- duplicate user rows + duplicate Stripe customers. Partial WHERE
      -- excludes legacy session-switcher accounts that predate email
      -- (e.g. 'mark', 'harry' from the bootstrap inserts above).
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
        ON users (lower(email))
        WHERE email IS NOT NULL;
    `);

    // Add prompt_version column to jobs
    await client.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_version TEXT;
    `);

    // TRQ-176: prompt-length budget telemetry. The DYNAMIC CALIBRATION
    // NOTES section is appended to SYSTEM_PROMPT on every analyse call,
    // and grows unbounded as the calibration agent approves more notes.
    // After enough approved notes Sonnet's accuracy can degrade from
    // instruction overload with no visibility. `prompt_chars` is the
    // raw character count of the prompt (SYSTEM_PROMPT + appended
    // calibration section) stamped at save-time alongside prompt_version.
    // Additive only — never read load-bearingly; pure observability.
    await client.query(`
      ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_chars INTEGER;
    `);

    // Agent retry queue — exponential backoff for failed agent runs
    await client.query(`
      CREATE TABLE IF NOT EXISTS agent_retry_queue (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        agent_type TEXT NOT NULL,
        payload JSONB,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        last_error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        next_retry_at TIMESTAMPTZ NOT NULL
      );
    `);

    // Dictation telemetry — voice-to-text usage tracking
    await client.query(`
      CREATE TABLE IF NOT EXISTS dictation_runs (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        success BOOLEAN NOT NULL,
        latency_ms INTEGER,
        audio_bytes INTEGER,
        duration_ms INTEGER,
        transcript_chars INTEGER,
        failure_category TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Fix: if dictation_runs.user_id was created as INTEGER, drop and recreate
    // (table may have been created with wrong type in a prior deploy)
    const colCheck = await client.query(`
      SELECT data_type FROM information_schema.columns
      WHERE table_name = 'dictation_runs' AND column_name = 'user_id'
    `);
    if (colCheck.rows.length > 0 && colCheck.rows[0].data_type === 'integer') {
      console.warn('[initDB] dictation_runs.user_id is INTEGER — recreating table with TEXT');
      await client.query('DROP TABLE dictation_runs');
      await client.query(`
        CREATE TABLE dictation_runs (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          success BOOLEAN NOT NULL,
          latency_ms INTEGER,
          audio_bytes INTEGER,
          duration_ms INTEGER,
          transcript_chars INTEGER,
          failure_category TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
    }

    // TRQ-15 — General error capture. Every Express 5xx writes one row
    // here BEFORE safeError swaps the message for the generic client-
    // facing one, so we keep the real stack/message for the analytics
    // dashboard. user_id is nullable because errors can happen before
    // auth (e.g. OAuth callback failures).
    //
    // Retention is intentionally NOT trimmed in code — the row count
    // stays small for the foreseeable future. If it grows we'll add a
    // nightly truncate.
    await client.query(`
      CREATE TABLE IF NOT EXISTS system_errors (
        id SERIAL PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        source TEXT NOT NULL,
        route TEXT,
        status_code INTEGER,
        message TEXT NOT NULL,
        stack TEXT,
        user_agent TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_system_errors_created ON system_errors(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_system_errors_source ON system_errors(source);
    `);

    // TRQ-15 — Pageview telemetry for the landing page + SPA route
    // changes. Anonymous: only path/referrer/sha256-hashed UA/random
    // session-scoped ID. No IP, no fingerprint, no user_id unless the
    // beacon fires while the user is signed in (NULL otherwise). Honours
    // navigator.doNotTrack client-side. Public POST /api/track writes
    // here; /api/admin/analytics reads the daily aggregate.
    await client.query(`
      CREATE TABLE IF NOT EXISTS pageviews (
        id SERIAL PRIMARY KEY,
        path TEXT NOT NULL,
        referrer TEXT,
        ua_hash TEXT,
        session_id TEXT,
        user_id TEXT REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pageviews_created ON pageviews(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_pageviews_path ON pageviews(path);
    `);

    // Analytics Phase 1 (2026-06-29) — first-party event log. Parallel
    // to `pageviews` but for named funnel events (signup_completed,
    // quote_started, quote_analysed, pack_purchased, ...). The
    // event_name allowlist is enforced server-side at /api/event so
    // free-form names can't slip in and leak context. `props` is JSONB
    // for flexible per-event metadata; `user_id` is TEXT to match
    // users.id (Google "google-1234..." / legacy "mark"/"harry").
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        event_name TEXT NOT NULL,
        user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        session_id TEXT,
        path TEXT,
        props JSONB
      );
      CREATE INDEX IF NOT EXISTS idx_events_name_created ON events(event_name, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_user_created ON events(user_id, created_at DESC);
    `);

    // Migrate hardcoded calibration notes to DB (idempotent)
    const hardcodedNotes = [
      { fieldType: 'material_unit_cost', fieldLabel: 'Chapter 8 traffic management', note: 'If any photograph shows the wall is adjacent to a public carriageway, include a Chapter 8 traffic management line item (£380–450). This is a legal requirement for roadside works.' },
      { fieldType: 'measurement', fieldLabel: 'Foundation scope', note: 'When damage description indicates full-length foundation failure, the foundation excavation must cover the FULL wall length, not just the collapsed section.' },
      { fieldType: 'material_unit_cost', fieldLabel: 'Mortar specification', note: 'For natural sandstone/stone boundary walls requiring bedding and pointing, specify 1:1:6 cement-lime-sand mortar. Material cost: £130–165 for 10–14 linear metres.' },
      { fieldType: 'material_unit_cost', fieldLabel: 'Cherry Laurel planting', note: 'Cherry Laurel at 600–1000mm height: £38–50 per plant supply and plant. 12m run at 600mm centres ≈ 20 plants, £760–1,000 total.' },
      { fieldType: 'labour_days', fieldLabel: 'Mortar-pointed sandstone wall', note: '10–12 linear metres, 900mm height, full rebuild: 7–9 days for 2 operatives. 0.7–0.8 operative-days/metre. Benchmark: 2 operatives for 8 days (£6,400 at £400/day).' },
    ];
    for (const note of hardcodedNotes) {
      await client.query(
        `INSERT INTO calibration_notes (field_type, field_label, note, status, proposed_by)
         SELECT $1, $2, $3, 'approved', 'hardcoded-migration'
         WHERE NOT EXISTS (
           SELECT 1 FROM calibration_notes WHERE proposed_by = 'hardcoded-migration' AND field_label = $2
         )`,
        [note.fieldType, note.fieldLabel, note.note]
      );
    }

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
    // sec-audit L-1 — `auto` resolves to true when the connection is
    // HTTPS (in prod, Railway terminates TLS and we trust the
    // X-Forwarded-Proto header via app.set('trust proxy', 1)) and
    // false on local HTTP dev. Removes the previous NODE_ENV check
    // — same effect in prod, but no risk that a misset env var
    // silently sends session cookies over plain HTTP.
    secure: 'auto',
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
      // _isNewUser marker is consumed inside the /auth/google/callback
      // handler to decide whether to apply a referral. Existing users
      // are skipped (signup-time bonus only — a returning user can
      // still redeem via POST /auth/redeem-referral if they want to).
      const u = existing.rows[0];
      u._isNewUser = false;
      return done(null, u);
    }

    // New user — provision account with unique, URL-safe ID
    const baseId = (name || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 20) || 'user';
    let userId = baseId;
    const clash = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (clash.rows.length > 0) {
      // 32 bits from crypto.randomBytes. Math.random().toString(36)
      // only gives ~21 bits and two concurrent Google signups can
      // collide, erroring the second INSERT on the unique id.
      userId = `${baseId}_${crypto.randomBytes(4).toString('hex')}`;
    }

    // TRQ-151: record legal acceptance for new signups. By
    // completing Google OAuth they have accepted the current
    // versions of Terms, Privacy Policy, and DPA. Versions are
    // pinned at the moment of signup so the audit trail captures
    // exactly which text they agreed to.
    //
    // TRQ-150: start the 30-day no-card trial clock NOW. The trial
    // is FastQuote-side (not Stripe-side) because we don't collect a
    // card at signup. When the user later clicks Subscribe, Stripe
    // sees a subscription with no trial — the FastQuote-side clock
    // is already wound down by then.
    const inserted = await pool.query(
      `INSERT INTO users (id, name, email, avatar_url, auth_provider, auth_provider_id,
        plan, profile_complete, created_at, last_login_at,
        terms_accepted_version, terms_accepted_at,
        privacy_accepted_version, privacy_accepted_at,
        dpa_accepted_version, dpa_accepted_at,
        trial_ends_at, subscription_status)
       VALUES ($1, $2, $3, $4, 'google', $5, 'basic', false, NOW(), NOW(),
        $6, NOW(), $7, NOW(), $8, NOW(),
        NOW() + INTERVAL '30 days', 'trialing')
       RETURNING *`,
      [
        userId, name, email, avatar, googleId,
        LEGAL_VERSIONS.terms, LEGAL_VERSIONS.privacy, LEGAL_VERSIONS.dpa,
      ]
    );
    const newUser = inserted.rows[0];
    newUser._isNewUser = true;
    return done(null, newUser);
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

app.get('/auth/google', (req, res, next) => {
  // Referrals Phase 1 (2026-06-23): stash any incoming ?ref= code on
  // the session BEFORE Google's redirect so it survives the round-trip
  // back to our /auth/google/callback. The query string from the original
  // landing URL is lost by the time the user returns from Google.
  // Manual entry is handled separately via POST /auth/redeem-referral
  // (lets the user redeem retroactively if they already signed up).
  const refRaw = req.query?.ref;
  if (typeof refRaw === 'string' && refRaw.length > 0 && refRaw.length <= 64) {
    req.session.pendingReferralCode = refRaw;
  }
  return passport.authenticate('google', {
    scope: ['openid', 'profile', 'email'],
    prompt: 'select_account',
  })(req, res, next);
});

// `handleOauthFailure` is a 4-arg error middleware that Express treats as
// an error handler. If Passport blows up mid-callback (bad state param,
// session lost between /auth/google and this callback, network error
// talking to Google) we must NOT let the default 500 handler render —
// that leaves the user on an ugly error page with no route back. Instead
// we log the cause server-side and bounce to /login?error=oauth_failed,
// which shows a clear message plus the Sign-in button again.
function handleOauthFailure(err, req, res, _next) {
  console.warn(`[OAuth] callback error: ${err?.message || err}`);
  try { req.session?.destroy?.(() => {}); } catch {}
  // Railway DNS blips and Postgres restarts show up here as "session
  // store unreachable" — the user's Google credentials are fine, it's
  // our infrastructure that's hiccupping. Point them at a friendlier
  // message so they don't assume their Google account is broken (Mark
  // hit this during today's outage and thought he'd lost access).
  const reason = isTransientInfrastructureError(err) ? 'reconnecting' : 'oauth_failed';
  res.redirect(`/login?error=${reason}`);
}

app.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login?error=auth_failed' }),
  // sec-audit L-4 — regenerate the session on successful login so any
  // pre-login session id (planted via fixation) is invalidated. Passport
  // re-attaches req.user to the new session for us.
  //
  // Referrals Phase 1 (2026-06-23): `pendingReferralCode` was set on the
  // pre-login session in /auth/google. The regenerate() below blows that
  // session away, so we lift the code out FIRST and pass it through as
  // a local. Applying the referral happens after the user is logged in
  // (so we have a stable user.id) but before redirect.
  (req, res, next) => {
    const user = req.user;
    const pendingRef = req.session?.pendingReferralCode || null;
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        // Analytics Phase 1 — fire signup_completed. `wasNew` mirrors
        // the boolean used downstream for new-user routing, so the
        // funnel can separate first-login activations from returning
        // logins. Best-effort, swallowed internally.
        recordEvent('signup_completed', user.id, { wasNew: !!user?._isNewUser }).catch(() => {});
        // Best-effort: a failure here must NEVER block the login. The
        // referral helper logs and swallows internally.
        if (pendingRef && user?._isNewUser) {
          applyReferralAtSignup(user.id, pendingRef)
            .then((result) => {
              if (result?.applied) {
                // Analytics — fire referral_redeemed on the success
                // branch only. `referrerId` exposes downstream
                // attribution; `code` is the (already-normalised)
                // referral code, capped for safety.
                recordEvent('referral_redeemed', user.id, {
                  code: String(pendingRef).slice(0, 64),
                  referrerId: result.referrerUserId || null,
                }).catch(() => {});
              }
            })
            .catch((e) => console.warn('[Referrals] applyReferralAtSignup failed:', e.message))
            .finally(next);
        } else {
          next();
        }
      });
    });
  },
  (req, res) => {
    // TRQ-94: always land on the dashboard. The old `?onboarding=true`
    // branch fed into a full-page onboarding gate that has been removed
    // — the profile is now only required at the moment the customer is
    // about to see it (see ProfileGateModal in QuoteOutput).
    res.redirect('/');
  },
  handleOauthFailure,
);

/**
 * Referrals Phase 1 (2026-06-23) — shared validator/applier for a
 * referral code at signup. Called from /auth/google/callback (for the
 * `?ref=` URL path) and from POST /auth/redeem-referral (for the
 * manual-entry path). Both paths must:
 *
 *   1. Normalise the input (uppercase, trim, reject malformed).
 *   2. Look up the code in `referral_codes`.
 *   3. Reject self-referral (referrer === referee).
 *   4. INSERT into `referrals` (UNIQUE on referee → safe to retry).
 *   5. Set `users.bonus_free_quotes = 2` on the referee.
 *
 * All in one transaction so a partial state never appears.
 * Unknown / self / already-redeemed → returns
 * `{ applied: false, reason }` and does NOT throw. Callers fall
 * through to the default signup.
 */
async function applyReferralAtSignup(refereeUserId, rawCode) {
  const code = normaliseReferralCode(rawCode);
  if (!code) return { applied: false, reason: 'malformed' };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'SELECT code, user_id FROM referral_codes WHERE code = $1',
      [code]
    );
    const decision = validateRedemption({
      codeRow: rows[0] || null,
      userId: refereeUserId,
    });
    if (!decision.valid) {
      await client.query('ROLLBACK');
      return { applied: false, reason: decision.reason };
    }
    // INSERT — ON CONFLICT (referee_user_id) DO NOTHING guards against
    // double-redemption (manual entry after URL redemption, or two
    // concurrent callbacks).
    const ins = await client.query(
      `INSERT INTO referrals (referrer_user_id, referee_user_id, code_used)
       VALUES ($1, $2, $3)
       ON CONFLICT (referee_user_id) DO NOTHING
       RETURNING id`,
      [decision.referrerUserId, refereeUserId, code]
    );
    if (ins.rows.length === 0) {
      await client.query('ROLLBACK');
      return { applied: false, reason: 'already-redeemed' };
    }
    // Grant the +2 signup bonus. We additively set to MAX(current, 2)
    // so a previous code-less redeem-then-redeem can't double up.
    // In practice the ON CONFLICT above prevents that — this is belt-
    // and-braces.
    await client.query(
      `UPDATE users
          SET bonus_free_quotes = GREATEST(bonus_free_quotes, $2)
        WHERE id = $1`,
      [refereeUserId, REFERRAL_REFEREE_BONUS]
    );
    await client.query('COMMIT');
    return { applied: true, referrerUserId: decision.referrerUserId };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Referrals Phase 1 (2026-06-23) — first-analysis credit trigger.
 *
 * Called from BOTH analyse success paths (photo + video). Idempotent:
 *
 *   1. SELECT FOR UPDATE on the referee's row where
 *      `first_analysis_at IS NULL`. Locks the row so two concurrent
 *      analyses can't both think they're first.
 *   2. If a row matches (i.e. this user IS a referee and has not yet
 *      completed an analysis), stamp `first_analysis_at` +
 *      `reward_credited_at`, then bump the referrer's bonus by +2.
 *   3. The transaction-scoped FOR UPDATE + IS NULL predicate means
 *      the credit happens at most once even if two analyse calls
 *      somehow race to the success block.
 *
 * Failures are LOGGED but do NOT throw — the analyse response has
 * already been sent to the client by the time this runs.
 */
async function maybeCreditReferrerOnFirstAnalysis(refereeUserId) {
  if (!refereeUserId) return;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, referrer_user_id
         FROM referrals
        WHERE referee_user_id = $1
          AND first_analysis_at IS NULL
        FOR UPDATE`,
      [refereeUserId]
    );
    if (rows.length !== 1) {
      // Either not a referee, or already credited. No-op — ROLLBACK
      // (rather than COMMIT) keeps the resilience-test counter happy
      // and means we don't issue a trivial empty COMMIT in PG.
      await client.query('ROLLBACK');
      return;
    }
    const { id: referralId, referrer_user_id: referrerId } = rows[0];
    await client.query(
      `UPDATE referrals
          SET first_analysis_at = NOW(),
              reward_credited_at = NOW()
        WHERE id = $1`,
      [referralId]
    );
    await client.query(
      `UPDATE users
          SET bonus_free_quotes = bonus_free_quotes + $2
        WHERE id = $1`,
      [referrerId, REFERRAL_REFERRER_REWARD]
    );
    await client.query('COMMIT');
    console.log(`[Referrals] Credited referrer=${referrerId} for referee=${refereeUserId} (+${REFERRAL_REFERRER_REWARD})`);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    console.warn('[Referrals] credit failed for referee=' + refereeUserId + ':', err.message);
  } finally {
    client.release();
  }
}

/**
 * Lazy referral-code provisioner. Each user gets one code (UNIQUE
 * constraint on referral_codes.user_id). Paul's PAULJULY is seeded
 * explicitly via a post-deploy SQL snippet — that row already exists
 * by the time he loads the dashboard, so the SELECT below short-circuits
 * before hitting the generator.
 *
 * Conflict-retry: the generator picks a random 4-char suffix, so two
 * users with the same name prefix could collide. We retry up to 5
 * times before giving up (after which the caller logs and the UI
 * shows "code unavailable").
 */
async function getOrCreateReferralCode(userId, userName) {
  if (!userId) return null;
  const existing = await pool.query(
    'SELECT code FROM referral_codes WHERE user_id = $1',
    [userId]
  );
  if (existing.rows.length > 0) return existing.rows[0].code;
  for (let i = 0; i < 5; i++) {
    const candidate = generateReferralCode(userName);
    try {
      const r = await pool.query(
        `INSERT INTO referral_codes (code, user_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING
         RETURNING code`,
        [candidate, userId]
      );
      if (r.rows.length > 0) return r.rows[0].code;
      // Either the code clashed OR the user already has a code via a
      // concurrent insert. Re-SELECT to catch the latter.
      const re = await pool.query(
        'SELECT code FROM referral_codes WHERE user_id = $1',
        [userId]
      );
      if (re.rows.length > 0) return re.rows[0].code;
    } catch (err) {
      console.warn('[Referrals] generate attempt failed:', err.message);
    }
  }
  return null;
}

app.get('/auth/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.session.destroy((destroyErr) => {
      if (destroyErr) console.error('[Logout] Session destroy error:', destroyErr.message);
      res.clearCookie('tq_session');
      res.redirect('/login');
    });
  });
});

app.get('/auth/me', async (req, res) => {
  // Server-driven feature flags. The video walkthrough pipeline is
  // gated by VIDEO_ANALYSIS_ENABLED (fail-closed in production,
  // default-open in staging/dev). The client uses this to hide the
  // video CaptureChoice card and skip the upload UI entirely so
  // disabled video isn't a dead button.
  const features = {
    videoAnalysisEnabled: isVideoAnalysisEnabledFromProcessEnv(),
  };

  // Quota state (2026-06-22). The SubscriptionBanner reads this to
  // decide between "X of 3 free quotes used" / hard-lockout CTA / no
  // banner. Failure to load the row is silent — banner falls back to
  // its default empty state rather than crashing the whole /auth/me
  // call. Both branches below (Google OAuth + legacy switcher) need
  // the same shape, so we share this helper.
  const loadBilling = async (userId) => {
    if (!userId) return null;
    try {
      const r = await pool.query(
        `SELECT free_quotes_used, bonus_free_quotes, purchased_quotes,
                comp_until, subscription_status
         FROM users WHERE id = $1`,
        [userId]
      );
      const u = r.rows[0];
      if (!u) return null;
      const billing = resolveQuotaState(u, {
        hasActiveSubscription: u.subscription_status === 'active',
      });
      // Persistent quotes counter (2026-06-23): expose comp_until as
      // an ISO string so the client-side QuotaCounter can compute
      // "Free during {month}" / "Free through {month}" without
      // hardcoding "July". `resolveQuotaState` is locked, so we
      // attach it directly here. Null when the user isn't comped.
      billing.compUntil = u.comp_until
        ? new Date(u.comp_until).toISOString()
        : null;
      // Referrals Phase 1 (2026-06-23): include the referrer's name if
      // this user signed up via a code, so the ReferralWelcome banner
      // can render "Paul invited you" instead of "A friend invited you".
      // Single LEFT JOIN, returns NULL if the user was a cold signup.
      // Failure is silent — banner falls back to "A friend".
      try {
        const refRow = await pool.query(
          `SELECT u.name AS referrer_name
           FROM referrals r
           JOIN users u ON u.id = r.referrer_user_id
           WHERE r.referee_user_id = $1
           LIMIT 1`,
          [userId]
        );
        billing.referredBy = refRow.rows[0]?.referrer_name
          ? { name: refRow.rows[0].referrer_name }
          : null;
      } catch {
        billing.referredBy = null;
      }
      return billing;
    } catch (err) {
      console.warn('[/auth/me] billing lookup failed:', err.message);
      return null;
    }
  };

  // Google OAuth session
  if (req.user) {
    const billing = await loadBilling(req.user.id);
    return res.json({
      user: {
        id: req.user.id,
        name: req.user.name,
        email: req.user.email,
        avatarUrl: req.user.avatar_url,
        plan: req.user.plan || 'basic',
        profileComplete: !!req.user.profile_complete,
      },
      features,
      billing,
      legacy: false,
    });
  }
  // Legacy switcher session (Mark / Harry)
  if (req.session?.legacyUserId) {
    try {
      const r = await pool.query('SELECT * FROM users WHERE id = $1', [req.session.legacyUserId]);
      const u = r.rows[0];
      if (!u) return res.json({ user: null, features });
      // Use loadBilling so the legacy path also picks up referredBy.
      // Mark/Harry are admins and unlikely to be referees, but consistency
      // matters — if a basic user ever ends up on the legacy switcher
      // they should still see the welcome banner.
      const billing = await loadBilling(u.id);
      return res.json({
        user: {
          id: u.id,
          name: u.name,
          email: u.email,
          avatarUrl: u.avatar_url,
          plan: u.plan || 'basic',
          profileComplete: !!u.profile_complete,
        },
        features,
        billing,
        legacy: true,
      });
    } catch {
      return res.json({ user: null, features });
    }
  }
  res.json({ user: null, features });
});

// Temporary legacy-session endpoint for Mark and Harry transition
const LEGACY_USERS = ['mark', 'harry'];
// SECURITY (sec-audit C-1): the legacy switcher lets you become any
// LEGACY_USERS value without authentication — fine in dev, full account
// takeover in prod. Gated to non-production builds. Any prod hit is
// logged at WARN so we'd see an exploitation attempt against an old
// build that lacked this gate.
app.post('/api/session/legacy', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      `[SECURITY] /api/session/legacy hit in prod from ip=${req.ip} ua="${(req.get('user-agent') || '').slice(0, 200)}" body=${JSON.stringify(req.body || {}).slice(0, 200)}`
    );
    return res.status(404).json({ error: 'Not found' });
  }
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
      font-family: 'Inter', sans-serif;
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
      font-family: 'Inter', sans-serif;
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
    /* Referrals Phase 1 (2026-06-23) */
    .ref-block { margin-top: 20px; text-align: left; }
    .ref-toggle {
      background: none;
      border: none;
      color: #7a6f5e;
      font-size: 13px;
      cursor: pointer;
      padding: 6px 0;
      font-family: inherit;
    }
    .ref-toggle:hover { color: #e8a838; }
    .ref-panel { margin-top: 8px; }
    .ref-input {
      width: 100%;
      padding: 10px 12px;
      background: #1a1714;
      border: 1px solid #3a3630;
      border-radius: 6px;
      color: #f0ede8;
      font-family: inherit;
      font-size: 14px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    .ref-input:disabled { opacity: 0.7; cursor: not-allowed; background: #221f1a; }
    .ref-input:focus { outline: none; border-color: #e8a838; }
    .ref-hint { color: #7a6f5e; font-size: 12px; margin-top: 6px; }
    .ref-locked-note { color: #e8a838; font-size: 12px; margin-top: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">FASTQUOTE</div>
    <div class="tagline">Professional quoting for tradespeople</div>
    \${ERROR_HTML}
    <a id="signin-btn" href="\${SIGNIN_HREF}" class="btn">
      <svg width="20" height="20" viewBox="0 0 48 48">
        <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
        <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
        <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
        <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
      </svg>
      Sign in with Google
    </a>
    \${REF_BLOCK_HTML}
    <div class="footer"><a href="/privacy" style="color:#4a4640;text-decoration:none">Privacy</a> &middot; <a href="/terms" style="color:#4a4640;text-decoration:none">Terms</a></div>
  </div>
  <script>
    (function() {
      var toggle = document.getElementById('ref-toggle');
      var panel = document.getElementById('ref-panel');
      var input = document.getElementById('ref-input');
      var signinBtn = document.getElementById('signin-btn');
      if (toggle && panel) {
        toggle.addEventListener('click', function() {
          var hidden = panel.style.display === 'none';
          panel.style.display = hidden ? 'block' : 'none';
          toggle.textContent = hidden ? '− Hide referral code' : '+ Got a referral code?';
        });
      }
      if (input && signinBtn && !input.disabled) {
        // Keep the Sign-in URL in sync with what the user types so the
        // OAuth round-trip carries the code as ?ref=… and the callback
        // can apply it. Empty input → plain /auth/google (no ref).
        input.addEventListener('input', function() {
          var v = (input.value || '').trim();
          signinBtn.href = v ? '/auth/google?ref=' + encodeURIComponent(v) : '/auth/google';
        });
      }
    })();
  </script>
</body>
</html>`;

app.get('/login', (req, res) => {
  if (req.isAuthenticated?.() || req.session?.legacyUserId) {
    return res.redirect('/');
  }
  // Error copy per-cause. Paul's case was session_expired → we want a
  // clear "your session ran out, tap Sign-in again" message rather than
  // a scary 'sign-in failed' which implies bad password / Google issue.
  let errorMsg = '';
  switch (req.query.error) {
    case 'session_expired':
      errorMsg = "<div class='error'>Your session ran out. Please sign in again to get back to your quotes.</div>";
      break;
    case 'oauth_failed':
      errorMsg = "<div class='error'>We couldn't complete the Google sign-in. Please try again.</div>";
      break;
    case 'auth_failed':
      errorMsg = "<div class='error'>Sign-in failed. Please try again.</div>";
      break;
    case 'reconnecting':
      // Transient infrastructure error — our DB was briefly unreachable.
      // Your Google account is fine; retrying in a moment will work.
      errorMsg = "<div class='error'>We\u2019re reconnecting to our database. Please wait a moment and sign in again \u2014 your Google account is fine.</div>";
      break;
    default:
      errorMsg = '';
  }

  // Referrals Phase 1 (2026-06-23): if the URL has ?ref=…, pre-fill
  // the field AND lock it (disabled). Per spec — removes the "first-
  // code-vs-last-code" conflict by removing the conflict entirely.
  // If no URL ref, the field is empty + editable, hidden behind a
  // "Got a referral code?" toggle so the default UX stays clean.
  const refFromUrl = normaliseReferralCode(req.query.ref);
  let refBlockHtml = '';
  let signinHref = '/auth/google';
  if (refFromUrl) {
    signinHref = `/auth/google?ref=${encodeURIComponent(refFromUrl)}`;
    refBlockHtml = `
      <div class="ref-block">
        <div class="ref-panel">
          <input id="ref-input" class="ref-input" type="text"
            value="${escapeHtml(refFromUrl)}" disabled
            aria-label="Referral code">
          <div class="ref-locked-note">Referral applied — you'll start with 5 free quotes.</div>
        </div>
      </div>
    `;
  } else {
    refBlockHtml = `
      <div class="ref-block">
        <button id="ref-toggle" type="button" class="ref-toggle">+ Got a referral code?</button>
        <div id="ref-panel" class="ref-panel" style="display:none;">
          <input id="ref-input" class="ref-input" type="text"
            placeholder="e.g. PAULJULY"
            autocomplete="off" autocapitalize="characters" spellcheck="false"
            aria-label="Referral code">
          <div class="ref-hint">Optional. Bumps you to 5 free quotes if recognised.</div>
        </div>
      </div>
    `;
  }

  const html = LOGIN_PAGE_HTML
    .replace('${ERROR_HTML}', errorMsg)
    .replace('${SIGNIN_HREF}', signinHref)
    .replace('${REF_BLOCK_HTML}', refBlockHtml);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(html);
});

// Defence-in-depth HTML escape — minimal but enough for inserting a
// user-supplied referral code into an attribute or text node on the
// static login page. Codes are already normalised via
// normaliseReferralCode (uppercase + alphanumeric/hyphen only, ≤64
// chars), but this catches a hypothetical future code shape with
// special characters.
function escapeHtml(s) {
  if (typeof s !== 'string') return '';
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// --- Legal pages ---

// TRQ-151: legal document versions. Bump these when the published
// text changes. The OAuth callback writes the current version into
// `users.{terms,privacy,dpa}_accepted_version` for every new signup
// so we always know which text someone agreed to. Existing users
// keep NULL — they predate this audit trail.
//
// HARRY: when you finalise legal wording, you can either bump the
// date here (and existing users stay on the prior version) or push
// a one-off re-acceptance flow. The schema supports both — this PR
// just lays the audit trail.
const LEGAL_VERSIONS = Object.freeze({
  // privacy bumped 2026-06-19 — EU migration completed (TRQ-149)
  privacy: '2026-06-19',
  terms: '2026-06-15',
  dpa: '2026-06-15',
});

const LEGAL_PAGE_STYLE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Inter', sans-serif; background: #1a1714; color: #f0ede8; min-height: 100vh; }
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
  <p class="updated">Version ${LEGAL_VERSIONS.privacy}</p>

  <h2>About this notice</h2>
  <p>FastQuote is operated by Harry Doyle (sole trader, trading as "FastQuote"), based in the United Kingdom. This policy explains what personal data we hold, why, and what your rights are. UK GDPR and the Data Protection Act 2018 apply.</p>

  <h2>Two groups of people</h2>
  <p>FastQuote handles personal data about two distinct groups:</p>
  <ul>
    <li><strong>You, the tradesperson</strong> &mdash; you signed up, you have an account, you are our customer. We are the controller of your personal data.</li>
    <li><strong>Your end clients</strong> &mdash; the homeowners or businesses whose property you are quoting for. Their names, site addresses, and photos enter the system because you upload them. <strong>You are the controller of their data. FastQuote is your processor.</strong> See our <a href="/dpa">Data Processing Agreement</a> for the detail.</li>
  </ul>

  <h2>What we collect</h2>
  <p><strong>About you (the tradesperson):</strong></p>
  <ul>
    <li>Name and email address (from Google when you sign in).</li>
    <li>Business details you enter into your profile: company name, phone, trading address, VAT number, day rate.</li>
    <li>Session cookies so you stay signed in.</li>
    <li>Anonymous pageviews of the marketing site (path + session id, no personal identifier). See "Analytics" below.</li>
  </ul>
  <p><strong>About your end clients (uploaded by you):</strong></p>
  <ul>
    <li>Client name, site address, contact details you choose to enter on a quote.</li>
    <li>Job photographs or video walkthroughs of their property.</li>
    <li>Quote content, measurements, and generated documents.</li>
  </ul>

  <h2>Why we hold it &mdash; lawful basis</h2>
  <ul>
    <li><strong>Your account data</strong> &mdash; contract (Article 6(1)(b)): we need it to provide the service you signed up for.</li>
    <li><strong>End-client data you upload</strong> &mdash; on your behalf, under your lawful basis (typically your contract with that client). FastQuote does not independently determine why this data is processed.</li>
    <li><strong>Learning data</strong> (anonymous diffs of AI suggestions vs your confirmed values) &mdash; legitimate interests (Article 6(1)(f)): improving the service. Anonymised before storage; no personal data leaks into the learning loop.</li>
    <li><strong>Anonymous pageviews</strong> &mdash; legitimate interests: understanding which landing pages convert. No identifier, no cross-site tracking, honours <code>navigator.doNotTrack</code>.</li>
  </ul>

  <h2>Processors we use</h2>
  <p>To run the service we send data to these third parties:</p>
  <ul>
    <li><strong>Anthropic, PBC</strong> (United States) &mdash; job photographs + transcripts are sent to the Claude API for analysis. Per Anthropic's API terms, inputs are not used to train their models and are not retained beyond the API request. Transfer to the US is covered by the UK Addendum to the EU Standard Contractual Clauses.</li>
    <li><strong>OpenAI, LLC</strong> (United States) &mdash; audio from voice dictation and video walkthroughs is sent to Whisper for transcription. Audio is in-memory only; never persisted. Same transfer safeguards as Anthropic.</li>
    <li><strong>Railway Corp.</strong> &mdash; hosting + managed Postgres. Production data is currently in Railway's US West region; we are migrating to Railway's EU region (see "Data storage" below).</li>
    <li><strong>Cloudflare R2</strong> &mdash; off-platform encrypted backups of the database. Bucket is access-token-scoped; AES256 server-side encryption at rest.</li>
    <li><strong>Google LLC</strong> &mdash; sign-in only. We receive your name and email. No other Google services used.</li>
    <li><strong>Stripe, Inc.</strong> (once billing is live) &mdash; payment processing for the £19.99/month subscription. Stripe is the controller for payment data; we never see your full card number.</li>
  </ul>

  <h2>Data storage and international transfers</h2>
  <p>Your account database is hosted in Railway's EU West region (Amsterdam, Netherlands), and the Cloudflare R2 backup bucket is also in the EU jurisdiction. No personal data is routinely held outside the EU/UK. Cross-border transfers to the United States are limited to the sub-processors named above (Anthropic, OpenAI, Google sign-in, Stripe) and are covered by the relevant Standard Contractual Clauses and UK Addendum.</p>

  <h2>Retention</h2>
  <ul>
    <li>Account data &mdash; for as long as your account is active. On account deletion, account data is removed within 30 days from the live database.</li>
    <li>Quote data &mdash; same lifecycle. Anonymous learning data (diffs only, no PII) is retained indefinitely.</li>
    <li>Backups &mdash; 7 daily + 4 weekly snapshots. Deleting your account does not surgically edit existing backups; data ages out of backups within ~5 weeks of deletion.</li>
    <li>Pageviews &mdash; 30 days rolling.</li>
  </ul>

  <h2>Your rights</h2>
  <p>You have the right to access, correct, port, restrict, or delete your personal data, and to object to processing. To exercise any of these, email <a href="mailto:fastquote@harrydoyle.uk">fastquote@harrydoyle.uk</a>. We respond within 30 days. If you are unhappy with our handling, you can complain to the UK Information Commissioner's Office (<a href="https://ico.org.uk">ico.org.uk</a>).</p>

  <h2>What we don't do</h2>
  <ul>
    <li>We do not sell or share your data with advertisers.</li>
    <li>We do not use any third-party tracking or analytics SDK on the app (no Google Analytics, no Mixpanel, no Sentry).</li>
    <li>We do not profile end clients for any purpose.</li>
  </ul>

  <h2>Security</h2>
  <p>HTTPS-only. Session secrets and database passwords are stored as Railway environment variables, never in code. Database backups are encrypted at rest. We run secret-scanning on every commit. See our <a href="/terms">Terms of Service</a> for limits on liability.</p>

  <h2>Contact</h2>
  <p>Controller: Harry Doyle (sole trader t/a FastQuote), United Kingdom.<br>Email: <a href="mailto:fastquote@harrydoyle.uk">fastquote@harrydoyle.uk</a></p>
  </div></body></html>`);
});

app.get('/dpa', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>FastQuote &mdash; Data Processing Agreement</title><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet"><style>${LEGAL_PAGE_STYLE}</style></head><body><div class="wrap">
  <a href="/" class="brand">FASTQUOTE</a>
  <h1>Data Processing Agreement</h1>
  <p class="updated">Version ${LEGAL_VERSIONS.dpa}</p>

  <h2>Why this exists</h2>
  <p>When you upload your end clients' personal data (their names, site addresses, photos of their property) to FastQuote, you are the data controller and FastQuote is your processor. UK GDPR Article 28 requires a written agreement between us. This page IS that agreement. Accepting the Terms at signup also accepts this DPA.</p>

  <h2>1. Definitions</h2>
  <ul>
    <li><strong>You / "Controller"</strong>: the tradesperson with a FastQuote account.</li>
    <li><strong>FastQuote / "Processor"</strong>: Harry Doyle, sole trader t/a FastQuote.</li>
    <li><strong>End Client Data</strong>: personal data about your end clients (homeowners, businesses) that you upload to FastQuote.</li>
    <li><strong>UK GDPR</strong>: the United Kingdom General Data Protection Regulation.</li>
  </ul>

  <h2>2. Subject matter and duration</h2>
  <p>FastQuote processes End Client Data solely to provide the quoting service to you: to analyse photos, generate quotes, store quotes for retrieval, and deliver quotes via the client portal. Processing continues for as long as you have an account or as required to provide the service.</p>

  <h2>3. Nature and purpose of processing</h2>
  <ul>
    <li>Storage of End Client Data in our database.</li>
    <li>Transmission of photos and transcripts to Anthropic for AI analysis.</li>
    <li>Transmission of audio to OpenAI Whisper for transcription.</li>
    <li>Generation and delivery of quote documents (PDF, DOCX, client portal URL).</li>
    <li>Encrypted backups via Cloudflare R2.</li>
  </ul>

  <h2>4. Categories of data and data subjects</h2>
  <ul>
    <li><strong>Categories of personal data</strong>: name, address, telephone, email, photographs of property, video walkthroughs, quote-specific notes.</li>
    <li><strong>Data subjects</strong>: your end clients (homeowners, business owners commissioning trade work).</li>
  </ul>

  <h2>5. Your obligations as controller</h2>
  <ul>
    <li>You confirm you have a lawful basis to collect and upload End Client Data (typically your contract with the client).</li>
    <li>You will inform your end clients that a digital tool is used to prepare their quote (a short verbal mention is sufficient).</li>
    <li>You will respond to their data-subject requests directly; FastQuote will assist where technically necessary.</li>
  </ul>

  <h2>6. FastQuote's obligations as processor</h2>
  <ul>
    <li>Process End Client Data only on your documented instructions (the act of using the service constitutes instruction).</li>
    <li>Ensure persons authorised to process the data are bound by confidentiality (currently only Harry has access).</li>
    <li>Apply appropriate technical and organisational security measures (HTTPS, encrypted backups, environment-variable secrets, no third-party tracking, see Privacy Policy for detail).</li>
    <li>Assist you in responding to data-subject requests (access, correction, deletion) within a reasonable time.</li>
    <li>Notify you without undue delay (within 72 hours) on becoming aware of a personal data breach.</li>
    <li>Return or delete all End Client Data after the end of services, subject to backup retention windows (~5 weeks).</li>
  </ul>

  <h2>7. Sub-processors</h2>
  <p>FastQuote uses the following sub-processors. By accepting this DPA you provide general authorisation; we will notify you of new sub-processors with a chance to object.</p>
  <ul>
    <li><strong>Anthropic, PBC</strong> &mdash; AI analysis (US, SCCs + UK Addendum).</li>
    <li><strong>OpenAI, LLC</strong> &mdash; voice-to-text (US, SCCs + UK Addendum).</li>
    <li><strong>Railway Corp.</strong> &mdash; hosting + managed Postgres (currently US, migrating to EU).</li>
    <li><strong>Cloudflare, Inc.</strong> &mdash; encrypted backup storage (R2, multi-region with EU option).</li>
    <li><strong>Google LLC</strong> &mdash; authentication only.</li>
    <li><strong>Stripe, Inc.</strong> &mdash; payment processing (controller for payment data, not a sub-processor of yours).</li>
  </ul>

  <h2>8. International transfers</h2>
  <p>Transfers to US-based sub-processors (Anthropic, OpenAI, Stripe) are covered by the UK Addendum to the EU Standard Contractual Clauses. Railway production data is in transit to the EU region.</p>

  <h2>9. Liability</h2>
  <p>Each party is liable for damages caused by its own breach of UK GDPR or this agreement. FastQuote's overall liability is limited as set out in the <a href="/terms">Terms of Service</a>.</p>

  <h2>10. Governing law</h2>
  <p>This agreement is governed by the laws of England and Wales.</p>

  <p style="margin-top:32px;font-size:13px;">Accepted on signup. Version recorded against your user record with a timestamp.</p>
  </div></body></html>`);
});

app.get('/terms', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>FastQuote &mdash; Terms of Service</title><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&family=IBM+Plex+Sans:wght@400;500&display=swap" rel="stylesheet"><style>${LEGAL_PAGE_STYLE}</style></head><body><div class="wrap">
  <a href="/" class="brand">FASTQUOTE</a>
  <h1>Terms of Service</h1>
  <p class="updated">Version ${LEGAL_VERSIONS.terms}</p>

  <h2>What FastQuote is</h2>
  <p>FastQuote is an AI-assisted quoting tool for tradespeople. You photograph a job, FastQuote produces a draft quote, and you finalise and send it to your client. It is provided by Harry Doyle (sole trader, trading as "FastQuote"), based in the United Kingdom.</p>

  <h2>Signup and account</h2>
  <p>Accounts are created via Google sign-in. By signing up you confirm you are at least 18, that you intend to use FastQuote in the course of your trade or business, and that you accept these Terms, our <a href="/privacy">Privacy Policy</a>, and our <a href="/dpa">Data Processing Agreement</a> as the same version that was current when you signed in. We record the version and timestamp against your account so we both know what you agreed to.</p>

  <h2>Subscription and billing</h2>
  <p>FastQuote is offered at &pound;19.99 per month after a 1-month no-card trial. Pricing and payment terms appear before any card is collected. Cancel anytime; access continues until the end of the paid period. Refunds are at our discretion within seven days of payment.</p>

  <h2>Your data, your clients' data</h2>
  <p>You retain ownership of all data you enter into FastQuote. When you upload information about your end clients (homeowners, businesses), <strong>you are the data controller</strong> and FastQuote is your processor &mdash; see our <a href="/dpa">Data Processing Agreement</a> for the formal terms.</p>

  <h2>You confirm, when you upload</h2>
  <ul>
    <li>You have the right to upload photographs of the property and any details about the end client (typically because you are quoting for them under a verbal or written agreement).</li>
    <li>You will inform your end client that a digital tool is used to prepare quotes. A brief verbal mention is sufficient; no signed waiver required.</li>
    <li>You do not upload data that is unrelated to a genuine quote (e.g. photos of unconnected third parties, sensitive identification documents).</li>
  </ul>

  <h2>Your responsibility for accuracy</h2>
  <p>FastQuote produces AI-generated suggestions. You must review, confirm, and adjust every measurement, material quantity, labour estimate, and cost figure before the quote leaves the system. Your professional judgement is the final authority &mdash; FastQuote is a tool, not a replacement for it.</p>

  <h2>Limitation of liability</h2>
  <p>To the extent permitted by law, FastQuote is not liable for: errors in AI-generated content; losses arising from a quote you sent to a client; service interruptions; or consequential loss. Our total liability in any twelve-month period is capped at the amount you paid us in that period (and is zero during the free trial). Nothing in these Terms limits liability that cannot be limited by law (e.g. fraud, personal injury caused by negligence).</p>

  <h2>Acceptable use</h2>
  <p>Use FastQuote only for its intended purpose: generating professional quotes for legitimate trade work. Do not attempt to access other users' data, reverse-engineer the service, or interfere with its operation.</p>

  <h2>Termination</h2>
  <p>You can delete your account at any time by emailing <a href="mailto:fastquote@harrydoyle.uk">fastquote@harrydoyle.uk</a>. We may suspend or terminate accounts for breach of these Terms after reasonable notice (except in cases of fraud or serious misuse, where notice may be immediate).</p>

  <h2>Changes to these terms</h2>
  <p>We may update these terms; when we do, we increment the version and update the signup acceptance flow. Continued use after a change constitutes acceptance of the new version. We will notify you by email of material changes.</p>

  <h2>Governing law</h2>
  <p>These terms are governed by the laws of England and Wales. Any disputes will be resolved in the courts of England and Wales.</p>

  <h2>Contact</h2>
  <p>Harry Doyle (sole trader t/a FastQuote), United Kingdom.<br>Email: <a href="mailto:fastquote@harrydoyle.uk">fastquote@harrydoyle.uk</a></p>
  </div></body></html>`);
});

// --- Landing page for unauthenticated visitors at / ---
//
// New conversion-focused landing (2026-05-18 spec): hero + live demo
// strip + trust + 3-step + pricing + footer. Visual styles live in
// public/landing/landing.css and the demo controller in
// public/landing/landing.js — both copied into dist/ by Vite's public-
// dir convention so Express's static handler serves them at
// /landing/landing.css and /landing/landing.js.
//
// Auth model is invite-only Google OAuth, so the spec's /signup CTA
// is wired to /login (an alias is registered below) — both endpoints
// land the user on the Google consent screen via Passport.
const LANDING_PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>FastQuote &mdash; From quote to customer, ready in 5 minutes.</title>
  <meta name="description" content="FastQuote turns a few photos of a job into a professional quote in five minutes. Built for dry stone wallers." />
  <meta name="theme-color" content="#f4eee2" />
  <meta property="og:title" content="FastQuote &mdash; Quoting tools for dry stone wallers" />
  <meta property="og:description" content="Photograph the wall. Get measurements, materials and a polished quote in five minutes." />
  <meta property="og:image" content="/og.png" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="https://fastquote.uk/" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/landing/landing.css?v=3" />
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "name": "FastQuote",
    "applicationCategory": "BusinessApplication",
    "operatingSystem": "Web",
    "url": "https://fastquote.uk/",
    "description": "Quoting tools for dry stone wallers — photos in, professional quote out, in under five minutes."
  }
  </script>
  <!-- TRQ-15: landing pageview beacon. Fires one anonymous POST to
       /api/track. Honours navigator.doNotTrack. Failure is silent.
       Inline so it runs before any deferred scripts and so a blocked
       landing.js can't suppress the analytics signal. -->
  <script>
    (function() {
      try {
        var dnt = navigator.doNotTrack || window.doNotTrack;
        if (dnt === '1' || dnt === 'yes') return;
        var sid = sessionStorage.getItem('fq_session_id');
        if (!sid) {
          sid = (crypto && crypto.randomUUID)
            ? crypto.randomUUID()
            : (Math.random().toString(36).slice(2) + Date.now().toString(36));
          sessionStorage.setItem('fq_session_id', sid);
        }
        fetch('/api/track', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            path: location.pathname || '/',
            referrer: document.referrer || '',
            sessionId: sid,
          }),
          keepalive: true,
          credentials: 'same-origin',
        }).catch(function () {});
      } catch (_) {}
    })();
  </script>
</head>
<body>
  <header class="nav">
    <div class="nav-inner">
      <a href="/" class="brand" aria-label="FastQuote">
        <span class="brand-mark" aria-hidden="true"></span>FASTQUOTE
      </a>
      <nav class="nav-links" aria-label="Primary">
        <a href="#how">How it works</a>
        <a href="#pricing">Pricing</a>
      </nav>
      <div class="nav-actions">
        <a href="/login" class="nav-login">Log in</a>
        <a href="/signup" class="btn btn-sm btn-primary">Get started &rarr;</a>
      </div>
    </div>
  </header>

  <section class="hero">
    <div class="hero-bg" aria-hidden="true"></div>
    <div class="hero-grain" aria-hidden="true"></div>
    <div class="hero-inner">
      <div class="hero-copy">
        <span class="eyebrow">For dry stone wallers</span>
        <h1 class="hero-title">
          From quote to customer.
          <span class="hero-title-amber">Ready in 5 minutes.</span>
        </h1>
        <p class="hero-sub">
          Spend less time on paperwork, more time doing your job. Take a few
          photos of the wall &mdash; FastQuote handles the measurements,
          materials and a professional quote, typically in under five minutes.
        </p>
        <div class="hero-cta-row">
          <a href="/signup" class="btn btn-lg btn-primary">Get started &rarr;</a>
        </div>
        <ul class="hero-facts">
          <li>No card needed to try</li>
          <li>Simple monthly pricing, cancel anytime</li>
          <li>Built with West Yorkshire wallers</li>
        </ul>
      </div>

      <div class="hero-demo">
        <div class="demo" data-demo aria-label="See how a quote is built">
          <div class="demo-head">
            <span class="demo-live">
              <span class="demo-dot" aria-hidden="true"></span>
              Live &middot; Beck Farm, HD8
            </span>
            <button type="button" class="demo-replay" aria-label="Replay demo">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <polyline points="23 4 23 10 17 10"/>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
              </svg>
              Replay
            </button>
          </div>
          <div class="demo-stage">
            <div class="demo-stage-step is-active" data-stage="1">
              <p class="demo-stage-label">01 &middot; Photos go in</p>
              <div class="demo-photos">
                <div class="demo-photo" aria-hidden="true"><img src="/landing/photos/wall-1-urban.jpg" alt="" /></div>
                <div class="demo-photo" aria-hidden="true"><img src="/landing/photos/wall-2-village.jpg" alt="" /></div>
                <div class="demo-photo" aria-hidden="true"><img src="/landing/photos/wall-3-moorland.jpg" alt="" /></div>
              </div>
            </div>
            <div class="demo-stage-step" data-stage="2">
              <p class="demo-stage-label">02 &middot; Numbers come out</p>
              <ul class="demo-rows">
                <li class="demo-row" style="--d: 0ms">
                  <span class="demo-row-label">Wall length</span>
                  <span class="demo-row-v" data-target="18m"></span>
                </li>
                <li class="demo-row" style="--d: 100ms">
                  <span class="demo-row-label">Stone reclaimed</span>
                  <span class="demo-row-v" data-target="65%"></span>
                </li>
                <li class="demo-row" style="--d: 200ms">
                  <span class="demo-row-label">New stone</span>
                  <span class="demo-row-v" data-target="1.8 t"></span>
                </li>
                <li class="demo-row" style="--d: 300ms">
                  <span class="demo-row-label">Labour</span>
                  <span class="demo-row-v" data-target="2 &times; 6 days"></span>
                </li>
                <li class="demo-row" style="--d: 400ms">
                  <span class="demo-row-label">Materials cost</span>
                  <span class="demo-row-v" data-target="&pound;1,518"></span>
                </li>
              </ul>
            </div>
            <div class="demo-stage-step" data-stage="3">
              <p class="demo-stage-label">03 &middot; Send to client</p>
              <div class="demo-total">
                <p class="demo-total-eyebrow">Quote total inc. VAT</p>
                <p class="demo-total-value">&pound;7,581.60</p>
                <p class="demo-total-meta">QT-2026-0047 &middot; valid 30 days</p>
              </div>
              <div class="demo-status">
                <span class="demo-status-dot" aria-hidden="true"></span>
                Sent to James &middot; viewed 12 mins ago
              </div>
            </div>
          </div>
          <div class="demo-progress" aria-hidden="true">
            <div class="demo-progress-bar"></div>
          </div>
        </div>
      </div>
    </div>
  </section>

  <section class="trust">
    <div class="trust-inner">
      <div class="trust-cell">
        <div class="trust-stat">80%+</div>
        <div class="trust-label">Accuracy first time</div>
      </div>
      <div class="trust-cell">
        <div class="trust-stat">5 mins</div>
        <div class="trust-label">Typical quote time</div>
      </div>
      <div class="trust-cell">
        <div class="trust-stat">&uarr;</div>
        <div class="trust-label">Improve your win rate</div>
      </div>
      <div class="trust-cell">
        <div class="trust-stat">DSWA</div>
        <div class="trust-label">Working with members</div>
      </div>
    </div>
  </section>

  <section class="how" id="how">
    <div class="how-inner">
      <div class="how-head">
        <span class="eyebrow section-eyebrow">How it works</span>
        <h2 class="section-title">Three steps. Roughly five minutes.</h2>
      </div>
      <div class="how-grid">
        <article class="step">
          <p class="step-num">01</p>
          <h3 class="step-title">Snap the wall</h3>
          <p class="step-body">
            A few photos &mdash; overview, close-up, side profile. Voice
            notes if your hands are full of dust.
          </p>
          <div class="step-mock" aria-hidden="true">
            <div class="step-mock-photos">
              <img class="step-mock-photo" src="/landing/photos/wall-1-urban.jpg" alt="" loading="lazy" />
              <img class="step-mock-photo" src="/landing/photos/wall-2-village.jpg" alt="" loading="lazy" />
              <img class="step-mock-photo" src="/landing/photos/wall-3-moorland.jpg" alt="" loading="lazy" />
            </div>
          </div>
        </article>
        <article class="step">
          <p class="step-num">02</p>
          <h3 class="step-title">Check the numbers</h3>
          <p class="step-body">
            Measurements, stone tonnage, materials, labour days. Every figure
            is editable &mdash; confirm what looks right, tweak what doesn't.
          </p>
          <div class="step-mock" aria-hidden="true">
            <div class="step-mock-table">
              <div class="step-mock-row"><span>Wall length</span><span>18.0 m</span></div>
              <div class="step-mock-row"><span>Wall height</span><span>1.2 m</span></div>
              <div class="step-mock-row"><span>New stone</span><span>1.8 t</span></div>
              <div class="step-mock-row amber"><span>Materials</span><span>&pound;1,518</span></div>
            </div>
          </div>
        </article>
        <article class="step">
          <p class="step-num">03</p>
          <h3 class="step-title">Send. Track. Get on with it.</h3>
          <p class="step-body">
            A polished, branded quote your client sees on their phone. You see
            when they open it and whether they accept.
          </p>
          <div class="step-mock" aria-hidden="true">
            <div class="step-mock-quote">
              <span class="step-mock-ref">QT-2026-0047</span>
              <span class="step-mock-total">&pound;7,581.60</span>
              <span class="step-mock-accepted">Accepted</span>
            </div>
          </div>
        </article>
      </div>
    </div>
  </section>

  <section class="data" id="data-trust">
    <div class="data-inner">
      <div class="data-head">
        <span class="eyebrow">Your data, looked after</span>
        <h2 class="data-title">Your clients' details, kept safe.</h2>
        <p class="data-lead">Quotes and customer information sit behind proper data protection &mdash; not a spreadsheet on a laptop or a notebook in the van.</p>
      </div>
      <div class="data-grid">
        <div class="data-item">
          <div class="data-ico" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.5l8 3v5.5c0 4.8-3.4 8-8 9.5-4.6-1.5-8-4.7-8-9.5V5.5l8-3z"/><path d="M8.5 12l2.3 2.3L15.7 9.4"/></svg>
          </div>
          <h3>Registered with the ICO</h3>
          <p>We're registered with the Information Commissioner's Office, the UK's data-protection regulator.</p>
          <p class="data-ref">ICO reg. ZC178109</p>
        </div>
        <div class="data-item">
          <div class="data-ico" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12l2.5 2.5L16 9"/></svg>
          </div>
          <h3>UK GDPR compliant</h3>
          <p>We collect only what's needed to build your quotes, and handle it to UK GDPR standards.</p>
        </div>
        <div class="data-item">
          <div class="data-ico" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/></svg>
          </div>
          <h3>Kept secure</h3>
          <!-- Defensive default per spec §3: softened the stronger "encrypted
               in transit / encrypted on disk" phrasing until the Railway-PG
               disk-level control is verified (TLS in transit is confirmed).
               Swap back to the stronger phrasing when ready. -->
          <p>Your quotes and client details are kept secure, so they stay private.</p>
        </div>
        <div class="data-item">
          <div class="data-ico" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M5 20h14"/></svg>
          </div>
          <h3>Your data stays yours</h3>
          <p>We never sell it or share it. Export or delete everything whenever you like.</p>
        </div>
      </div>
    </div>
  </section>

  <section class="pricing" id="pricing">
    <div class="pricing-inner">
      <div class="pricing-head">
        <span class="eyebrow section-eyebrow">Pricing</span>
        <h2 class="section-title">One plan. Built to grow your trade.</h2>
      </div>
      <div class="pricing-card">
        <div class="pricing-money">
          <p class="pricing-money-eyebrow">Subscription</p>
          <p class="pricing-headline">
            Fair, monthly,
            <span>no surprises.</span>
          </p>
          <div class="pricing-amount">
            <span class="pricing-currency">&pound;</span>
            <span class="pricing-figure">19.99</span>
            <span class="pricing-period">/month</span>
          </div>
          <p class="pricing-caption">Start free &middot; cancel anytime</p>
        </div>
        <ul class="pricing-features">
          <li>
            <span class="tick" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="#bd5e09" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            Unlimited quotes &amp; clients
          </li>
          <li>
            <span class="tick" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="#bd5e09" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            Client portal &amp; live quote tracking
          </li>
          <li>
            <span class="tick" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="#bd5e09" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            PDF export &amp; print-ready quotes
          </li>
          <li>
            <span class="tick" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="#bd5e09" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
            Your branding on every quote
          </li>
        </ul>
        <div class="pricing-cta-col">
          <a href="/signup" class="btn btn-lg btn-primary btn-block">
            Start free &mdash; no card needed &rarr;
          </a>
          <p class="pricing-cta-note">Free while you make your first 3 quotes.</p>
        </div>
      </div>

      <!-- Pay-as-you-go pack (2026-06-24). Secondary panel — intentionally
           worse per-quote value than the subscription so it stays a top-up
           for occasional users, not a substitute for paying monthly. -->
      <div class="pricing-pack">
        <div>
          <p class="pricing-pack-label">Or pay as you go</p>
          <h3 class="pricing-pack-title">5 quotes &mdash; &pound;9.99</h3>
        </div>
        <p class="pricing-pack-blurb">A one-off top-up. Use them whenever &mdash; they don't expire.</p>
        <div class="pricing-pack-cta">
          <a href="/signup" class="btn btn-primary">
            Buy 5 quotes &mdash; &pound;9.99
          </a>
          <p class="pricing-pack-note">No subscription &middot; sign in to buy</p>
        </div>
      </div>
    </div>
  </section>

  <footer class="foot">
    <div class="foot-inner">
      <div class="foot-brand-col">
        <span class="foot-brand">
          <span class="brand-mark" aria-hidden="true"></span>
          <span class="brand">FASTQUOTE</span>
          <span class="foot-tag">&mdash; Quoting tools for tradesmen.</span>
        </span>
      </div>
      <div class="foot-links">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="/dpa">DPA</a>
        <a href="mailto:fastquote@harrydoyle.uk">fastquote@harrydoyle.uk</a>
      </div>
      <div class="foot-right">
        <div>&copy; 2026 FastQuote &middot; Built in West Yorkshire</div>
        <div class="foot-meta">ICO reg. ZC178109</div>
      </div>
    </div>
  </footer>

  <script src="/landing/landing.js?v=2" defer></script>
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

// /signup — the landing page's primary CTA target. FastQuote is invite-only
// Google OAuth (CLAUDE.md "Access to FastQuote is by invitation only"), so
// signup and login are the same flow. 302 redirect preserves the URL the
// user landed on for analytics + lets us swap the destination later
// without changing the landing copy.
app.get('/signup', (req, res) => res.redirect(302, '/login'));

// --- Auth Middleware ---

// SECURITY (sec-audit H-2): the test bypass is double-gated. Both
// NODE_ENV !== 'production' AND ENABLE_TEST_AUTH=1 must be set for it
// to ever consider the x-test-user-id header. In production we refuse
// to look at the header at all, so accidentally setting NODE_ENV=test
// in prod (Nixpacks defaults, ops mistake) cannot enable impersonation.
const TEST_AUTH_ENABLED =
  process.env.NODE_ENV !== 'production' &&
  process.env.ENABLE_TEST_AUTH === '1';

function requireAuth(req, res, next) {
  // Test bypass — only when test auth is explicitly enabled at boot.
  if (TEST_AUTH_ENABLED && req.headers['x-test-user-id']) {
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
  // Legacy switcher session — sec-audit L-3: read the actual plan from
  // the DB rather than synthesising 'admin'. Defence in depth in case
  // C-1's gate is ever weakened.
  if (req.session?.legacyUserId) {
    pool
      .query('SELECT plan FROM users WHERE id = $1', [req.session.legacyUserId])
      .then(({ rows }) => {
        const plan = rows[0]?.plan || 'basic';
        req.user = { id: req.session.legacyUserId, plan };
        next();
      })
      .catch((err) => {
        console.error('[Auth] legacy plan lookup failed:', err.message);
        // Fail closed: if we can't verify the plan, treat as unauth.
        res.status(401).json({ error: 'Not authenticated' });
      });
    return;
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

// Compute the current prompt version (SYSTEM_PROMPT + approved
// calibration notes) from the live calibration_notes table. Used at
// /analyse time AND at job-save time so every `jobs.prompt_version`
// row is non-NULL — otherwise calibration's effect on accuracy is
// unmeasurable per the 2026-06-22 calibration investigation.
//
// The format here MUST match the photo-path /analyse augmentation
// (server.js: see the `/api/users/:id/analyse` route) so analyse-time
// and save-time hashes line up. Returns null on DB failure so save
// continues — promptVersion is observability data, not load-bearing
// for the user's quote.
async function computeCurrentPromptVersion() {
  try {
    const { rows: calNotes } = await pool.query(
      `SELECT field_type, field_label, note FROM calibration_notes WHERE status = 'approved' ORDER BY approved_at ASC`
    );
    let augmentedPrompt = SYSTEM_PROMPT;
    if (calNotes.length > 0) {
      const dynamicSection = calNotes.map((n, i) =>
        `${i + 1}. [${n.field_type}/${n.field_label}] ${n.note}`
      ).join('\n');
      augmentedPrompt += `\n\nDYNAMIC CALIBRATION NOTES (auto-generated from completed job data):\n${dynamicSection}`;
    }
    return computePromptVersion(SYSTEM_PROMPT, augmentedPrompt.slice(SYSTEM_PROMPT.length));
  } catch (err) {
    console.warn(`[PromptVersion] Failed to compute prompt version: ${err.message}`);
    return null;
  }
}

// TRQ-176: prompt-length budget telemetry. Recomputes the current
// augmented prompt size (SYSTEM_PROMPT + DYNAMIC CALIBRATION NOTES) and
// returns the raw character count. Mirrors computeCurrentPromptVersion
// so both observability fields agree on the same calibration-notes
// snapshot. Returns null on DB failure so save never breaks — this is
// pure observability data, not load-bearing for the quote.
//
// The format here MUST match the photo-path /analyse augmentation
// (server.js: /api/users/:id/analyse route) so save-time char count
// reflects what's actually sent to Sonnet at analyse time.
async function computeCurrentPromptChars() {
  try {
    const { rows: calNotes } = await pool.query(
      `SELECT field_type, field_label, note FROM calibration_notes WHERE status = 'approved' ORDER BY approved_at ASC`
    );
    let augmentedPrompt = SYSTEM_PROMPT;
    if (calNotes.length > 0) {
      const dynamicSection = calNotes.map((n, i) =>
        `${i + 1}. [${n.field_type}/${n.field_label}] ${n.note}`
      ).join('\n');
      augmentedPrompt += `\n\nDYNAMIC CALIBRATION NOTES (auto-generated from completed job data):\n${dynamicSection}`;
    }
    return augmentedPrompt.length;
  } catch (err) {
    console.warn(`[PromptChars] Failed to compute prompt char count: ${err.message}`);
    return null;
  }
}

// sec-audit I-2 — fire-and-forget admin audit write. Never throws —
// audit failure must not break the underlying admin action.
async function logAdminAction(req, action, targetId = null, details = null) {
  try {
    await pool.query(
      `INSERT INTO admin_audit (actor_id, action, target_id, details, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        req.user?.id || null,
        String(action).slice(0, 100),
        targetId ? String(targetId).slice(0, 100) : null,
        details ? JSON.parse(JSON.stringify(details)) : null,
        req.ip,
        (req.get('user-agent') || '').slice(0, 500),
      ]
    );
  } catch (err) {
    console.warn(`[Audit] write failed action=${action} err=${err.message}`);
  }
}

// Protect all user-scoped routes
app.use('/api/users/:id', requireAuth, requireOwner);

// --- User Registry Routes ---

app.get('/api/users', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, created_at AS "createdAt" FROM users ORDER BY name'
    );
    res.json(rows);
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.post('/api/users', requireAuth, async (req, res) => {
  try {
    const { id, name } = req.body || {};
    if (!id || !name) return res.status(400).json({ error: 'id and name required' });
    await pool.query(
      'INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = $2',
      [id, name]
    );
    res.json({ id, name });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.delete('/api/users/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// --- Profile Routes ---

// Client Portal accent colour (TRQ-130) — the tradesman's chosen tint
// for the customer-facing /q/:token page. Whitelist mirrors the one in
// portalRenderer.js → safeAccent(). Server-side rejection stops bad
// values ever reaching the DB, even if a scripted client tries to
// smuggle CSS/attribute content through the profile save.
const ACCENT_WHITELIST = ['amber', 'rust', 'moss', 'slate'];

// Document-type label (TRQ-134). Mirrors DOCUMENT_TYPES in
// src/utils/documentType.js. Whitelist at the save boundary so bad
// values never reach the DB; the render-time helper has its own
// fallback to 'quote' as belt-and-braces.
const DOCUMENT_TYPE_WHITELIST = ['quote', 'estimate'];

app.get('/api/users/:id/profile', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT data FROM profiles WHERE user_id = $1',
      [req.params.id]
    );
    if (rows.length === 0) return res.json(null);
    res.json(rows[0].data);
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.put('/api/users/:id/profile', async (req, res) => {
  try {
    const body = req.body || {};
    if ('accent' in body && !ACCENT_WHITELIST.includes(body.accent)) {
      return res.status(400).json({ error: 'invalid accent' });
    }
    if ('documentType' in body && !DOCUMENT_TYPE_WHITELIST.includes(body.documentType)) {
      return res.status(400).json({ error: 'invalid documentType' });
    }
    await pool.query(
      `INSERT INTO profiles (user_id, data) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET data = $2`,
      [req.params.id, JSON.stringify(body)]
    );
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.put('/api/users/:id/settings/:key', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body is required' });
    }
    await pool.query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1, $2, $3)
       ON CONFLICT (user_id, key) DO UPDATE SET value = $3`,
      [req.params.id, req.params.key, JSON.stringify(req.body.value)]
    );
    // Also update users.profile_complete column so passport deserialization sees it
    if (req.params.key === 'profile_complete') {
      const newValue = !!req.body.value;
      await pool.query(
        'UPDATE users SET profile_complete = $2 WHERE id = $1',
        [req.params.id, newValue]
      );
      // Analytics Phase 1 — fire profile_completed on the first
      // false→true transition only. Idempotency via the events table:
      // if we've already recorded this event for this user we don't
      // re-fire on subsequent toggles (rare edit flows). At pre-launch
      // scale there's no concurrent-first-save race to worry about.
      if (newValue) {
        try {
          const { rows: existing } = await pool.query(
            `SELECT 1 FROM events
               WHERE event_name = 'profile_completed' AND user_id = $1
               LIMIT 1`,
            [req.params.id]
          );
          if (existing.length === 0) {
            recordEvent('profile_completed', req.params.id, {}).catch(() => {});
          }
        } catch (e) {
          // events table missing or transient — analytics is best-effort.
          console.warn('[profile_completed] check failed:', e?.message || e);
        }
      }
    }
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.post('/api/users/:id/quote-sequence/increment', async (req, res) => {
  try {
    // Atomic increment: INSERT or UPDATE in a single statement to avoid race conditions
    const { rows } = await pool.query(
      `INSERT INTO settings (user_id, key, value) VALUES ($1, 'quoteSequence', to_jsonb(2))
       ON CONFLICT (user_id, key) DO UPDATE SET value = to_jsonb((settings.value::int) + 1)
       RETURNING value`,
      [req.params.id]
    );
    res.json(rows[0].value);
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
              decline_reason AS "declineReason",
              -- TRQ-132: Client Portal badge inputs. Minimal set — only
              -- what the dashboard badge logic needs. IP / user-agent /
              -- decline reason stay on the admin detail route.
              client_token AS "clientToken",
              client_token_expires_at AS "clientTokenExpiresAt",
              client_viewed_at AS "clientViewedAt",
              client_response AS "clientResponse"
       FROM jobs WHERE user_id = $1 ORDER BY saved_at DESC LIMIT 100`,
      [req.params.id]
    );
    // TRQ-172 (sec-audit round 5, M-2): LIMIT 100 caps the response
    // payload. The query returns full quote_snapshot JSONB per row
    // (50–500 KB each) which Resume Job in App.jsx depends on; the
    // proper fix is dropping snapshot from the list and lazy-fetching
    // it on Resume, but that's a multi-file refactor. For two-user
    // scale (Mark + Paul) the 100-job ceiling is plenty and prevents
    // unbounded growth from blowing up the dashboard load.
    // Add snapshot alias for backward compatibility
    const jobs = rows.map(r => ({
      ...r,
      totalAmount: Number(r.totalAmount),
      snapshot: r.quoteSnapshot,
    }));
    res.json(jobs);
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.post('/api/users/:id/jobs', async (req, res) => {
  try {
    const allowed = pickAllowedKeys(req.body);
    const { jobDetails, quotePayload } = allowed;

    const quoteRef = jobDetails?.quoteReference || '';

    // TRQ-137: Dedup window widened from 30s → 10 minutes.
    // Why: Paul's edit-regenerate-save cycle is slower than 30s (he
    // reviews the preview, adjusts, re-saves), so the old window let a
    // stream of duplicate POSTs through. The proper fix is client-side
    // (SavedQuoteViewer.virtualState now carries savedJobId so the
    // next save uses PUT), but widening the server window is
    // belt-and-braces. If the same (user, quote_reference) turns up on
    // POST within 10 minutes, return the existing id — the client then
    // holds that id and switches to PUT for any subsequent saves,
    // closing the loop.
    if (quoteRef) {
      const { rows: existing } = await pool.query(
        `SELECT id FROM jobs
         WHERE user_id = $1 AND quote_reference = $2
           AND saved_at > NOW() - INTERVAL '10 minutes'
         ORDER BY saved_at DESC LIMIT 1`,
        [req.params.id, quoteRef]
      );
      if (existing.length > 0) {
        return res.json({ id: existing[0].id });
      }
    }

    const id = `sq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const totals = quotePayload?.totals;

    const quoteSnapshot = allowed;

    // Stamp prompt_version server-side. The client used to be expected
    // to send `req.body.promptVersion`, but it never did — every job
    // row ended up with prompt_version = NULL, making calibration
    // attribution impossible (2026-06-22 investigation). Trust the
    // client value if present (forward-compat); otherwise recompute
    // from the live calibration_notes table so the column is never NULL.
    const promptVersion = req.body.promptVersion
      || await computeCurrentPromptVersion();

    // TRQ-176: prompt-length budget telemetry. Stamp the raw char count
    // of the augmented prompt alongside prompt_version. The /analyse
    // routes append DYNAMIC CALIBRATION NOTES on every call; without
    // visibility into the growing size, an over-stuffed prompt could
    // degrade Sonnet's accuracy without anyone noticing. Best-effort —
    // null on failure (jobs.prompt_chars is observability-only).
    const promptChars = await computeCurrentPromptChars();

    await pool.query(
      `INSERT INTO jobs (id, user_id, saved_at, client_name, site_address,
        quote_reference, quote_date, total_amount, has_rams, quote_snapshot, prompt_chars, prompt_version)
       VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, FALSE, $8, $9, $10)`,
      [
        id,
        req.params.id,
        jobDetails?.clientName || '',
        jobDetails?.siteAddress || '',
        quoteRef,
        jobDetails?.quoteDate || '',
        totals?.total ?? 0,
        JSON.stringify(quoteSnapshot),
        promptChars,
        promptVersion,
      ]
    );
    res.json({ id });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.put('/api/users/:id/jobs/:jobId', async (req, res) => {
  try {
    const allowed = pickAllowedKeys(req.body);
    const { jobDetails, quotePayload } = allowed;
    const totals = quotePayload?.totals;
    const quoteSnapshot = allowed;

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
    safeError(res, err, `${req.method} ${req.path}`);
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
              completion_feedback AS "completionFeedback",
              -- TRQ-133: Client Portal detail fields for the StatusModal
              -- audit section. IP + user-agent are stripped for non-admin
              -- callers below — they're admin-only audit data.
              client_token AS "clientToken",
              client_token_expires_at AS "clientTokenExpiresAt",
              client_viewed_at AS "clientViewedAt",
              client_ip AS "clientIp",
              client_user_agent AS "clientUserAgent",
              client_response AS "clientResponse",
              client_response_at AS "clientResponseAt",
              client_decline_reason AS "clientDeclineReason"
       FROM jobs WHERE id = $1 AND user_id = $2`,
      [req.params.jobId, req.params.id]
    );
    if (rows.length === 0) return res.json(null);
    const job = rows[0];
    job.totalAmount = Number(job.totalAmount);
    job.snapshot = job.quoteSnapshot;
    // Admin-plan gate: strip the soft-fingerprint fields (IP + UA) from
    // the response for non-admin traders. They can still see *that* a
    // client viewed their link and *when* — just not the network
    // metadata.
    if (req.user?.plan !== 'admin') {
      delete job.clientIp;
      delete job.clientUserAgent;
    }
    res.json(job);
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// Rate-limiter for the PDF endpoint — each render spawns a Chromium page
// and loads fonts from Google Fonts. Keep the concurrency bounded.
const pdfRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => req.params.id || req.ip,
  message: { error: 'Too many PDF requests. Please wait a minute and try again.' },
});

// TRQ-172 (sec-audit round 5, L-1): hardening cap on the QBO CSV export.
// Auth-gated and computationally cheap (one DB read + in-memory build),
// so this is belt-and-braces rather than money protection — but keeps a
// runaway client from spamming the route while a legitimate user waits.
const csvExportRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => req.params.id || req.ip,
  message: { error: 'Too many export requests. Please wait a minute and try again.' },
});

// POST /api/users/:id/jobs/:jobId/pdf
// Accepts pre-rendered quote HTML (react-dom/server.renderToStaticMarkup
// on the client) and returns a native PDF using Chromium + public/print.css.
// This is the Phase-2 successor to the html2canvas "Download PDF" path; it
// produces crisp, selectable-text PDFs with correct page breaks every time.
app.post('/api/users/:id/jobs/:jobId/pdf', pdfRateLimit, async (req, res) => {
  const { quoteHtml, title, headerHtml, footerHtml } = req.body || {};
  if (typeof quoteHtml !== 'string' || quoteHtml.length === 0) {
    return res.status(400).json({ error: 'quoteHtml is required' });
  }
  if (quoteHtml.length > 5_000_000) {
    // Guard against someone sending a 50MB blob of base64-inlined photos —
    // the photos appendix has large data URLs but should never get close.
    return res.status(413).json({ error: 'quoteHtml exceeds 5MB' });
  }
  // TRQ-169: header/footer are bounded — they render on every page so
  // a runaway template would balloon the PDF. 4KB each is generous.
  // TRQ-172 (sec-audit round 5, M-1): also sanitise. Puppeteer's
  // headerTemplate/footerTemplate accept arbitrary HTML, and even
  // though setJavaScriptEnabled(false) blocks <script> execution and
  // setRequestInterception aborts off-allowlist URLs, a crafted
  // <img src="data.attacker.com"> could exfiltrate via DNS resolution
  // before the request abort. Run both through the same sanitiser the
  // body uses; the legitimate buildPdfHeaderHtml output passes
  // through unchanged because it only uses safe tags + inline styles.
  const safeHeader = typeof headerHtml === 'string' && headerHtml.length <= 4096
    ? sanitiseQuoteHtml(headerHtml) : undefined;
  const safeFooter = typeof footerHtml === 'string' && footerHtml.length <= 4096
    ? sanitiseQuoteHtml(footerHtml) : undefined;

  try {
    const pdf = await renderQuotePdf({
      quoteHtml,
      title,
      headerHtml: safeHeader,
      footerHtml: safeFooter,
    });
    const safeFilename = (title || 'Quote').replace(/[^a-zA-Z0-9._-]/g, '-');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}.pdf"`);
    res.setHeader('Content-Length', pdf.length);
    res.send(pdf);
  } catch (err) {
    console.error(`[PDF] render failed job=${req.params.jobId} err=${err.message}`);
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// QuickBooks Online UK — invoice CSV export (file-only, no API / OAuth).
// Protected by the global `app.use('/api/users/:id', requireAuth, requireOwner)`
// middleware so ownership is enforced before this handler runs.
app.get('/api/users/:id/jobs/:jobId/export/quickbooks-csv', csvExportRateLimit, async (req, res) => {
  const { id: userId, jobId } = req.params;
  try {
    const { rows: jobRows } = await pool.query(
      'SELECT * FROM jobs WHERE id = $1 AND user_id = $2',
      [jobId, userId]
    );
    if (jobRows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const job = jobRows[0];

    const { rows: profRows } = await pool.query(
      'SELECT data FROM profiles WHERE user_id = $1',
      [userId]
    );
    const profile = profRows[0]?.data || {};

    const csv = buildQuickbooksCSV(job, profile);

    const safeRef = String(job.quote_reference || 'quote')
      .replace(/[^a-zA-Z0-9_-]/g, '_');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="fastquote-${safeRef}-quickbooks.csv"`
    );
    // No BOM: QBO's CSV parser has been known to reject the BOM as part
    // of the first column header ("\uFEFFInvoiceNo"), breaking auto-
    // mapping. Excel re-opening isn't the target use case here — QBO is.
    res.send(csv);
  } catch (err) {
    // "no line items" and "snapshot is empty" are 400-class user errors,
    // not server bugs. Return the specific message so the UI can explain.
    if (/no line items|snapshot is empty/i.test(err?.message || '')) {
      return res.status(400).json({ error: err.message });
    }
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-124: Client Portal — token generation + status
//
// These routes sit under the owner-scoped prefix
// (`app.use('/api/users/:id', requireAuth, requireOwner)` above) so they
// cannot be called without a logged-in session whose userId matches the
// :id in the URL. That single guard is the ownership enforcement — do
// not add or remove it here without updating that middleware.
//
// The token itself is the client's only credential (no account, no
// password) so it MUST be generated via crypto.randomUUID (128-bit
// entropy). Anything else — Math.random, timestamp-derived, sequential —
// would make the quote URL guessable.
// ─────────────────────────────────────────────────────────────────────────

app.post('/api/users/:id/jobs/:jobId/client-token', async (req, res) => {
  const { id: userId, jobId } = req.params;

  try {
    // Fetch the live quote snapshot + the tradesman's current profile;
    // the UPDATE below freezes both into the job row so future edits to
    // either do not change what the client sees at /q/:token.
    const { rows: jobRows } = await pool.query(
      'SELECT quote_snapshot FROM jobs WHERE id = $1 AND user_id = $2',
      [jobId, userId]
    );
    if (jobRows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const { rows: profileRows } = await pool.query(
      'SELECT data FROM profiles WHERE user_id = $1',
      [userId]
    );

    const token = generateClientToken();
    const expires = computeClientTokenExpiry();

    await pool.query(
      `UPDATE jobs
         SET client_token             = $1,
             client_token_expires_at  = $2,
             client_snapshot          = $3,
             client_snapshot_profile  = $4,
             client_viewed_at         = NULL,
             client_response          = NULL,
             client_response_at       = NULL,
             client_decline_reason    = NULL,
             client_ip                = NULL,
             client_user_agent        = NULL
       WHERE id = $5 AND user_id = $6`,
      [
        token,
        expires,
        jobRows[0].quote_snapshot,
        profileRows[0]?.data || {},
        jobId,
        userId,
      ]
    );

    const baseUrl = (process.env.PUBLIC_BASE_URL || 'https://fastquote.uk').replace(/\/$/, '');
    // Analytics Phase 1 — fire quote_sent on token generation success.
    // Regenerating the token (e.g. resending a quote) counts as a
    // new "sent" event, which is the right granularity for the
    // funnel — we want to see retries / resends as their own signal.
    recordEvent('quote_sent', userId, { jobId }).catch(() => {});
    res.json({
      token,
      url: `${baseUrl}/q/${token}`,
      expires: expires.toISOString(),
      ttlDays: CLIENT_TOKEN_TTL_DAYS,
    });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.get('/api/users/:id/jobs/:jobId/client-status', async (req, res) => {
  const { id: userId, jobId } = req.params;

  try {
    const { rows } = await pool.query(
      `SELECT client_token, client_token_expires_at,
              client_viewed_at, client_response,
              client_response_at, client_decline_reason
         FROM jobs
        WHERE id = $1 AND user_id = $2`,
      [jobId, userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Job not found' });
    }
    const r = rows[0];
    if (!r.client_token) {
      return res.json({ hasToken: false });
    }

    const baseUrl = (process.env.PUBLIC_BASE_URL || 'https://fastquote.uk').replace(/\/$/, '');
    res.json({
      hasToken: true,
      url: `${baseUrl}/q/${r.client_token}`,
      expires: r.client_token_expires_at,
      expired: isClientTokenExpired(r.client_token_expires_at),
      viewed: !!r.client_viewed_at,
      viewedAt: r.client_viewed_at,
      response: r.client_response,
      responseAt: r.client_response_at,
      declineReason: r.client_decline_reason,
    });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.put('/api/users/:id/jobs/:jobId/status', async (req, res) => {
  try {
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({ error: 'Request body is required' });
    }
    const { status, sentAt, expiresAt, acceptedAt, declinedAt, declineReason, completionFeedback } = req.body;
    if (!['sent', 'accepted', 'declined', 'completed'].includes(status)) {
      return res.status(400).json({ error: `Invalid status: ${status}. Must be sent, accepted, declined, or completed.` });
    }
    const { rows } = await pool.query(
      'SELECT id, status AS current_status FROM jobs WHERE id = $1 AND user_id = $2',
      [req.params.jobId, req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: `Job ${req.params.jobId} not found` });
    }

    // Validate status transitions — prevent nonsensical backward transitions
    const VALID_TRANSITIONS = {
      draft:     ['sent', 'accepted', 'declined', 'completed'],
      sent:      ['accepted', 'declined', 'completed'],
      // accepted → declined: client backed out after initially accepting.
      // Mark hit this on 2026-06-26; the UI (PR #44) offers the action
      // but this server-side gate was rejecting it.
      accepted:  ['completed', 'declined'],
      // declined → sent: re-send a declined quote untouched.
      // declined → draft: customer called back to discuss — waller wants
      //   to edit the quote (price/scope) before re-sending. Honest UX:
      //   moving to draft signals "back in your hands" rather than
      //   "magically went out again". Added 2026-06-29 alongside the
      //   dashboard redesign's Re-open kebab action.
      declined:  ['sent', 'draft'],
      completed: [],                // terminal state
    };
    const currentStatus = rows[0].current_status || 'draft';
    const allowed = VALID_TRANSITIONS[currentStatus] || [];
    if (!allowed.includes(status)) {
      return res.status(400).json({
        error: `Cannot transition from '${currentStatus}' to '${status}'.`,
      });
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

            // Auto-calibration: check if enough jobs completed since last calibration
            try {
              const { rows: calRows } = await pool.query(
                `SELECT COUNT(*)::int AS cnt FROM jobs
                 WHERE status = 'completed'
                   AND saved_at > COALESCE(
                     (SELECT MAX(created_at) FROM agent_runs WHERE agent_type = 'calibration' AND status = 'completed'),
                     '1970-01-01'
                   )`
              );
              const completedSinceLast = calRows[0]?.cnt || 0;
              if (shouldAutoCalibrate(completedSinceLast)) {
                console.log(`[AutoCalibration] Triggering: ${completedSinceLast} jobs since last calibration`);
                runCalibrationAgent({ pool, userId: req.params.id }).catch(calErr =>
                  console.error('[AutoCalibration] Error:', calErr.message)
                );
              }
            } catch (calCheckErr) {
              console.error('[AutoCalibration] Check failed:', calCheckErr.message);
            }
          }
        } catch (err) {
          console.error(`[FeedbackAgent] Error for job ${req.params.jobId}:`, err.message);
          enqueueRetry(pool, 'feedback', {
            userId: req.params.id,
            jobId: req.params.jobId,
            completionFeedback,
            completionNotes: req.body.completionNotes || '',
          }, err.message).catch(retryErr =>
            console.error('[RetryQueue] Failed to enqueue:', retryErr.message)
          );
        }
      })();
    }

    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
        if (!d.fieldType || !d.fieldLabel || d.aiValue == null || d.confirmedValue == null) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Each diff must have fieldType, fieldLabel, aiValue, and confirmedValue',
          });
        }
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
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// --- Admin Learning Dashboard (4.1g) ---

app.get('/api/admin/learning', requireAuth, requireAdminPlan, async (req, res) => {
  try {
    // Field bias — was previously aggregated entirely in SQL via
    // AVG(edit_magnitude), but `edit_magnitude` was computed at
    // insert time using parseFloat() on display-formatted ai_value
    // strings like "2,000mm". parseFloat truncates at the comma so a
    // 55% real delta showed up as 154,900% in the chart (2026-06-22
    // calibration investigation, "data-quality landmine"). The fix:
    // pull the raw ai_value + confirmed_value strings and recompute
    // bias in JS using parseAiValue, which strips currency, commas,
    // and unit suffixes before Number()-ing. Edit-rate / total
    // counts stay in SQL — they don't depend on numeric parsing.
    const fieldBiasRaw = await pool.query(`
      SELECT field_type, field_label, ai_value, confirmed_value, was_edited
      FROM quote_diffs
      WHERE field_type IN ('measurement','material_unit_cost','labour_days')
    `);

    const fieldBias = computeFieldBiasFromRows(fieldBiasRaw.rows);

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

    // --- Weighted accuracy (additive, per 2026-06-22 calibration investigation)
    //
    // Existing `ai_accuracy_score` is edit-presence (binary: was_edited or
    // not). This second metric scores per-field accuracy as
    // `1 - clamped(|edit|/|ai|)` so a 5% edit reads as 0.95, not 0. Both
    // metrics surface on the dashboard side-by-side so the trajectory can
    // be compared apples-to-apples. See src/utils/weightedAccuracy.js.
    //
    // Pulled as raw diffs (one row per diff) so the JS aggregator can group
    // by job within a week — distribution stats (p50 / p90) are computed
    // in JS, not SQL, because percentile_cont on per-quote means after a
    // GROUP BY is awkward to express portably.
    const weightedRawRows = await pool.query(`
      SELECT DATE_TRUNC('week', created_at) AS week,
        job_id, user_id, ai_value, confirmed_value
      FROM quote_diffs
      WHERE field_type IN ('measurement','material_quantity','material_unit_cost','labour_days','labour_workers')
        AND created_at >= NOW() - INTERVAL '90 days'
    `);

    // Group raw rows into { weekIso -> { jobId -> [diffs] } }, then summarise.
    const byWeek = new Map();
    for (const r of weightedRawRows.rows) {
      const weekKey = r.week instanceof Date ? r.week.toISOString() : String(r.week);
      if (!byWeek.has(weekKey)) byWeek.set(weekKey, { weekRaw: r.week, byJob: new Map() });
      const wk = byWeek.get(weekKey);
      if (!wk.byJob.has(r.job_id)) wk.byJob.set(r.job_id, []);
      wk.byJob.get(r.job_id).push({ aiValue: r.ai_value, confirmedValue: r.confirmed_value });
    }

    const weightedWeekly = [];
    for (const { weekRaw, byJob } of byWeek.values()) {
      const quotes = [...byJob.values()];
      const summary = summariseWeightedAccuracy(quotes);
      weightedWeekly.push({
        week: weekRaw,
        count: summary.count,
        mean: summary.mean,
        p50: summary.p50,
        p90: summary.p90,
      });
    }
    weightedWeekly.sort((a, b) => new Date(b.week) - new Date(a.week));
    const weightedWeeklyTop12 = weightedWeekly.slice(0, 12);

    // Overall (last 90 days) summary — for a single headline number.
    const allQuotesLast90d = [];
    for (const { byJob } of byWeek.values()) {
      for (const diffs of byJob.values()) allQuotesLast90d.push(diffs);
    }
    const weightedSummary = summariseWeightedAccuracy(allQuotesLast90d);

    // TRQ-176: prompt-length budget telemetry. Pull the last 50 saved
    // jobs (ordered newest-first) so the dashboard can render a 50-job
    // sparkline AND compute avg-of-last-20 for the alarm threshold.
    // Older NULL rows (jobs saved before this column existed) are
    // filtered out so the sparkline only shows real data points.
    const promptCharsRows = await pool.query(`
      SELECT id, prompt_chars, saved_at
      FROM jobs
      WHERE prompt_chars IS NOT NULL
      ORDER BY saved_at DESC
      LIMIT 50
    `);
    const promptCharsHistory = promptCharsRows.rows.map(r => ({
      jobId: r.id,
      promptChars: Number(r.prompt_chars),
      savedAt: r.saved_at,
    }));
    // Current value = most recent job's prompt_chars (or null if none).
    const promptCharsCurrent = promptCharsHistory[0]?.promptChars ?? null;
    const last20 = promptCharsHistory.slice(0, 20);
    const promptCharsAvg20 = last20.length > 0
      ? Math.round(last20.reduce((s, r) => s + r.promptChars, 0) / last20.length)
      : null;

    // Breakdown: base prompt (fixed) vs calibration notes (growable).
    // 2026-06-29 refit — the old 10,000 threshold was unrealistic (base
    // prompt alone is 20k+) and the alarm copy wrongly blamed
    // "calibration corpus growing" when notes were a minority. Split
    // the metric so the breakdown surfaces where the chars actually live.
    const basePromptChars = SYSTEM_PROMPT.length;
    const { rows: notesRows } = await pool.query(
      `SELECT COALESCE(SUM(length(note)), 0)::int AS chars,
              COUNT(*)::int AS count
         FROM calibration_notes
         WHERE status = 'approved'`
    );
    const notesChars = notesRows[0]?.chars ?? 0;
    const notesCount = notesRows[0]?.count ?? 0;
    const notesShare = promptCharsAvg20 && promptCharsAvg20 > 0
      ? notesChars / promptCharsAvg20
      : 0;

    // Two alarms: absolute budget (catches runaway growth) + share
    // (catches the architectural bug of unbounded note accumulation
    // even when individual notes are small).
    const PROMPT_CHARS_ALARM_THRESHOLD = 30000;
    const NOTES_SHARE_ALARM_THRESHOLD = 0.5;
    const absoluteAlarm = promptCharsAvg20 != null && promptCharsAvg20 > PROMPT_CHARS_ALARM_THRESHOLD;
    const shareAlarm = notesShare > NOTES_SHARE_ALARM_THRESHOLD;
    const promptCharsAlarm = absoluteAlarm || shareAlarm;

    res.json({
      fieldBias,
      weeklyTrend: weeklyTrend.rows.map(r => ({
        week: r.week, avgAccuracy: Number(r.avg_accuracy), quoteCount: Number(r.quote_count),
      })),
      weightedWeeklyTrend: weightedWeeklyTop12,
      weightedSummary,
      refCardImpact: refCardImpact.rows.map(r => ({
        referenceCardUsed: r.reference_card_used, editRatePct: Number(r.edit_rate_pct),
        total: Number(r.total),
      })),
      userAccuracy: userAccuracy.rows.map(r => ({
        userId: r.user_id, avgAccuracy: Number(r.avg_accuracy), quoteCount: Number(r.quote_count),
        isOutlier: Number(r.avg_accuracy) < 0.4 && Number(r.quote_count) >= 3,
      })),
      // TRQ-176: prompt-length budget. Newest-first sparkline data +
      // headline current + avg-of-last-20 alarm + base/notes breakdown
      // (2026-06-29). Empty arrays / null values are valid (pre-feature
      // jobs); the dashboard handles them.
      promptSize: {
        current: promptCharsCurrent,
        avg20: promptCharsAvg20,
        alarm: promptCharsAlarm,
        absoluteAlarm,
        shareAlarm,
        threshold: PROMPT_CHARS_ALARM_THRESHOLD,
        notesShareThreshold: NOTES_SHARE_ALARM_THRESHOLD,
        basePromptChars,
        notesChars,
        notesCount,
        notesShare,
        history: promptCharsHistory,
      },
    });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
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
    await logAdminAction(req, 'set-plan', req.params.id, { newPlan: plan });
    res.json({ ok: true, id: req.params.id, plan });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
    await logAdminAction(req, 'migrate-data', toUserId, {
      from: fromUserId,
      to: toUserId,
      counts: { jobs: jobs.rowCount, diffs: diffs.rowCount, photos: photos.rowCount },
    });
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
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.put('/api/users/:id/drafts', async (req, res) => {
  try {
    const draftJson = JSON.stringify(req.body);
    if (draftJson.length > 500 * 1024) {
      console.warn(`[Draft] Large draft payload for user ${req.params.id}: ${Math.round(draftJson.length / 1024)}KB`);
    }
    await pool.query(
      `INSERT INTO drafts (user_id, saved_at, data) VALUES ($1, NOW(), $2)
       ON CONFLICT (user_id) DO UPDATE SET saved_at = NOW(), data = $2`,
      [req.params.id, draftJson]
    );
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.delete('/api/users/:id/drafts', async (req, res) => {
  try {
    await pool.query('DELETE FROM drafts WHERE user_id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// --- Photo Routes ---

// sec-audit M-3 — hard cap per-user on photo storage. Without this, a
// user could push 50 MB JSONs in a loop and fill our Postgres. 500 MB
// is plenty for normal use (~25 high-res quote-photo sets).
const PER_USER_PHOTO_BYTES_CEILING = 500 * 1024 * 1024;

app.put('/api/users/:id/photos/:context/:slot', async (req, res) => {
  try {
    const { data, label, name } = req.body;
    if (!data) return res.status(400).json({ error: 'data is required' });

    // Quota check: sum existing user_photos rows for this user (excl.
    // the row we're about to overwrite) + the new payload size.
    const { rows: usageRows } = await pool.query(
      `SELECT COALESCE(SUM(octet_length(data)), 0)::bigint AS bytes
         FROM user_photos
        WHERE user_id = $1
          AND NOT (context = $2 AND slot = $3)`,
      [req.params.id, req.params.context, req.params.slot]
    );
    const existingBytes = Number(usageRows[0]?.bytes || 0);
    const incomingBytes = Buffer.byteLength(String(data), 'utf8');
    if (existingBytes + incomingBytes > PER_USER_PHOTO_BYTES_CEILING) {
      console.warn(
        `[Photo] quota exceeded user=${req.params.id} existing=${existingBytes} incoming=${incomingBytes}`
      );
      return res.status(413).json({
        error: 'Photo storage quota exceeded for this account. Delete old photos to make room.',
      });
    }

    await pool.query(
      `INSERT INTO user_photos (user_id, context, slot, data, label, name, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id, context, slot)
       DO UPDATE SET data = $4, label = $5, name = $6, updated_at = NOW()`,
      [req.params.id, req.params.context, req.params.slot, data, label || null, name || null]
    );
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.post('/api/users/:id/photos/copy', async (req, res) => {
  try {
    const { fromContext, toContext } = req.body || {};
    if (!fromContext || !toContext) {
      return res.status(400).json({ error: 'fromContext and toContext required' });
    }
    // Use transaction to prevent partial state if crash between DELETE and INSERT
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Delete existing target photos first
      await client.query(
        'DELETE FROM user_photos WHERE user_id = $1 AND context = $2',
        [req.params.id, toContext]
      );
      // Copy from source to target
      await client.query(
        `INSERT INTO user_photos (user_id, context, slot, data, label, name, updated_at)
         SELECT user_id, $2, slot, data, label, name, NOW()
         FROM user_photos WHERE user_id = $1 AND context = $3`,
        [req.params.id, toContext, fromContext]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// --- GDPR Routes ---

app.delete('/api/users/:id/data', async (req, res) => {
  try {
    const userId = req.params.id;
    // Use transaction to ensure all-or-nothing GDPR data deletion
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM agent_runs WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM quote_diffs WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM user_photos WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM drafts WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM jobs WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM settings WHERE user_id = $1', [userId]);
      await client.query('DELETE FROM profiles WHERE user_id = $1', [userId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.get('/api/users/:id/export', async (req, res) => {
  try {
    const userId = req.params.id;
    const [profileRes, settingsRes, jobsRes, draftsRes, photosRes, diffsRes, agentRunsRes] = await Promise.all([
      pool.query('SELECT data FROM profiles WHERE user_id = $1', [userId]),
      pool.query('SELECT key, value FROM settings WHERE user_id = $1', [userId]),
      pool.query('SELECT quote_snapshot AS "quoteSnapshot", rams_snapshot AS "ramsSnapshot", saved_at AS "savedAt", client_name AS "clientName" FROM jobs WHERE user_id = $1', [userId]),
      pool.query('SELECT data FROM drafts WHERE user_id = $1', [userId]),
      pool.query('SELECT context, slot, label, name, updated_at AS "updatedAt" FROM user_photos WHERE user_id = $1', [userId]),
      pool.query('SELECT field_type, field_label, ai_value, confirmed_value, was_edited, edit_magnitude, created_at FROM quote_diffs WHERE user_id = $1', [userId]),
      pool.query('SELECT agent_type, status, input_summary, output_summary, model, duration_ms, created_at FROM agent_runs WHERE user_id = $1', [userId]),
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
      agentRuns: agentRunsRes.rows,
    });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
  keyGenerator: (req) => String(req.user?.id ?? 0),
  message: { error: 'Too many analyses. Please wait before trying again.' },
  validate: false,
});

// sec-audit M-4 — second rate limit keyed by client IP. Prevents the
// "many cheap accounts" bypass: per-user is 20/hour but with multiple
// OAuth accounts an attacker could multiply that. This catches the
// common case where the abuse comes from one client. Production sits
// behind Railway's proxy; trust proxy is set above so req.ip is the
// real client IP, not Railway's edge.
const aiRateLimitPerIp = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100, // 5x the per-user — leaves room for shared NATs (offices, schools)
  message: { error: 'Too many analyses from this network. Please wait before trying again.' },
});

// --- Dictation (voice-to-text) ---

const dictationUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

const dictationRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 30,
  keyGenerator: (req) => String(req.user?.id ?? 0),
  message: { error: 'Too many dictation requests. Please wait a moment.' },
  validate: false,
});

app.post('/api/dictate', requireAuth, dictationRateLimit, dictationUpload.single('audio'), async (req, res) => {
  const startTime = Date.now();
  const userId = req.user.id;

  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided' });
  }

  if (!req.file.mimetype?.startsWith('audio/')) {
    return res.status(400).json({ error: 'File must be an audio recording' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('[Dictation] OPENAI_API_KEY not configured');
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }

  console.log(`[Dictation] user=${userId} mime=${req.file.mimetype} size=${req.file.size} hasKey=${!!apiKey}`);

  try {
    const text = await transcribe(req.file.buffer, req.file.mimetype);
    console.log(`[Dictation] SUCCESS user=${userId} chars=${text.length}`);
    const latencyMs = Date.now() - startTime;

    // Log telemetry (non-blocking)
    pool.query(
      `INSERT INTO dictation_runs (user_id, success, latency_ms, audio_bytes, transcript_chars)
       VALUES ($1, true, $2, $3, $4)`,
      [userId, latencyMs, req.file.size, text.length]
    ).catch(err => console.warn('[Dictation] Telemetry insert failed:', err.message));

    res.json({ text });
  } catch (err) {
    const latencyMs = Date.now() - startTime;

    // Log failed attempt (non-blocking)
    pool.query(
      `INSERT INTO dictation_runs (user_id, success, latency_ms, audio_bytes, transcript_chars, failure_category)
       VALUES ($1, false, $2, $3, 0, $4)`,
      [userId, latencyMs, req.file.size, err.constructor?.name || 'unknown']
    ).catch(telErr => console.warn('[Dictation] Telemetry insert failed:', telErr.message));

    console.error(`[Dictation] FAIL user=${userId} error=${err.message} stack=${err.stack?.split('\n')[1]?.trim()}`);
    safeError(res, err, `POST /api/dictate user=${userId}`);
  }
});

// --- Video Upload (walkthrough) ---

const videoStorage = multer.diskStorage({
  destination: '/tmp',
  filename: (req, file, cb) => {
    // Sanitize jobId to prevent path traversal (#13)
    const safeJobId = String(req.params.jobId).replace(/[^a-zA-Z0-9_-]/g, '_');
    cb(null, `video_${safeJobId}_${Date.now()}`);
  },
});

const videoUpload = multer({
  storage: videoStorage,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB (Paul reports 2-min iPhone clips ~300MB)
    // Profile JSON ships embedded as a logo data URL. Multer's default
    // fieldSize of 1MB rejects with LIMIT_FIELD_VALUE → "Field value
    // too long" 500 to the client (Paul saw this on bank holiday).
    // 10MB comfortably fits a 5–6MB logo after base64 inflation.
    fieldSize: 10 * 1024 * 1024,
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) cb(null, true);
    else cb(new Error('File must be a video'), false);
  },
});

const videoRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  keyGenerator: (req) => String(req.user?.id ?? 0),
  message: { error: 'Too many video analyses. Please wait before trying again.' },
  validate: false,
});

// --- SSE video progress ---
const videoProgress = new VideoProgressEmitter();

app.get('/api/users/:id/jobs/:jobId/video/progress', requireAuth, (req, res) => {
  const { jobId } = req.params;

  // Video analysis kill-switch: if disabled, refuse the SSE upgrade
  // before any keep-alive write so the client falls back cleanly to
  // its time-based estimator instead of stranding on "Processing...".
  if (!isVideoAnalysisEnabledFromProcessEnv()) {
    return res.status(503).json({ error: VIDEO_DISABLED_MESSAGE });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('\n'); // flush headers

  const unsub = videoProgress.subscribe(jobId, (data) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (data.stage === 'complete' || data.stage === 'error') {
      clearTimeout(sseTimeout);
      res.end();
    }
  });

  // Timeout: close SSE after 5 minutes if no complete/error (matches XHR timeout)
  const sseTimeout = setTimeout(() => {
    unsub();
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ stage: 'error', progress: 0, error: 'Progress timeout' })}\n\n`);
      res.end();
    }
  }, 300000);

  req.on('close', () => {
    clearTimeout(sseTimeout);
    unsub();
  });
});

// Video analysis kill-switch: refuse the upload BEFORE multer streams
// the body to disk. This stops wasted bandwidth and disk pressure
// while the rebuild lands. Mounted as middleware so the disabled-state
// reply path doesn't depend on req.files being populated.
function requireVideoAnalysisEnabled(req, res, next) {
  if (!isVideoAnalysisEnabledFromProcessEnv()) {
    return res.status(503).json({ error: VIDEO_DISABLED_MESSAGE });
  }
  return next();
}

app.post('/api/users/:id/jobs/:jobId/video',
  requireAuth,
  requireVideoAnalysisEnabled,
  videoRateLimit,
  videoUpload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'extraPhotos', maxCount: 10 },
  ]),
  async (req, res) => {
    const userId = req.user.id;
    const { jobId } = req.params;
    const videoFile = req.files?.video?.[0];
    const extraPhotoFiles = req.files?.extraPhotos || [];

    if (!videoFile) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    if (!videoFile.mimetype?.startsWith('video/')) {
      return res.status(400).json({ error: 'File must be a video' });
    }

    // sec-audit M-2 — verify magic bytes, not just the client's claimed
    // MIME. A user could upload e.g. an ELF binary with Content-Type:
    // video/mp4 to feed ffmpeg unexpected input. Reject anything whose
    // sniffed MIME doesn't actually match a video container.
    try {
      const sniffed = await fileTypeFromFile(videoFile.path);
      if (!sniffed || !sniffed.mime.startsWith('video/')) {
        try { fs.unlinkSync(videoFile.path); } catch {}
        return res.status(400).json({
          error: `File contents are not a recognised video format (detected: ${sniffed?.mime || 'unknown'})`,
        });
      }
    } catch (err) {
      console.warn(`[Video] magic-byte check failed: ${err.message}`);
      try { fs.unlinkSync(videoFile.path); } catch {}
      return res.status(400).json({ error: 'Could not verify video file format' });
    }

    // Validate extra photo MIME types (sniffed too).
    const invalidPhoto = extraPhotoFiles.find(f => !f.mimetype?.startsWith('image/'));
    if (invalidPhoto) {
      return res.status(400).json({ error: `Extra photo must be an image (got ${invalidPhoto.mimetype})` });
    }
    for (const f of extraPhotoFiles) {
      try {
        const sniffed = await fileTypeFromFile(f.path);
        if (!sniffed || !sniffed.mime.startsWith('image/')) {
          try { fs.unlinkSync(f.path); } catch {}
          return res.status(400).json({
            error: `Extra photo contents are not a recognised image (detected: ${sniffed?.mime || 'unknown'})`,
          });
        }
      } catch {
        try { fs.unlinkSync(f.path); } catch {}
        return res.status(400).json({ error: 'Could not verify photo file format' });
      }
    }

    console.log(`[Video] user=${userId} job=${jobId} mime=${videoFile.mimetype} size=${videoFile.size} extraPhotos=${extraPhotoFiles.length}`);

    // Free-quotes quota gate (2026-06-22). Same contract as the photo
    // /analyse route — active subscription or comp_until bypasses,
    // otherwise the 3-free allowance applies. We do this AFTER the
    // multer upload because we need a valid req.user.id, but BEFORE
    // any ffmpeg / Whisper / Claude work (the bandwidth was already
    // burned by the time we got here; the compute is the bigger cost
    // we still avoid). The upload's temp video file is unlinked to
    // keep disk pressure off.
    // Captured so the success-path accounting block below knows which
    // bucket (free vs purchased) to decrement. Subscribed / comped
    // reasons skip the bucket update entirely. Declared at the route
    // scope so it survives the gate's IIFE.
    let videoGateReason = null;
    // Analytics Phase 1 — wall-clock start, captured before any
    // ffmpeg / Whisper / Claude work begins so the durationMs in the
    // quote_analysed event reflects the user-perceived latency.
    const videoAnalyseStart = Date.now();
    {
      let quotaUser = null;
      try {
        const { rows } = await pool.query(
          `SELECT free_quotes_used, bonus_free_quotes, purchased_quotes,
                  comp_until, subscription_status
           FROM users WHERE id = $1`,
          [userId]
        );
        quotaUser = rows[0] || null;
      } catch (err) {
        console.warn('[Video] quota lookup failed:', err.message);
      }
      const hasActiveSubscription = quotaUser?.subscription_status === 'active';
      const decision = quotaGate(quotaUser, { hasActiveSubscription });
      videoGateReason = decision.reason;
      if (!decision.allowed) {
        try { fs.unlinkSync(videoFile.path); } catch {}
        for (const f of extraPhotoFiles) { try { fs.unlinkSync(f.path); } catch {} }
        // Effective limit includes the referrals Phase 1 bonus — a referee
        // who signed up with a valid code gets `FREE_QUOTES_LIMIT + 2`, and
        // a referrer accrues +2 per successful referral. The lockout copy
        // MUST reflect the effective limit, not the baseline, or referred
        // users see "you've used your 3 free quotes" when they actually
        // had 5. CLAUDE.md's "load-bearing copy" doctrine pre-dates this.
        const bonus = Math.max(0, Number(quotaUser?.bonus_free_quotes) || 0);
        const effectiveLimit = FREE_QUOTES_LIMIT + bonus;
        const used = Number(quotaUser?.free_quotes_used) || 0;
        return res.status(402).json({
          error: 'quota_exhausted',
          message: `You've used your ${effectiveLimit} free quotes. Subscribe to continue.`,
          freeQuotesUsed: Math.min(used, effectiveLimit),
          freeQuotesLimit: effectiveLimit,
        });
      }
    }

    videoProgress.create(jobId);
    try {
      // Parse form fields — frontend sends briefNotes (#3) and profile JSON (#5)
      const briefNotes = req.body.briefNotes || '';
      const siteAddress = req.body.siteAddress || '';
      const scaleReferences = req.body.scaleReferences || '';

      // Parse profile from JSON string sent by frontend (#5)
      let profile = { dayRate: 400 };
      try {
        if (req.body.profile) {
          const parsed = JSON.parse(req.body.profile);
          profile = { ...profile, ...parsed };
        }
      } catch {
        console.warn('[Video] Failed to parse profile JSON, using defaults');
      }

      // Convert extra photo files to data URL format for processVideo (#4)
      const extraPhotos = extraPhotoFiles.map(f => ({
        data: `data:${f.mimetype};base64,${fs.readFileSync(f.path).toString('base64')}`,
        name: f.originalname,
      }));

      // Mark (2026-05-19): "no site images in the quote" — video-mode
      // attached photos were thrown away with the multer temp files after
      // analysis. Persist them now into user_photos with the same shape
      // photo-mode uses (context='draft', slot='extra-N'), BEFORE the
      // finally-block cleanup. loadPhotos picks them up on Step 4 + save
      // → user_photos rows are re-keyed to the saved jobId at quote save
      // time (existing flow). Best-effort per-row: a single malformed
      // photo blob must not 500 the whole analysis.
      for (let i = 0; i < extraPhotos.length; i++) {
        const p = extraPhotos[i];
        try {
          await pool.query(
            `INSERT INTO user_photos (user_id, context, slot, data, label, name, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())
             ON CONFLICT (user_id, context, slot)
             DO UPDATE SET data = $4, label = $5, name = $6, updated_at = NOW()`,
            [userId, 'draft', `extra-${i}`, p.data, p.label || 'Site photo', p.name || null]
          );
        } catch (err) {
          console.warn(`[Video] persist photo ${i} failed user=${userId} job=${jobId}: ${err.message}`);
        }
      }
      if (extraPhotos.length > 0) {
        console.log(`[Video] persist photos user=${userId} job=${jobId} count=${extraPhotos.length}`);
      }

      videoProgress.emit(jobId, { stage: 'processing', progress: 10, message: 'Processing video...' });

      const result = await processVideo({
        videoPath: videoFile.path,
        jobId,
        extraNotes: briefNotes,
        extraPhotos,
        siteAddress,
        profile,
      });

      console.log(`[Video] SUCCESS user=${userId} job=${jobId} frames=${result.frames.length} transcript=${result.transcript.length}chars`);

      videoProgress.emit(jobId, { stage: 'analysing', progress: 50, message: 'Analysing with AI...' });

      // Build imageContent array in the same format as the photo analysis pipeline.
      // Job context goes FIRST so Claude knows location + scale references before
      // it starts spatial reasoning over the frames. Then a hierarchy preamble
      // tells the model which images are the primary capture (video frames)
      // vs supplementary detail (extra photos) so a single labelled reference
      // card photo isn't lost among 50 walking frames.
      const imageContent = [];

      const videoScaleBlock = scaleReferences.trim()
        ? `\nUSER-PROVIDED SCALE REFERENCES: ${scaleReferences.trim()}`
        : '';
      const observationsBlock = result.combinedNotes
        ? `\nTRADESMAN'S ON-SITE OBSERVATIONS (voice transcript + notes):\n${result.combinedNotes}`
        : '';
      // Profile-aware prompting (2026-06-02): emit TRADESMAN PROFILE
      // ahead of JOB CONTEXT so Claude knows who the tradesman is
      // (region context, preferred stones, mortar usage) before it
      // reasons over the video frames. Photos always win over these
      // priors — see tradesmanProfileBlock.js for the prior-not-veto
      // wording on mortarUsage.
      const tradesmanProfileBlock = buildTradesmanProfileBlock(profile);
      imageContent.push({
        type: 'text',
        text: `${tradesmanProfileBlock}JOB CONTEXT\nSite address: ${siteAddress}${observationsBlock}${videoScaleBlock}`,
      });

      imageContent.push({
        type: 'text',
        text: `PRIMARY CAPTURE — ${result.frames.length} key frame${result.frames.length === 1 ? '' : 's'} extracted from a video walkthrough. Use these for spatial coherence and overall scope.${result.extraPhotoFrames.length > 0 ? ` SUPPLEMENTARY — ${result.extraPhotoFrames.length} additional photograph${result.extraPhotoFrames.length === 1 ? '' : 's'} (typically close-ups or a reference card). Use for detail confirmation; the reference card if present is the authoritative scale anchor.` : ''}`,
      });

      // Video frames
      for (let i = 0; i < result.frames.length; i++) {
        imageContent.push({ type: 'text', text: `--- Video Frame ${i + 1} ---` });
        imageContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: result.frames[i].mediaType,
            data: result.frames[i].base64,
          },
        });
      }

      // Extra photos
      for (let i = 0; i < result.extraPhotoFrames.length; i++) {
        imageContent.push({ type: 'text', text: `--- Additional Photo ${i + 1} ---` });
        imageContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: result.extraPhotoFrames[i].mediaType,
            data: result.extraPhotoFrames[i].base64,
          },
        });
      }

      // Now call the same Anthropic analysis pipeline the photo path uses
      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
      }

      // Load calibration notes
      let augmentedPrompt = SYSTEM_PROMPT;
      try {
        const { rows: calNotes } = await pool.query(
          `SELECT field_type, field_label, note FROM calibration_notes WHERE status = 'approved' ORDER BY approved_at ASC`
        );
        if (calNotes.length > 0) {
          const dynamicSection = calNotes.map((n, i) =>
            `${i + 1}. [${n.field_type}/${n.field_label}] ${n.note}`
          ).join('\n');
          augmentedPrompt += `\n\nDYNAMIC CALIBRATION NOTES:\n${dynamicSection}`;
        }
      } catch (err) {
        console.warn('[Video] Failed to load calibration notes:', err.message);
      }

      const promptVersion = computePromptVersion(SYSTEM_PROMPT, augmentedPrompt.slice(SYSTEM_PROMPT.length));

      const analysisResponse = await callAnthropicRaw({
        systemPrompt: augmentedPrompt,
        messages: [{ role: 'user', content: imageContent }],
        model: 'claude-sonnet-4-5-20250929',
        maxTokens: 4000,
        // Low temperature for structured measurement extraction so
        // identical inputs converge on similar outputs. Without this,
        // re-running analysis on the same video produced ~£10k swings
        // (Paul, 2026-05-13). Damage prose can sound slightly more
        // stilted at 0, so 0.2 balances determinism against readability.
        temperature: 0.2,
        apiKey,
      });

      const rawText = analysisResponse.content?.[0]?.text || '';

      // Parse, validate, and normalise using the same aiParser pipeline as the photo path (#1)
      const parsed = parseAIResponse(rawText);
      if (!parsed) {
        return res.status(422).json({ error: 'Analysis returned an unreadable response. Try again.' });
      }

      const aiValidation = validateAIResponse(parsed);
      if (!aiValidation.valid) {
        console.warn('[Video] AI response validation warnings:', aiValidation.errors);
      }

      let normalised = normalizeAIResponse(parsed);
      normalised.referenceCardDetected = parsed.referenceCardDetected;
      normalised.stoneType = parsed.stoneType;
      normalised.additionalCosts = [];
      normalised.labourEstimate.dayRate = profile.dayRate;

      // Enforce confidence floor based on scale-anchor availability and
      // plausibility bounds — same post-processing the photo path uses.
      normalised = applyMeasurementPlausibilityBounds(normalised, { scaleReferences });

      videoProgress.emit(jobId, { stage: 'reviewing', progress: 80, message: 'Reviewing analysis...' });

      // Self-critique — wall-clock capped so a slow Haiku call can't
      // strand the user on the "Reviewing analysis..." screen.
      let finalNormalised = normalised;
      let critiqueNotes = null;
      const critiqueStart = Date.now();
      try {
        const critiqueResult = await withTimeout(
          runSelfCritique({
            pool,
            userId,
            jobId: null,
            analysis: normalised,
            briefNotes: result.combinedNotes || '',
          }),
          SELF_CRITIQUE_TIMEOUT_MS,
          'Video self-critique'
        );
        finalNormalised = critiqueResult.analysis;
        critiqueNotes = critiqueResult.critique;
        console.log(`[Video] Self-critique OK user=${userId} job=${jobId} dur=${Date.now() - critiqueStart}ms`);
      } catch (err) {
        console.warn(`[Video] Self-critique skipped user=${userId} job=${jobId} dur=${Date.now() - critiqueStart}ms reason=${err.message}`);
      }

      videoProgress.finish(jobId);

      // Return the same shape the frontend expects: { normalised, rawResponse, critiqueNotes } (#1)
      res.json({
        normalised: finalNormalised,
        rawResponse: rawText,
        critiqueNotes,
        promptVersion,
        transcript: result.transcript,
      });

      // Analytics Phase 1 — fire quote_analysed on the video success
      // path. `source: 'video'` distinguishes from the photo route so
      // the funnel can compare drop-off between the two capture modes.
      recordEvent('quote_analysed', userId, {
        source: 'video',
        durationMs: Date.now() - videoAnalyseStart,
        freeOrPaid: videoGateReason,
      }).catch(() => {});

      // Quota accounting (2026-06-22, pay-as-you-go pack 2026-06-24).
      // For the video path the jobId already exists (the SPA creates the
      // job row before upload), so we key the grant on `job:${jobId}` —
      // stable across retries of the same upload. ON CONFLICT DO NOTHING
      // dedupes so a re-upload of the same job burns at most one quote.
      //
      // Which bucket gets decremented is decided by the gate at the
      // pre-flight check above (videoGateReason). Subscribed and comped
      // users don't have a bucket to decrement.
      if (videoGateReason === 'free-remaining') {
        pool.query(
          `WITH inserted AS (
             INSERT INTO free_quote_grants (user_id, quote_token)
             VALUES ($1, $2)
             ON CONFLICT (user_id, quote_token) DO NOTHING
             RETURNING user_id
           )
           UPDATE users
              SET free_quotes_used = free_quotes_used + 1
            WHERE id = $1
              AND EXISTS (SELECT 1 FROM inserted)`,
          [userId, `job:${jobId}`]
        ).catch((err) =>
          console.warn('[Video] free_quotes increment failed:', err.message)
        );
      } else if (videoGateReason === 'purchased-remaining') {
        pool.query(
          `WITH inserted AS (
             INSERT INTO free_quote_grants (user_id, quote_token)
             VALUES ($1, $2)
             ON CONFLICT (user_id, quote_token) DO NOTHING
             RETURNING user_id
           )
           UPDATE users
              SET purchased_quotes = GREATEST(0, purchased_quotes - 1)
            WHERE id = $1
              AND EXISTS (SELECT 1 FROM inserted)`,
          [userId, `job:${jobId}`]
        ).catch((err) =>
          console.warn('[Video] purchased_quotes decrement failed:', err.message)
        );
      }

      // Referrals Phase 1 (2026-06-23): credit referrer on first
      // analysis (video path mirrors the photo path). See the helper
      // for the FOR-UPDATE idempotency story.
      maybeCreditReferrerOnFirstAnalysis(userId).catch(() => {});
    } catch (err) {
      console.error(`[Video] FAIL user=${userId} job=${jobId} error=${err.message}`);
      videoProgress.error(jobId, err.message);
      const classified = classifyAnalysisError(err);
      if (classified) {
        return res.status(classified.status).json({ error: classified.message });
      }
      safeError(res, err, `POST /api/users/:id/jobs/:jobId/video user=${userId}`);
    } finally {
      // Clean up uploaded files (#7)
      try { if (videoFile?.path) fs.unlinkSync(videoFile.path); } catch {}
      for (const f of extraPhotoFiles) {
        try { if (f?.path) fs.unlinkSync(f.path); } catch {}
      }
      // Delay destroy to let SSE "complete" event flush to client
      setTimeout(() => videoProgress.destroy(jobId), 1000);
    }
  }
);

// SECURITY (sec-audit H-1): cap what the proxy will forward.
// Pre-fix this endpoint was a raw passthrough — client could request
// any model + arbitrary max_tokens + arbitrary message volume,
// trivially burning Anthropic credits ($50+/hour/account at Opus).
// We now enforce a model allowlist, a token ceiling, a body-size
// ceiling, and a defensive message-array length cap.
const ANTHROPIC_MODEL_ALLOWLIST = new Set([
  'claude-sonnet-4-5-20250929',     // primary analysis
  'claude-haiku-4-5-20251001',    // agent calls
  // Add new models explicitly. Never wildcard.
]);
const ANTHROPIC_MAX_TOKENS_CEILING = 8192;   // generous for analysis output
const ANTHROPIC_MAX_BODY_BYTES = 250_000;    // photos arrive in /analyse, not here
const ANTHROPIC_MAX_MESSAGES = 20;

function validateAnthropicProxyBody(body) {
  if (!body || typeof body !== 'object') return 'Request body must be a JSON object';
  if (typeof body.model !== 'string' || !ANTHROPIC_MODEL_ALLOWLIST.has(body.model)) {
    return `Model not permitted by proxy. Allowed: ${[...ANTHROPIC_MODEL_ALLOWLIST].join(', ')}`;
  }
  if (typeof body.max_tokens !== 'number' || body.max_tokens <= 0) {
    return 'max_tokens must be a positive number';
  }
  if (body.max_tokens > ANTHROPIC_MAX_TOKENS_CEILING) {
    return `max_tokens must be \u2264 ${ANTHROPIC_MAX_TOKENS_CEILING}`;
  }
  if (!Array.isArray(body.messages)) return 'messages must be an array';
  if (body.messages.length === 0 || body.messages.length > ANTHROPIC_MAX_MESSAGES) {
    return `messages length must be between 1 and ${ANTHROPIC_MAX_MESSAGES}`;
  }
  return null;
}

app.post('/api/anthropic/messages', aiRateLimitPerIp, requireAuth, aiRateLimit, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  const validationError = validateAnthropicProxyBody(req.body);
  if (validationError) {
    console.warn(`[AI-proxy] reject user=${req.user?.id} reason="${validationError}"`);
    return res.status(400).json({ error: validationError });
  }

  const body = JSON.stringify(req.body);
  if (body.length > ANTHROPIC_MAX_BODY_BYTES) {
    console.warn(`[AI-proxy] reject user=${req.user?.id} reason="body too large (${body.length}b)"`);
    return res.status(413).json({ error: `Request too large (${body.length} bytes; max ${ANTHROPIC_MAX_BODY_BYTES})` });
  }

  for (let attempt = 0; attempt < ANTHROPIC_MAX_RETRIES; attempt++) {
    try {
      const result = await makeAnthropicRequest(body, apiKey);

      if (RETRYABLE_STATUS_CODES.has(result.statusCode) && attempt < ANTHROPIC_MAX_RETRIES - 1) {
        // Cap Retry-After at 5 minutes. Anthropic's real values stay
        // well under this; an unexpectedly large header (upstream bug
        // or MITM) would otherwise stall the proxy for hours.
        const retryAfterRaw = parseInt(result.headers['retry-after'] || '0', 10);
        const retryAfterSecs = Number.isFinite(retryAfterRaw) ? Math.min(Math.max(retryAfterRaw, 0), 300) : 0;
        const delay = result.statusCode === 429
          ? Math.max(ANTHROPIC_RETRY_DELAYS[attempt], retryAfterSecs * 1000)
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
        res.status(502).json({ error: 'Analysis service temporarily unavailable. Please try again.' });
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
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.put('/api/admin/calibration-notes/:noteId', requireAuth, requireAdminPlan, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Status must be approved or rejected' });
    }
    const approvedAt = status === 'approved' ? new Date() : null;
    const { rowCount } = await pool.query(
      `UPDATE calibration_notes
       SET status = $1, approved_by = $2, approved_at = $3
       WHERE id = $4`,
      [status, req.user.id, approvedAt, req.params.noteId]
    );
    if (rowCount === 0) return res.status(404).json({ error: 'Calibration note not found' });
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
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
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// ─────────────────────────────────────────────────────────────────────
// TRQ-174: Admin Analytics endpoint
//
// Single round-trip aggregator for the Analytics dashboard. Returns
// users / quotes / spend / reliability / portal-engagement sections in
// one response so the frontend doesn't fan out into 6 separate
// requests on every page load.
//
// Range: ?range=24h | 7d | 30d | all (default 30d). All tables that
// support a created_at filter are scoped by this window; users are
// always returned in full because "users that haven't logged in" is a
// dashboard signal too.
//
// Cached in-memory for 60s — Mark refreshing the tab won't re-run the
// 6 aggregate queries every time. Cache is per-range and clears on
// process restart (acceptable; this is a 2-user app).
// ─────────────────────────────────────────────────────────────────────
const ANALYTICS_CACHE_MS = 60_000;
const analyticsCache = new Map(); // range → { at, payload }

function rangeToInterval(range) {
  // Returns a Postgres-friendly interval expression OR null for "all".
  switch (range) {
    case '24h': return '24 hours';
    case '7d':  return '7 days';
    case '30d': return '30 days';
    case 'all': return null;
    default:    return '30 days';
  }
}

app.get('/api/admin/analytics', requireAuth, requireAdminPlan, async (req, res) => {
  const range = ['24h', '7d', '30d', 'all'].includes(req.query.range)
    ? req.query.range : '30d';
  // Analytics Phase 1: the "Exclude internal" toggle changes the SQL
  // predicate for the events section, so the cache key must include
  // it. Other sections aren't affected by this flag, so we still get
  // useful cache hits across toggle switches at the same range.
  const excludeInternalKey = req.query.excludeInternal !== '0' ? 'ex1' : 'ex0';
  const cacheKey = `${range}:${excludeInternalKey}`;
  const cached = analyticsCache.get(cacheKey);
  if (cached && Date.now() - cached.at < ANALYTICS_CACHE_MS) {
    return res.json(cached.payload);
  }
  const interval = rangeToInterval(range); // null = all-time
  // Built up below. Each section runs in a single SQL round-trip.
  // PostgreSQL DATE arithmetic: COALESCE($N::interval, 'NULL'::interval)
  // doesn't work cleanly, so we conditionally append the interval
  // predicate string-side. NEVER interpolate user input — only the
  // hard-coded interval map values below are interpolated.
  const intervalSql = interval ? `INTERVAL '${interval}'` : null;
  const sinceFilter = (col) => intervalSql ? `${col} > NOW() - ${intervalSql}` : 'TRUE';

  try {
    // ── Users section ────────────────────────────────────────────────
    const usersQuery = pool.query(`
      SELECT id, name, plan, auth_provider, created_at AS "createdAt",
             last_login_at AS "lastLoginAt"
      FROM users ORDER BY last_login_at DESC NULLS LAST
    `);
    // Count signups in the window
    const signupsQuery = pool.query(`
      SELECT COUNT(*)::int AS "count" FROM users WHERE ${sinceFilter('created_at')}
    `);

    // ── Quote activity ───────────────────────────────────────────────
    const quotesQuery = pool.query(`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(*) FILTER (WHERE status = 'draft')::int AS "drafts",
        COUNT(*) FILTER (WHERE status = 'sent')::int AS "sent",
        COUNT(*) FILTER (WHERE status = 'accepted')::int AS "accepted",
        COUNT(*) FILTER (WHERE status = 'declined')::int AS "declined",
        COUNT(*) FILTER (WHERE status = 'completed')::int AS "completed",
        COALESCE(SUM(total_amount) FILTER (WHERE status IN ('sent','accepted','completed')), 0)::float AS "totalValueGbp",
        COALESCE(AVG(total_amount) FILTER (WHERE status IN ('sent','accepted','completed')), 0)::float AS "avgValueGbp",
        COUNT(*) FILTER (WHERE quote_snapshot->>'captureMode' = 'video')::int AS "videoMode",
        COUNT(*) FILTER (WHERE quote_snapshot->>'captureMode' = 'photos')::int AS "photoMode",
        COUNT(*) FILTER (WHERE quote_snapshot->>'quoteMode' = 'quick')::int AS "quickMode"
      FROM jobs WHERE ${sinceFilter('saved_at')}
    `);

    // ── Per-user quote + spend roll-up ───────────────────────────────
    // Joins jobs with agent_runs (token spend includes both 'analyse'
    // calls and background agent_types) and dictation_runs (Whisper).
    // Returns one row per user so the dashboard table can sort/filter.
    //
    // TRQ-15 additions: ramsCount (how many of this user's quotes have
    // RAMS attached), failedAnalyseCalls (per-user failure attribution),
    // activeDays (distinct days this user actually saved a quote in
    // the window — a "did they show up" metric better than raw login
    // counts since we don't log every sign-in event).
    const perUserQuery = pool.query(`
      WITH user_jobs AS (
        SELECT user_id,
               COUNT(*)::int AS jobs,
               COUNT(*) FILTER (WHERE has_rams = TRUE)::int AS rams_count,
               COUNT(DISTINCT DATE(saved_at))::int AS active_days,
               COALESCE(SUM(total_amount) FILTER (WHERE status IN ('sent','accepted','completed')), 0)::float AS quoted_value,
               MAX(saved_at) AS last_quote_at
        FROM jobs WHERE ${sinceFilter('saved_at')}
        GROUP BY user_id
      ),
      user_fails AS (
        SELECT user_id,
               COUNT(*) FILTER (WHERE agent_type = 'analyse')::int AS failed_analyse,
               COUNT(*)::int AS failed_total
        FROM agent_runs
        WHERE status = 'failed' AND ${sinceFilter('created_at')}
        GROUP BY user_id
      ),
      user_tokens AS (
        -- TRQ-176 fix: jsonb_object_agg throws on a NULL key, and
        -- pre-TRQ-173 agent_runs rows have model IS NULL. COALESCE the
        -- key to 'unknown' so old rows bucket cleanly. analyse_calls
        -- is also filtered to agent_type='analyse' (was counting every
        -- agent run, including background self_critique/feedback —
        -- misleading on the dashboard).
        SELECT user_id,
               COUNT(*) FILTER (WHERE agent_type = 'analyse')::int AS analyse_calls,
               COALESCE(SUM(prompt_tokens), 0)::bigint AS prompt_tokens,
               COALESCE(SUM(completion_tokens), 0)::bigint AS completion_tokens,
               jsonb_object_agg(COALESCE(model, 'unknown'), COALESCE(model_tokens, 0)) AS by_model
        FROM (
          SELECT user_id, agent_type, model, prompt_tokens, completion_tokens,
                 SUM(COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0))
                   OVER (PARTITION BY user_id, model) AS model_tokens
          FROM agent_runs WHERE ${sinceFilter('created_at')}
        ) t
        GROUP BY user_id
      ),
      user_audio AS (
        SELECT user_id, COALESCE(SUM(audio_bytes), 0)::bigint AS audio_bytes
        FROM dictation_runs WHERE ${sinceFilter('created_at')}
        GROUP BY user_id
      )
      SELECT
        u.id AS "userId", u.name, u.plan, u.last_login_at AS "lastLoginAt",
        COALESCE(j.jobs, 0) AS "jobs",
        COALESCE(j.rams_count, 0) AS "ramsCount",
        COALESCE(j.active_days, 0) AS "activeDays",
        COALESCE(j.quoted_value, 0) AS "quotedValue",
        j.last_quote_at AS "lastQuoteAt",
        COALESCE(t.analyse_calls, 0) AS "analyseCalls",
        COALESCE(f.failed_analyse, 0) AS "failedAnalyseCalls",
        COALESCE(f.failed_total, 0) AS "failedTotal",
        COALESCE(t.prompt_tokens, 0)::bigint AS "promptTokens",
        COALESCE(t.completion_tokens, 0)::bigint AS "completionTokens",
        t.by_model AS "tokensByModel",
        COALESCE(a.audio_bytes, 0)::bigint AS "whisperAudioBytes"
      FROM users u
      LEFT JOIN user_jobs j ON j.user_id = u.id
      LEFT JOIN user_tokens t ON t.user_id = u.id
      LEFT JOIN user_fails f ON f.user_id = u.id
      LEFT JOIN user_audio a ON a.user_id = u.id
      ORDER BY COALESCE(t.prompt_tokens + t.completion_tokens, 0) DESC
    `);

    // ── Per-quote spend (top 20 most-expensive quotes in window) ─────
    const perQuoteQuery = pool.query(`
      SELECT
        ar.job_id AS "jobId", ar.user_id AS "userId",
        j.client_name AS "clientName", j.quote_reference AS "quoteReference",
        SUM(COALESCE(ar.prompt_tokens, 0))::bigint AS "promptTokens",
        SUM(COALESCE(ar.completion_tokens, 0))::bigint AS "completionTokens",
        COUNT(*)::int AS "calls",
        MAX(ar.created_at) AS "lastCallAt"
      FROM agent_runs ar
      LEFT JOIN jobs j ON j.id = ar.job_id
      WHERE ar.job_id IS NOT NULL AND ${sinceFilter('ar.created_at')}
      GROUP BY ar.job_id, ar.user_id, j.client_name, j.quote_reference
      ORDER BY (SUM(COALESCE(ar.prompt_tokens, 0)) + SUM(COALESCE(ar.completion_tokens, 0))) DESC
      LIMIT 20
    `);

    // ── Spend totals by model (for the "where the bill goes" chart) ──
    const spendByModelQuery = pool.query(`
      SELECT model,
             COALESCE(SUM(prompt_tokens), 0)::bigint AS "promptTokens",
             COALESCE(SUM(completion_tokens), 0)::bigint AS "completionTokens",
             COUNT(*)::int AS calls
      FROM agent_runs WHERE model IS NOT NULL AND ${sinceFilter('created_at')}
      GROUP BY model
      ORDER BY (SUM(prompt_tokens) + SUM(completion_tokens)) DESC NULLS LAST
    `);

    // ── Reliability — failures + retry queue depth ───────────────────
    const failuresQuery = pool.query(`
      SELECT id, user_id AS "userId", agent_type AS "agentType",
             error, model, created_at AS "createdAt"
      FROM agent_runs
      WHERE status = 'failed' AND ${sinceFilter('created_at')}
      ORDER BY created_at DESC LIMIT 50
    `);
    const retryQueueQuery = pool.query(`
      SELECT COUNT(*)::int AS "depth",
             COUNT(*) FILTER (WHERE attempts >= 2)::int AS "stuck"
      FROM agent_retry_queue
    `);

    // ── Portal engagement ────────────────────────────────────────────
    const portalQuery = pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE client_token IS NOT NULL)::int AS "tokensIssued",
        COUNT(*) FILTER (WHERE client_viewed_at IS NOT NULL)::int AS "viewed",
        COUNT(*) FILTER (WHERE client_response IS NOT NULL)::int AS "responded",
        COUNT(*) FILTER (WHERE client_response = 'accepted')::int AS "accepted",
        COUNT(*) FILTER (WHERE client_response = 'declined')::int AS "declined"
      FROM jobs
      WHERE client_token IS NOT NULL AND ${sinceFilter('saved_at')}
    `);

    // ── Daily spend trend (last 30 days regardless of range — chart) ──
    const dailyTrendQuery = pool.query(`
      SELECT DATE(created_at) AS "date",
             COALESCE(SUM(prompt_tokens), 0)::bigint AS "promptTokens",
             COALESCE(SUM(completion_tokens), 0)::bigint AS "completionTokens"
      FROM agent_runs
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `);

    // ── TRQ-15: new time series ──────────────────────────────────────
    // All windowed to fixed periods (not the selected range) so the
    // charts always show meaningful history regardless of the user's
    // filter. The dashboard re-renders these as sparklines.

    // Quotes saved per week (12 weeks) — answers ticket req #11.
    const quotesPerWeekQuery = pool.query(`
      SELECT DATE_TRUNC('week', saved_at)::date AS "week",
             COUNT(*)::int AS "count"
      FROM jobs
      WHERE saved_at > NOW() - INTERVAL '12 weeks'
      GROUP BY DATE_TRUNC('week', saved_at)
      ORDER BY DATE_TRUNC('week', saved_at) ASC
    `);

    // Failures per day (30d) — agent_type='analyse' + RAMS subtype if
    // we add one later. For now any failed agent_run counts; the chart
    // separates by agent_type via the optional groupings field.
    const failuresPerDayQuery = pool.query(`
      SELECT DATE(created_at) AS "date",
             COUNT(*)::int AS "count",
             COUNT(*) FILTER (WHERE agent_type = 'analyse')::int AS "analyseFails"
      FROM agent_runs
      WHERE status = 'failed' AND created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `);

    // Signups per day (30d) — for the growth chart.
    const signupsPerDayQuery = pool.query(`
      SELECT DATE(created_at) AS "date",
             COUNT(*)::int AS "count"
      FROM users
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `);

    // Page views per day (30d) — landing + SPA route changes.
    // Anonymous (user_id NULL) and authenticated views are summed; the
    // distinct-sessions metric is computed in JS below.
    const pageviewsPerDayQuery = pool.query(`
      SELECT DATE(created_at) AS "date",
             COUNT(*)::int AS "count",
             COUNT(DISTINCT session_id)::int AS "sessions"
      FROM pageviews
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `);

    // Pageviews top paths (30d) — answers "which landing pages get traffic".
    const pageviewsTopPathsQuery = pool.query(`
      SELECT path, COUNT(*)::int AS "count"
      FROM pageviews
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY path
      ORDER BY COUNT(*) DESC
      LIMIT 10
    `);

    // Analytics Phase 1 (2026-06-29) — events feed for the dashboard.
    // The default UI toggle excludes internal users (Harry + Mark)
    // since their QA traffic skews the conversion percentages. The
    // server returns BOTH the all-rows totals and a separate
    // funnel-with-internal-excluded set so the client can render
    // either view without a second round-trip.
    //
    // "Exclude internal" is implemented as a SQL predicate on
    // `props->>'internal'`. Anything other than the literal string
    // 'true' passes the filter, so external users (no internal prop)
    // and the few rows where the env-var was set after the event are
    // both counted as external.
    const excludeInternalSql = `COALESCE(props->>'internal', '') <> 'true'`;
    const eventsExcludeInternal = req.query.excludeInternal !== '0';
    const eventsFilter = eventsExcludeInternal ? `AND ${excludeInternalSql}` : '';

    // Top event names by count over the selected range (defaults to
    // 30d via rangeToInterval). Capped at 20 rows — the allowlist is
    // 15 names so any growth beyond that is a noisy bug.
    const eventsTopQuery = pool.query(`
      SELECT event_name AS "eventName", COUNT(*)::int AS "count"
      FROM events
      WHERE ${sinceFilter('created_at')}
        ${eventsFilter}
      GROUP BY event_name
      ORDER BY COUNT(*) DESC
      LIMIT 20
    `);

    // Funnel counts — distinct users per stage so a power user who
    // analyses 20 quotes doesn't dominate the funnel percentages.
    const eventsFunnelQuery = pool.query(`
      SELECT event_name AS "eventName",
             COUNT(DISTINCT user_id)::int AS "users",
             COUNT(*)::int AS "count"
      FROM events
      WHERE ${sinceFilter('created_at')}
        ${eventsFilter}
        AND event_name IN (
          'signup_completed', 'profile_completed', 'quote_started',
          'quote_analysed', 'quote_sent', 'client_responded'
        )
      GROUP BY event_name
    `);

    // Total events + raw distinct-users headline.
    const eventsSummaryQuery = pool.query(`
      SELECT COUNT(*)::int AS "total",
             COUNT(DISTINCT user_id)::int AS "users"
      FROM events
      WHERE ${sinceFilter('created_at')}
        ${eventsFilter}
    `);

    // System errors over time + recent. Limited to 30 days for the
    // chart and 50 rows for the table. Both feed the new Errors
    // section in Analytics.jsx.
    const errorsPerDayQuery = pool.query(`
      SELECT DATE(created_at) AS "date",
             COUNT(*)::int AS "count"
      FROM system_errors
      WHERE created_at > NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY DATE(created_at) ASC
    `);
    const errorsRecentQuery = pool.query(`
      SELECT id, user_id AS "userId", source, route, status_code AS "statusCode",
             message, created_at AS "createdAt"
      FROM system_errors
      ORDER BY created_at DESC LIMIT 50
    `);

    // Retention — simple metrics, not a full cohort grid (2 users today
    // would make the grid meaningless). Three signals:
    //   - signups7d / converted7d : of last week's signups, how many
    //     saved at least one quote within 7 days of joining?
    //   - d7Active / d14Active     : of all users who signed up >=7d
    //     ago, how many were active in the last 7d / 14d?
    const retentionQuery = pool.query(`
      WITH new_signups AS (
        SELECT id, created_at FROM users
        WHERE created_at > NOW() - INTERVAL '30 days'
      ),
      converted AS (
        SELECT n.id
        FROM new_signups n
        WHERE EXISTS (
          SELECT 1 FROM jobs j
          WHERE j.user_id = n.id
            AND j.saved_at BETWEEN n.created_at AND n.created_at + INTERVAL '7 days'
        )
      ),
      eligible AS (
        -- "Established" users — signed up at least 7 days ago. Avoids
        -- counting brand-new users (who haven't HAD 7 days to be
        -- inactive) as churned.
        SELECT id FROM users WHERE created_at < NOW() - INTERVAL '7 days'
      ),
      active_7d AS (
        SELECT DISTINCT user_id FROM jobs
        WHERE saved_at > NOW() - INTERVAL '7 days'
      ),
      active_14d AS (
        SELECT DISTINCT user_id FROM jobs
        WHERE saved_at > NOW() - INTERVAL '14 days'
      )
      SELECT
        (SELECT COUNT(*)::int FROM new_signups) AS "newSignups30d",
        (SELECT COUNT(*)::int FROM converted) AS "convertedIn7d",
        (SELECT COUNT(*)::int FROM eligible) AS "eligibleUsers",
        (SELECT COUNT(*)::int FROM eligible e JOIN active_7d a ON a.user_id = e.id) AS "d7Active",
        (SELECT COUNT(*)::int FROM eligible e JOIN active_14d a ON a.user_id = e.id) AS "d14Active"
    `);

    const [
      usersRes, signupsRes, quotesRes, perUserRes, perQuoteRes,
      spendByModelRes, failuresRes, retryQueueRes, portalRes, dailyTrendRes,
      quotesPerWeekRes, failuresPerDayRes, signupsPerDayRes,
      pageviewsPerDayRes, pageviewsTopPathsRes,
      errorsPerDayRes, errorsRecentRes, retentionRes,
      eventsTopRes, eventsFunnelRes, eventsSummaryRes,
    ] = await Promise.all([
      usersQuery, signupsQuery, quotesQuery, perUserQuery, perQuoteQuery,
      spendByModelQuery, failuresQuery, retryQueueQuery, portalQuery, dailyTrendQuery,
      quotesPerWeekQuery, failuresPerDayQuery, signupsPerDayQuery,
      pageviewsPerDayQuery, pageviewsTopPathsQuery,
      errorsPerDayQuery, errorsRecentQuery, retentionQuery,
      eventsTopQuery, eventsFunnelQuery, eventsSummaryQuery,
    ]);

    // Convert per-user token totals into £ for the dashboard. Per-user
    // by_model is a JSON object — sum each model's £ separately so a
    // user with mixed Sonnet+Haiku usage gets a correct total.
    const usersWithCost = perUserRes.rows.map((u) => {
      let modelCostGbp = 0;
      const byModel = u.tokensByModel || {};
      for (const [model, totalTokens] of Object.entries(byModel)) {
        // The window-function aggregate above sums prompt+completion
        // per (user, model) but we only have the combined number here.
        // For the per-user table treat the split as 70/30 (typical for
        // analyse calls) — the breakdown chart uses the exact split
        // from spendByModel below for accuracy. Acceptable approximation
        // for the user-table column which is "spend overview".
        const numericTokens = Number(totalTokens) || 0;
        modelCostGbp += tokensToGbp(model, numericTokens * 0.7, numericTokens * 0.3);
      }
      const audioBytes = Number(u.whisperAudioBytes) || 0;
      const whisperGbp = whisperBytesToGbp(audioBytes);
      return {
        ...u,
        promptTokens: Number(u.promptTokens) || 0,
        completionTokens: Number(u.completionTokens) || 0,
        whisperAudioBytes: audioBytes,
        estimatedCostGbp: Number((modelCostGbp + whisperGbp).toFixed(4)),
      };
    });

    const perQuoteWithCost = perQuoteRes.rows.map((q) => {
      const promptTokens = Number(q.promptTokens) || 0;
      const completionTokens = Number(q.completionTokens) || 0;
      // Per-quote we don't know the model split — use Sonnet 4 as the
      // default since analyse calls are Sonnet (background agents on
      // Haiku contribute much less spend).
      const estimatedCostGbp = tokensToGbp(
        'claude-sonnet-4-5-20250929', promptTokens, completionTokens
      );
      return {
        ...q,
        promptTokens, completionTokens,
        estimatedCostGbp: Number(estimatedCostGbp.toFixed(4)),
      };
    });

    const spendByModelWithCost = spendByModelRes.rows.map((m) => {
      const promptTokens = Number(m.promptTokens) || 0;
      const completionTokens = Number(m.completionTokens) || 0;
      return {
        model: m.model, calls: m.calls,
        promptTokens, completionTokens,
        estimatedCostGbp: Number(
          tokensToGbp(m.model, promptTokens, completionTokens).toFixed(4)
        ),
      };
    });

    const totalCostGbp = spendByModelWithCost.reduce(
      (sum, m) => sum + m.estimatedCostGbp, 0
    );

    const portal = portalRes.rows[0] || {};
    const portalRates = {
      tokensIssued: portal.tokensIssued || 0,
      viewed: portal.viewed || 0,
      responded: portal.responded || 0,
      accepted: portal.accepted || 0,
      declined: portal.declined || 0,
      viewRate: portal.tokensIssued > 0
        ? Number((portal.viewed / portal.tokensIssued).toFixed(2)) : 0,
      responseRate: portal.viewed > 0
        ? Number((portal.responded / portal.viewed).toFixed(2)) : 0,
    };

    // 14-day "dormant" cut. Mark sees who hasn't been near the app.
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const dormant = usersRes.rows.filter(
      (u) => !u.lastLoginAt || new Date(u.lastLoginAt) < fourteenDaysAgo
    ).length;

    // TRQ-15: retention math. The SQL returns raw counts; the rates are
    // computed here so the client doesn't have to redo the divisions
    // for every render.
    const retention = retentionRes.rows[0] || {};
    const retentionMetrics = {
      newSignups30d: retention.newSignups30d || 0,
      convertedIn7d: retention.convertedIn7d || 0,
      conversionRate: retention.newSignups30d > 0
        ? Number((retention.convertedIn7d / retention.newSignups30d).toFixed(2)) : 0,
      eligibleUsers: retention.eligibleUsers || 0,
      d7Active: retention.d7Active || 0,
      d14Active: retention.d14Active || 0,
      d7Rate: retention.eligibleUsers > 0
        ? Number((retention.d7Active / retention.eligibleUsers).toFixed(2)) : 0,
      d14Rate: retention.eligibleUsers > 0
        ? Number((retention.d14Active / retention.eligibleUsers).toFixed(2)) : 0,
    };

    const payload = {
      range,
      generatedAt: new Date().toISOString(),
      pricing: getPriceMap(),
      users: {
        total: usersRes.rows.length,
        byPlan: usersRes.rows.reduce((acc, u) => {
          acc[u.plan] = (acc[u.plan] || 0) + 1;
          return acc;
        }, {}),
        signupsInRange: signupsRes.rows[0]?.count || 0,
        dormantCount: dormant,
        list: usersRes.rows,
      },
      quotes: quotesRes.rows[0] || {},
      perUser: usersWithCost,
      perQuote: perQuoteWithCost,
      spend: {
        totalGbp: Number(totalCostGbp.toFixed(2)),
        byModel: spendByModelWithCost,
        dailyTrend: dailyTrendRes.rows.map((d) => ({
          date: d.date,
          promptTokens: Number(d.promptTokens) || 0,
          completionTokens: Number(d.completionTokens) || 0,
        })),
      },
      reliability: {
        recentFailures: failuresRes.rows,
        retryQueueDepth: retryQueueRes.rows[0]?.depth || 0,
        retryQueueStuck: retryQueueRes.rows[0]?.stuck || 0,
      },
      portal: portalRates,
      // TRQ-15 — new sections ────────────────────────────────────────
      series: {
        quotesPerWeek: quotesPerWeekRes.rows.map((r) => ({
          week: r.week, count: r.count,
        })),
        failuresPerDay: failuresPerDayRes.rows.map((r) => ({
          date: r.date, count: r.count, analyseFails: r.analyseFails,
        })),
        signupsPerDay: signupsPerDayRes.rows.map((r) => ({
          date: r.date, count: r.count,
        })),
        pageviewsPerDay: pageviewsPerDayRes.rows.map((r) => ({
          date: r.date, count: r.count, sessions: r.sessions,
        })),
      },
      pageviews: {
        // Total + sessions for the 30d window so the dashboard can
        // render headline cards without re-summing the daily series.
        total30d: pageviewsPerDayRes.rows.reduce((sum, r) => sum + r.count, 0),
        sessions30d: pageviewsPerDayRes.rows.reduce((sum, r) => sum + r.sessions, 0),
        topPaths: pageviewsTopPathsRes.rows,
      },
      retention: retentionMetrics,
      errors: {
        perDay: errorsPerDayRes.rows.map((r) => ({
          date: r.date, count: r.count,
        })),
        recent: errorsRecentRes.rows.map((r) => ({
          ...r,
          // Truncate the per-row message so the JSON payload doesn't
          // balloon with one stack-trace-heavy row.
          message: (r.message || '').slice(0, 300),
        })),
        total30d: errorsPerDayRes.rows.reduce((sum, r) => sum + r.count, 0),
      },
      // Analytics Phase 1 (2026-06-29) — events feed for the dashboard.
      // `excludeInternal` reflects the filter the server actually
      // applied so the UI can render the toggle's current state on
      // first paint. `funnel` is an ordered list with users + count
      // per stage; the client computes drop-off percentages between
      // adjacent stages.
      events: {
        excludeInternal: eventsExcludeInternal,
        summary: eventsSummaryRes.rows[0] || { total: 0, users: 0 },
        top: eventsTopRes.rows,
        funnel: (() => {
          const STAGES = [
            'signup_completed', 'profile_completed', 'quote_started',
            'quote_analysed', 'quote_sent', 'client_responded',
          ];
          const by = new Map(
            eventsFunnelRes.rows.map((r) => [r.eventName, r])
          );
          return STAGES.map((s) => ({
            eventName: s,
            users: by.get(s)?.users || 0,
            count: by.get(s)?.count || 0,
          }));
        })(),
      },
    };

    analyticsCache.set(cacheKey, { at: Date.now(), payload });
    res.json(payload);
  } catch (err) {
    // Explicit log so a Mark-on-prod 500 leaves a footprint in
    // Railway logs we can grep for. safeError already logs but
    // genericises the client message; this gives us the SQL detail.
    console.error(`[Analytics] failed range=${range}: ${err?.message || err}`);
    if (err?.code) console.error(`[Analytics] pg code=${err.code} pos=${err.position}`);
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// ───── TRQ-150 — Stripe subscription billing (test mode for now) ─────
//
// The webhook is registered above (before express.json). These three
// routes are the user-facing surface:
//   - GET  /api/billing/status      — what the trial banner reads
//   - POST /api/billing/checkout    — opens a Stripe Checkout session
//   - POST /api/billing/portal      — opens the Stripe billing portal
//
// All three require auth. Billing routes return 503 if STRIPE_SECRET_KEY
// isn't configured rather than 500 — communicates "billing not wired
// in this environment" cleanly to the client. Staging may run without
// Stripe keys.

const billingRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 10, // 10/min/IP per route — generous for legit users, cheap on abuse
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many billing requests — wait a moment.' },
});

function requireStripe(_req, res, next) {
  if (!hasStripeKey()) {
    return res.status(503).json({
      error: 'Billing is not configured in this environment.',
      configured: false,
    });
  }
  next();
}

app.get('/api/billing/status', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { rows } = await pool.query(
      `SELECT id, plan, trial_ends_at, subscription_status,
              stripe_customer_id, current_period_end, cancel_at_period_end,
              trial_will_end_at, free_quotes_used, bonus_free_quotes,
              purchased_quotes, comp_until
       FROM users WHERE id = $1`,
      [userId]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'user not found' });
    // Quota model (2026-06-22). The legacy time-trial fields below are
    // still emitted for compatibility with older client builds, but
    // the SubscriptionBanner now drives off `quotaState`. The two are
    // independent: `state` could read "trialing" from old data while
    // `quotaState` correctly reads "free-remaining" — this is fine,
    // the banner uses quotaState first.
    const quota = resolveQuotaState(user, {
      hasActiveSubscription: user.subscription_status === 'active',
    });
    res.json({
      state: currentSubscriptionState(user),
      daysOfTrialRemaining: daysOfTrialRemaining(user),
      trialEndsAt: user.trial_ends_at,
      // TRQ-150 trial_will_end webhook: when Stripe has flagged that the
      // trial converts soon, the UI switches its banner. The bare
      // timestamp is enough — the client formats "ends in N days" from
      // it. NULL when no such signal is in-flight.
      trialWillEndAt: user.trial_will_end_at,
      currentPeriodEnd: user.current_period_end,
      cancelAtPeriodEnd: user.cancel_at_period_end || false,
      hasStripeCustomer: Boolean(user.stripe_customer_id),
      // Display copy for the trial banner — keeps the client thin.
      pricing: { gbpPerMonth: PRICE_GBP, trialDays: TRIAL_DAYS },
      configured: hasStripeKey(),
      // Quota fields (2026-06-22). Banner reads these first.
      quotaState: quota.quotaState,
      isComped: quota.isComped,
      freeQuotesUsed: quota.freeQuotesUsed,
      freeQuotesLimit: quota.freeQuotesLimit,
      hasActiveSubscription: quota.hasActiveSubscription,
      // Pay-as-you-go pack balance (2026-06-24). The persistent
      // counter uses this to render mixed-state copy.
      purchasedQuotesRemaining: quota.purchasedQuotesRemaining,
      // Pack pricing for the buy button.
      quotePack: {
        sizeQuotes: QUOTE_PACK_SIZE,
        pricePence: QUOTE_PACK_PRICE_PENCE,
        priceGbp: QUOTE_PACK_PRICE_PENCE / 100,
      },
    });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.post('/api/billing/checkout', requireAuth, billingRateLimit, requireStripe, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { rows } = await pool.query(
      `SELECT id, name, email, subscription_status FROM users WHERE id = $1`,
      [userId]
    );
    const user = rows[0];
    if (!user) return res.status(404).json({ error: 'user not found' });
    if (user.subscription_status === 'active') {
      return res.status(409).json({ error: 'already subscribed' });
    }

    // Paul's free-month is keyed off the user's id (set in env so it's
    // not hardcoded into source). When the env var holds 'paul'
    // (the seed user id) AND a coupon is configured, apply it.
    const withPaulCoupon = userId === process.env.STRIPE_PAUL_COUPON_USER_ID;

    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const { url } = await createCheckoutSession({
      userId,
      email: user.email,
      withPaulCoupon,
      successUrl: `${baseUrl}/?billing=success`,
      cancelUrl: `${baseUrl}/?billing=cancelled`,
    });
    res.json({ url });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.post('/api/billing/portal', requireAuth, billingRateLimit, requireStripe, async (req, res) => {
  try {
    const userId = req.user?.id;
    const { rows } = await pool.query(
      `SELECT stripe_customer_id FROM users WHERE id = $1`,
      [userId]
    );
    const customerId = rows[0]?.stripe_customer_id;
    if (!customerId) {
      return res.status(409).json({
        error: 'No subscription on file — start one via /api/billing/checkout first.',
      });
    }
    const baseUrl = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
    const { url } = await createPortalSession(customerId, `${baseUrl}/`);
    res.json({ url });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// ───── End TRQ-150 billing routes ─────

// ───── Pay-as-you-go quote pack (2026-06-24) ─────
//
// One-time £9.99 payment, 5 quotes, never expires. Shares the same
// Stripe account + webhook secret as TRQ-150 — the fan-out in the
// webhook handler at the top of this file calls both
// applySubscriptionEventToDb AND applyQuotePackEventToDb, and the
// two routing rules are disjoint (subscription events vs one-time
// payment events tagged metadata.fastquote_product='quote_pack').
//
// VAT: Harry is NOT VAT-registered. The Checkout session passes
// `automatic_tax: false` (see billing.js → createQuotePackCheckoutSession)
// so receipts never imply VAT. Mirror TRQ-157's pattern.
//
// Refunds are MANUAL — see docs/REFUNDS.md. No automated claw-back of
// `users.purchased_quotes` if a refund is issued.

app.post(
  '/api/billing/buy-quote-pack',
  requireAuth,
  billingRateLimit,
  requireStripe,
  async (req, res) => {
    try {
      const userId = req.user?.id;
      const { rows } = await pool.query(
        `SELECT id, email, subscription_status FROM users WHERE id = $1`,
        [userId]
      );
      const user = rows[0];
      if (!user) return res.status(404).json({ error: 'user not found' });
      // Subscribed users don't need a pack. Block to avoid taking money
      // for something that gives the user no benefit.
      if (user.subscription_status === 'active') {
        return res.status(409).json({ error: 'already subscribed' });
      }
      const baseUrl =
        process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
      const { url } = await createQuotePackCheckoutSession({
        userId,
        email: user.email,
        successUrl: `${baseUrl}/?pack_purchased=1`,
        cancelUrl: `${baseUrl}/`,
      });
      res.json({ url });
    } catch (err) {
      safeError(res, err, `${req.method} ${req.path}`);
    }
  }
);

// ───── End pay-as-you-go quote pack routes ─────

// ─────────────────────────────────────────────────────────────────────────
// Referrals Phase 1 (2026-06-23)
//
//  • GET /api/users/:id/referrals    — returns the user's code, current
//    bonus balance, and the list of referrals they've made.
//  • POST /auth/redeem-referral      — accept a code post-signup. Same
//    validation as the OAuth-callback ?ref= path; idempotent.
//
// Both routes follow the design law: referral / code / invite / bonus
// vocabulary is safe for basic users (the banned-vocab list rules out
// AI/agent terminology, not commerce-y words).
// ─────────────────────────────────────────────────────────────────────────

app.get('/api/users/:id/referrals', async (req, res) => {
  // The route is mounted under the global /api/users/:id requireAuth +
  // requireOwner pair, so we know req.params.id is the caller's own id.
  try {
    const userId = req.params.id;
    const { rows: userRows } = await pool.query(
      'SELECT name, bonus_free_quotes FROM users WHERE id = $1',
      [userId]
    );
    if (userRows.length === 0) return res.status(404).json({ error: 'user not found' });
    const user = userRows[0];

    const code = await getOrCreateReferralCode(userId, user.name);

    const { rows: referrals } = await pool.query(
      `SELECT r.id, r.created_at AS "signedUpAt", r.first_analysis_at AS "firstAnalysisAt",
              u.name AS "refereeName"
         FROM referrals r
         JOIN users u ON u.id = r.referee_user_id
        WHERE r.referrer_user_id = $1
        ORDER BY r.created_at DESC`,
      [userId]
    );
    const decorated = referrals.map((r) => ({
      refereeName: r.refereeName || 'Unnamed',
      signedUpAt: r.signedUpAt,
      status: r.firstAnalysisAt ? 'earned' : 'pending',
    }));

    res.json({
      code,
      bonusFreeQuotes: Number(user.bonus_free_quotes) || 0,
      referrals: decorated,
    });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.post('/auth/redeem-referral', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'auth required' });
    const rawCode = req.body?.code;
    const result = await applyReferralAtSignup(userId, rawCode);

    // Return the updated billing block regardless of outcome so the
    // client banner re-renders without a second round-trip.
    const { rows } = await pool.query(
      `SELECT free_quotes_used, comp_until, subscription_status, bonus_free_quotes
         FROM users WHERE id = $1`,
      [userId]
    );
    const u = rows[0];
    const billing = u
      ? resolveQuotaState(u, { hasActiveSubscription: u.subscription_status === 'active' })
      : null;

    if (result.applied) {
      // Analytics — fire referral_redeemed for the manual-entry path
      // (matches the URL-redemption fire in /auth/google/callback so
      // both code paths show up in the funnel identically).
      recordEvent('referral_redeemed', userId, {
        code: String(rawCode || '').slice(0, 64),
        referrerId: result.referrerUserId || null,
      }).catch(() => {});
      return res.json({ applied: true, billing });
    }
    // Spec: invalid (unknown / self / already-redeemed) does NOT error
    // — it falls through as a no-op. Return 200 with applied=false so
    // the client can show a quiet "code not recognised" message.
    return res.json({ applied: false, reason: result.reason, billing });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// ───── End Referrals Phase 1 routes ─────

// Approved calibration notes for system prompt assembly
app.get('/api/calibration-notes/approved', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT field_type, field_label, note, evidence, approved_at
       FROM calibration_notes
       WHERE status = 'approved'
       ORDER BY approved_at ASC`
    );
    res.json(rows);
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// --- Server-side Analysis Endpoint (with self-critique) ---

import { runSelfCritique } from './agents/selfCritique.js';
import { runFeedbackAgent } from './agents/feedbackAgent.js';
import { runCalibrationAgent } from './agents/calibrationAgent.js';
import { callAnthropicRaw, withTimeout } from './agents/agentUtils.js';
import { shouldAutoCalibrate } from './autoCalibration.js';
import { enqueueRetry, processRetryQueue } from './agents/retryQueue.js';

// Self-critique is best-effort enrichment; an uncritiqued analysis is
// still a valid analysis. Cap the wall-clock so a slow Anthropic
// response can't strand the user on the "Reviewing analysis..." screen
// (Paul saw 9+ minutes — the socket-idle timeout in callAnthropicRaw
// doesn't fire when the upstream drips bytes).
const SELF_CRITIQUE_TIMEOUT_MS = 25_000;

app.post('/api/users/:id/analyse', aiRateLimitPerIp, aiRateLimit, async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' });
  }

  const { messages, model, max_tokens } = req.body;
  if (!messages) {
    return res.status(400).json({ error: 'messages is required' });
  }

  // Quota gate (2026-06-22): 3 free quotes per user, then subscribe.
  // Active subscription OR comp_until in the future bypasses the
  // counter. The decision is centralised in src/utils/quotaGate.js —
  // /auth/me uses the same helper so the SPA banner and this server
  // gate can never disagree. Failure to load the user row is a hard
  // deny (defensive: a missing user shouldn't burn free quotes).
  const userIdParam = req.params.id;
  let quotaUser = null;
  try {
    const { rows } = await pool.query(
      `SELECT id, free_quotes_used, bonus_free_quotes, purchased_quotes,
              comp_until, subscription_status, trial_ends_at
       FROM users WHERE id = $1`,
      [userIdParam]
    );
    quotaUser = rows[0] || null;
  } catch (err) {
    console.warn('[Analyse] quota lookup failed:', err.message);
  }
  const hasActiveSubscription = quotaUser?.subscription_status === 'active';
  const gateDecision = quotaGate(quotaUser, { hasActiveSubscription });
  if (!gateDecision.allowed) {
    // Effective limit includes the referral bonus (referrals Phase 1).
    // The lockout copy MUST reflect the effective limit, not the baseline:
    // a referee who signed up with a valid code gets 5 free quotes total,
    // not 3, and the message at exhaustion must match that allowance.
    const bonus = Math.max(0, Number(quotaUser?.bonus_free_quotes) || 0);
    const effectiveLimit = FREE_QUOTES_LIMIT + bonus;
    const used = Number(quotaUser?.free_quotes_used) || 0;
    return res.status(402).json({
      error: 'quota_exhausted',
      message: `You've used your ${effectiveLimit} free quotes. Subscribe to continue.`,
      freeQuotesUsed: Math.min(used, effectiveLimit),
      freeQuotesLimit: effectiveLimit,
    });
  }

  // The client passes a `quoteToken` (UUID) generated when the user
  // started this draft (NEW_QUOTE in the reducer). Re-analyses on the
  // same draft (retry-after-error, edit-then-re-analyse) reuse it, so
  // a single ON CONFLICT DO NOTHING in free_quote_grants below keeps
  // each draft counting as exactly one free quote. Falls back to a
  // synthesised per-call token when missing — older client builds
  // don't send it; they'll burn one free quote per analyse call,
  // which is the same behaviour as the new client's first call.
  const quoteToken =
    typeof req.body.quoteToken === 'string' && req.body.quoteToken.length > 0
      ? req.body.quoteToken
      : `legacy-${crypto.randomUUID()}`;

  // TRQ-173: Analytics needs per-user / per-quote token spend. Reuse
  // the agent_runs table with agent_type='analyse' so a single query
  // covers both analyse calls and background agents. Logging is
  // best-effort — every catch is silent so observability can't break
  // the user-facing flow.
  const analyseStart = Date.now();
  let analyseRunId = null;
  try {
    const r = await pool.query(
      `INSERT INTO agent_runs (user_id, agent_type, status, model)
       VALUES ($1, 'analyse', 'running', $2) RETURNING id`,
      [req.params.id, typeof model === 'string' ? model : 'claude-sonnet-4-5-20250929']
    );
    analyseRunId = r.rows[0]?.id;
  } catch (err) {
    console.warn('[Analyse] Failed to insert agent_runs row:', err.message);
  }

  // SECURITY (sec-audit H-1): clamp model + max_tokens to the same
  // allowlist/ceiling the proxy enforces. Prevents an authenticated
  // user from forcing Opus calls or 200k-token outputs.
  const requestedModel = typeof model === 'string' ? model : 'claude-sonnet-4-5-20250929';
  if (!ANTHROPIC_MODEL_ALLOWLIST.has(requestedModel)) {
    console.warn(`[Analyse] reject user=${req.user?.id} model="${requestedModel}"`);
    return res.status(400).json({ error: `Model not permitted` });
  }
  const requestedMaxTokens = typeof max_tokens === 'number' && max_tokens > 0
    ? Math.min(max_tokens, ANTHROPIC_MAX_TOKENS_CEILING)
    : 4000;

  try {
    // Use server-side prompt (ignore any client-sent systemPrompt)
    let augmentedPrompt = SYSTEM_PROMPT;
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

    // Compute prompt version hash
    const promptVersion = computePromptVersion(SYSTEM_PROMPT, augmentedPrompt.slice(SYSTEM_PROMPT.length));

    // Call 1: Primary analysis with retry on transient Anthropic errors.
    // The /api/anthropic/messages proxy already retries on 429/500/502/
    // 503/529; this route was missing the same logic, so a single
    // overloaded response from Anthropic surfaced to the user as
    // "Something Went Wrong / The service is temporarily unavailable"
    // (Paul, 2026-04-28). Same backoff schedule as the proxy.
    let analysisResponse = null;
    let lastErr = null;
    for (let attempt = 0; attempt < ANTHROPIC_MAX_RETRIES; attempt++) {
      try {
        analysisResponse = await callAnthropicRaw({
          systemPrompt: augmentedPrompt,
          messages,
          model: requestedModel,
          maxTokens: requestedMaxTokens,
          // Low temperature on the photo path for the same reason the
          // video path uses 0.2 — re-running analysis on identical
          // photos must not silently produce a different total.
          temperature: 0.2,
          apiKey,
        });
        break;
      } catch (err) {
        lastErr = err;
        // callAnthropicRaw throws "Anthropic API error (529): ..." on
        // non-2xx. Extract the status to decide if it's retryable.
        const statusMatch = /Anthropic API error \((\d+)\)/.exec(err.message || '');
        const status = statusMatch ? Number(statusMatch[1]) : null;
        const retryable = status !== null && RETRYABLE_STATUS_CODES.has(status);
        if (!retryable || attempt === ANTHROPIC_MAX_RETRIES - 1) throw err;
        const delay = ANTHROPIC_RETRY_DELAYS[attempt];
        console.warn(`[Analyse] Anthropic ${status} for user=${req.params.id}, retrying in ${delay}ms (attempt ${attempt + 1}/${ANTHROPIC_MAX_RETRIES})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
    if (!analysisResponse) throw lastErr || new Error('Analysis failed without response');

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

    // Call 2: Self-critique (fire-and-forget safe — if it fails or
    // exceeds SELF_CRITIQUE_TIMEOUT_MS, return the uncritiqued analysis)
    let finalAnalysis = analysisJson;
    let critiqueNotes = null;
    const critiqueStart = Date.now();
    try {
      const critiqueResult = await withTimeout(
        runSelfCritique({
          pool,
          userId: req.params.id,
          jobId: null, // job not created yet at this point
          analysis: analysisJson,
          briefNotes: req.body.briefNotes || '',
        }),
        SELF_CRITIQUE_TIMEOUT_MS,
        'Photo self-critique'
      );
      finalAnalysis = critiqueResult.analysis;
      critiqueNotes = critiqueResult.critique;
      console.log(`[SelfCritique] OK user=${req.params.id} dur=${Date.now() - critiqueStart}ms`);
    } catch (err) {
      console.warn(`[SelfCritique] Skipped user=${req.params.id} dur=${Date.now() - critiqueStart}ms reason=${err.message}`);
    }

    // Return in same format as Anthropic API response for backward compatibility
    res.json({
      content: [{ type: 'text', text: JSON.stringify(finalAnalysis) }],
      usage: analysisResponse.usage,
      critiqueNotes,
      promptVersion,
    });

    // Analytics Phase 1 — fire quote_analysed on the photo success
    // path. Server-side fire so ad-blockers can't suppress it and the
    // count matches the actual analyse calls. The duration / source /
    // freeOrPaid trio answers the spec's week-1 question: "are paid
    // quotes more reliable than free ones?".
    recordEvent('quote_analysed', userIdParam, {
      source: 'photo',
      durationMs: Date.now() - analyseStart,
      freeOrPaid: gateDecision.reason,
    }).catch(() => {});

    // Quota accounting (2026-06-22, consume-on-success rule formalised
    // 2026-06-24). Only on full success — the parse-failure path above
    // returns early before this, and the catch block never decrements.
    // The INSERT into free_quote_grants uses `ON CONFLICT DO NOTHING`
    // so retrying the same draft (same quoteToken) is idempotent: each
    // draft burns at most one quote, no matter how many times the user
    // retries.
    //
    // Pay-as-you-go pack (2026-06-24): if the gate's reason was
    // 'purchased-remaining' we decrement users.purchased_quotes
    // instead of incrementing free_quotes_used. The SAME free_quote_
    // grants row is the dedupe key for both buckets — re-analysing a
    // draft never burns a second quote (free OR paid). Per-spec:
    // "even more critical for paid quotes — someone paying £9.99 must
    // never lose 3 of 5 from re-running one wall."
    //
    // Subscribed users skip this entire branch — no need to track
    // grants we'll never enforce against. Comped users likewise (gate
    // reason was 'comped', no consumption).
    const consumeReason = gateDecision.reason;
    if (consumeReason === 'free-remaining') {
      pool.query(
        `WITH inserted AS (
           INSERT INTO free_quote_grants (user_id, quote_token)
           VALUES ($1, $2)
           ON CONFLICT (user_id, quote_token) DO NOTHING
           RETURNING user_id
         )
         UPDATE users
            SET free_quotes_used = free_quotes_used + 1
          WHERE id = $1
            AND EXISTS (SELECT 1 FROM inserted)`,
        [userIdParam, quoteToken]
      ).catch((err) =>
        console.warn('[Analyse] free_quotes increment failed:', err.message)
      );
    } else if (consumeReason === 'purchased-remaining') {
      pool.query(
        `WITH inserted AS (
           INSERT INTO free_quote_grants (user_id, quote_token)
           VALUES ($1, $2)
           ON CONFLICT (user_id, quote_token) DO NOTHING
           RETURNING user_id
         )
         UPDATE users
            SET purchased_quotes = GREATEST(0, purchased_quotes - 1)
          WHERE id = $1
            AND EXISTS (SELECT 1 FROM inserted)`,
        [userIdParam, quoteToken]
      ).catch((err) =>
        console.warn('[Analyse] purchased_quotes decrement failed:', err.message)
      );
    }
    // 'subscribed' / 'comped' / unknown reason → no bucket change.

    // Referrals Phase 1 (2026-06-23): if this user was referred AND
    // this is their first completed analysis, credit the referrer with
    // +2 bonus quotes. Fire-and-forget — the response has already gone
    // out to the client; we just need the DB write to land.
    maybeCreditReferrerOnFirstAnalysis(userIdParam).catch(() => {});

    // TRQ-173: success-path agent_runs completion. Best-effort.
    // TRQ-140: success status is 'completed', NOT 'ok'. The single
    // canonical enum is documented in agents/agentUtils.js — every
    // analytics filter, calibration query, and reliability count keys
    // on 'completed'. Writing 'ok' here used to make the bulk of
    // Anthropic spend invisible to the calibration agent.
    if (analyseRunId) {
      const usage = analysisResponse.usage || {};
      pool.query(
        `UPDATE agent_runs SET status = 'completed', prompt_tokens = $1,
                 completion_tokens = $2, duration_ms = $3 WHERE id = $4`,
        [
          Number(usage.input_tokens) || 0,
          Number(usage.output_tokens) || 0,
          Date.now() - analyseStart,
          analyseRunId,
        ]
      ).catch((err) => console.warn('[Analyse] Failed to update agent_runs:', err.message));
    }
  } catch (err) {
    // TRQ-173: failure-path agent_runs completion. Best-effort, fire
    // before safeError responds. Captures error message (truncated) so
    // Analytics can show recent failures.
    if (analyseRunId) {
      pool.query(
        `UPDATE agent_runs SET status = 'failed', duration_ms = $1, error = $2 WHERE id = $3`,
        [Date.now() - analyseStart, String(err?.message || 'unknown').slice(0, 500), analyseRunId]
      ).catch(() => {});
    }
    const classified = classifyAnalysisError(err);
    if (classified) {
      console.error(`[Analyse] FAIL ${req.method} ${req.path} status=${classified.status} error=${err.message}`);
      return res.status(classified.status).json({ error: classified.message });
    }
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-125: Client Portal — public routes (no auth)
//
// These routes are the client's entire interface with FastQuote. There is
// no account, no password — the UUID in the URL IS the credential. Every
// line below is load-bearing on that security model:
//
//   • Rate-limited (20/hr/IP) so an attacker can't enumerate tokens.
//   • Security headers on every HTML response (noindex, no-store, DENY,
//     CSP) — keeps the quote out of search engines, intermediary caches,
//     and phishing iframes.
//   • Parameterised queries only.
//   • Expiry checked on every sub-route.
//   • Bot-safe view tracking — the GET never writes client_viewed_at; the
//     beacon does, and only after real-human interaction (dwell / scroll).
//   • Single-submission guard on /respond via `AND client_response IS NULL`.
// ─────────────────────────────────────────────────────────────────────────

const clientPortalRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later.' },
});

app.use('/q/', clientPortalRateLimit);

// TRQ-126: the portal + error pages are rendered by portalRenderer.js
// (imported above). Adapters keep the route handlers below stable — if
// the renderer module ever relocates, only this file needs updating.
function tokenNotFoundHtml() {
  return renderPortalNotFound();
}

function tokenExpiredHtml(job) {
  return renderPortalExpired(job);
}

// Shared security headers for every /q/:token HTML response. CSP locks
// script execution to same-origin; no inline user content executes.
function setClientPortalSecurityHeaders(res) {
  res.set({
    'X-Robots-Tag': 'noindex, nofollow',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy':
      "default-src 'self'; " +
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; " +
      "img-src 'self' data:; " +
      "script-src 'self' 'unsafe-inline'; " +
      "frame-ancestors 'none'",
  });
}

app.get('/q/:token', async (req, res) => {
  const { token } = req.params;
  try {
    const { rows } = await pool.query(
      `SELECT id, user_id,
              client_token_expires_at,
              client_snapshot,
              client_snapshot_profile,
              client_response,
              client_response_at,
              client_decline_reason,
              quote_reference,
              site_address
         FROM jobs
        WHERE client_token = $1`,
      [token]
    );

    setClientPortalSecurityHeaders(res);

    if (rows.length === 0) {
      return res.status(404).type('html').send(tokenNotFoundHtml());
    }
    const job = rows[0];
    if (isClientTokenExpired(job.client_token_expires_at)) {
      return res.status(410).type('html').send(tokenExpiredHtml(job));
    }
    // NOTE: we intentionally do NOT update client_viewed_at here.
    // Email prefetchers and link-scanners will hit this GET without
    // executing JS; the beacon at /q/:token/viewed fires only after real
    // dwell / scroll interaction, so that's what captures a real view.
    return res.status(200).type('html').send(renderClientPortal(job, token));
  } catch (err) {
    // Portal is a customer-facing HTML surface — a raw JSON blob on
    // transient outages looks broken to the client and undermines the
    // tradesman's professionalism. Render the styled 503 page instead,
    // which auto-refreshes once.
    console.error(`[GET /q/:token]`, err?.message || err);
    setClientPortalSecurityHeaders(res);
    if (isTransientInfrastructureError(err)) {
      res.set('Retry-After', '10');
      return res.status(503).type('html').send(renderPortalServiceUnavailable());
    }
    // Fall through to safeError for genuine server bugs (JSON is fine
    // there — only developers / our logs see it in practice).
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.post('/q/:token/viewed', async (req, res) => {
  const { token } = req.params;
  try {
    const ua = (req.get('user-agent') || '').slice(0, 500);
    await pool.query(
      `UPDATE jobs
         SET client_viewed_at   = COALESCE(client_viewed_at, NOW()),
             client_ip          = COALESCE(client_ip, $1),
             client_user_agent  = COALESCE(client_user_agent, $2)
       WHERE client_token = $3
         AND client_token_expires_at > NOW()`,
      [req.ip, ua || null, token]
    );
    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

app.post('/q/:token/respond', async (req, res) => {
  const { token } = req.params;
  const { response, declineReason } = req.body || {};

  if (!['accepted', 'declined'].includes(response)) {
    return res.status(400).json({ error: 'Invalid response' });
  }

  // Defensive: cap decline reason before it hits SQL. Keeps the audit
  // row small and blocks novel-length paste attacks.
  const reason = typeof declineReason === 'string' ? declineReason.slice(0, 300) : null;
  const ua = (req.get('user-agent') || '').slice(0, 500);

  try {
    const { rows } = await pool.query(
      `UPDATE jobs
         SET client_response       = $1,
             client_response_at    = NOW(),
             client_decline_reason = $2,
             client_ip             = COALESCE(client_ip, $3),
             client_user_agent     = COALESCE(client_user_agent, $4),
             status                = CASE WHEN $1 = 'accepted' THEN 'accepted' ELSE 'declined' END,
             accepted_at           = CASE WHEN $1 = 'accepted' THEN NOW() ELSE accepted_at END,
             declined_at           = CASE WHEN $1 = 'declined' THEN NOW() ELSE declined_at END,
             decline_reason        = CASE WHEN $1 = 'declined' THEN $2 ELSE decline_reason END
       WHERE client_token = $5
         AND client_token_expires_at > NOW()
         AND client_response IS NULL
       RETURNING id, user_id`,
      [response, reason, req.ip, ua || null, token]
    );

    if (rows.length === 0) {
      // Either the token is unknown/expired OR the client_response is
      // already set. 409 Conflict in both cases — the request was valid
      // but conflicts with the resource's current state.
      return res.status(409).json({ error: 'Response already recorded or link expired' });
    }

    // Analytics Phase 1 — fire client_responded attributed to the
    // tradesman (the job owner), not the client (who is account-less
    // by design). Closes the funnel: this is the win condition.
    recordEvent('client_responded', rows[0].user_id, {
      response,
      jobId: rows[0].id,
    }).catch(() => {});

    res.json({ ok: true });
  } catch (err) {
    safeError(res, err, `${req.method} ${req.path}`);
  }
});

// --- TRQ-15: system_errors write helper + /api/track pageview beacon ---

// Defensively truncate user-controlled or runaway-recursion strings
// before INSERT so a 50KB stack can't bloat the analytics table.
function logSystemError(req, err, statusCode) {
  const route = req ? `${req.method} ${req.path}` : null;
  const userId = req?.user?.id || req?.session?.legacyUserId || null;
  const ua = req?.get ? (req.get('user-agent') || null) : null;
  const message = (err?.message || 'Unknown error').slice(0, 2000);
  const stack = err?.stack ? String(err.stack).slice(0, 8000) : null;
  pool.query(
    `INSERT INTO system_errors (user_id, source, route, status_code, message, stack, user_agent)
     VALUES ($1, 'server_5xx', $2, $3, $4, $5, $6)`,
    [userId, route, statusCode, message, stack, ua]
  ).catch((logErr) => {
    console.error('[system_errors INSERT failed]', logErr?.message || logErr);
  });
}

// Anonymous pageview beacon. 60/min/IP is generous enough to allow
// rapid SPA route navigation (the beacon fires on every history.push)
// but cheap enough to discourage abuse.
const pageviewRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many tracking requests.' },
});

// Bot UAs we don't want clogging up pageviews. Conservative list —
// we'd rather over-count than fingerprint borderline UAs and miss
// real signals. Lowercased substring match.
const BOT_UA_PATTERNS = [
  'bot', 'crawler', 'spider', 'scrape', 'curl/', 'wget/',
  'python-requests', 'go-http-client', 'java/',
  'facebookexternalhit', 'slackbot', 'twitterbot', 'linkedinbot',
  'whatsapp', 'pingdom', 'uptimerobot',
];
function isBotUserAgent(ua) {
  if (!ua) return true; // No UA → probably automation.
  const lower = ua.toLowerCase();
  return BOT_UA_PATTERNS.some((pat) => lower.includes(pat));
}

app.post('/api/track', pageviewRateLimit, async (req, res) => {
  try {
    const { path, referrer, sessionId } = req.body || {};
    if (!path || typeof path !== 'string') {
      // 204 not 400 — we never want the beacon to surface errors in
      // the client console. Silently drop malformed payloads.
      return res.status(204).end();
    }
    const ua = (req.get('user-agent') || '').slice(0, 500);
    if (isBotUserAgent(ua)) {
      return res.status(204).end();
    }
    // Hash UA to ua_hash for de-duplication / cohort grouping without
    // storing the raw string (privacy: no fingerprinting back to the
    // exact browser). SHA-256 truncated to 16 chars is plenty for
    // distinct counts at our scale.
    const uaHash = ua
      ? crypto.createHash('sha256').update(ua).digest('hex').slice(0, 16)
      : null;
    // Normalize path: strip query string and trailing slash, cap length.
    const cleanPath = String(path).split('?')[0].replace(/\/$/, '').slice(0, 200) || '/';
    const cleanReferrer = referrer
      ? String(referrer).split('?')[0].slice(0, 200)
      : null;
    const cleanSession = sessionId
      ? String(sessionId).slice(0, 64)
      : null;
    // Only attach user_id if the request is from an authenticated
    // session — anonymous landing visits stay anonymous.
    const userId = req.user?.id || req.session?.legacyUserId || null;
    await pool.query(
      `INSERT INTO pageviews (path, referrer, ua_hash, session_id, user_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [cleanPath, cleanReferrer, uaHash, cleanSession, userId]
    );
    res.status(204).end();
  } catch (err) {
    // Tracking failures never surface to the client. Log + return 204
    // so retries don't compound the problem.
    console.error('[/api/track]', err?.message || err);
    res.status(204).end();
  }
});

// --- Analytics Phase 1 (2026-06-29): first-party event log ---
//
// Parallel infrastructure to /api/track + pageviews, but for named
// funnel events. The 11-name allowlist is the PII safeguard: anything
// outside the list 204s silently so an accidental free-form name (e.g.
// "saved client_email=foo@bar.com") can't leak through. Every fire
// path — client-side trackEvent(), server-side recordEvent() — goes
// through the same allowlist via /api/event for client calls, or
// through recordEvent() directly for server-side calls.
//
// Phase 2 (Microsoft Clarity) is deliberately NOT shipped here — DPA
// implications need Harry's sign-off separately.

// The complete set of event names we accept. Adding a new name
// requires a same-PR update to the dashboard funnel widget and (for
// client-side fires) the relevant component. Twelve from the spec's
// week-1 funnel, plus landing_viewed which is reserved for future use
// by the marketing pageview beacon refactor (not wired in Phase 1).
const EVENT_NAME_ALLOWLIST = new Set([
  'signup_started',       // landing CTA click (deferred — needs inline JS)
  'signup_completed',     // /auth/google/callback success
  'referral_redeemed',    // applyReferralAtSignup success
  'profile_completed',    // first false→true profile_complete flip
  'quote_started',        // SPA NEW_QUOTE
  'photo_uploaded',       // JobDetails photo slot success
  'quote_analysed',       // /api/users/:id/analyse success (photo + video)
  'quote_sent',           // POST /client-token success
  'client_responded',     // /q/:token/respond
  'pack_purchased',       // applyQuotePackEventToDb success
  'subscription_started', // applySubscriptionEventToDb first→active
  'pdf_downloaded',       // QuoteOutput PDF button
  'landing_viewed',       // reserved
  'client_link_copied',   // reserved
  'step_entered',         // reserved
]);

// Internal-user identification — Harry's decision 2026-06-29 was CSV
// env var. Production Railway value to be set as `INTERNAL_USER_IDS`,
// e.g. `harry,mark`. Events from these users are written with
// `props.internal = true` rather than dropped, so the admin dashboard
// can both QA the funnel AND exclude them from public-facing rates.
function isInternalUser(userId) {
  if (!userId) return false;
  const raw = process.env.INTERNAL_USER_IDS || '';
  if (!raw.trim()) return false;
  const ids = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return ids.includes(String(userId));
}

// Central INSERT helper. Called from server-side fire sites (auth
// callback, profile flip, analyse success, client-token, /q respond,
// billing webhooks). Best-effort: errors logged once, never thrown
// upstream — analytics MUST NOT break the user flow.
async function recordEvent(name, userId, props = {}, { sessionId = null, path = null } = {}) {
  if (!name || !EVENT_NAME_ALLOWLIST.has(name)) return;
  const finalProps = (props && typeof props === 'object') ? { ...props } : {};
  if (isInternalUser(userId)) {
    finalProps.internal = true;
  }
  try {
    await pool.query(
      `INSERT INTO events (event_name, user_id, session_id, path, props)
       VALUES ($1, $2, $3, $4, $5)`,
      [name, userId || null, sessionId, path, JSON.stringify(finalProps)]
    );
  } catch (err) {
    // Silent capture per spec — log once, never surface.
    console.warn('[recordEvent]', name, err?.message || err);
  }
}

// Public client beacon. Same shape as /api/track: rate-limited, bot-
// filtered, silent 204 on any malformed/unauthorised input.
const eventRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many event requests.' },
});

app.post('/api/event', eventRateLimit, async (req, res) => {
  try {
    const { name, props } = req.body || {};
    // Reject unknown / malformed names with 204 (not 400) — we don't
    // surface internal structure to the client. This is the PII
    // safeguard: only the hard-coded EVENT_NAME_ALLOWLIST writes.
    if (!name || typeof name !== 'string' || !EVENT_NAME_ALLOWLIST.has(name)) {
      return res.status(204).end();
    }
    const ua = (req.get('user-agent') || '').slice(0, 500);
    if (isBotUserAgent(ua)) {
      return res.status(204).end();
    }
    const userId = req.user?.id || req.session?.legacyUserId || null;
    const sessionId = req.sessionID || null;
    // Path from Referer — the SPA route the user was on when the
    // event fired. Strip query string + cap length to keep the row
    // small and avoid leaking ?token=… into the analytics table.
    const referer = req.get('referer') || '';
    let pathClean = null;
    if (referer) {
      try {
        const u = new URL(referer);
        pathClean = u.pathname.slice(0, 200);
      } catch {
        // Unparseable Referer — leave null.
      }
    }
    const safeProps = (props && typeof props === 'object' && !Array.isArray(props)) ? props : {};
    // Defensive: cap individual prop value lengths so a runaway client
    // can't stuff a 1MB string into JSONB. 1KB per value is generous
    // for the fields we expect (priceId, response strings, slot keys).
    const trimmedProps = {};
    for (const [k, v] of Object.entries(safeProps)) {
      if (typeof k !== 'string' || k.length > 64) continue;
      if (v === null || typeof v === 'boolean' || typeof v === 'number') {
        trimmedProps[k] = v;
      } else if (typeof v === 'string') {
        trimmedProps[k] = v.slice(0, 1000);
      }
      // Drop objects/arrays/functions — flat props only.
    }
    await recordEvent(name, userId, trimmedProps, { sessionId, path: pathClean });
    res.status(204).end();
  } catch (err) {
    // Best-effort, never propagate.
    console.warn('[/api/event]', err?.message || err);
    res.status(204).end();
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
  // TRQ-15: the global error handler catches anything that wasn't
  // routed through safeError (body-parser failures, uncaught throws).
  // Persist these too so the analytics dashboard sees the full picture.
  logSystemError(req, err, 500);
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  res.status(500).send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>FastQuote</title><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800&display=swap" rel="stylesheet"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter',sans-serif;background:#1a1714;color:#f0ede8;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:20px}.brand{font-family:'Barlow Condensed',sans-serif;font-size:32px;font-weight:800;color:#e8a838;letter-spacing:.05em;margin-bottom:24px}h1{font-size:20px;font-weight:500;margin-bottom:8px}p{color:#999;font-size:14px;margin-bottom:24px}a{color:#e8a838;text-decoration:none;font-size:14px;padding:10px 24px;border:1px solid #3a3630;border-radius:8px;transition:all .15s}a:hover{border-color:#e8a838}</style></head><body><div class="brand">FASTQUOTE</div><h1>Something went wrong</h1><p>Please try again in a moment.</p><a href="/">Go to Dashboard</a></body></html>`);
});

// --- Static Files + SPA Fallback ---

app.use(express.static(join(__dirname, 'dist')));

app.get('/{*path}', (req, res) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(__dirname, 'dist', 'index.html'));
});

// --- Multer error handler (file size limit, type rejection) ---
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'File too large' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message === 'File must be a video') {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

// --- Start Server ---

const PORT = process.env.PORT || 3000;

// Start listening BEFORE DB init so healthcheck can respond immediately
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`FastQuote server running on port ${PORT}`);
  });
}

const dbReady = initDB()
  .then(async () => {
    // TRQ-15 — once the DB is ready, register the system_errors writer
    // with safeError so every 5xx persists for the analytics dashboard.
    // logSystemError() is defined at module scope (below) so the global
    // express error handler at the bottom of the file can call it too.
    setSystemErrorLogger(logSystemError);

    // Sweep retry queue on startup
    if (process.env.NODE_ENV !== 'test') {
      try {
        await processRetryQueue(pool, {
          feedback: async (payload) => {
            const { rows } = await pool.query(
              'SELECT quote_snapshot FROM jobs WHERE id = $1',
              [payload.jobId]
            );
            if (rows.length > 0 && rows[0].quote_snapshot) {
              await runFeedbackAgent({
                pool,
                userId: payload.userId,
                jobId: payload.jobId,
                quoteSnapshot: rows[0].quote_snapshot,
                completionFeedback: payload.completionFeedback,
                completionNotes: payload.completionNotes || '',
              });
            }
          },
        });
        console.log('[RetryQueue] Startup sweep complete');
      } catch (err) {
        console.error('[RetryQueue] Startup sweep failed:', err.message);
      }
    }
  })
  .catch((err) => {
    console.error('Failed to initialise database:', err);
  });

export { app, pool, dbReady };
