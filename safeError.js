/**
 * Safe error response helper.
 * For 500s: logs full error, returns generic message (no internal details).
 * For 400/404: passes through the specific message.
 */
export function safeError(res, err, context, statusCode = 500) {
  const message = err?.message || 'Unknown error';
  console.error(`[${context}]`, message);

  if (statusCode >= 500) {
    return res.status(statusCode).json({ error: 'Something went wrong. Please try again.' });
  }

  return res.status(statusCode).json({ error: message });
}
