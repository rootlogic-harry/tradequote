import { runAgent } from './agentUtils.js';

const CALIBRATION_SYSTEM_PROMPT = `You are a calibration analyst for a dry stone wall quoting system.
You are given aggregated data about how often the system's suggestions are edited by tradesmen,
along with recent feedback lessons from completed jobs.

Your job is to propose specific calibration notes that can be added to the system's prompt
to improve future quote accuracy.

Each note should be:
- Specific and actionable (not vague)
- Based on evidence from the data provided
- Focused on a single field or category
- Written as an instruction to the quoting system

Return ONLY valid JSON. No preamble, no markdown fences. Schema:
{
  "proposed": [
    {
      "fieldType": "string — measurement | material_unit_cost | labour_days | general",
      "fieldLabel": "string — specific field name",
      "note": "string — the calibration instruction to add to the system prompt",
      "evidence": {
        "sampleSize": 0,
        "avgBias": 0.0,
        "editRate": 0.0,
        "direction": "over | under | mixed"
      }
    }
  ],
  "summary": "string — 1-2 sentence overview of findings"
}

If the data is insufficient for any proposals, return:
{ "proposed": [], "summary": "Insufficient data for calibration proposals." }`;

/**
 * Run the calibration agent to propose system prompt updates.
 *
 * @param {Object} opts
 * @param {import('pg').Pool} opts.pool
 * @param {string} opts.userId - Admin user who triggered the run
 * @returns {Promise<{runId: string, proposals: Object}>}
 */
async function runCalibrationAgent({ pool, userId }) {
  // 1. Query fields with high edit rates (>30%) and sufficient sample size (>=5)
  const { rows: fieldBias } = await pool.query(`
    SELECT field_type, field_label,
      COUNT(*) AS total,
      ROUND(AVG(CASE WHEN was_edited THEN 1.0 ELSE 0.0 END) * 100, 1) AS edit_rate_pct,
      ROUND(AVG(edit_magnitude) * 100, 1) AS avg_bias_pct,
      ROUND(AVG(ABS(edit_magnitude)) * 100, 1) AS avg_error_pct
    FROM quote_diffs
    WHERE edit_magnitude IS NOT NULL
    GROUP BY field_type, field_label
    HAVING COUNT(*) >= 5
      AND AVG(CASE WHEN was_edited THEN 1.0 ELSE 0.0 END) > 0.3
    ORDER BY AVG(CASE WHEN was_edited THEN 1.0 ELSE 0.0 END) DESC
  `);

  // 2. Query recent feedback agent lessons
  const { rows: feedbackRuns } = await pool.query(`
    SELECT output_summary, created_at
    FROM agent_runs
    WHERE agent_type = 'feedback'
      AND status = 'completed'
      AND output_summary IS NOT NULL
    ORDER BY created_at DESC
    LIMIT 20
  `);

  // 3. Load currently approved calibration notes
  const { rows: approvedNotes } = await pool.query(`
    SELECT field_type, field_label, note
    FROM calibration_notes
    WHERE status = 'approved'
    ORDER BY approved_at ASC
  `);

  const userContent = `Here is the current calibration data:

## Fields with high edit rates (>30%, sample size >= 5):
${fieldBias.length > 0
    ? fieldBias.map(f =>
        `- ${f.field_type}/${f.field_label}: edited ${f.edit_rate_pct}% of the time, avg bias ${f.avg_bias_pct}% (${Number(f.avg_bias_pct) > 0 ? 'system underestimates' : 'system overestimates'}), sample size ${f.total}`
      ).join('\n')
    : 'No fields meet the threshold yet.'}

## Recent feedback lessons from completed jobs:
${feedbackRuns.length > 0
    ? feedbackRuns.map(r => {
        const output = r.output_summary;
        return `- ${output?.overallAssessment || 'No assessment'} (severity: ${output?.severity || 'unknown'})`;
      }).join('\n')
    : 'No feedback lessons yet.'}

## Currently approved calibration notes:
${approvedNotes.length > 0
    ? approvedNotes.map(n => `- [${n.field_type}/${n.field_label}]: ${n.note}`).join('\n')
    : 'None approved yet.'}

Based on this data, propose specific calibration notes to improve quoting accuracy.
Do NOT re-propose notes that are already approved (listed above).`;

  const { runId, output } = await runAgent({
    pool,
    userId,
    jobId: null,
    agentType: 'calibration',
    systemPrompt: CALIBRATION_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 3000,
    inputSummary: {
      fieldsAboveThreshold: fieldBias.length,
      feedbackLessonsCount: feedbackRuns.length,
      approvedNotesCount: approvedNotes.length,
    },
  });

  const proposals = output || { proposed: [], summary: 'Calibration analysis could not be parsed' };

  // Insert proposed calibration notes
  if (proposals.proposed?.length > 0) {
    for (const p of proposals.proposed) {
      try {
        await pool.query(
          `INSERT INTO calibration_notes (field_type, field_label, note, status, proposed_by, evidence)
           VALUES ($1, $2, $3, 'proposed', $4, $5)`,
          [
            p.fieldType || 'general',
            p.fieldLabel || 'General',
            p.note,
            runId,
            JSON.stringify(p.evidence || {}),
          ]
        );
      } catch (err) {
        console.warn('[CalibrationAgent] Failed to insert note:', err.message);
      }
    }
  }

  return { runId, proposals };
}

export { runCalibrationAgent, CALIBRATION_SYSTEM_PROMPT };
