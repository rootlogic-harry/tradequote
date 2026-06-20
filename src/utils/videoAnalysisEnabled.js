/**
 * Video analysis feature flag.
 *
 * The video walkthrough pipeline (multer disk upload → ffmpeg frame
 * extraction → Whisper transcription → Sonnet vision analysis) has
 * been unstable in production with both reliability failures (5xx
 * mid-upload, ffmpeg "Conversion failed", Anthropic 529 without retry,
 * Whisper format rejections) and accuracy failures (£10k swings on
 * back-to-back runs, motion-blurred frames diluting model attention).
 *
 * A deeper rebuild is on the roadmap but not yet scoped. Until then,
 * this flag lets us disable video in production while keeping the
 * staging environment iterating on a fix.
 *
 * Contract:
 *
 *   Environment           | env var unset    | env var = "true" | env var = "false"
 *   ----------------------|------------------|------------------|------------------
 *   production            | DISABLED         | ENABLED          | DISABLED
 *   non-production        | ENABLED          | ENABLED          | DISABLED
 *
 * The asymmetry is deliberate. In production an unset flag must NOT
 * silently re-enable broken video — a forgotten env var on a Railway
 * config wipe should fail closed. Staging (NODE_ENV !== 'production')
 * defaults open so future iteration doesn't require an extra step.
 *
 * Truthy values: "true", "1", "yes" (case-insensitive).
 * Falsy values:  anything else, including empty string and missing.
 *
 * No coupling to `process.env` inside the function — callers pass the
 * relevant env values so tests don't have to mutate global state.
 *
 * @param {object} env
 * @param {string} [env.flag]    — value of process.env.VIDEO_ANALYSIS_ENABLED
 * @param {string} [env.nodeEnv] — value of process.env.NODE_ENV
 * @returns {boolean} whether the video analysis surface should be live
 */
export function isVideoAnalysisEnabled({ flag, nodeEnv } = {}) {
  const normalisedFlag = typeof flag === 'string' ? flag.trim().toLowerCase() : '';
  const isProd = nodeEnv === 'production';

  if (normalisedFlag === 'true' || normalisedFlag === '1' || normalisedFlag === 'yes') {
    return true;
  }
  if (normalisedFlag === 'false' || normalisedFlag === '0' || normalisedFlag === 'no') {
    return false;
  }
  // Unset / unrecognised value: prod fails closed, non-prod defaults open.
  return !isProd;
}

/**
 * Convenience wrapper that reads from `process.env` directly. Use this
 * in route handlers and the /auth/me payload; use `isVideoAnalysisEnabled`
 * directly in tests so you don't have to mutate process.env.
 */
export function isVideoAnalysisEnabledFromProcessEnv() {
  return isVideoAnalysisEnabled({
    flag: process.env.VIDEO_ANALYSIS_ENABLED,
    nodeEnv: process.env.NODE_ENV,
  });
}

/**
 * User-facing message returned from the video upload route when the
 * flag is off. Kept here so the server route and the client error
 * mapping agree on the exact wording.
 */
export const VIDEO_DISABLED_MESSAGE =
  'Video analysis is temporarily unavailable. Please use photos to generate a quote.';
