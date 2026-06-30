/**
 * Source-level guard for the /guides/ content hub (discoverability Wave 2).
 *
 * Every markdown file in content/guides/ must:
 *   - have YAML front-matter with title, description, slug
 *   - slug be kebab-case and match the filename
 *   - description be <= 160 chars (meta-description rule)
 *   - body be >= 200 words (no stubs)
 *   - contain no banned vocabulary in body OR front-matter
 *
 * The plumbing track ships the Express route that renders these as HTML;
 * this test pins the content contract so a stub merge cannot accidentally
 * land a half-empty guide or leak banned AI vocabulary into a SEO surface.
 */
import { readFileSync, readdirSync } from 'fs';
import { dirname, join, basename, extname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const guidesDir = join(__dirname, '../../content/guides');

// Per CLAUDE.md "Banned vocabulary for basic users", with the caveat
// that the guides are tradesperson-facing marketing surface — the
// FastQuote product can be mentioned but the underlying technology
// (model / LLM / prompt / Claude) must not be named.
//
// The whole-word matcher is case-insensitive but excludes "AI" inside
// other words (e.g. "available", "maintain") via \b boundaries. Each
// pattern is a banned token in the guide body / front-matter.
const BANNED = [
  /\bAI\b/,
  /\bartificial intelligence\b/i,
  /\bLLM\b/,
  /\bClaude\b/,
  /\bSonnet\b/,
  /\bHaiku\b/,
  /\bsystem prompt\b/i,
  /\bthe model\b/i,
  /\bthe AI\b/i,
  /\bself[- ]critique\b/i,
  /\bcalibration note\b/i,
  /\blearning dashboard\b/i,
  // Honesty guardrails from the task brief — no claims we can't back.
  /\b\d{2,3}\s*%\s*accurate\b/i,
  /\b\d{2,3}\s*%\s*accuracy\b/i,
  /\bvoice note(s)?\b/i,
  /\bvideo walkthrough(s)?\b/i,
  /\bvoice memo(s)?\b/i,
];

/**
 * Minimal YAML front-matter extractor. Markdown files start with `---`,
 * have key/value lines, then a closing `---`. We do not pull a YAML
 * library in just for this — the schema is fixed and known.
 */
function parseFrontMatter(src) {
  if (!src.startsWith('---\n')) return { frontMatter: null, body: src };
  const end = src.indexOf('\n---\n', 4);
  if (end === -1) return { frontMatter: null, body: src };
  const block = src.slice(4, end);
  const body = src.slice(end + 5);
  const fm = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([a-zA-Z][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    // Strip surrounding quotes on string values.
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  return { frontMatter: fm, body };
}

function countWords(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function isKebabCase(s) {
  return /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.test(s);
}

const files = readdirSync(guidesDir).filter(f => f.endsWith('.md'));

describe('content/guides/* — content contract', () => {
  test('hub exists with at least the pillar and 8 cluster articles', () => {
    expect(files.length).toBeGreaterThanOrEqual(9);
    expect(files).toContain('index.md');
  });

  describe.each(files)('%s', (file) => {
    const src = readFileSync(join(guidesDir, file), 'utf8');
    const { frontMatter, body } = parseFrontMatter(src);
    const fileSlug = basename(file, extname(file));

    test('has front-matter with title, description, slug', () => {
      expect(frontMatter).not.toBeNull();
      expect(frontMatter.title).toBeTruthy();
      expect(frontMatter.description).toBeTruthy();
      expect(frontMatter.slug).toBeTruthy();
    });

    test('slug is kebab-case and matches the filename', () => {
      expect(isKebabCase(frontMatter.slug)).toBe(true);
      expect(frontMatter.slug).toBe(fileSlug);
    });

    test('description is at most 160 characters', () => {
      expect(frontMatter.description.length).toBeLessThanOrEqual(160);
    });

    test('body is at least 200 words', () => {
      expect(countWords(body)).toBeGreaterThanOrEqual(200);
    });

    test('no banned vocabulary in body', () => {
      for (const pattern of BANNED) {
        const m = body.match(pattern);
        if (m) {
          throw new Error(`Banned vocabulary in ${file} body: "${m[0]}" (pattern ${pattern})`);
        }
      }
    });

    test('no banned vocabulary in front-matter', () => {
      const fmText = Object.values(frontMatter).join(' ');
      for (const pattern of BANNED) {
        const m = fmText.match(pattern);
        if (m) {
          throw new Error(`Banned vocabulary in ${file} front-matter: "${m[0]}" (pattern ${pattern})`);
        }
      }
    });
  });
});
