/**
 * Anthropic + OpenAI token pricing — used by the Analytics dashboard
 * (TRQ-173) to convert agent_runs.prompt_tokens / completion_tokens into
 * a £ estimate per user / per quote / per model.
 *
 * Prices are USD-per-million-tokens at the date stamped below. They
 * change roughly every 6 months. When Anthropic publishes a new
 * schedule, bump PRICES_LAST_REVIEWED and the affected entries; the
 * Analytics page exposes the date so admins know how stale the £
 * figure is.
 *
 * Conversion: GBP/USD rate is hard-coded too — small enough variance
 * that it's not worth a live FX call for an internal dashboard.
 *
 * Sources (verify before bumping):
 *   - Anthropic: https://www.anthropic.com/pricing
 *   - OpenAI Whisper: https://openai.com/api/pricing/
 */

export const PRICES_LAST_REVIEWED = '2026-04-30';
export const USD_TO_GBP = 0.79;

// USD per 1,000,000 tokens. Keep keys aligned with the values
// ANTHROPIC_MODEL_ALLOWLIST permits in server.js.
const ANTHROPIC_PRICES_USD_PER_MTOK = {
  // Sonnet 4 (full-quality analysis path)
  'claude-sonnet-4-20250514': { input: 3, output: 15 },
  'claude-sonnet-4-5-20250929': { input: 3, output: 15 },
  // Haiku 4.5 (background agents — self-critique, feedback, calibration)
  'claude-haiku-4-5-20251001': { input: 1, output: 5 },
};

// Whisper bills per minute. Audio bytes don't directly map to minutes,
// but compressed audio at ~32 kbps → ~240 KB/min is a reasonable
// average for the formats we accept. Used to estimate dictation +
// video-transcription spend.
export const WHISPER_USD_PER_MINUTE = 0.006;
export const WHISPER_KB_PER_MINUTE_ESTIMATE = 240;

/**
 * Convert (model, input_tokens, output_tokens) → £.
 *
 * Returns 0 for unknown models (rather than throwing) so analytics
 * doesn't blow up on a row written before a model was added to the map.
 * Such rows count toward "unknown spend" in the dashboard.
 */
export function tokensToGbp(model, inputTokens = 0, outputTokens = 0) {
  const price = ANTHROPIC_PRICES_USD_PER_MTOK[model];
  if (!price) return 0;
  const usd = (inputTokens / 1e6) * price.input + (outputTokens / 1e6) * price.output;
  return usd * USD_TO_GBP;
}

/**
 * Estimate £ for Whisper transcription from total audio bytes.
 */
export function whisperBytesToGbp(audioBytes = 0) {
  if (!audioBytes) return 0;
  const minutes = audioBytes / 1024 / WHISPER_KB_PER_MINUTE_ESTIMATE;
  return minutes * WHISPER_USD_PER_MINUTE * USD_TO_GBP;
}

/** Return the supported model list — useful for analytics filtering. */
export function knownModels() {
  return Object.keys(ANTHROPIC_PRICES_USD_PER_MTOK);
}

/** Return the price map (read-only) — for the dashboard's "pricing assumptions" section. */
export function getPriceMap() {
  return {
    pricesLastReviewed: PRICES_LAST_REVIEWED,
    usdToGbp: USD_TO_GBP,
    anthropicUsdPerMtok: { ...ANTHROPIC_PRICES_USD_PER_MTOK },
    whisperUsdPerMinute: WHISPER_USD_PER_MINUTE,
    whisperKbPerMinuteEstimate: WHISPER_KB_PER_MINUTE_ESTIMATE,
  };
}
