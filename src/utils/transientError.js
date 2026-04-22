/**
 * Classify "transient infrastructure" errors — DB DNS blips, connection
 * refused, timeouts. Used by the server's error handler to return 503
 * with a Retry-After hint (instead of a scary 500 + generic message),
 * and by the portal route to render a styled "temporarily unavailable"
 * page rather than a raw JSON blob.
 *
 * Today's Railway outage is the canonical case: `getaddrinfo EAI_AGAIN
 * postgres-8dej.railway.internal`. The app is fine; the platform's
 * internal DNS briefly can't resolve its own Postgres hostname.
 *
 * KEEP THIS LIST TIGHT. Anything that's actually a code bug (SQL
 * syntax, constraint violation, missing column) MUST NOT be classified
 * as transient — that would mask real regressions behind a "try again
 * later" message and delay detection.
 */

// Node + pg connection-level error codes we've actually seen or expect
// to see in production. Anything else is treated as a real error.
const TRANSIENT_CODES = new Set([
  'EAI_AGAIN',        // DNS lookup temporarily failed (Railway outage today)
  'ECONNREFUSED',     // Postgres process restarting / briefly unreachable
  'ECONNRESET',       // Connection killed mid-query
  'ETIMEDOUT',        // Network timeout
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',        // DNS resolution failed (dig deeper if persistent)
  '57P01',            // pg: admin_shutdown
  '57P02',            // pg: crash_shutdown
  '57P03',            // pg: cannot_connect_now
  '08000',            // pg: connection_exception
  '08003',            // pg: connection_does_not_exist
  '08006',            // pg: connection_failure
  '08001',            // pg: sqlclient_unable_to_establish_sqlconnection
  '08004',            // pg: sqlserver_rejected_establishment_of_sqlconnection
]);

export function isTransientInfrastructureError(err) {
  if (!err) return false;
  const code = err.code || err.errno;
  if (code && TRANSIENT_CODES.has(String(code))) return true;
  // Some Node layers surface the error as a nested cause (e.g. pg pool
  // wraps getaddrinfo errors). Walk one level.
  if (err.cause && err.cause !== err) {
    const causeCode = err.cause.code || err.cause.errno;
    if (causeCode && TRANSIENT_CODES.has(String(causeCode))) return true;
  }
  // Textual fallback — some environments strip .code but keep the
  // message intact. Be strict: match only on tokens that can't appear
  // in user-supplied input.
  const msg = String(err.message || '');
  if (/\bEAI_AGAIN\b/.test(msg)) return true;
  if (/\bECONNREFUSED\b/.test(msg)) return true;
  if (/\bgetaddrinfo\b/.test(msg)) return true;
  return false;
}
