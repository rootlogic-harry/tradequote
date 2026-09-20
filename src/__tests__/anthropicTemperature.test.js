/**
 * Determinism regression — TRQ feedback (Paul, 2026-05-13)
 *
 * Re-running analysis on an unchanged saved quote produced a ~£10k different
 * estimate and read a wall as "19m high". The structural cause was that the
 * Anthropic Messages API defaults to temperature 1.0 (maximum sampling
 * diversity) when the caller omits it. callAnthropicRaw never set a value, so
 * every Sonnet analysis used full diversity. The original fix pinned a low
 * `temperature`.
 *
 * 2026-09-19: `temperature` (along with `top_p`/`top_k`) is rejected outright
 * (400 invalid_request_error) on claude-sonnet-5 and claude-opus-5 — the only
 * two models this proxy is allowed to call. This took Mark's analyse route to
 * a 100% failure rate the day after the Sonnet 5 upgrade. `effort` is the
 * documented replacement lever for low-variance output, so the mechanism was
 * swapped from `temperature` to `output_config.effort`.
 *
 * These source-level scans assert that:
 *   1. callAnthropicRaw forwards the effort parameter when supplied.
 *   2. Both main-analysis call sites in server.js pass a low effort.
 *   3. Self-critique runs at low effort (2026-09-20: it sits under a 25s
 *      timeout on Opus 5, which thinks by default). Feedback / calibration
 *      agents still get NO forced effort — they're background jobs.
 *   4. `temperature` is never sent to the Anthropic API from this proxy —
 *      it 400s on both allowlisted models.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentUtilsSrc = readFileSync(join(__dirname, '../../agents/agentUtils.js'), 'utf8');
const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const selfCritiqueSrc = readFileSync(join(__dirname, '../../agents/selfCritique.js'), 'utf8');

describe('Anthropic effort plumbing (replaces temperature — 2026-09-19)', () => {
  test('callAnthropicRaw accepts an effort parameter', () => {
    expect(agentUtilsSrc).toMatch(/function callAnthropicRaw\([^)]*effort[^)]*\)/);
  });

  test('callAnthropicRaw forwards effort into output_config when supplied', () => {
    expect(agentUtilsSrc).toMatch(/payload\.output_config\s*=\s*\{\s*effort\s*\}/);
  });

  test('callAnthropicRaw never sends a temperature field in the request payload', () => {
    // temperature/top_p/top_k are removed on claude-sonnet-5 and
    // claude-opus-5 (the only two allowlisted models) — a 400 on every call.
    expect(agentUtilsSrc).not.toMatch(/payload\.temperature/);
  });

  test('video analysis route passes low effort to Sonnet', () => {
    const videoBlock = serverSrc.match(
      /callAnthropicRaw\(\{[\s\S]{0,1200}?model: 'claude-sonnet-5'[\s\S]{0,1200}?\}\)/
    );
    expect(videoBlock).not.toBeNull();
    expect(videoBlock[0]).toMatch(/effort:\s*'low'/);
    expect(videoBlock[0]).not.toMatch(/temperature:/);
  });

  test('photo /analyse route passes low effort to Sonnet', () => {
    // Photo path uses requestedModel (clamped to the allowlist server-side)
    // rather than a literal model string. Find the route's callAnthropicRaw
    // and assert it includes a low effort and never a temperature field.
    const photoMatches = serverSrc.match(
      /callAnthropicRaw\(\{[\s\S]{0,1200}?model: requestedModel[\s\S]{0,1200}?\}\)/g
    );
    expect(photoMatches).not.toBeNull();
    for (const block of photoMatches) {
      expect(block).toMatch(/effort:\s*'low'/);
      expect(block).not.toMatch(/temperature:/);
    }
  });

  test('self-critique runner uses low effort (2026-09-20, Harry-approved)', () => {
    // Reverses the earlier "don't lock effort" decision. Self-critique runs
    // synchronously in the user's request path under a 25s wall-clock
    // timeout (SELF_CRITIQUE_TIMEOUT_MS); on claude-opus-5, which thinks by
    // default, the model-default effort risks blowing that budget and
    // silently skipping the critique. Feedback and calibration agents are
    // unchanged (background, no timeout).
    expect(selfCritiqueSrc).toMatch(/effort:\s*'low'/);
  });
});
