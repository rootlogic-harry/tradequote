/**
 * Safe error response helper.
 *
 * - For transient infrastructure errors (Railway DNS blips, Postgres
 *   restarts, network timeouts): returns 503 with `Retry-After: 10`
 *   and a retryable-flag body. Lets clients show a "reconnecting…"
 *   UI instead of a scary generic 500 message.
 * - For 500s from real bugs: logs full error server-side, returns
 *   generic message (no internal details leak to the client).
 * - For 400/404: passes the specific message through.
 */
import { isTransientInfrastructureError } from './src/utils/transientError.js';

export function safeError(res, err, context, statusCode = 500) {
  const message = err?.message || 'Unknown error';
  console.error(`[${context}]`, message);

  if (statusCode >= 500 && isTransientInfrastructureError(err)) {
    // 503 Service Unavailable + Retry-After makes well-behaved clients
    // (and our own UI) back off and retry rather than surface the
    // error to the user as a hard failure.
    res.set('Retry-After', '10');
    return res.status(503).json({
      error: 'We\u2019re reconnecting to our database. Please try again in a moment.',
      retryable: true,
    });
  }

  if (statusCode >= 500) {
    return res.status(statusCode).json({ error: 'Something went wrong. Please try again.' });
  }

  return res.status(statusCode).json({ error: message });
}
