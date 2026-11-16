import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { calculateAIAccuracyScore } from '../utils/diffTracking.js';

const serverSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../server.js'),
  'utf8',
);
import {
  MEASUREMENT_REMOVED,
  MEASUREMENT_REMOVED_VALUE,
  appendRemovedMeasurementSection,
  buildMeasurementRemovalDiff,
  formatRemovedMeasurementSection,
} from '../utils/removedMeasurements.js';

describe('buildMeasurementRemovalDiff', () => {
  test('records the suggestion as removed without treating it as a numeric edit', () => {
    const diff = buildMeasurementRemovalDiff('A4 card width', '210mm');
    expect(diff.fieldType).toBe(MEASUREMENT_REMOVED);
    expect(diff.fieldLabel).toBe('A4 card width');
    expect(diff.aiValue).toBe('210mm');
    expect(diff.confirmedValue).toBe(MEASUREMENT_REMOVED_VALUE);
    expect(diff.wasEdited).toBe(true);
    expect(diff.editMagnitude).toBeNull();
  });

  test('does not change the numeric accuracy score', () => {
    const kept = { fieldType: 'measurement', wasEdited: false, editMagnitude: 0 };
    const removed = buildMeasurementRemovalDiff('Area m²', '12');
    expect(calculateAIAccuracyScore([kept, removed])).toBe(1);
  });

  test('keeps a missing suggestion as an empty string so the diff can be stored', () => {
    const diff = buildMeasurementRemovalDiff('Wall length', null);
    expect(diff.aiValue).toBe('');
    expect(diff.confirmedValue).toBe('[removed]');
  });
});

describe('analyse prompt wiring', () => {
  test('photo analyse, video analyse, and the save-time hash all append removed labels', () => {
    const uses = serverSource.match(/appendRemovedMeasurementSection\(/g) || [];
    // Version helper, char-count helper, video route, photo route.
    expect(uses.length).toBeGreaterThanOrEqual(4);
    expect(serverSource).toContain("field_type = 'measurement_removed'");
    expect(serverSource).toContain('loadRemovedMeasurementLabels(req.params.id)');
  });
});

describe('formatRemovedMeasurementSection', () => {
  test('is empty when nothing has been deleted', () => {
    expect(formatRemovedMeasurementSection([])).toBe('');
    expect(formatRemovedMeasurementSection(null)).toBe('');
    expect(appendRemovedMeasurementSection('PROMPT', [])).toBe('PROMPT');
  });

  test('tells the next analysis not to emit the deleted labels again', () => {
    const section = formatRemovedMeasurementSection(['A4 card width', 'Area m²']);
    expect(section).toContain('REMOVED MEASUREMENTS');
    expect(section).toContain('Do not emit them again');
    expect(section).toContain('1. A4 card width');
    expect(section).toContain('2. Area m²');
    expect(section).toContain('scale reference');
    expect(appendRemovedMeasurementSection('PROMPT', ['A4 card width'])).toMatch(/^PROMPT\n\nREMOVED MEASUREMENTS/);
  });

  test('drops blank labels and repeats, and caps the list', () => {
    const labels = ['  A4 card width ', 'a4 card width', '', 'Area m²'];
    for (let i = 0; i < 30; i++) labels.push(`Extra ${i}`);
    const section = formatRemovedMeasurementSection(labels);
    expect(section).toContain('1. A4 card width');
    expect(section.match(/^1\. /m)).not.toBeNull();
    expect(section).not.toMatch(/2\. a4 card width/i);
    expect(section).toContain('20. Extra 17');
    expect(section).not.toContain('Extra 18');
  });
});
