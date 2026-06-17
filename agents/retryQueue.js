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
 * Mark orphaned `status = 'running'` agent_runs rows as `'failed'`.
 *
 * Background (TRQ-163): rows are INSERTed with status='running' at
 * the start of an agent run; the UPDATE to 'completed' or 'failed'
 * lives in the success/error handler. Anything that prevents the
 * handler from firing — Anthropic API outage, container kill mid-
 * request, missing await — leaves a row stuck on 'running' forever.
 * Those rows then pollute analytics ("X% of analyse runs never
 * finished") and never get cleaned up because there's no retry
 * entry for them.
 *
 * This sweeper is the structural answer to the one-shot manual
 * UPDATE that was needed during TRQ-140 sign-off. It runs whenever
 * processRetryQueue() runs, which is on server start.
 *
 * Threshold: 1 hour. Real analyse runs are usually <30s; calibration
 * /feedback can take minutes but never an hour. A row in 'running'
 * for >1h is dead by definition.
 *
 * Returns the count of reaped rows (0 if nothing to do).
 */
export async function reapOrphanedRuns(pool, options = {}) {
  const staleAfterMinutes = options.staleAfterMinutes ?? 60;
  const marker = options.marker
    ?? `[reaper: orphaned 'running' run, age > ${staleAfterMinutes}m]`;

  const { rowCount } = await pool.query(
    `UPDATE agent_runs
        SET status = 'failed',
            error = COALESCE(error, '') || $1
      WHERE status = 'running'
        AND created_at < NOW() - ($2 || ' minutes')::interval`,
    [' ' + marker, String(staleAfterMinutes)]
  );

  if (rowCount > 0) {
    console.log(`[RetryQueue] Reaped ${rowCount} orphaned 'running' agent_runs row(s) (threshold ${staleAfterMinutes}m).`);
  }
  return rowCount;
}

/**
 * Process pending retries. Calls the provided runner for each due entry.
 * Also reaps any orphaned `status='running'` rows (see reapOrphanedRuns).
 */
export async function processRetryQueue(pool, runners) {
  // Reaper pass first — keeps analytics clean before the retry-attempt
  // loop starts. Failures here shouldn't block retries; log + continue.
  try {
    await reapOrphanedRuns(pool);
  } catch (err) {
    console.warn(`[RetryQueue] reapOrphanedRuns failed: ${err.message}`);
  }

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
