/**
 * Source-level assertion that the /api/admin/learning endpoint
 * (which feeds the bias chart in LearningDashboard.jsx) computes
 * bias via parseAiValue rather than the corrupted SQL
 * AVG(edit_magnitude) path.
 *
 * 2026-06-22 calibration investigation: `ai_value` was stored as
 * display strings like "2,000mm". parseFloat("2,000mm") → 2 (not
 * 2000), so the stored edit_magnitude was wildly wrong, and the
 * per-field bias chart showed 154,900% biases that contaminated all
 * downstream calibration decisions. Fix: pull raw values and
 * re-aggregate in JS using parseAiValue + computeFieldBiasFromRows.
 *
 * Bonus: also asserts that aiValue itself is UNTOUCHED — the writer
 * paths (aiParser.js, diffTracking.js) are on the Do-Not-Touch List
 * and changing them would invalidate the existing learning corpus.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const aiParserSource = readFileSync(join(__dirname, '../utils/aiParser.js'), 'utf8');
const diffTrackingSource = readFileSync(join(__dirname, '../utils/diffTracking.js'), 'utf8');

describe('/api/admin/learning bias chart uses parseAiValue', () => {
  test('server imports the computeFieldBiasFromRows helper', () => {
    expect(serverSource).toContain("from './src/utils/computeFieldBias.js'");
    expect(serverSource).toContain('computeFieldBiasFromRows');
  });

  test('/api/admin/learning route uses computeFieldBiasFromRows for bias', () => {
    const routeStart = serverSource.indexOf("'/api/admin/learning'");
    const routeEnd = serverSource.indexOf('// --- Admin User Management ---');
    expect(routeStart).toBeGreaterThan(-1);
    expect(routeEnd).toBeGreaterThan(routeStart);

    const routeBody = serverSource.slice(routeStart, routeEnd);
    expect(routeBody).toContain('computeFieldBiasFromRows');
    // The route fetches raw ai_value + confirmed_value so the
    // aggregator can re-parse them with parseAiValue.
    expect(routeBody).toContain('ai_value');
    expect(routeBody).toContain('confirmed_value');
  });

  test('/api/admin/learning route no longer relies on AVG(edit_magnitude) for bias', () => {
    // The corrupted-edit_magnitude path was the bug. The route may
    // still touch edit_magnitude for legacy reads elsewhere, but
    // the fieldBias query specifically must not use it.
    const routeStart = serverSource.indexOf("'/api/admin/learning'");
    const routeEnd = serverSource.indexOf('// --- Admin User Management ---');
    const routeBody = serverSource.slice(routeStart, routeEnd);

    // The fieldBias raw query selects ai_value + confirmed_value,
    // not edit_magnitude.
    const fieldBiasQueryStart = routeBody.indexOf('fieldBiasRaw');
    expect(fieldBiasQueryStart).toBeGreaterThan(-1);
    const fieldBiasQueryBody = routeBody.slice(fieldBiasQueryStart, fieldBiasQueryStart + 600);
    expect(fieldBiasQueryBody).not.toContain('AVG(edit_magnitude)');
    expect(fieldBiasQueryBody).toContain('ai_value');
    expect(fieldBiasQueryBody).toContain('confirmed_value');
  });
});

describe('aiValue immutability — Do-Not-Touch files are unmodified', () => {
  test('aiParser.js still sets aiValue from displayValue (unchanged)', () => {
    // The writer contract: aiValue is set ONCE in aiParser.js, from
    // m.displayValue. The 2026-06-22 fix must NOT change this — all
    // existing learning data depends on the format being consistent.
    expect(aiParserSource).toContain('aiValue: m.displayValue');
  });

  test('diffTracking.js still uses parseFloat (writer path unchanged)', () => {
    // The Do-Not-Touch contract: edit_magnitude as stored is part of
    // the existing learning corpus and must keep the same compute
    // shape. The fix reads ai_value RAW in the dashboard endpoint and
    // re-parses with parseAiValue — diffTracking itself is untouched.
    expect(diffTrackingSource).toContain('parseFloat(aiValue)');
    expect(diffTrackingSource).toContain('parseFloat(confirmedValue)');
  });
});

describe('parseAiValue is the canonical reader', () => {
  test('parseAiValue lives in src/utils/parseAiValue.js', () => {
    // Brief acceptance: "src/utils/parseAiValue.js exists with the
    // robust parser". Verified by the test file's import resolving.
    const utilSource = readFileSync(join(__dirname, '../utils/parseAiValue.js'), 'utf8');
    expect(utilSource).toContain('export function parseAiValue');
  });

  test('computeFieldBias uses parseAiValue (not parseFloat)', () => {
    const utilSource = readFileSync(join(__dirname, '../utils/computeFieldBias.js'), 'utf8');
    expect(utilSource).toContain("import { parseAiValue } from './parseAiValue.js'");
    expect(utilSource).toContain('parseAiValue(row.ai_value)');
    expect(utilSource).toContain('parseAiValue(row.confirmed_value)');
    // Must not CALL parseFloat (the bug we're fixing). Allowed in
    // comments referencing the prior bug, but never invoked.
    expect(utilSource).not.toMatch(/\bparseFloat\(/);
  });
});
