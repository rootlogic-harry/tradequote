/**
 * buildAnthropicPayload — the request body callAnthropicRaw sends.
 *
 * Extracted from callAnthropicRaw so the wire shape is testable without
 * mocking https. Guards the 2026-09-19 (temperature 400) and 2026-09-20
 * (adaptive thinking on by default) incidents.
 */
import { describe, test, expect } from '@jest/globals';
import { buildAnthropicPayload } from '../../agents/agentUtils.js';

const base = { systemPrompt: 'sys', messages: [{ role: 'user', content: 'hi' }], model: 'claude-sonnet-5', maxTokens: 4000 };

describe('buildAnthropicPayload', () => {
  test('maps the core fields onto the Messages API shape', () => {
    const p = buildAnthropicPayload(base);
    expect(p).toMatchObject({ model: 'claude-sonnet-5', max_tokens: 4000, system: 'sys', messages: base.messages });
  });

  test('sends neither thinking nor output_config when not asked (agents keep model defaults)', () => {
    const p = buildAnthropicPayload(base);
    expect(p).not.toHaveProperty('thinking');
    expect(p).not.toHaveProperty('output_config');
  });

  test('forwards effort inside output_config', () => {
    expect(buildAnthropicPayload({ ...base, effort: 'low' }).output_config).toEqual({ effort: 'low' });
  });

  test('forwards an explicit thinking config (analysis calls disable it)', () => {
    expect(buildAnthropicPayload({ ...base, thinking: { type: 'disabled' } }).thinking).toEqual({ type: 'disabled' });
  });

  test('effort and thinking can be combined', () => {
    const p = buildAnthropicPayload({ ...base, effort: 'low', thinking: { type: 'disabled' } });
    expect(p.output_config).toEqual({ effort: 'low' });
    expect(p.thinking).toEqual({ type: 'disabled' });
  });

  test('never sends temperature / top_p / top_k (400 on sonnet-5 and opus-5)', () => {
    const p = buildAnthropicPayload({ ...base, effort: 'low', thinking: { type: 'disabled' } });
    expect(p).not.toHaveProperty('temperature');
    expect(p).not.toHaveProperty('top_p');
    expect(p).not.toHaveProperty('top_k');
  });
});
