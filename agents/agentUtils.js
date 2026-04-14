import https from 'https';

const ANTHROPIC_API_URL = 'api.anthropic.com';
const ANTHROPIC_API_PATH = '/v1/messages';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const DEFAULT_MAX_TOKENS = 4000;

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
 */
async function completeAgentRun(pool, runId, { output, model, promptTokens, completionTokens, durationMs }) {
  await pool.query(
    `UPDATE agent_runs
     SET status = 'completed',
         output_summary = $1,
         model = $2,
         prompt_tokens = $3,
         completion_tokens = $4,
         duration_ms = $5
     WHERE id = $6`,
    [
      output ? JSON.stringify(output) : null,
      model || null,
      promptTokens || null,
      completionTokens || null,
      durationMs || null,
      runId,
    ]
  );
}

/**
 * Mark an agent_run as failed with error message.
 */
async function failAgentRun(pool, runId, errorMessage, durationMs) {
  await pool.query(
    `UPDATE agent_runs
     SET status = 'failed', error = $1, duration_ms = $2
     WHERE id = $3`,
    [errorMessage, durationMs || null, runId]
  );
}

/**
 * Make a raw HTTPS request to the Anthropic Messages API.
 * Returns the parsed JSON response body.
 */
function callAnthropicRaw({ systemPrompt, messages, model, maxTokens, apiKey }) {
  const body = JSON.stringify({
    model: model || DEFAULT_MODEL,
    max_tokens: maxTokens || DEFAULT_MAX_TOKENS,
    system: systemPrompt,
    messages,
  });

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

export { runAgent, createAgentRun, completeAgentRun, failAgentRun, callAnthropicRaw };
