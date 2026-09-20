/**
 * Block-aware reading of an Anthropic Messages API response.
 *
 * claude-sonnet-5 / claude-opus-5 run adaptive thinking unless the request
 * says otherwise, and the response then LEADS with a `thinking` block whose
 * text is empty (display defaults to "omitted"). `content[0].text` is
 * therefore undefined — reading by position silently yields '' and turns a
 * good response into "unreadable" (2026-09-20 incident). Always locate the
 * text by block type via this helper.
 *
 * Pure and dependency-free: used by server.js, agents/, and the SPA bundle.
 */

// A block carries answer text if it has a string `text` and is either a
// `text` block or a typeless legacy/mock block. Thinking blocks never qualify
// even if a stray `text` field is present.
function isTextBlock(block) {
  return (
    block != null &&
    typeof block === 'object' &&
    typeof block.text === 'string' &&
    (block.type === undefined || block.type === 'text')
  );
}

/**
 * @param {object} response Parsed Messages API response body.
 * @returns {{text: string, hasText: boolean, blockTypes: string[],
 *            stopReason: string|null, truncated: boolean, refused: boolean}}
 */
export function extractResponseText(response) {
  const blocks = Array.isArray(response?.content) ? response.content : [];
  const text = blocks.filter(isTextBlock).map((b) => b.text).join('');
  const stopReason = response?.stop_reason ?? null;
  return {
    text,
    hasText: text.trim().length > 0,
    blockTypes: blocks.map((b) => (b && typeof b === 'object' && b.type) || 'unknown'),
    stopReason,
    truncated: stopReason === 'max_tokens',
    refused: stopReason === 'refusal',
  };
}

/**
 * One-line, STRUCTURE-ONLY description of a response for logs and
 * agent_runs.error. Deliberately never includes the text itself — quote
 * analyses contain customer site addresses.
 */
export function describeResponseShape(response) {
  const r = extractResponseText(response);
  const outputTokens = response?.usage?.output_tokens ?? 'n/a';
  return (
    `blocks=[${r.blockTypes.join(',')}] stop_reason=${r.stopReason ?? 'n/a'} ` +
    `output_tokens=${outputTokens} text_chars=${r.text.length}`
  );
}
