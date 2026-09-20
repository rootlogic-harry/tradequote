/**
 * Anthropic response block handling (2026-09-20 incident).
 *
 * claude-sonnet-5 and claude-opus-5 run adaptive thinking by default when the
 * request omits `thinking`. The response then leads with a `thinking` block —
 * whose `text` is undefined (display defaults to "omitted") — followed by the
 * `text` block. Every reader in this codebase used `content[0].text`, got
 * undefined, fell back to '', failed JSON.parse, and Mark's analyse calls
 * returned HTTP 200 with an empty body ("unreadable response") for a day.
 *
 * extractResponseText must therefore find the text block by TYPE, never by
 * position, and must expose enough structure (stop_reason, block types) for
 * callers to fail loudly instead of silently.
 */
import { describe, test, expect } from '@jest/globals';
import { extractResponseText, describeResponseShape } from '../utils/anthropicResponse.js';

const thinkingBlock = { type: 'thinking', thinking: '', signature: 'sig' };
const textBlock = (text) => ({ type: 'text', text });

describe('extractResponseText', () => {
  test('returns the text block when a thinking block comes first (THE incident)', () => {
    const r = extractResponseText({
      content: [thinkingBlock, textBlock('{"a":1}')],
      stop_reason: 'end_turn',
    });
    expect(r.text).toBe('{"a":1}');
    expect(r.hasText).toBe(true);
    expect(r.blockTypes).toEqual(['thinking', 'text']);
  });

  test('returns the text block when it is the only block', () => {
    const r = extractResponseText({ content: [textBlock('hello')], stop_reason: 'end_turn' });
    expect(r.text).toBe('hello');
    expect(r.blockTypes).toEqual(['text']);
  });

  test('skips redacted_thinking and tool blocks too', () => {
    const r = extractResponseText({
      content: [{ type: 'redacted_thinking', data: 'x' }, textBlock('ok')],
      stop_reason: 'end_turn',
    });
    expect(r.text).toBe('ok');
  });

  test('concatenates multiple text blocks in order', () => {
    const r = extractResponseText({
      content: [textBlock('{"a":'), thinkingBlock, textBlock('1}')],
      stop_reason: 'end_turn',
    });
    expect(r.text).toBe('{"a":1}');
  });

  test('accepts a typeless block that carries string text (simplified mocks / older shapes)', () => {
    const r = extractResponseText({ content: [{ text: '{"a":1}' }], stop_reason: 'end_turn' });
    expect(r.text).toBe('{"a":1}');
  });

  test('ignores a non-text block even if it carries a stray text field', () => {
    const r = extractResponseText({
      content: [{ type: 'thinking', text: 'private reasoning', thinking: '' }, textBlock('answer')],
      stop_reason: 'end_turn',
    });
    expect(r.text).toBe('answer');
  });

  test('a thinking-only response has no text (hasText=false, text="")', () => {
    const r = extractResponseText({ content: [thinkingBlock], stop_reason: 'max_tokens' });
    expect(r.text).toBe('');
    expect(r.hasText).toBe(false);
  });

  test('whitespace-only text does not count as usable text', () => {
    const r = extractResponseText({ content: [textBlock('  \n ')], stop_reason: 'end_turn' });
    expect(r.hasText).toBe(false);
  });

  test('flags max_tokens truncation', () => {
    const r = extractResponseText({ content: [textBlock('{"a":')], stop_reason: 'max_tokens' });
    expect(r.truncated).toBe(true);
    expect(r.stopReason).toBe('max_tokens');
  });

  test('flags a refusal', () => {
    const r = extractResponseText({ content: [], stop_reason: 'refusal' });
    expect(r.refused).toBe(true);
    expect(r.hasText).toBe(false);
  });

  test('normal end_turn is neither truncated nor refused', () => {
    const r = extractResponseText({ content: [textBlock('x')], stop_reason: 'end_turn' });
    expect(r.truncated).toBe(false);
    expect(r.refused).toBe(false);
  });

  test.each([null, undefined, {}, { content: null }, { content: 'oops' }, { content: [null, 3] }])(
    'never throws on malformed input %p',
    (input) => {
      const r = extractResponseText(input);
      expect(r.text).toBe('');
      expect(r.hasText).toBe(false);
    }
  );
});

describe('describeResponseShape (safe to log — structure only, never content)', () => {
  test('reports block types, stop_reason, output tokens and text length', () => {
    const s = describeResponseShape({
      content: [thinkingBlock, textBlock('')],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 5000, output_tokens: 4000 },
    });
    expect(s).toContain('blocks=[thinking,text]');
    expect(s).toContain('stop_reason=max_tokens');
    expect(s).toContain('output_tokens=4000');
    expect(s).toContain('text_chars=0');
  });

  test('never includes the response text (customer addresses may appear in it)', () => {
    const s = describeResponseShape({
      content: [textBlock('12 Nook Farm, secret-address-marker')],
      stop_reason: 'end_turn',
      usage: { output_tokens: 10 },
    });
    expect(s).not.toContain('secret-address-marker');
    expect(s).toContain('text_chars=');
  });

  test('tolerates a missing response', () => {
    expect(() => describeResponseShape(undefined)).not.toThrow();
  });
});
