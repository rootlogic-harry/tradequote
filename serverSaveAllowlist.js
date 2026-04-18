/**
 * Server-side save allowlist. Controls which keys from req.body
 * are stored in quote_snapshot JSONB. Prevents photos/blobs from
 * being saved in the snapshot column.
 */
export const SERVER_SAVE_ALLOWLIST = [
  'profile', 'jobDetails', 'reviewData',
  'quotePayload', 'quoteSequence', 'quoteMode', 'captureMode', 'diffs',
  'transcript', 'aiRawResponse',
];

/**
 * Pick only allowed keys from a body object.
 * Returns a new object containing only SERVER_SAVE_ALLOWLIST keys.
 */
export function pickAllowedKeys(body) {
  if (!body || typeof body !== 'object') return {};
  const result = {};
  for (const key of SERVER_SAVE_ALLOWLIST) {
    if (body[key] !== undefined) {
      result[key] = body[key];
    }
  }
  return result;
}
