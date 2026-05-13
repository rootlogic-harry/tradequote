/**
 * Determinism regression — TRQ feedback (Paul, 2026-05-13)
 *
 * Re-running analysis on an unchanged saved quote produced a ~£10k different
 * estimate and read a wall as "19m high". The structural cause was that the
 * Anthropic Messages API defaults to temperature 1.0 (maximum sampling
 * diversity) when the caller omits it. callAnthropicRaw never set a value, so
 * every Sonnet analysis used full diversity.
 *
 * These source-level scans assert that:
 *   1. callAnthropicRaw forwards the temperature parameter when supplied.
 *   2. Both main-analysis call sites in server.js pass a low temperature.
 *   3. Self-critique / other agent callers DO NOT silently get a temperature
 *      overridden — diversity helps the critique surface alternatives.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const agentUtilsSrc = readFileSync(join(__dirname, '../../agents/agentUtils.js'), 'utf8');
const serverSrc = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const selfCritiqueSrc = readFileSync(join(__dirname, '../../agents/selfCritique.js'), 'utf8');

describe('Anthropic temperature plumbing', () => {
  test('callAnthropicRaw accepts a temperature parameter', () => {
    expect(agentUtilsSrc).toMatch(/function callAnthropicRaw\([^)]*temperature[^)]*\)/);
  });

  test('callAnthropicRaw forwards temperature into the request body when supplied', () => {
    expect(agentUtilsSrc).toMatch(/payload\.temperature\s*=\s*temperature/);
  });

  test('callAnthropicRaw bounds temperature to the 0..1 range Anthropic accepts', () => {
    expect(agentUtilsSrc).toMatch(/temperature\s*>=\s*0\s*&&\s*temperature\s*<=\s*1/);
  });

  test('video analysis route passes a low temperature to Sonnet 4', () => {
    // Pull the block immediately preceding the Sonnet 4 model identifier
    // in the video route and assert it sets temperature to a low value.
    const videoBlock = serverSrc.match(
      /callAnthropicRaw\(\{[\s\S]{0,1200}?model: 'claude-sonnet-4-20250514'[\s\S]{0,1200}?\}\)/
    );
    expect(videoBlock).not.toBeNull();
    expect(videoBlock[0]).toMatch(/temperature:\s*0\.[12]\b/);
  });

  test('photo /analyse route passes a low temperature to Sonnet', () => {
    // Photo path uses requestedModel (clamped to the allowlist server-side)
    // rather than a literal model string. Find the route's callAnthropicRaw
    // and assert it includes a low temperature.
    const photoMatches = serverSrc.match(
      /callAnthropicRaw\(\{[\s\S]{0,1200}?model: requestedModel[\s\S]{0,1200}?\}\)/g
    );
    expect(photoMatches).not.toBeNull();
    for (const block of photoMatches) {
      expect(block).toMatch(/temperature:\s*0\.[12]\b/);
    }
  });

  test('self-critique runner does not set temperature (keeps Anthropic default)', () => {
    // CRITIQUE_SYSTEM_PROMPT benefits from diversity — alternative
    // interpretations of the same analysis surface more candidate issues.
    // We deliberately don't lock it to a low temperature.
    expect(selfCritiqueSrc).not.toMatch(/temperature:/);
  });
});
