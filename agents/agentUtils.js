import https from 'https';

const ANTHROPIC_API_URL = 'api.anthropic.com';
const ANTHROPIC_API_PATH = '/v1/messages';
// Hotfix 2026-06-16: Anthropic retired claude-sonnet-4-20250514
// (Paul started hitting 404 not_found_error on every analyse call).
// Migrated to Sonnet 4.5 — same pricing ($3/$15 per MTok), behaviourally
// close. The old string is kept in src/utils/anthropicPricing.js for
// historical agent_runs row cost-out only.
const DEFAULT_MODEL = 'claude-sonnet-4-5-20250929';
const DEFAULT_MAX_TOKENS = 4000;

/**
 * Canonical `agent_runs.status` enum — DO NOT add new values without
 * a deliberate migration.
 *
 *   'running'   → row inserted, agent in flight
 *   'completed' → finished successfully (THE single success string)
 *   'failed'    → threw or returned an error
 *
 * TRQ-140 history: the /api/users/:id/analyse path used to write 'ok'
 * here, which made every analyse row invisible to filters keyed on
 * 'completed' (the calibration agent's "recent completed runs" query
 * and the auto-calibration trigger). All writers now use 'completed'.
 * A one-shot migration (scripts/migrate-agent-runs-status-ok.js)
 * converts legacy 'ok' rows.
 *
 * If you ever need a new status, update:
 *   1. This comment
 *   2. Every writer (currently this file + server.js:/analyse path)
 *   3. Every reader / FILTER clause in server.js + agents/*.js
 *   4. The Analytics dashboard payload if exposing it
 */
export const AGENT_RUN_STATUS = Object.freeze({
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
});

/**
 * Create an agent_run row in the database with status 'running'.
 */
async function createAgentRun(pool, { userId, jobId, agentType, inputSummary }) {
  const { rows } = await pool.query(
    `INSERT INTO agent_runs (user_id, job_id, agent_type, status, input_summary, created_at)
     VALUES ($1, $2, $3, 'running', $4, NOW())
     RETURNING id`,
    [userId || null, jobId || null, agentType, inputSummary ? JSON.stringify(inputSummary) : null]
  );
  return rows[0].id;
}

/**
 * Mark an agent_run as completed with output summary and timing.
 *
 * Lifecycle bug-hunt 2026-06-30 #4: WHERE includes `status = 'running'`
 * so a row already stamped 'failed' by reapOrphanedRuns (60-min
 * threshold) is NOT silently overwritten back to 'completed' when a
 * slow agent finally returns. The analytics queries that count
 * `failed` runs rely on the reaper stamp being durable.
 */
async function completeAgentRun(pool, runId, { output, model, promptTokens, completionTokens, durationMs }) {
  const { rowCount } = await pool.query(
    `UPDATE agent_runs
     SET status = 'completed',
         output_summary = $1,
         model = $2,
         prompt_tokens = $3,
         completion_tokens = $4,
         duration_ms = $5
     WHERE id = $6 AND status = 'running'`,
    [
      output ? JSON.stringify(output) : null,
      model || null,
      promptTokens || null,
      completionTokens || null,
      durationMs || null,
      runId,
    ]
  );
  if (rowCount === 0) {
    // Almost certainly reaped — log so the audit trail is visible
    // without throwing (the agent did finish; the work was real).
    console.warn(`[Agent] completeAgentRun no-op: runId=${runId} was no longer 'running' (likely reaped). Audit row stays 'failed' to preserve analytics integrity.`);
  }
}

/**
 * Mark an agent_run as failed with error message.
 *
 * Same WHERE guard as completeAgentRun — if the reaper has already
 * stamped this row 'failed', leave the reaper's marker in `error`
 * intact rather than overwriting with the in-process error.
 */
async function failAgentRun(pool, runId, errorMessage, durationMs) {
  const { rowCount } = await pool.query(
    `UPDATE agent_runs
     SET status = 'failed', error = $1, duration_ms = $2
     WHERE id = $3 AND status = 'running'`,
    [errorMessage, durationMs || null, runId]
  );
  if (rowCount === 0) {
    console.warn(`[Agent] failAgentRun no-op: runId=${runId} was no longer 'running' (likely reaped). Original reaper marker preserved.`);
  }
}

/**
 * Make a raw HTTPS request to the Anthropic Messages API.
 * Returns the parsed JSON response body.
 */
function callAnthropicRaw({ systemPrompt, messages, model, maxTokens, apiKey, temperature }) {
  // Anthropic's default temperature is 1.0 (maximum sampling diversity).
  // For our measurement-extraction task that produces £10k swings between
  // back-to-back runs on identical inputs (Paul, 2026-05-13). Callers pass
  // a low temperature explicitly when they want repeatable structured
  // output; when omitted we leave Anthropic's default so existing agent
  // calls (self-critique, feedback) aren't subtly altered by this change.
  const payload = {
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
    system: systemPrompt,
    messages,
  };
  if (typeof temperature === 'number' && temperature >= 0 && temperature <= 1) {
    payload.temperature = temperature;
  }
  const body = JSON.stringify(payload);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: ANTHROPIC_API_URL,
        path: ANTHROPIC_API_PATH,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: 180000, // 3 minutes
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString();
          if (res.statusCode >= 400) {
            reject(new Error(`Anthropic API error (${res.statusCode}): ${raw}`));
            return;
          }
          try {
            resolve(JSON.parse(raw));
          } catch {
            reject(new Error(`Anthropic API returned unparseable response: ${raw.slice(0, 200)}`));
          }
        });
        res.on('error', reject);
      }
    );
    req.on('timeout', () => req.destroy(new Error('Anthropic API request timed out')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * High-level agent runner: creates a run, calls Claude, logs the result.
 *
 * @param {Object} opts
 * @param {import('pg').Pool} opts.pool - Postgres pool
 * @param {string} opts.userId - User who triggered the agent
 * @param {string} [opts.jobId] - Associated job ID
 * @param {string} opts.agentType - 'self_critique' | 'feedback' | 'calibration'
 * @param {string} opts.systemPrompt - System prompt for Claude
 * @param {Array} opts.messages - Messages array for Claude
 * @param {string} [opts.model] - Model override
 * @param {number} [opts.maxTokens] - Max tokens override
 * @param {Object} [opts.inputSummary] - Summary of input for logging
 * @returns {Promise<{runId: string, output: Object, rawText: string}>}
 */
async function runAgent({ pool, userId, jobId, agentType, systemPrompt, messages, model, maxTokens, inputSummary }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not configured');
  }

  const runId = await createAgentRun(pool, { userId, jobId, agentType, inputSummary });
  const start = Date.now();

  try {
    const response = await callAnthropicRaw({
      systemPrompt,
      messages,
      model: model || DEFAULT_MODEL,
      maxTokens,
      apiKey,
    });

    const durationMs = Date.now() - start;
    const rawText = response.content?.[0]?.text || '';
    const usage = response.usage || {};

    // Try to parse JSON from the response text
    let parsed = null;
    try {
      // Handle ```json fences
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      const toParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
      parsed = JSON.parse(toParse);
    } catch {
      // Not JSON — that's OK for some agents, keep rawText
    }

    await completeAgentRun(pool, runId, {
      output: parsed || { rawText },
      model: model || DEFAULT_MODEL,
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
      durationMs,
    });

    return { runId, output: parsed, rawText, durationMs };
  } catch (err) {
    const durationMs = Date.now() - start;
    await failAgentRun(pool, runId, err.message, durationMs).catch(() => {});
    throw err;
  }
}

/**
 * Wall-clock timeout wrapper. The socket-idle timeout in callAnthropicRaw
 * does not protect against slow drips from the upstream API — once any
 * byte arrives the idle clock resets. This gives callers a hard deadline
 * so user-facing flows never block indefinitely on best-effort agents.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export { runAgent, createAgentRun, completeAgentRun, failAgentRun, callAnthropicRaw, withTimeout };
