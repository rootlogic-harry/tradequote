/**
 * runAgent output handling (2026-09-20 incident).
 *
 * Before: runAgent read `response.content[0].text`. On claude-opus-5 (adaptive
 * thinking by default) content[0] is a thinking block, so every agent got ''
 * — and runAgent then wrote `{ rawText: '' }` to agent_runs with
 * status='completed'. Self-critique / feedback / calibration silently did
 * nothing while the moat table recorded success.
 *
 * After: runAgent finds the text block by type, and an empty or truncated
 * response is a FAILED run that throws (so the feedback retry queue and the
 * self-critique "Skipped" path both see it).
 */
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { runAgent } from '../../agents/agentUtils.js';

function mockPool() {
  const calls = [];
  return {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: 'run-1' }], rowCount: 1 };
    },
    calls,
    updates: () => calls.filter((c) => /UPDATE agent_runs/.test(c.sql)),
  };
}

const thinking = { type: 'thinking', thinking: '', signature: 's' };
const text = (t) => ({ type: 'text', text: t });
const respond = (content, stop_reason = 'end_turn') => async () => ({
  content,
  stop_reason,
  usage: { input_tokens: 100, output_tokens: 50 },
});

const args = (pool, callFn, extra = {}) => ({
  pool,
  userId: 'u1',
  jobId: null,
  agentType: 'self_critique',
  systemPrompt: 'sys',
  messages: [{ role: 'user', content: 'x' }],
  model: 'claude-opus-5',
  maxTokens: 2000,
  callFn,
  ...extra,
});

let origKey;
beforeEach(() => { origKey = process.env.ANTHROPIC_API_KEY; process.env.ANTHROPIC_API_KEY = 'test-key'; });
afterEach(() => { process.env.ANTHROPIC_API_KEY = origKey; });

describe('runAgent — thinking-aware output handling', () => {
  test('parses JSON from the text block even when a thinking block leads', async () => {
    const pool = mockPool();
    const r = await runAgent(args(pool, respond([thinking, text('{"corrections":[],"notes":"ok"}')])));
    expect(r.output).toEqual({ corrections: [], notes: 'ok' });
    const [update] = pool.updates();
    expect(update.sql).toContain("status = 'completed'");
  });

  test('still handles ```json fenced output', async () => {
    const r = await runAgent(args(mockPool(), respond([text('```json\n{"a":1}\n```')])));
    expect(r.output).toEqual({ a: 1 });
  });

  test('non-JSON but non-empty text still completes with output=null (existing behaviour)', async () => {
    const pool = mockPool();
    const r = await runAgent(args(pool, respond([text('plain prose answer')])));
    expect(r.output).toBeNull();
    expect(r.rawText).toBe('plain prose answer');
    expect(pool.updates()[0].sql).toContain("status = 'completed'");
  });

  test('thinking-only response FAILS the run and throws — never records completed/empty', async () => {
    const pool = mockPool();
    await expect(runAgent(args(pool, respond([thinking], 'max_tokens')))).rejects.toThrow(/no usable text/i);
    const updates = pool.updates();
    expect(updates).toHaveLength(1);
    expect(updates[0].sql).toContain("status = 'failed'");
    expect(updates.some((u) => u.sql.includes("status = 'completed'"))).toBe(false);
  });

  test('the failure message records block types + stop_reason for diagnosis', async () => {
    const pool = mockPool();
    await expect(runAgent(args(pool, respond([thinking], 'max_tokens')))).rejects.toThrow(/thinking/);
    const errorParam = pool.updates()[0].params[0];
    expect(errorParam).toMatch(/blocks=\[thinking\]/);
    expect(errorParam).toMatch(/stop_reason=max_tokens/);
  });

  test('max_tokens truncation FAILS even when partial text exists', async () => {
    const pool = mockPool();
    await expect(runAgent(args(pool, respond([thinking, text('{"corrections":[{"sev')], 'max_tokens')))).rejects.toThrow(/truncated|max_tokens/i);
    expect(pool.updates()[0].sql).toContain("status = 'failed'");
  });

  test('a refusal FAILS the run', async () => {
    const pool = mockPool();
    await expect(runAgent(args(pool, respond([], 'refusal')))).rejects.toThrow();
    expect(pool.updates()[0].sql).toContain("status = 'failed'");
  });

  test('forwards effort to the API call when supplied', async () => {
    let seen;
    const callFn = async (opts) => { seen = opts; return { content: [text('{"a":1}')], stop_reason: 'end_turn', usage: {} }; };
    await runAgent(args(mockPool(), callFn, { effort: 'low' }));
    expect(seen.effort).toBe('low');
  });

  test('omits effort (model default) when not supplied — feedback/calibration unchanged', async () => {
    let seen;
    const callFn = async (opts) => { seen = opts; return { content: [text('{"a":1}')], stop_reason: 'end_turn', usage: {} }; };
    await runAgent(args(mockPool(), callFn));
    expect(seen.effort).toBeUndefined();
  });
});
