/**
 * Agent retry queue — exponential backoff for failed agent runs.
 */

/**
 * Build a retry queue entry.
 */
export function buildRetryEntry(agentType, payload, lastError, maxAttempts = 3) {
  return {
    agentType,
    payload,
    lastError,
    attempts: 0,
    maxAttempts,
  };
}

/**
 * Calculate the next retry time using exponential backoff: 2^attempts * 60s.
 */
export function calculateNextRetryAt(attempts, baseTime = new Date()) {
  const delayMs = Math.pow(2, attempts) * 60 * 1000;
  return new Date(baseTime.getTime() + delayMs);
}

/**
 * Check if an entry can still be retried.
 */
export function isRetryable(entry) {
  return entry.attempts < entry.maxAttempts;
}

/**
 * Enqueue a failed agent run for retry.
 */
export async function enqueueRetry(pool, agentType, payload, error, maxAttempts = 3) {
  const nextRetryAt = calculateNextRetryAt(0);
  await pool.query(
    `INSERT INTO agent_retry_queue (agent_type, payload, last_error, max_attempts, next_retry_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [agentType, JSON.stringify(payload), error, maxAttempts, nextRetryAt.toISOString()]
  );
}

/**
 * Process pending retries. Calls the provided runner for each due entry.
 */
export async function processRetryQueue(pool, runners) {
  const { rows } = await pool.query(
    `SELECT * FROM agent_retry_queue
     WHERE attempts < max_attempts AND next_retry_at <= NOW()
     ORDER BY next_retry_at ASC`
  );

  for (const row of rows) {
    const runner = runners[row.agent_type];
    if (!runner) {
      console.warn(`[RetryQueue] No runner for agent_type: ${row.agent_type}`);
      continue;
    }

    try {
      const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
      await runner(payload);
      // Success — remove from queue
      await pool.query('DELETE FROM agent_retry_queue WHERE id = $1', [row.id]);
      console.log(`[RetryQueue] Successfully retried ${row.agent_type} (id: ${row.id})`);
    } catch (err) {
      const newAttempts = row.attempts + 1;
      const nextRetry = calculateNextRetryAt(newAttempts);
      await pool.query(
        `UPDATE agent_retry_queue SET attempts = $1, last_error = $2, next_retry_at = $3
         WHERE id = $4`,
        [newAttempts, err.message, nextRetry.toISOString(), row.id]
      );
      console.warn(`[RetryQueue] Retry ${newAttempts}/${row.max_attempts} failed for ${row.agent_type}: ${err.message}`);
    }
  }
}
