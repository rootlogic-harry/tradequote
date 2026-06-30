/**
 * Per-guide JSON-LD @graph + Person/Author + internal linking.
 *
 * The /guides/* pages need machine-readable structure so LLMs (ChatGPT,
 * Gemini, Perplexity, ClaudeBot, etc.) can answer "how do I quote for a
 * dry stone wall?" with FastQuote in the result set. The visible HTML
 * stays clean; the structured-data block is what crawlers parse.
 *
 * These tests drive the renderer in src/utils/guides.js directly — no
 * HTTP — so the contract is pinned at the rendering boundary regardless
 * of how the Express route wires it in.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  renderGuidesIndex,
  renderGuidePage,
  listGuides,
} from '../utils/guides.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const guidesDir = join(__dirname, '../../content/guides');

const ORG_ID = 'https://fastquote.uk/#organization';
const PERSON_ID = 'https://fastquote.uk/#harry';

/**
 * Pull every <script type="application/ld+json"> payload out of an HTML
 * string and return them parsed. There may be more than one block on a
 * page; the per-guide work emits exactly one @graph script tag, but the
 * extractor is generic so the tests stay honest if we ever add more.
 */
function extractJsonLd(html) {
  const out = [];
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    out.push(JSON.parse(m[1]));
  }
  return out;
}

function findNode(graph, type) {
  return graph.find((n) =>
    Array.isArray(n['@type']) ? n['@type'].includes(type) : n['@type'] === type,
  );
}

function findAllNodes(graph, type) {
  return graph.filter((n) =>
    Array.isArray(n['@type']) ? n['@type'].includes(type) : n['@type'] === type,
  );
}

describe('renderGuidePage — JSON-LD @graph', () => {
  test('emits a single application/ld+json block containing a @graph', () => {
    const html = renderGuidePage(guidesDir, 'cost-per-metre');
    expect(html).not.toBeNull();
    const blocks = extractJsonLd(html);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]['@context']).toBe('https://schema.org');
    expect(Array.isArray(blocks[0]['@graph'])).toBe(true);
  });

  test('JSON-LD parses as valid JSON for every guide on disk', () => {
    for (const g of listGuides(guidesDir)) {
      const html = renderGuidePage(guidesDir, g.slug);
      const blocks = extractJsonLd(html);
      expect(blocks).toHaveLength(1);
      expect(blocks[0]['@context']).toBe('https://schema.org');
      expect(Array.isArray(blocks[0]['@graph'])).toBe(true);
      expect(blocks[0]['@graph'].length).toBeGreaterThanOrEqual(4);
    }
  });

  test('cluster article uses BlogPosting and pillar uses Article', () => {
    const cluster = renderGuidePage(guidesDir, 'cost-per-metre');
    const clusterGraph = extractJsonLd(cluster)[0]['@graph'];
    expect(findNode(clusterGraph, 'BlogPosting')).toBeDefined();

    const pillar = renderGuidePage(guidesDir, 'index');
    const pillarGraph = extractJsonLd(pillar)[0]['@graph'];
    // The pillar gets an Article (not BlogPosting) since it is the hub.
    expect(findNode(pillarGraph, 'Article')).toBeDefined();
    expect(findNode(pillarGraph, 'BlogPosting')).toBeUndefined();
  });

  test('Article.author cross-references the Person @id', () => {
    const html = renderGuidePage(guidesDir, 'cost-per-metre');
    const graph = extractJsonLd(html)[0]['@graph'];
    const article = findNode(graph, 'BlogPosting');
    expect(article.author).toEqual({ '@id': PERSON_ID });
    const person = findNode(graph, 'Person');
    expect(person['@id']).toBe(PERSON_ID);
    expect(person.name).toBe('Harry Doyle');
    expect(person.jobTitle).toMatch(/Founder/);
    expect(person.url).toBe('https://fastquote.uk');
    expect(Array.isArray(person.sameAs)).toBe(true);
    expect(person.worksFor).toEqual({ '@id': ORG_ID });
  });

  test('Article.publisher references the landing Organization @id (not redefined)', () => {
    const html = renderGuidePage(guidesDir, 'cost-per-metre');
    const graph = extractJsonLd(html)[0]['@graph'];
    const article = findNode(graph, 'BlogPosting');
    expect(article.publisher).toEqual({ '@id': ORG_ID });
    // Organization is a reference only — no name/url duplicated here.
    const org = findNode(graph, 'Organization');
    expect(org['@id']).toBe(ORG_ID);
    expect(org.name).toBeUndefined();
    expect(org.url).toBeUndefined();
  });

  test('Article carries headline, description, keywords, datePublished, image, mainEntityOfPage', () => {
    const html = renderGuidePage(guidesDir, 'cost-per-metre');
    const graph = extractJsonLd(html)[0]['@graph'];
    const article = findNode(graph, 'BlogPosting');
    expect(article.headline).toMatch(/per metre/i);
    expect(typeof article.description).toBe('string');
    expect(article.description.length).toBeGreaterThan(20);
    expect(typeof article.keywords).toBe('string');
    expect(article.keywords.split(',').length).toBeGreaterThanOrEqual(3);
    expect(article.datePublished).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(article.dateModified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(article.image).toBe('https://fastquote.uk/og.png');
    expect(article.mainEntityOfPage).toBe(
      'https://fastquote.uk/guides/cost-per-metre',
    );
    expect(typeof article.articleSection).toBe('string');
    expect(article.articleSection.length).toBeGreaterThan(0);
  });

  test('BreadcrumbList has three levels: FastQuote → Guides → This guide', () => {
    const html = renderGuidePage(guidesDir, 'cost-per-metre');
    const graph = extractJsonLd(html)[0]['@graph'];
    const crumbs = findNode(graph, 'BreadcrumbList');
    expect(crumbs).toBeDefined();
    expect(Array.isArray(crumbs.itemListElement)).toBe(true);
    expect(crumbs.itemListElement).toHaveLength(3);
    expect(crumbs.itemListElement[0].position).toBe(1);
    expect(crumbs.itemListElement[0].name).toMatch(/FastQuote/i);
    expect(crumbs.itemListElement[1].position).toBe(2);
    expect(crumbs.itemListElement[1].name).toMatch(/Guides/i);
    expect(crumbs.itemListElement[2].position).toBe(3);
    expect(crumbs.itemListElement[2].item).toBe(
      'https://fastquote.uk/guides/cost-per-metre',
    );
  });

  test('FAQPage is emitted only when the body has question-shaped H2s', () => {
    // whats-in-a-quote.md has no question-shaped H2s — so no FAQPage.
    // None of its H2s end in "?" — the spec is explicit: don't fabricate.
    const noFaqHtml = renderGuidePage(guidesDir, 'whats-in-a-quote');
    const noFaqGraph = extractJsonLd(noFaqHtml)[0]['@graph'];
    expect(findNode(noFaqGraph, 'FAQPage')).toBeUndefined();

    // index.md (pillar) opens with a question-shaped H2 ("How long should
    // a quote take?") so it should carry a FAQPage node.
    const faqHtml = renderGuidePage(guidesDir, 'index');
    const faqGraph = extractJsonLd(faqHtml)[0]['@graph'];
    const faq = findNode(faqGraph, 'FAQPage');
    expect(faq).toBeDefined();
    expect(Array.isArray(faq.mainEntity)).toBe(true);
    expect(faq.mainEntity.length).toBeGreaterThanOrEqual(1);
    for (const q of faq.mainEntity) {
      expect(q['@type']).toBe('Question');
      expect(typeof q.name).toBe('string');
      expect(q.name.endsWith('?')).toBe(true);
      expect(q.acceptedAnswer['@type']).toBe('Answer');
      expect(typeof q.acceptedAnswer.text).toBe('string');
      expect(q.acceptedAnswer.text.length).toBeGreaterThan(20);
    }
  });

  test('no banned vocabulary appears in any JSON-LD string', () => {
    // The structured-data surface is exactly the surface LLMs read first.
    // It must respect the same vocabulary rules as the visible copy.
    const banned = [
      /\bAI\b/,
      /\bartificial intelligence\b/i,
      /\bLLM\b/,
      /\bClaude\b/,
      /\bSonnet\b/,
      /\bHaiku\b/,
      /\bthe model\b/i,
      /\bself[- ]critique\b/i,
      /\baggregateRating\b/, // unsubstantiated review claim
      /\breviewCount\b/, // unsubstantiated review count claim
    ];
    for (const g of listGuides(guidesDir)) {
      const html = renderGuidePage(guidesDir, g.slug);
      const graph = extractJsonLd(html)[0];
      const text = JSON.stringify(graph);
      for (const re of banned) {
        if (re.test(text)) {
          throw new Error(
            `Banned vocabulary "${re}" found in JSON-LD for ${g.slug}`,
          );
        }
      }
    }
  });

  test('Person description stays honest — no expert/master/veteran claims', () => {
    const html = renderGuidePage(guidesDir, 'cost-per-metre');
    const graph = extractJsonLd(html)[0]['@graph'];
    const person = findNode(graph, 'Person');
    const personText = JSON.stringify(person);
    expect(personText).not.toMatch(/\bmaster waller\b/i);
    expect(personText).not.toMatch(/\bexpert waller\b/i);
    expect(personText).not.toMatch(/\bveteran\b/i);
    expect(personText).not.toMatch(/\bmaster craftsman\b/i);
    expect(personText).not.toMatch(/\b\d+\s+years[' ]?(?: of)?\s+experience\b/i);
  });
});

describe('renderGuidesIndex — JSON-LD @graph', () => {
  test('uses CollectionPage with hasPart array of guide Article @ids', () => {
    const html = renderGuidesIndex(guidesDir);
    const blocks = extractJsonLd(html);
    expect(blocks).toHaveLength(1);
    const graph = blocks[0]['@graph'];
    const collection = findNode(graph, 'CollectionPage');
    expect(collection).toBeDefined();
    expect(Array.isArray(collection.hasPart)).toBe(true);
    // Should reference every guide on disk.
    const guides = listGuides(guidesDir);
    expect(collection.hasPart.length).toBe(guides.length);
    for (const ref of collection.hasPart) {
      expect(typeof ref['@id']).toBe('string');
      expect(ref['@id']).toMatch(/^https:\/\/fastquote\.uk\/guides\//);
    }
  });

  test('BreadcrumbList stops at Guides (2 levels)', () => {
    const html = renderGuidesIndex(guidesDir);
    const graph = extractJsonLd(html)[0]['@graph'];
    const crumbs = findNode(graph, 'BreadcrumbList');
    expect(crumbs).toBeDefined();
    expect(crumbs.itemListElement).toHaveLength(2);
    expect(crumbs.itemListElement[1].item).toBe('https://fastquote.uk/guides/');
  });

  // Bug-hunt 2026-06-30 #3 — index.md is the pillar; it renders at
  // /guides/ itself, so listGuides must not surface it as a child.
  test('listGuides excludes the pillar (index)', () => {
    const guides = listGuides(guidesDir);
    expect(guides.length).toBeGreaterThan(0);
    for (const g of guides) {
      expect(g.slug).not.toBe('index');
    }
  });

  test('/guides/index.md exists on disk (pillar source)', () => {
    // Sanity check — the skip in listGuides is only meaningful while
    // the pillar source itself remains in place.
    expect(existsSync(join(guidesDir, 'index.md'))).toBe(true);
  });

  // Belt-and-braces server check: the route /guides/:slug must 301
  // /guides/index → /guides/ so a stray link can't dilute SEO.
  test('server.js /guides/:slug handler 301s on slug "index"', () => {
    const serverPath = join(__dirname, '..', '..', 'server.js');
    const serverSrc = readFileSync(serverPath, 'utf8');
    const start = serverSrc.indexOf("app.get('/guides/:slug'");
    expect(start).toBeGreaterThan(-1);
    const block = serverSrc.slice(start, start + 700);
    expect(block).toMatch(/req\.params\.slug\s*===\s*['"]index['"]/);
    expect(block).toMatch(/res\.redirect\(\s*301\s*,\s*['"]\/guides\/['"]\s*\)/);
  });

  test('index page Organization is a reference, not a redefinition', () => {
    const html = renderGuidesIndex(guidesDir);
    const graph = extractJsonLd(html)[0]['@graph'];
    const org = findNode(graph, 'Organization');
    expect(org['@id']).toBe(ORG_ID);
    expect(org.name).toBeUndefined();
  });
});

describe('renderGuidePage — visible internal linking', () => {
  test('renders a "Related guides" nav for an individual article', () => {
    const html = renderGuidePage(guidesDir, 'cost-per-metre');
    expect(html).toMatch(/<nav[^>]+aria-label="Related guides"/);
    // Three related links by default.
    const block = html.match(
      /<nav[^>]+aria-label="Related guides"[\s\S]*?<\/nav>/,
    )[0];
    const links = block.match(/<a href="\/guides\//g) || [];
    expect(links.length).toBe(3);
  });

  test('related guides are derived from the front-matter "related" list when present', () => {
    const html = renderGuidePage(guidesDir, 'cost-per-metre');
    const block = html.match(
      /<nav[^>]+aria-label="Related guides"[\s\S]*?<\/nav>/,
    )[0];
    // cost-per-metre.md should declare related guides that include these.
    expect(block).toMatch(/\/guides\/how-long-to-rebuild/);
    expect(block).toMatch(/\/guides\/yorkshire-walling-costs/);
  });

  test('related guides never point at the current page', () => {
    for (const g of listGuides(guidesDir)) {
      if (g.slug === 'index') continue; // index has no related block
      const html = renderGuidePage(guidesDir, g.slug);
      const block = html.match(
        /<nav[^>]+aria-label="Related guides"[\s\S]*?<\/nav>/,
      );
      if (!block) continue;
      expect(block[0]).not.toMatch(
        new RegExp(`href="/guides/${g.slug}"`),
      );
    }
  });

  test('index page does not render a related-guides block', () => {
    const html = renderGuidesIndex(guidesDir);
    expect(html).not.toMatch(/aria-label="Related guides"/);
  });
});

describe('renderGuidePage — author bio block', () => {
  test('renders an honest, factual author bio with Person microdata', () => {
    const html = renderGuidePage(guidesDir, 'cost-per-metre');
    // The bio block carries itemtype="https://schema.org/Person" so the
    // microdata maps to the same Person node as the JSON-LD.
    expect(html).toMatch(
      /itemscope[^>]*itemtype="https:\/\/schema\.org\/Person"/,
    );
    expect(html).toMatch(/Harry Doyle/);
    expect(html).toMatch(/Founder of FastQuote/i);
    // No banned claim words.
    const bioMatch = html.match(
      /<aside[^>]*itemtype="https:\/\/schema\.org\/Person"[\s\S]*?<\/aside>/,
    );
    expect(bioMatch).not.toBeNull();
    const bio = bioMatch[0];
    expect(bio).not.toMatch(/\bexpert\b/i);
    expect(bio).not.toMatch(/\bmaster\b/i);
    expect(bio).not.toMatch(/\bveteran\b/i);
    expect(bio).not.toMatch(/\b\d+\s+years[' ]?(?: of)?\s+experience\b/i);
  });

  test('index page does not render an author bio block', () => {
    const html = renderGuidesIndex(guidesDir);
    expect(html).not.toMatch(/itemtype="https:\/\/schema\.org\/Person"/);
  });
});
