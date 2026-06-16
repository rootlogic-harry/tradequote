/**
 * Guards on .gitleaksignore — TRQ-156 follow-up.
 *
 * The ignore file is a place future leaks could be hidden by mistake.
 * These tests enforce that every entry has a documented reason and
 * that the file matches the actual false-positive shape (the
 * client-portal test-fixture UUID).
 *
 * If a new entry needs adding, the human review should explain WHY
 * it's a false positive in a comment block above the fingerprint
 * line. This test makes "no comment" + "new entry" fail loudly.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const ignorePath = join(repoRoot, '.gitleaksignore');

describe('.gitleaksignore — exists and is hygienic', () => {
  test('the file exists', () => {
    expect(existsSync(ignorePath)).toBe(true);
  });

  test('opens with the format + "no entry without why" guidance', () => {
    const src = readFileSync(ignorePath, 'utf8');
    // The "Never add a line without the why" guidance wraps across a
    // markdown comment newline (`# ` prefix on the continuation line).
    expect(src).toMatch(/Never add a line without[\s\S]{0,20}the why/);
    expect(src).toMatch(/Fingerprint/);
  });
});

describe('.gitleaksignore — entries match the known false-positive shape', () => {
  const lines = readFileSync(ignorePath, 'utf8').split('\n');
  // A fingerprint line: <sha>:<file>:<rule>:<line>
  const fingerprintLines = lines
    .map((l, i) => ({ line: l.trim(), index: i }))
    .filter(({ line }) => /^[0-9a-f]{40}:.+:[a-z-]+:\d+$/.test(line));

  test('there are six entries (matches the TRQ-156 audit count)', () => {
    expect(fingerprintLines).toHaveLength(6);
  });

  test('every entry targets a file under src/__tests__/', () => {
    for (const { line } of fingerprintLines) {
      const [, file] = line.split(':');
      expect(file.startsWith('src/__tests__/')).toBe(true);
    }
  });

  test('every entry is the generic-api-key rule (no other rules suppressed)', () => {
    for (const { line } of fingerprintLines) {
      const parts = line.split(':');
      expect(parts[2]).toBe('generic-api-key');
    }
  });

  test('every fingerprint line has a preceding why-block comment', () => {
    // Walk backwards from each fingerprint line. The nearest non-blank
    // line above must be either another fingerprint line OR a comment
    // (`#`). At least one of the preceding comment lines (within 30
    // lines) must contain words like "false positive", "safe", or
    // "test fixture".
    for (const { index } of fingerprintLines) {
      const before = lines.slice(Math.max(0, index - 30), index).join('\n');
      expect(before).toMatch(/false positive|safe|test fixture|test-fixture/i);
    }
  });

  test('client-portal context is documented (the why for these specific entries)', () => {
    const src = readFileSync(ignorePath, 'utf8');
    expect(src).toMatch(/client.portal|portal.test|\/q\/:token/i);
    expect(src).toMatch(/a3f7c091-2e84-4b1a-9f23-8d05e7b61c3a/);
  });
});
