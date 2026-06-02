import fs from 'node:fs';
import path from 'node:path';

/**
 * Load and validate fixture JSON files.
 *
 * Fixture shape (see regression/README.md for the worked example):
 *   {
 *     "id": "kebab-id-matching-filename",
 *     "name": "Human-readable name",
 *     "inputs": {
 *       "siteAddress": "...",
 *       "briefNotes": "...",
 *       "scaleReferences": "...",
 *       "photos": { "overview": "photos/overview.jpg", ... }
 *     },
 *     "groundTruth": {
 *       "totalAmount": { "value": 4500, "tolerance": 0.10 },
 *       "measurements": { "Wall height": { "value": 1200, "tolerance": 0.15 } },
 *       "labour": { "estimatedDays": { "value": 3, "abs": 0.5 } },
 *       "materials": [
 *         { "description": "walling stone" },
 *         { "description": "lime mortar", "forbidden": true }
 *       ]
 *     }
 *   }
 *
 * Photo paths are relative to the fixture file's directory.
 */
export function loadFixture(fixturePath) {
  const raw = fs.readFileSync(fixturePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Fixture ${fixturePath} is not valid JSON: ${err.message}`);
  }

  validateFixture(parsed, fixturePath);

  const fixtureDir = path.dirname(fixturePath);
  // Resolve photo paths to absolute so the runner can readFileSync them.
  const photos = parsed.inputs?.photos || {};
  const resolvedPhotos = {};
  for (const [slot, relPath] of Object.entries(photos)) {
    resolvedPhotos[slot] = path.resolve(fixtureDir, relPath);
  }

  return {
    ...parsed,
    _path: fixturePath,
    _photosResolved: resolvedPhotos,
  };
}

function validateFixture(f, fixturePath) {
  if (!f.id || typeof f.id !== 'string') {
    throw new Error(`Fixture ${fixturePath} missing required field: id`);
  }
  if (!f.inputs || typeof f.inputs !== 'object') {
    throw new Error(`Fixture ${fixturePath} missing inputs object`);
  }
  if (!f.groundTruth || typeof f.groundTruth !== 'object') {
    throw new Error(`Fixture ${fixturePath} missing groundTruth object`);
  }
  // At least one ground-truth field must exist or the comparator does nothing.
  const gt = f.groundTruth;
  const hasAnyField =
    gt.totalAmount ||
    (gt.measurements && Object.keys(gt.measurements).length > 0) ||
    (gt.labour && Object.keys(gt.labour).length > 0) ||
    (Array.isArray(gt.materials) && gt.materials.length > 0);
  if (!hasAnyField) {
    throw new Error(
      `Fixture ${fixturePath} has empty groundTruth — define at least totalAmount, measurements, labour, or materials`
    );
  }
}

/**
 * Discover all fixtures under regression/fixtures/.
 * Returns a list of loaded + validated fixtures.
 */
export function loadAllFixtures(fixturesDir) {
  if (!fs.existsSync(fixturesDir)) return [];
  const entries = fs.readdirSync(fixturesDir);
  const fixturePaths = entries
    .filter((e) => e.endsWith('.json'))
    .map((e) => path.join(fixturesDir, e));
  return fixturePaths.map(loadFixture);
}
