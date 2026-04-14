import { runAgent } from './agentUtils.js';

const FEEDBACK_SYSTEM_PROMPT = `You are a quoting accuracy analyst for dry stone wall repair professionals.
You are given a completed job's quote data and feedback from the tradesman about whether the quote was accurate.

Analyse what likely went wrong (or right) and produce structured lessons that can improve future quotes.

Consider:
1. Were measurements accurate? Check the quote diffs for edit patterns.
2. Were material quantities right? Stone tonnage is the most common source of error.
3. Was labour estimation realistic? Compare estimated days to actual scope.
4. Were any costs missed entirely?
5. Were any costs unnecessarily included?

Return ONLY valid JSON. No preamble, no markdown fences. Schema:
{
  "likelyIssues": [
    {
      "category": "measurements | materials | labour | missing_cost | excess_cost",
      "description": "string — what likely went wrong",
      "suggestedCalibration": "string — how to adjust future quotes"
    }
  ],
  "overallAssessment": "string — 1-2 sentence summary",
  "severity": "low | medium | high",
  "suggestedCalibrations": [
    {
      "fieldType": "string — e.g. 'measurement', 'material_unit_cost', 'labour_days'",
      "fieldLabel": "string — e.g. 'Stone supply', 'Estimated Days'",
      "note": "string — calibration note to add to system prompt",
      "evidence": {
        "feedback": "string — spot_on | under_quoted | over_quoted",
        "quoteTotal": 0,
        "editedFields": 0
      }
    }
  ]
}`;

/**
 * Run the feedback agent after a job is marked as completed with feedback.
 *
 * @param {Object} opts
 * @param {import('pg').Pool} opts.pool
 * @param {string} opts.userId
 * @param {string} opts.jobId
 * @param {Object} opts.quoteSnapshot - The full quote snapshot from the job
 * @param {string} opts.completionFeedback - 'spot_on' | 'under_quoted' | 'over_quoted'
 * @param {string} [opts.completionNotes] - Free-text notes from admin
 * @returns {Promise<{runId: string, lessons: Object}>}
 */
async function runFeedbackAgent({ pool, userId, jobId, quoteSnapshot, completionFeedback, completionNotes }) {
  // Gather diffs for this job
  const { rows: diffs } = await pool.query(
    `SELECT field_type, field_label, ai_value, confirmed_value, was_edited, edit_magnitude
     FROM quote_diffs WHERE job_id = $1`,
    [jobId]
  );

  const editedDiffs = diffs.filter(d => d.was_edited);
  const totalAmount = quoteSnapshot?.quotePayload?.totals?.total || 0;

  const userContent = `Job completion feedback: ${completionFeedback}
${completionNotes ? `Tradesman's notes: ${completionNotes}` : ''}

Quote total: £${totalAmount.toFixed(2)}

Fields that were edited by the tradesman (${editedDiffs.length} of ${diffs.length}):
${editedDiffs.map(d =>
  `- ${d.field_type}/${d.field_label}: AI said "${d.ai_value}", tradesman changed to "${d.confirmed_value}" (${(d.edit_magnitude * 100).toFixed(1)}% change)`
).join('\n') || 'No fields were edited.'}

Quote details:
- Materials count: ${quoteSnapshot?.reviewData?.materials?.length || 0}
- Labour days: ${quoteSnapshot?.reviewData?.labourEstimate?.estimatedDays || 'unknown'}
- Workers: ${quoteSnapshot?.reviewData?.labourEstimate?.numberOfWorkers || 'unknown'}
- Stone type: ${quoteSnapshot?.reviewData?.stoneType || 'unknown'}

Analyse what likely went wrong (or right) with this quote.`;

  const { runId, output } = await runAgent({
    pool,
    userId,
    jobId,
    agentType: 'feedback',
    systemPrompt: FEEDBACK_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 2000,
    inputSummary: {
      feedback: completionFeedback,
      quoteTotal: totalAmount,
      diffsCount: diffs.length,
      editedCount: editedDiffs.length,
    },
  });

  const lessons = output || { likelyIssues: [], overallAssessment: 'Could not analyse', severity: 'low', suggestedCalibrations: [] };

  // Create proposed calibration notes if the agent suggested any
  if (lessons.suggestedCalibrations?.length > 0 && completionFeedback !== 'spot_on') {
    for (const cal of lessons.suggestedCalibrations) {
      try {
        await pool.query(
          `INSERT INTO calibration_notes (field_type, field_label, note, status, proposed_by, evidence)
           VALUES ($1, $2, $3, 'proposed', $4, $5)`,
          [
            cal.fieldType || 'general',
            cal.fieldLabel || 'General',
            cal.note,
            runId,
            JSON.stringify(cal.evidence || {}),
          ]
        );
      } catch (err) {
        console.warn('[FeedbackAgent] Failed to insert calibration note:', err.message);
      }
    }
  }

  return { runId, lessons };
}

export { runFeedbackAgent, FEEDBACK_SYSTEM_PROMPT };
