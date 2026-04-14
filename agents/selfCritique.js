import { runAgent } from './agentUtils.js';

const CRITIQUE_SYSTEM_PROMPT = `You are a quality-assurance reviewer for dry stone wall repair quotes.
You've been given an AI analysis of job photographs. Check for:
1. Tonnage vs dimensions mismatch (e.g. 2 tonnes for a 1m wall section)
2. Labour days unrealistic for the scope (e.g. 10 days for a small gap)
3. Materials list missing obvious items for the job type
4. Measurements that contradict each other (e.g. wall height > wall length)
5. Additional costs that seem inappropriate for the job type
6. Stone type inconsistency (e.g. limestone pricing used for gritstone)
7. Schedule of works steps that don't match the damage described

Return ONLY valid JSON. No preamble, no markdown fences. Schema:
{
  "corrections": [
    {
      "field": "string — which field or section has the issue",
      "issue": "string — what the problem is",
      "suggestedFix": "string — what the corrected value or approach should be",
      "severity": "low | medium | high"
    }
  ],
  "notes": "string — overall assessment summary",
  "confidence": 0.0 to 1.0
}

If everything looks consistent, return:
{ "corrections": [], "notes": "No issues found", "confidence": 1.0 }`;

/**
 * Merge critique corrections into the analysis result.
 * Only applies corrections that map to known fields.
 */
function applyCorrectedValues(analysis, corrections) {
  if (!corrections || corrections.length === 0) return analysis;

  const result = JSON.parse(JSON.stringify(analysis)); // deep clone

  for (const correction of corrections) {
    const field = correction.field?.toLowerCase();

    // Labour days correction
    if (field?.includes('labour') && field?.includes('day') && correction.suggestedFix) {
      const days = parseFloat(correction.suggestedFix);
      if (!isNaN(days) && days > 0 && result.labourEstimate) {
        result.labourEstimate.estimatedDays = days;
      }
    }

    // Tonnage / material quantity correction
    if (field?.includes('tonnage') || field?.includes('stone supply')) {
      const match = correction.suggestedFix?.match(/[\d.]+/);
      if (match && result.materials) {
        const tonnageItem = result.materials.find(m =>
          m.description?.toLowerCase().includes('stone') && m.unit?.toLowerCase() === 't'
        );
        if (tonnageItem) {
          const newQty = parseFloat(match[0]);
          if (!isNaN(newQty) && newQty > 0) {
            tonnageItem.quantity = String(newQty);
            tonnageItem.totalCost = newQty * (tonnageItem.unitCost || 0);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Run the self-critique agent on an analysis result.
 *
 * @param {Object} opts
 * @param {import('pg').Pool} opts.pool
 * @param {string} opts.userId
 * @param {string} [opts.jobId]
 * @param {Object} opts.analysis - The raw analysis JSON from the first Claude call
 * @param {string} opts.briefNotes - User's brief notes about the job
 * @returns {Promise<{analysis: Object, critique: Object, runId: string}>}
 */
async function runSelfCritique({ pool, userId, jobId, analysis, briefNotes }) {
  const userContent = `Here is the analysis output to review:

${JSON.stringify(analysis, null, 2)}

${briefNotes ? `Tradesman's notes about the job: ${briefNotes}` : ''}

Check for internal consistency issues in this dry stone wall repair quote analysis.`;

  const { runId, output } = await runAgent({
    pool,
    userId,
    jobId,
    agentType: 'self_critique',
    systemPrompt: CRITIQUE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
    model: 'claude-haiku-4-5-20251001', // Fast model for critique — cost-efficient
    maxTokens: 2000,
    inputSummary: {
      materialsCount: analysis.materials?.length,
      measurementsCount: analysis.measurements?.length,
      labourDays: analysis.labourEstimate?.estimatedDays,
      stoneType: analysis.stoneType,
    },
  });

  const critique = output || { corrections: [], notes: 'Critique could not be parsed', confidence: 0 };

  // Apply corrections if any high/medium severity ones found
  const significantCorrections = (critique.corrections || []).filter(
    c => c.severity === 'high' || c.severity === 'medium'
  );

  const correctedAnalysis = significantCorrections.length > 0
    ? applyCorrectedValues(analysis, significantCorrections)
    : analysis;

  return {
    analysis: correctedAnalysis,
    critique,
    runId,
  };
}

export { runSelfCritique, applyCorrectedValues, CRITIQUE_SYSTEM_PROMPT };
