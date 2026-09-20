/**
 * Source-level contracts for the 2026-09-20 "unreadable analysis" incident.
 *
 * Behaviour lives in anthropicResponse.test.js / runAgentOutput.test.js /
 * anthropicPayload.test.js / analyseJob.test.js. These scans pin the WIRING
 * in server.js and the agents, which can't be imported into Jest (same
 * approach as anthropicTemperature.test.js / analyseInstrumentation.test.js).
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(__dirname, '../../', p), 'utf8');

const serverSrc = read('server.js');
const READERS = {
  'server.js': serverSrc,
  'agents/agentUtils.js': read('agents/agentUtils.js'),
  'agents/selfCritique.js': read('agents/selfCritique.js'),
  'agents/feedbackAgent.js': read('agents/feedbackAgent.js'),
  'agents/calibrationAgent.js': read('agents/calibrationAgent.js'),
  'src/utils/analyseJob.js': read('src/utils/analyseJob.js'),
};

// Comments legitimately explain the bug ("never content[0]"), so scan CODE
// only. Line-comment stripping requires whitespace/line-start before `//` so
// URLs like https://… inside strings are left alone.
const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

describe('no positional content-block reads (thinking blocks lead the response)', () => {
  test.each(Object.keys(READERS))('%s never reads content[0]', (file) => {
    // Matches content[0], content?.[0], content?.[0]?.text, .content [0] …
    expect(stripComments(READERS[file])).not.toMatch(/content\s*\??\.?\s*\[\s*0\s*\]/);
  });

  test('the scan itself catches a real positional read (guards the guard)', () => {
    const bad = 'const t = resp.content?.[0]?.text || "";';
    expect(stripComments(bad)).toMatch(/content\s*\??\.?\s*\[\s*0\s*\]/);
    const commentOnly = '// never content[0]\nconst ok = 1;';
    expect(stripComments(commentOnly)).not.toMatch(/content\s*\??\.?\s*\[\s*0\s*\]/);
  });
});

describe('photo /api/users/:id/analyse route', () => {
  const start = serverSrc.indexOf("app.post('/api/users/:id/analyse'");
  const end = serverSrc.indexOf('// ─', start + 1);
  const block = serverSrc.slice(start, end);

  test('extracts text via the block-aware helper', () => {
    expect(block).toMatch(/extractResponseText\(/);
  });

  test('disables thinking on claude-sonnet-5 (restores pre-upgrade behaviour, removes max_tokens starvation)', () => {
    expect(block).toMatch(/thinking:[^\n]*claude-sonnet-5[^\n]*type:\s*'disabled'/);
  });

  test('keeps low effort', () => {
    expect(block).toMatch(/effort:\s*'low'/);
  });

  test('parses with the same lenient parser the client uses (prose-wrapped JSON must not regress)', () => {
    expect(block).toMatch(/parseAIResponse\(/);
    expect(block).not.toMatch(/JSON\.parse\(toParse\)/);
  });

  test('no longer returns HTTP 200 with unparseable text (the silent failure)', () => {
    expect(block).not.toMatch(/Return raw response if not parseable/);
    expect(block).not.toMatch(/critiqueNotes:\s*null,\s*\}\);\s*\}/);
  });

  test('unreadable output → 422, run marked failed, structure-only diagnostic log', () => {
    expect(block).toMatch(/status\(422\)/);
    expect(block).toMatch(/Analysis returned an unreadable response/);
    expect(block).toMatch(/failAgentRun\(/);
    expect(block).toMatch(/\[Analyse\] unreadable model output/);
    expect(block).toMatch(/describeResponseShape\(/);
  });

  test('a max_tokens truncation is reported as such, not as a generic parse failure', () => {
    expect(block).toMatch(/truncated/);
  });
});

describe('video analysis route', () => {
  test('disables thinking on its claude-sonnet-5 call', () => {
    const videoBlock = serverSrc.match(
      /callAnthropicRaw\(\{[\s\S]{0,1200}?model: 'claude-sonnet-5'[\s\S]{0,1200}?\}\)/
    );
    expect(videoBlock).not.toBeNull();
    expect(videoBlock[0]).toMatch(/thinking:\s*\{\s*type:\s*'disabled'\s*\}/);
  });

  test('extracts text via the block-aware helper', () => {
    const idx = serverSrc.indexOf("model: 'claude-sonnet-5'");
    expect(serverSrc.slice(idx, idx + 1500)).toMatch(/extractResponseText\(/);
  });
});

describe('analysis max_tokens headroom (Sonnet 5 tokenizer emits ~30% more tokens than 4.x for the same text)', () => {
  // 4000 was tuned on Sonnet 4.5. max_tokens is a ceiling, not a target —
  // raising it costs nothing unless the output is actually that long — and
  // the server proxy ceiling is 8192. Truncation would surface as a 422.
  const CEILING = Number(/ANTHROPIC_MAX_TOKENS_CEILING\s*=\s*(\d+)/.exec(serverSrc)[1]);

  test('client requests >= 8000 and never above the server ceiling', () => {
    const n = Number(/max_tokens:\s*(\d+)/.exec(READERS['src/utils/analyseJob.js'])[1]);
    expect(n).toBeGreaterThanOrEqual(8000);
    expect(n).toBeLessThanOrEqual(CEILING);
  });

  test("photo route's fallback when the client sends none is >= 8000", () => {
    const start = serverSrc.indexOf("app.post('/api/users/:id/analyse'");
    const block = serverSrc.slice(start, serverSrc.indexOf('// ─', start + 1));
    const fallback = Number(/Math\.min\(max_tokens,[^)]*\)\s*:\s*(\d+)/.exec(block)[1]);
    expect(fallback).toBeGreaterThanOrEqual(8000);
    expect(fallback).toBeLessThanOrEqual(CEILING);
  });

  test('video route asks for >= 8000', () => {
    const idx = serverSrc.indexOf("model: 'claude-sonnet-5'");
    const n = Number(/maxTokens:\s*(\d+)/.exec(serverSrc.slice(idx, idx + 400))[1]);
    expect(n).toBeGreaterThanOrEqual(8000);
    expect(n).toBeLessThanOrEqual(CEILING);
  });
});

describe('agents on claude-opus-5 (thinking stays ON — it helps critique — but budgets must allow for it)', () => {
  const maxTokensOf = (src) => Number(/maxTokens:\s*(\d[\d_]*)/.exec(src)?.[1].replace(/_/g, ''));

  test('self-critique runs at low effort so it fits SELF_CRITIQUE_TIMEOUT_MS', () => {
    expect(READERS['agents/selfCritique.js']).toMatch(/effort:\s*'low'/);
  });

  // Thinking tokens count against max_tokens. The pre-upgrade budgets
  // (2000/2000/3000) were sized for Haiku with no thinking.
  test('self-critique maxTokens >= 4000', () => {
    expect(maxTokensOf(READERS['agents/selfCritique.js'])).toBeGreaterThanOrEqual(4000);
  });
  test('feedback maxTokens >= 6000', () => {
    expect(maxTokensOf(READERS['agents/feedbackAgent.js'])).toBeGreaterThanOrEqual(6000);
  });
  test('calibration maxTokens >= 8000', () => {
    expect(maxTokensOf(READERS['agents/calibrationAgent.js'])).toBeGreaterThanOrEqual(8000);
  });
});

describe('operational config (2026-09-20 review)', () => {
  test('SELF_CRITIQUE_TIMEOUT_MS leaves >= ~2x headroom over the observed ~24s Opus 5 critique', () => {
    // Measured in production at effort 'low': 23.8s against the old 25s limit —
    // a slightly slower run would have silently skipped the critique.
    const ms = Number(/SELF_CRITIQUE_TIMEOUT_MS\s*=\s*([\d_]+)/.exec(serverSrc)[1].replace(/_/g, ''));
    expect(ms).toBeGreaterThanOrEqual(45000);
  });

  test("agentUtils DEFAULT_MODEL is a model the proxy allowlist actually permits", () => {
    // It was 'claude-sonnet-4-5-20250929' (retired lineage, not allowlisted).
    // All callers pass a model today, but a future caller that forgets would
    // have sent a model the rest of the system rejects.
    const allow = serverSrc.match(/ANTHROPIC_MODEL_ALLOWLIST\s*=\s*new Set\(\[([\s\S]*?)\]\)/)[1];
    const allowed = [...allow.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const def = /const DEFAULT_MODEL\s*=\s*'([^']+)'/.exec(READERS['agents/agentUtils.js'])[1];
    expect(allowed).toContain(def);
  });
});
