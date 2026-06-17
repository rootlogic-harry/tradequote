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

// TRQ-15 — system_errors capture. We don't import pool here (would
// create a circular dep with server.js). Instead server.js calls
// setSystemErrorLogger() once after the DB is ready. The logger is
// called with (req, err, statusCode); failure to log is swallowed.
let systemErrorLogger = null;
export function setSystemErrorLogger(fn) {
  systemErrorLogger = typeof fn === 'function' ? fn : null;
}

// Pull useful diagnostic fields off the error without dumping
// everything (PII, stack traces, etc.). Stripe errors in particular
// hide the actual cause inside `err.detail` — bare `err.message`
// for those gives you "An error occurred with our connection to
// Stripe" with no clue why, which is what bit us on 2026-06-17
// when a pasted key had whitespace and the underlying
// ERR_INVALID_CHAR was hidden behind that generic wrapper.
export function formatErrorContext(err) {
  if (!err || typeof err !== 'object') return null;
  // Stripe errors: surface type, code, statusCode, requestId, and
  // detail. Detail is itself an Error in connection-failure cases
  // (the underlying Node error); stringify it explicitly.
  if (err.type && String(err.type).startsWith('Stripe')) {
    return {
      stripe: {
        type: err.type,
        code: err.code,
        statusCode: err.statusCode,
        requestId: err.requestId,
        detail: err.detail?.message || err.detail?.toString?.() || err.detail,
      },
    };
  }
  // Node fs / net errors: code + syscall + errno are the useful bits.
  if (err.code || err.errno || err.syscall) {
    return { node: { code: err.code, errno: err.errno, syscall: err.syscall } };
  }
  // Anything with a .cause (Node 16+ AggregateError pattern): drill one level.
  if (err.cause && err.cause !== err) {
    return { cause: err.cause?.message || String(err.cause) };
  }
  return null;
}

export function safeError(res, err, context, statusCode = 500) {
  const message = err?.message || 'Unknown error';
  const ctx = formatErrorContext(err);
  if (ctx) {
    console.error(`[${context}]`, message, ctx);
  } else {
    console.error(`[${context}]`, message);
  }

  // Persist to system_errors for the analytics dashboard. Only for
  // genuine 5xx (not transient infra blips, not 4xx user errors).
  // Fire-and-forget — logging failures never block the response.
  if (statusCode >= 500 && !isTransientInfrastructureError(err) && systemErrorLogger) {
    try {
      systemErrorLogger(res.req, err, statusCode);
    } catch {
      // Never let logging interfere with the response.
    }
  }

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
