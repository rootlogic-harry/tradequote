import fs from 'node:fs';
import path from 'node:path';

/**
 * Submit one fixture's inputs to a FastQuote /analyse endpoint and return
 * the structured output the comparator wants: { totalAmount, measurements,
 * labour, materials }.
 *
 * The endpoint shape is the same `/api/users/:id/analyse` route the React
 * client uses (src/utils/analyseJob.js). We piggy-back on it so the suite
 * exercises the real production code path, not a mocked one.
 *
 * Auth: header `x-test-user-id: <id>` works when the server is booted with
 * ENABLE_TEST_AUTH=1 + NODE_ENV != production (server.js:1018 TEST_AUTH_ENABLED).
 *
 * @param {object} fixture     — loaded fixture object from fixtureLoader
 * @param {object} opts
 * @param {string} opts.baseUrl   — e.g. http://localhost:3000
 * @param {string} opts.testUserId — user id to impersonate via x-test-user-id
 * @returns {Promise<object>}  — { totalAmount, measurements, labour, materials, raw }
 */
export async function runFixture(fixture, opts) {
  const baseUrl = (opts.baseUrl || '').replace(/\/$/, '');
  const testUserId = opts.testUserId;
  if (!baseUrl) throw new Error('runFixture: opts.baseUrl is required');
  if (!testUserId) throw new Error('runFixture: opts.testUserId is required');

  // Build the imageContent array the same way the React client does.
  // We're hitting /api/users/:id/analyse so the server-side path
  // (calibration notes, plausibility bounds, self-critique, friendlyError)
  // is exercised verbatim.
  const PHOTO_SLOT_LABELS = {
    overview: 'Overview',
    closeup: 'Close-up',
    sideProfile: 'Side Profile',
    referenceCard: 'Reference Card',
    access: 'Access',
  };
  const imageContent = [];

  const jobDetails = fixture.inputs || {};
  const scaleBlock = jobDetails.scaleReferences?.trim()
    ? `\nUSER-PROVIDED SCALE REFERENCES: ${jobDetails.scaleReferences.trim()}`
    : '';
  const notesBlock = jobDetails.briefNotes
    ? `\nTRADESMAN'S ON-SITE OBSERVATIONS:\n${jobDetails.briefNotes}`
    : '';
  imageContent.push({
    type: 'text',
    text: `JOB CONTEXT\nSite address: ${jobDetails.siteAddress || ''}${notesBlock}${scaleBlock}`,
  });

  for (const [slot, label] of Object.entries(PHOTO_SLOT_LABELS)) {
    const filePath = fixture._photosResolved?.[slot];
    if (!filePath) continue;
    if (!fs.existsSync(filePath)) {
      throw new Error(`Fixture ${fixture.id}: photo missing at ${filePath}`);
    }
    const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'jpeg';
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const base64 = fs.readFileSync(filePath).toString('base64');
    imageContent.push({ type: 'text', text: `--- Photo: ${label} ---` });
    imageContent.push({
      type: 'image',
      source: { type: 'base64', media_type: mime, data: base64 },
    });
  }

  const body = {
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4000,
    messages: [{ role: 'user', content: imageContent }],
    briefNotes: jobDetails.briefNotes || '',
  };

  const url = `${baseUrl}/api/users/${encodeURIComponent(testUserId)}/analyse`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-test-user-id': testUserId,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`analyse endpoint returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  // /analyse returns Anthropic's response shape with content[0].text being
  // the JSON the model produced. Parse it.
  const rawText = data.content?.[0]?.text || '';
  let parsed;
  try {
    const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[1].trim() : rawText.trim());
  } catch (err) {
    throw new Error(`Could not parse analysis JSON: ${err.message}`);
  }

  return toComparatorShape(parsed);
}

/**
 * Reshape the server's analysis output into the flat structure the
 * comparator expects. The comparator only cares about a small slice
 * of the analysis — extracting that slice here keeps the comparator
 * decoupled from the AI schema.
 */
export function toComparatorShape(parsed) {
  const measurements = {};
  for (const m of parsed.measurements || []) {
    if (m && m.item && typeof m.valueMm === 'number') {
      measurements[m.item] = m.valueMm;
    }
  }

  const labour = {
    estimatedDays: parsed.labourEstimate?.estimatedDays,
    numberOfWorkers: parsed.labourEstimate?.numberOfWorkers,
  };

  // Total quote = sum(materials.totalCost) + days × workers × dayRate
  // We don't have the user's dayRate here; rely on the parsed values
  // the model produced. The fixture's groundTruth.totalAmount is set
  // accordingly.
  const materialsSubtotal = (parsed.materials || []).reduce(
    (s, m) => s + (Number(m?.totalCost) || 0),
    0
  );
  const labourTotal =
    (Number(labour.estimatedDays) || 0) *
    (Number(labour.numberOfWorkers) || 0) *
    (Number(parsed.labourEstimate?.dayRate) || 0);
  const totalAmount = materialsSubtotal + labourTotal;

  return {
    totalAmount,
    measurements,
    labour,
    materials: parsed.materials || [],
    raw: parsed,
  };
}
