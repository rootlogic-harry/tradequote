/**
 * Discoverability — Wave 1 (technical plumbing).
 *
 * Asserts the four "free signals" we ship for Google + AI crawlers:
 *   - public/robots.txt: allows AI crawlers, references sitemap
 *   - public/sitemap.xml: valid XML with the right URLs
 *   - public/llms.txt: structured markdown per llmstxt.org
 *   - server.js JSON-LD: @graph with Organization + SoftwareApplication
 *     + Offer + HowTo + FAQPage
 *   - server.js LANDING_PAGE_HTML: visible FAQ section with >= 6 questions
 *   - server.js GET /guides/ route mounted (returns 200 even with no files)
 *
 * These tests are deliberately structural, not pixel-perfect. The content
 * agent ships markdown files in a separate PR; the route must render
 * gracefully when content/guides is empty.
 */
import { readFileSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

function landingHtml() {
  const m = serverSrc.match(/const LANDING_PAGE_HTML = `([\s\S]*?)`;/);
  if (!m) throw new Error('LANDING_PAGE_HTML not found in server.js');
  return m[1];
}

describe('public/robots.txt', () => {
  const path = join(repoRoot, 'public/robots.txt');
  const txt = existsSync(path) ? readFileSync(path, 'utf8') : '';

  test('exists at public/robots.txt', () => {
    expect(existsSync(path)).toBe(true);
    expect(txt.length).toBeGreaterThan(50);
  });

  test('explicitly allows the major AI crawlers', () => {
    // Consensus list from the ai-robots-txt GitHub project.
    const aiAgents = [
      'GPTBot',
      'ChatGPT-User',
      'OAI-SearchBot',
      'ClaudeBot',
      'Claude-Web',
      'Claude-User',
      'anthropic-ai',
      'Google-Extended',
      'PerplexityBot',
      'Applebot-Extended',
      'cohere-ai',
      'CCBot',
      'Bytespider',
      'Meta-ExternalAgent',
    ];
    for (const agent of aiAgents) {
      const re = new RegExp(`User-agent:\\s*${agent}\\b`, 'i');
      expect(txt).toMatch(re);
    }
  });

  test('allows standard search crawlers', () => {
    expect(txt).toMatch(/User-agent:\s*Googlebot\b/i);
    expect(txt).toMatch(/User-agent:\s*Bingbot\b/i);
  });

  test('disallows authenticated / non-public surfaces', () => {
    expect(txt).toMatch(/Disallow:\s*\/api\//);
    expect(txt).toMatch(/Disallow:\s*\/auth\//);
    expect(txt).toMatch(/Disallow:\s*\/q\//);
    expect(txt).toMatch(/Disallow:\s*\/admin\//);
    expect(txt).toMatch(/Disallow:\s*\/dashboard\b/);
  });

  test('references the sitemap at the canonical URL', () => {
    expect(txt).toMatch(/Sitemap:\s*https:\/\/fastquote\.uk\/sitemap\.xml/);
  });

  test('allows /guides/ for the future content hub', () => {
    expect(txt).toMatch(/Allow:\s*\/guides\//);
  });
});

describe('public/sitemap.xml', () => {
  const path = join(repoRoot, 'public/sitemap.xml');
  const xml = existsSync(path) ? readFileSync(path, 'utf8') : '';

  test('exists at public/sitemap.xml', () => {
    expect(existsSync(path)).toBe(true);
  });

  test('begins with a valid XML declaration and urlset root', () => {
    expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
    expect(xml).toMatch(
      /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/
    );
    expect(xml).toMatch(/<\/urlset>\s*$/);
  });

  test('contains the four canonical marketing URLs + the guides index', () => {
    const urls = [
      'https://fastquote.uk/',
      'https://fastquote.uk/guides/',
      'https://fastquote.uk/privacy',
      'https://fastquote.uk/terms',
      'https://fastquote.uk/dpa',
    ];
    for (const url of urls) {
      // Escape regex special chars for the URL match.
      const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(xml).toMatch(new RegExp(`<loc>${esc}</loc>`));
    }
  });

  test('contains all 8 guide URLs (wave 2 content)', () => {
    // Mirrors the 8 markdown files in content/guides/ (minus index.md
    // which is the /guides/ hub already asserted above). Adding a new
    // guide means: write the .md AND add the URL here.
    const guides = [
      'cost-per-metre',
      'how-long-to-rebuild',
      'stone-tonnage',
      'whats-in-a-quote',
      'dswa-day-rate',
      'yorkshire-walling-costs',
      'cotswold-walling-costs',
      'chapter-8-traffic-management',
    ];
    for (const slug of guides) {
      expect(xml).toMatch(
        new RegExp(`<loc>https:\\/\\/fastquote\\.uk\\/guides\\/${slug}<\\/loc>`)
      );
    }
  });

  test('every <url> has a <lastmod>', () => {
    const urlBlocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
    expect(urlBlocks.length).toBeGreaterThanOrEqual(5);
    for (const block of urlBlocks) {
      expect(block).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    }
  });
});

describe('public/llms.txt', () => {
  const path = join(repoRoot, 'public/llms.txt');
  const md = existsSync(path) ? readFileSync(path, 'utf8') : '';

  test('exists at public/llms.txt', () => {
    expect(existsSync(path)).toBe(true);
  });

  test('starts with the H1 title per llmstxt.org', () => {
    expect(md).toMatch(/^# FastQuote\b/);
  });

  test('has a blockquote summary directly below the title', () => {
    expect(md).toMatch(/^# FastQuote[\s\S]*?\n>\s+\S/);
  });

  test('declares the required H2 sections', () => {
    expect(md).toMatch(/^## What FastQuote does/m);
    expect(md).toMatch(/^## Who it's for/m);
    expect(md).toMatch(/^## Pricing/m);
    expect(md).toMatch(/^## Key features/m);
    expect(md).toMatch(/^## Contact/m);
  });

  test('mentions the three pricing tiers with the locked figures', () => {
    expect(md).toMatch(/free.*3 quotes/i);
    expect(md).toMatch(/9\.99/);
    expect(md).toMatch(/19\.99/);
  });

  test('cites the ICO registration number for trust grounding', () => {
    expect(md).toMatch(/ZC178109/);
  });

  test('links to the guides hub', () => {
    expect(md).toMatch(/https:\/\/fastquote\.uk\/guides\//);
  });
});

describe('LANDING_PAGE_HTML — expanded JSON-LD @graph', () => {
  const html = landingHtml();

  // Pull the JSON-LD payload out, parse it, and assert against the
  // resulting object. The @graph structure is the load-bearing shape
  // LLMs and rich-results parsers consume.
  const ldMatch = html.match(
    /<script type="application\/ld\+json"[^>]*>\s*([\s\S]*?)\s*<\/script>/
  );

  test('the JSON-LD block parses as valid JSON', () => {
    expect(ldMatch).not.toBeNull();
    expect(() => JSON.parse(ldMatch[1])).not.toThrow();
  });

  test('uses the @graph pattern with @context', () => {
    const ld = JSON.parse(ldMatch[1]);
    expect(ld['@context']).toBe('https://schema.org');
    expect(Array.isArray(ld['@graph'])).toBe(true);
    expect(ld['@graph'].length).toBeGreaterThanOrEqual(5);
  });

  function findType(graph, type) {
    return graph.find((node) =>
      Array.isArray(node['@type'])
        ? node['@type'].includes(type)
        : node['@type'] === type
    );
  }

  test('contains an Organization node with FastQuote + ICO + email', () => {
    const ld = JSON.parse(ldMatch[1]);
    const org = findType(ld['@graph'], 'Organization');
    expect(org).toBeDefined();
    expect(org.name).toMatch(/FastQuote/);
    expect(org.url).toBe('https://fastquote.uk/');
    expect(org.email).toMatch(/fastquote@harrydoyle\.uk/);
    // ICO registration grounded as an identifier — LLMs latch onto these.
    const idStr = JSON.stringify(org);
    expect(idStr).toMatch(/ZC178109/);
  });

  test('contains a SoftwareApplication with the expected fields', () => {
    const ld = JSON.parse(ldMatch[1]);
    const app = findType(ld['@graph'], 'SoftwareApplication');
    expect(app).toBeDefined();
    expect(app.name).toMatch(/FastQuote/);
    expect(app.applicationCategory).toBe('BusinessApplication');
    expect(app.operatingSystem).toBeTruthy();
    // Description must respect the no-video honesty guardrail.
    expect(app.description).not.toMatch(/video/i);
    expect(app.description).not.toMatch(/film/i);
  });

  test('contains an Offer for the £19.99 subscription', () => {
    const ld = JSON.parse(ldMatch[1]);
    const ldStr = JSON.stringify(ld);
    expect(ldStr).toMatch(/"price":\s*"?19\.99"?/);
    expect(ldStr).toMatch(/"priceCurrency":\s*"GBP"/);
  });

  test('contains an Offer for the £9.99 quote pack', () => {
    const ld = JSON.parse(ldMatch[1]);
    const ldStr = JSON.stringify(ld);
    expect(ldStr).toMatch(/"price":\s*"?9\.99"?/);
  });

  test('contains a HowTo with three steps (Snap / Check / Send)', () => {
    const ld = JSON.parse(ldMatch[1]);
    const howto = findType(ld['@graph'], 'HowTo');
    expect(howto).toBeDefined();
    expect(Array.isArray(howto.step)).toBe(true);
    expect(howto.step.length).toBe(3);
    // Each step should be a HowToStep with a name.
    for (const step of howto.step) {
      expect(step['@type']).toBe('HowToStep');
      expect(typeof step.name).toBe('string');
      expect(step.name.length).toBeGreaterThan(2);
    }
  });

  test('contains a FAQPage with at least 6 question/answer pairs', () => {
    const ld = JSON.parse(ldMatch[1]);
    const faq = findType(ld['@graph'], 'FAQPage');
    expect(faq).toBeDefined();
    expect(Array.isArray(faq.mainEntity)).toBe(true);
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(6);
    for (const q of faq.mainEntity) {
      expect(q['@type']).toBe('Question');
      expect(typeof q.name).toBe('string');
      expect(q.acceptedAnswer['@type']).toBe('Answer');
      expect(typeof q.acceptedAnswer.text).toBe('string');
      expect(q.acceptedAnswer.text.length).toBeGreaterThan(20);
    }
  });

  test('@id cross-references resolve within the graph', () => {
    const ld = JSON.parse(ldMatch[1]);
    // Each node should have an @id so cross-graph reference is possible.
    for (const node of ld['@graph']) {
      expect(typeof node['@id']).toBe('string');
      expect(node['@id'].length).toBeGreaterThan(5);
    }
  });
});

describe('LANDING_PAGE_HTML — visible FAQ section', () => {
  const html = landingHtml();

  test('a <section class="faq"> is mounted on the landing', () => {
    expect(html).toMatch(/<section class="faq"[^>]*>/);
  });

  test('FAQ section carries an H2 heading', () => {
    const faqSection = html.match(/<section class="faq"[\s\S]*?<\/section>/);
    expect(faqSection).not.toBeNull();
    expect(faqSection[0]).toMatch(/<h2[^>]*>/);
  });

  test('renders at least 6 visible questions', () => {
    const faqSection = html.match(/<section class="faq"[\s\S]*?<\/section>/);
    expect(faqSection).not.toBeNull();
    const questions = faqSection[0].match(/<(?:summary|h3)[^>]*class="faq-q"[^>]*>/g) || [];
    expect(questions.length).toBeGreaterThanOrEqual(6);
  });

  test('FAQ honours the no-video honesty guardrail', () => {
    const faqSection = html.match(/<section class="faq"[\s\S]*?<\/section>/);
    expect(faqSection).not.toBeNull();
    expect(faqSection[0]).not.toMatch(/\bvideo\b/i);
    expect(faqSection[0]).not.toMatch(/\bfilm\b/i);
  });

  test('FAQ does not make accuracy percentage claims', () => {
    // No "95% accurate" or "99% accurate" style claims. The honesty
    // guardrail in the spec forbids these.
    const faqSection = html.match(/<section class="faq"[\s\S]*?<\/section>/);
    expect(faqSection).not.toBeNull();
    expect(faqSection[0]).not.toMatch(/\d{2,3}%\s*accura/i);
  });
});

describe('GET /guides/ route', () => {
  test('app.get for /guides is registered in server.js', () => {
    // Index route.
    expect(serverSrc).toMatch(
      /app\.get\(\s*['"]\/guides\/?['"]/
    );
    // Slug route.
    expect(serverSrc).toMatch(
      /app\.get\(\s*['"]\/guides\/:slug['"]/
    );
  });

  test('renders gracefully when content/guides/ has no markdown files', async () => {
    // Drive the helper directly with an empty (non-existent) directory.
    // The route should still produce HTML and surface a "Coming soon"
    // message instead of throwing.
    const { renderGuidesIndex } = await import('../utils/guides.js');
    const html = renderGuidesIndex(join(repoRoot, 'content', 'definitely-does-not-exist'));
    expect(typeof html).toBe('string');
    expect(html.length).toBeGreaterThan(100);
    expect(html).toMatch(/Coming soon/i);
    // The shell carries the canonical + OG image so an empty hub still
    // renders well in previews.
    expect(html).toMatch(/<link rel="canonical" href="https:\/\/fastquote\.uk\/guides\/"/);
    expect(html).toMatch(/og\.png/);
  });

  test('individual guide slug returns null when no markdown file matches', async () => {
    const { renderGuidePage } = await import('../utils/guides.js');
    const out = renderGuidePage(join(repoRoot, 'content', 'guides'), 'no-such-guide-exists');
    expect(out).toBeNull();
  });

  test('slug whitelist rejects path traversal attempts', async () => {
    const { renderGuidePage, isValidSlug } = await import('../utils/guides.js');
    expect(isValidSlug('../etc/passwd')).toBe(false);
    expect(isValidSlug('foo/bar')).toBe(false);
    expect(isValidSlug('foo bar')).toBe(false);
    expect(isValidSlug('foo.md')).toBe(false);
    expect(isValidSlug('valid-slug-1')).toBe(true);
    const out = renderGuidePage(join(repoRoot, 'content', 'guides'), '../../etc/passwd');
    expect(out).toBeNull();
  });
});

describe('marked dependency for guides rendering', () => {
  test('marked is listed as a direct dependency', () => {
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8')
    );
    expect(pkg.dependencies.marked).toBeTruthy();
  });
});
