/**
 * West Yorkshire homeowner quote routes.
 *
 * Public: request a waller, view a private quote link.
 * Admin: list enquiries, set outcome.
 *
 * Mounted only when HOMEOWNER_QUOTES_ENABLED=true.
 */

import rateLimit from 'express-rate-limit';
import crypto from 'node:crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  HEIGHTS,
  DAILY_LINK_CAP,
  OUTCOMES,
  classifyPostcode,
  consentCopy,
  formatBand,
  guideBand,
  parseNotifyUserIds,
  validateAskPayload,
} from './src/utils/homeownerEstimate.js';
import { isHomeownerQuotesEnabledFromProcessEnv } from './src/utils/homeownerQuotesEnabled.js';
import {
  buildWallerEnquiryEmail,
  sendTransactionalEmail,
} from './src/utils/sendTransactionalEmail.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOMEOWNER_HTML = join(__dirname, 'public', 'homeowner', 'index.html');

function heightLabel(metres) {
  return HEIGHTS.find((h) => h.metres === Number(metres))?.label || `About ${metres}m`;
}

function publicBaseUrl(req) {
  const envBase = process.env.PUBLIC_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol || 'http';
  return `${proto}://${host}`;
}

function hashIp(ip) {
  const salt = process.env.HOMEOWNER_IP_HASH_SALT || 'local-dev-salt';
  return crypto.createHash('sha256').update(`${salt}:${ip || 'unknown'}`).digest('hex');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * @param {import('express').Express} app
 * @param {object} deps
 * @param {import('pg').Pool} deps.pool
 * @param {Function} deps.requireAuth
 * @param {Function} deps.requireAdminPlan
 * @param {Function} [deps.recordEvent]
 * @param {Function} [deps.sendEmail]
 */
export function registerHomeownerQuoteRoutes(app, {
  pool,
  requireAuth,
  requireAdminPlan,
  recordEvent = async () => {},
  sendEmail = sendTransactionalEmail,
}) {
  const guard = (req, res, next) => {
    if (!isHomeownerQuotesEnabledFromProcessEnv()) {
      return res.status(404).json({ error: 'Not found' });
    }
    next();
  };

  const homeownerRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' },
    validate: false,
  });

  const serveApp = (req, res) => {
    if (!isHomeownerQuotesEnabledFromProcessEnv()) {
      return res.status(404).send('Not found');
    }
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(HOMEOWNER_HTML);
  };

  app.get('/quote', serveApp);
  app.get('/dry-stone-wall-cost-west-yorkshire', serveApp);
  app.get('/e/:id', (req, res, next) => {
    if (!/^[0-9a-f-]{8,36}$/i.test(req.params.id)) {
      return res.status(404).send('Not found');
    }
    return serveApp(req, res, next);
  });

  app.get('/api/homeowner/meta', guard, (_req, res) => {
    res.json({
      consentCopy: consentCopy(),
      heights: HEIGHTS,
      dailyLinkCap: DAILY_LINK_CAP,
      notifyMode: 'mark-only-test',
    });
  });

  app.post('/api/homeowner/preview', guard, homeownerRateLimit, (req, res) => {
    const place = classifyPostcode(req.body?.postcode);
    const band = place.valid
      ? guideBand(req.body?.lengthM, req.body?.heightM)
      : null;
    res.json({
      place,
      band,
      bandText: formatBand(band),
    });
  });

  app.post('/api/homeowner/request', guard, homeownerRateLimit, async (req, res) => {
    const parsed = validateAskPayload(req.body || {});
    if (!parsed.ok) {
      return res.status(400).json({ error: 'Check the form.', errors: parsed.errors });
    }

    const ipHash = hashIp(req.ip);
    try {
      const { rows: recent } = await pool.query(
        `SELECT COUNT(*)::int AS n
           FROM homeowner_quotes
          WHERE ip_hash = $1
            AND waller_requested = TRUE
            AND created_at > NOW() - INTERVAL '1 day'`,
        [ipHash],
      );
      if ((recent[0]?.n || 0) >= DAILY_LINK_CAP) {
        return res.status(429).json({
          error: 'That’s the limit for today. Your latest estimate is still here.',
          code: 'daily_cap',
        });
      }

      const id = crypto.randomUUID();
      const notifyIds = parseNotifyUserIds(process.env.HOMEOWNER_NOTIFY_USER_IDS);
      const { rows } = await pool.query(
        `INSERT INTO homeowner_quotes (
           id, postcode, postcode_outward, area_label, in_west_yorkshire,
           length_m, height_m, estimate_low, estimate_high,
           homeowner_name, homeowner_email, homeowner_phone,
           waller_requested, consent_share_with_wallers, consent_marketing,
           consent_at, status, photos, ip_hash
         ) VALUES (
           $1, $2, $3, $4, TRUE,
           $5, $6, $7, $8,
           $9, $10, $11,
           TRUE, TRUE, $12,
           NOW(), 'awaiting_contact', $13::jsonb, $14
         )
         RETURNING id, created_at, area_label, length_m, height_m,
                   estimate_low, estimate_high, homeowner_name`,
        [
          id,
          String(req.body.postcode).trim().toUpperCase(),
          parsed.place.outward,
          parsed.place.area,
          Number(req.body.lengthM),
          Number(req.body.heightM),
          parsed.band.low,
          parsed.band.high,
          parsed.name,
          parsed.email,
          parsed.phone,
          parsed.consentMarketing,
          JSON.stringify(parsed.photos),
          ipHash,
        ],
      );

      const quote = rows[0];
      const quoteUrl = `${publicBaseUrl(req)}/e/${id}`;
      const bandText = formatBand({ low: quote.estimate_low, high: quote.estimate_high });
      const notified = [];

      for (const userId of notifyIds) {
        const userRes = await pool.query(
          'SELECT id, name, email FROM users WHERE id = $1',
          [userId],
        );
        const user = userRes.rows[0];
        if (!user?.email) {
          console.warn(`[homeowner] notify skip user=${userId} — no email on account`);
          continue;
        }
        const mail = buildWallerEnquiryEmail({
          wallerName: user.name,
          area: quote.area_label,
          lengthM: quote.length_m,
          heightLabel: heightLabel(quote.height_m),
          bandText,
          quoteUrl,
          homeownerFirstName: quote.homeowner_name,
        });
        const sent = await sendEmail({
          to: user.email,
          subject: mail.subject,
          text: mail.text,
          logLabel: `homeowner-enquiry:${id}:${userId}`,
        });
        if (sent.ok) notified.push(userId);
      }

      await pool.query(
        `UPDATE homeowner_quotes
            SET notified_user_ids = $1::text[],
                notified_at = CASE WHEN cardinality($1::text[]) > 0 THEN NOW() ELSE NULL END,
                updated_at = NOW()
          WHERE id = $2`,
        [notified, id],
      );

      await recordEvent('homeowner_quote_requested', null, {
        in_west_yorkshire: true,
        area: quote.area_label,
        notified_count: notified.length,
      }, { path: '/quote' });

      if (notified.length) {
        await recordEvent('homeowner_waller_notified', null, {
          notified_count: notified.length,
          notify_ids: notified,
        }, { path: '/quote' });
      }

      return res.status(201).json({
        id,
        url: quoteUrl,
        bandText,
        area: quote.area_label,
        notifiedCount: notified.length,
      });
    } catch (err) {
      console.error('[homeowner] request failed:', err.message);
      return res.status(500).json({ error: 'Something went wrong' });
    }
  });

  app.get('/api/homeowner/quotes/:id', guard, homeownerRateLimit, async (req, res) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{8,36}$/i.test(id)) {
      return res.status(404).json({ error: 'Not found' });
    }
    try {
      const { rows } = await pool.query(
        `SELECT id, created_at, postcode_outward, area_label, length_m, height_m,
                estimate_low, estimate_high, homeowner_name, homeowner_email,
                homeowner_phone, photos, waller_requested, status
           FROM homeowner_quotes
          WHERE id = $1 AND waller_requested = TRUE`,
        [id],
      );
      const row = rows[0];
      if (!row) return res.status(404).json({ error: 'Not found' });

      res.setHeader('X-Robots-Tag', 'noindex, nofollow');
      res.setHeader('Cache-Control', 'no-store');
      return res.json({
        id: row.id,
        createdAt: row.created_at,
        outward: row.postcode_outward,
        area: row.area_label,
        lengthM: Number(row.length_m),
        heightM: Number(row.height_m),
        heightLabel: heightLabel(row.height_m),
        estimateLow: row.estimate_low,
        estimateHigh: row.estimate_high,
        bandText: formatBand({ low: row.estimate_low, high: row.estimate_high }),
        name: row.homeowner_name,
        email: row.homeowner_email,
        phone: row.homeowner_phone,
        photos: (row.photos || []).map((p) => ({ mime: p.mime, dataUrl: p.dataUrl })),
        status: row.status,
        disclaimer: 'Indicative guide. A site visit is required. This is not a quote from a named waller.',
      });
    } catch (err) {
      console.error('[homeowner] get quote failed:', err.message);
      return res.status(500).json({ error: 'Something went wrong' });
    }
  });

  app.get('/api/admin/enquiries', requireAuth, requireAdminPlan, guard, async (_req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, created_at, postcode_outward, area_label, length_m, height_m,
                estimate_low, estimate_high, homeowner_name, homeowner_email,
                homeowner_phone, status, outcome, notified_user_ids, notified_at,
                waller_requested
           FROM homeowner_quotes
          WHERE waller_requested = TRUE
          ORDER BY created_at DESC
          LIMIT 200`,
      );
      return res.json({
        enquiries: rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at,
          outward: row.postcode_outward,
          area: row.area_label,
          lengthM: Number(row.length_m),
          heightM: Number(row.height_m),
          heightLabel: heightLabel(row.height_m),
          bandText: formatBand({ low: row.estimate_low, high: row.estimate_high }),
          name: row.homeowner_name,
          email: row.homeowner_email,
          phone: row.homeowner_phone,
          status: row.status,
          outcome: row.outcome,
          notifiedUserIds: row.notified_user_ids || [],
          notifiedAt: row.notified_at,
          url: `/e/${row.id}`,
        })),
      });
    } catch (err) {
      console.error('[homeowner] list enquiries failed:', err.message);
      return res.status(500).json({ error: 'Something went wrong' });
    }
  });

  app.patch('/api/admin/enquiries/:id/outcome', requireAuth, requireAdminPlan, guard, async (req, res) => {
    const outcome = String(req.body?.outcome || '');
    if (!OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: 'Unknown outcome.' });
    }
    try {
      const { rows } = await pool.query(
        `UPDATE homeowner_quotes
            SET outcome = $1,
                status = $1,
                updated_at = NOW()
          WHERE id = $2 AND waller_requested = TRUE
          RETURNING id, outcome, status`,
        [outcome, req.params.id],
      );
      if (!rows[0]) return res.status(404).json({ error: 'Not found' });
      await recordEvent('homeowner_outcome_set', req.user?.id || null, {
        outcome,
        enquiry_id: rows[0].id,
      }, { path: '/admin/enquiries' });
      return res.json({ id: rows[0].id, outcome: rows[0].outcome, status: rows[0].status });
    } catch (err) {
      console.error('[homeowner] set outcome failed:', err.message);
      return res.status(500).json({ error: 'Something went wrong' });
    }
  });

  // Tiny HTML fallback if sendFile fails in odd environments — not the main path.
  void escapeHtml;
}
