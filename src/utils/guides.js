/**
 * Tiny guide hub helper.
 *
 * Loads markdown files from `content/guides/*.md`, renders them with
 * `marked`, and wraps each in a stripped-down landing-style HTML shell so
 * individual guide pages get the same OG meta + typography as the
 * marketing surface.
 *
 * Each rendered page also embeds a schema.org `@graph` of structured
 * data (Article / BlogPosting + Person + BreadcrumbList + Organization
 * reference + optional FAQPage) so LLM crawlers can answer "how do I
 * quote for a dry stone wall?" with FastQuote in the result set. The
 * landing's existing Organization `@id` is referenced rather than
 * redefined so the graph composes cleanly.
 *
 * Discoverability — Wave 1 (route) + per-guide structured data.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'fs';
import { join } from 'path';
import { marked } from 'marked';

// Configure marked: GitHub-flavoured. `headerIds` / `mangle` were removed
// in marked v8 — the defaults are sensible for our guide content.
marked.setOptions({
  gfm: true,
  breaks: false,
});

/**
 * The landing's Organization @id. Per-guide @graph nodes reference this
 * rather than redefining the organisation, so the structured-data
 * graph composes cleanly when a crawler stitches the pages together.
 */
const ORG_ID = 'https://fastquote.uk/#organization';
const PERSON_ID = 'https://fastquote.uk/#harry';
const SITE_BASE = 'https://fastquote.uk';
const OG_IMAGE = 'https://fastquote.uk/og.png';

/**
 * Whitelist a slug: lowercase alphanumeric + hyphen only. Defends
 * against path traversal (../foo) and weird filename chars.
 */
export function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9][a-z0-9-]{0,80}$/.test(slug);
}

/**
 * List every .md file in the guides directory. Returns `[]` when the
 * directory does not exist or is empty.
 */
export function listGuides(guidesDir) {
  if (!existsSync(guidesDir)) return [];
  let entries;
  try {
    entries = readdirSync(guidesDir);
  } catch (_) {
    return [];
  }
  const out = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const slug = name.slice(0, -3);
    if (!isValidSlug(slug)) continue;
    // Skip the pillar: it renders at `/guides/` itself, so listing it
    // here would put a card on the hub linking back to the hub.
    // Bug-hunt 2026-06-30 #3.
    if (slug === 'index') continue;
    const full = join(guidesDir, name);
    let stat;
    try {
      stat = statSync(full);
    } catch (_) {
      continue;
    }
    if (!stat.isFile()) continue;
    let raw;
    try {
      raw = readFileSync(full, 'utf8');
    } catch (_) {
      continue;
    }
    out.push({ slug, ...parseFrontmatter(raw) });
  }
  // Sort by title for stable ordering when there's no explicit order.
  out.sort((a, b) => a.title.localeCompare(b.title));
  return out;
}

/**
 * Read and parse a single guide by slug. Returns `null` when the file
 * does not exist or the slug fails validation.
 */
export function loadGuide(guidesDir, slug) {
  if (!isValidSlug(slug)) return null;
  const full = join(guidesDir, `${slug}.md`);
  if (!existsSync(full)) return null;
  let raw;
  try {
    raw = readFileSync(full, 'utf8');
  } catch (_) {
    return null;
  }
  return { slug, ...parseFrontmatter(raw) };
}

/**
 * Tiny frontmatter parser. Handles:
 *   - scalar `key: value` lines (with optional surrounding quotes)
 *   - inline array `keywords: ["a", "b"]`
 *
 * Recognised keys: title, description, slug, date, publishedAt,
 * modifiedAt, keywords, section, related.
 */
function parseFrontmatter(raw) {
  let title = '';
  let description = '';
  let date = '';
  let publishedAt = '';
  let modifiedAt = '';
  let section = '';
  let slug = '';
  let keywords = [];
  let related = [];
  let body = raw;
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (m) {
    body = m[2];
    for (const line of m[1].split('\n')) {
      // Match `key: rest-of-line`. The value is taken verbatim — quote
      // stripping happens later for scalars, and arrays parse separately.
      const kv = line.match(/^(\w+):\s*(.*?)\s*$/);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      const rawVal = kv[2];
      if (key === 'keywords' || key === 'related') {
        const arr = parseInlineArray(rawVal);
        if (key === 'keywords') keywords = arr;
        else related = arr;
        continue;
      }
      const val = rawVal.replace(/^["']|["']$/g, '');
      if (key === 'title') title = val;
      else if (key === 'description') description = val;
      else if (key === 'date') date = val;
      else if (key === 'publishedat') publishedAt = val;
      else if (key === 'modifiedat') modifiedAt = val;
      else if (key === 'section') section = val;
      else if (key === 'slug') slug = val;
    }
  }
  if (!title) {
    // Fall back to the first H1 in the body.
    const h1 = body.match(/^#\s+(.+?)\s*$/m);
    if (h1) title = h1[1];
  }
  return {
    title,
    description,
    date,
    publishedAt,
    modifiedAt,
    section,
    slugFromFm: slug,
    keywords,
    related,
    body,
  };
}

/**
 * Parse a YAML-ish inline array like `["a", "b", "c"]` or `[a, b]` into
 * a string array. Returns `[]` on anything unparseable so a typo in the
 * front-matter does not blow up rendering.
 */
function parseInlineArray(raw) {
  if (!raw) return [];
  const inner = raw.replace(/^\s*\[/, '').replace(/\]\s*$/, '');
  if (!inner.trim()) return [];
  return inner
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean);
}

/**
 * Render a guide's body markdown to HTML.
 */
export function renderGuideBodyHtml(body) {
  return marked.parse(body || '');
}

/**
 * HTML escape for use inside <title>, attributes, and visible text.
 */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strip markdown formatting from an inline string so it can be embedded
 * in JSON-LD as plain text. Conservative — only handles the inline marks
 * that show up in guide H2s and the first answer paragraph.
 */
function stripInlineMd(s) {
  if (!s) return '';
  return String(s)
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // links → label
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Pick a deterministic-but-shuffled set of `n` related guide slugs from
 * the full list, excluding the current slug. Deterministic seed is the
 * sum of char codes of the slug so each guide always gets the same
 * "related" set when no explicit `related` front-matter is set.
 */
function pickDeterministicRelated(allSlugs, currentSlug, n) {
  const pool = allSlugs.filter((s) => s !== currentSlug);
  if (pool.length <= n) return pool;
  let seed = 0;
  for (let i = 0; i < currentSlug.length; i++) {
    seed = (seed + currentSlug.charCodeAt(i)) | 0;
  }
  // Sort by (seedHash, slug) which is deterministic for the same seed.
  const ranked = pool
    .map((s, i) => {
      let h = seed;
      for (let j = 0; j < s.length; j++) h = (h * 31 + s.charCodeAt(j)) | 0;
      return { s, key: Math.abs(h) };
    })
    .sort((a, b) => a.key - b.key);
  return ranked.slice(0, n).map((r) => r.s);
}

/**
 * Extract `H2-shaped-as-question + next paragraph` pairs from a markdown
 * body. Used to feed the FAQPage node. Returns `[]` when no H2 ends with
 * a `?` — the spec is explicit that we should not fabricate Q&A.
 */
function extractFaqPairs(body) {
  if (!body) return [];
  const lines = body.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const h2 = lines[i].match(/^##\s+(.+?)\s*$/);
    if (!h2) continue;
    const q = stripInlineMd(h2[1]);
    if (!q.endsWith('?')) continue;
    // Find the first non-empty paragraph after this H2 that isn't another
    // heading or a list item — that's our answer paragraph.
    const buf = [];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (/^#{1,6}\s/.test(l)) break; // next heading ends the answer
      if (l.trim() === '') {
        if (buf.length > 0) break;
        continue;
      }
      if (/^[-*]\s/.test(l) || /^\d+\.\s/.test(l) || /^>/.test(l)) {
        if (buf.length > 0) break;
        continue;
      }
      buf.push(l.trim());
      // First paragraph only.
      if (
        j + 1 < lines.length &&
        (lines[j + 1].trim() === '' || /^#{1,6}\s/.test(lines[j + 1]))
      ) {
        break;
      }
    }
    const answer = stripInlineMd(buf.join(' '));
    if (answer.length > 20) out.push({ q, a: answer });
  }
  return out;
}

/**
 * Build the @graph for an individual guide page. `kind` is "pillar" for
 * the index.md (Article) or "cluster" for every other slug (BlogPosting).
 */
function buildArticleGraph({ guide, slug, kind, faqPairs }) {
  const canonical = `${SITE_BASE}/guides/${slug}`;
  const datePublished = guide.publishedAt || guide.date || '2026-06-30';
  const dateModified = guide.modifiedAt || datePublished;
  const articleType = kind === 'pillar' ? 'Article' : 'BlogPosting';

  const article = {
    '@type': articleType,
    '@id': `${canonical}#article`,
    headline: guide.title,
    description: guide.description,
    keywords: (guide.keywords || []).join(', '),
    datePublished,
    dateModified,
    author: { '@id': PERSON_ID },
    publisher: { '@id': ORG_ID },
    mainEntityOfPage: canonical,
    image: OG_IMAGE,
    articleSection: guide.section || 'Guides',
    inLanguage: 'en-GB',
  };

  const person = {
    '@type': 'Person',
    '@id': PERSON_ID,
    name: 'Harry Doyle',
    jobTitle: 'Founder, FastQuote',
    url: SITE_BASE,
    sameAs: [],
    worksFor: { '@id': ORG_ID },
  };

  const breadcrumbs = {
    '@type': 'BreadcrumbList',
    '@id': `${canonical}#breadcrumbs`,
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'FastQuote',
        item: `${SITE_BASE}/`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Guides',
        item: `${SITE_BASE}/guides/`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: guide.title,
        item: canonical,
      },
    ],
  };

  const orgRef = { '@type': 'Organization', '@id': ORG_ID };

  const graph = [article, person, breadcrumbs, orgRef];

  if (faqPairs && faqPairs.length > 0) {
    graph.push({
      '@type': 'FAQPage',
      '@id': `${canonical}#faq`,
      mainEntity: faqPairs.map((pair) => ({
        '@type': 'Question',
        name: pair.q,
        acceptedAnswer: {
          '@type': 'Answer',
          text: pair.a,
        },
      })),
    });
  }

  return graph;
}

/**
 * Build the @graph for the /guides/ index page. CollectionPage with a
 * hasPart array of every guide's Article @id, plus a 2-level breadcrumb.
 */
function buildIndexGraph(guides) {
  const canonical = `${SITE_BASE}/guides/`;
  const collection = {
    '@type': 'CollectionPage',
    '@id': `${canonical}#collection`,
    url: canonical,
    name: 'Stone walling guides',
    description:
      'Practical guides for UK wallers — dry stone and mortared — pricing per metre, day rates, measurement, RAMS, regional rate notes and quoting conventions.',
    inLanguage: 'en-GB',
    isPartOf: { '@id': `${SITE_BASE}/#website` },
    hasPart: guides.map((g) => ({
      '@id': `${SITE_BASE}/guides/${g.slug}#article`,
    })),
  };

  const breadcrumbs = {
    '@type': 'BreadcrumbList',
    '@id': `${canonical}#breadcrumbs`,
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'FastQuote',
        item: `${SITE_BASE}/`,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Guides',
        item: canonical,
      },
    ],
  };

  const orgRef = { '@type': 'Organization', '@id': ORG_ID };

  return [collection, breadcrumbs, orgRef];
}

/**
 * Serialize a @graph to a JSON-LD script tag.
 */
function jsonLdBlock(graph) {
  const payload = {
    '@context': 'https://schema.org',
    '@graph': graph,
  };
  // Escape `</` to prevent early script-tag closure in HTML embedding.
  const json = JSON.stringify(payload, null, 2).replace(/<\//g, '<\\/');
  return `<script type="application/ld+json">\n${json}\n</script>`;
}

/**
 * Shared CSS for the guides surface. Stripped-down version of the
 * landing palette so guide pages feel like the same site without
 * pulling in the full landing.css (which is layout-heavy).
 */
const GUIDES_CSS = `
  :root {
    --bg: #f4eee2; --bg-card: #fffdf8; --rule: #ddd1ba; --rule-2: #c9ba9c;
    --ink: #211a10; --ink-2: #4a3d29; --ink-3: #7c6c50;
    --brand: #bd5e09; --brand-dk: #8f4604;
    --display: "Barlow Condensed", system-ui, sans-serif;
    --body: "Inter", system-ui, sans-serif;
    --mono: "JetBrains Mono", ui-monospace, monospace;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; background: var(--bg); color: var(--ink);
    font-family: var(--body); font-size: 16px; line-height: 1.65;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--brand); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .g-nav {
    background: var(--bg);
    border-bottom: 1px solid var(--rule);
    padding: 18px 28px;
  }
  .g-nav-inner {
    max-width: 880px; margin: 0 auto;
    display: flex; align-items: center; justify-content: space-between;
  }
  .g-brand {
    font-family: var(--display); font-weight: 800; font-size: 22px;
    letter-spacing: 0.05em; color: var(--ink); text-transform: uppercase;
  }
  .g-brand:hover { text-decoration: none; color: var(--brand); }
  .g-back {
    font-family: var(--body); font-size: 14px; color: var(--ink-3);
  }
  .g-wrap {
    max-width: 760px; margin: 0 auto; padding: 48px 28px 96px;
  }
  .g-eyebrow {
    font-family: var(--mono); font-size: 12px; text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--brand); margin-bottom: 14px;
  }
  h1 {
    font-family: var(--display); font-weight: 800;
    font-size: clamp(32px, 5vw, 48px); line-height: 1.1; margin: 0 0 18px;
    color: var(--ink); letter-spacing: -0.01em; text-transform: uppercase;
  }
  h2 {
    font-family: var(--display); font-weight: 700;
    font-size: 26px; margin: 40px 0 14px; color: var(--ink);
    line-height: 1.15; text-transform: uppercase; letter-spacing: -0.005em;
  }
  h3 {
    font-family: var(--display); font-weight: 600;
    font-size: 20px; margin: 32px 0 10px; color: var(--ink);
  }
  p, li { font-size: 16px; line-height: 1.7; color: var(--ink-2); margin: 0 0 14px; }
  ul, ol { padding-left: 22px; margin: 0 0 16px; }
  blockquote {
    border-left: 3px solid var(--brand); padding: 4px 18px;
    margin: 18px 0; color: var(--ink-3); background: var(--bg-card);
  }
  code {
    font-family: var(--mono); font-size: 14px;
    background: var(--bg-card); padding: 2px 6px; border-radius: 3px;
    border: 1px solid var(--rule);
  }
  pre {
    background: var(--bg-card); border: 1px solid var(--rule);
    padding: 16px 18px; border-radius: 4px; overflow-x: auto;
  }
  pre code { border: 0; padding: 0; background: transparent; }
  table { border-collapse: collapse; margin: 16px 0; width: 100%; }
  th, td {
    border: 1px solid var(--rule); padding: 8px 12px; text-align: left;
    font-size: 15px;
  }
  th { background: var(--bg-card); font-weight: 600; }
  hr { border: 0; border-top: 1px solid var(--rule); margin: 36px 0; }
  .g-foot {
    margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--rule);
    font-size: 14px; color: var(--ink-3);
  }
  .g-foot a { color: var(--brand); }
  .g-index-list { list-style: none; padding: 0; }
  .g-index-list li {
    background: var(--bg-card); border: 1px solid var(--rule);
    border-radius: 4px; padding: 18px 22px; margin-bottom: 12px;
    transition: border-color 0.2s, transform 0.2s;
  }
  .g-index-list li:hover { border-color: var(--rule-2); transform: translateY(-1px); }
  .g-index-list h2 {
    font-size: 22px; margin: 0 0 6px; text-transform: uppercase;
  }
  .g-index-list h2 a { color: var(--ink); }
  .g-index-list p { margin: 0; font-size: 15px; color: var(--ink-3); }
  .g-empty {
    text-align: center; padding: 64px 24px;
    background: var(--bg-card); border: 1px solid var(--rule);
    border-radius: 4px; color: var(--ink-3);
  }
  .g-empty h2 {
    font-family: var(--display); color: var(--ink);
    text-transform: uppercase; margin: 0 0 12px;
  }
  .g-author {
    margin-top: 40px; padding: 18px 22px;
    background: var(--bg-card); border: 1px solid var(--rule);
    border-radius: 4px; color: var(--ink-2); font-size: 15px;
  }
  .g-author-name {
    font-weight: 600; color: var(--ink);
  }
  .g-related {
    margin-top: 36px; padding-top: 24px; border-top: 1px solid var(--rule);
  }
  .g-related h2 {
    font-family: var(--display); font-size: 20px;
    text-transform: uppercase; margin: 0 0 12px;
  }
  .g-related ul { list-style: none; padding: 0; margin: 0; }
  .g-related li { margin: 0 0 8px; font-size: 15px; }
`;

/**
 * Build the HTML shell shared by both the index and individual guide
 * pages. Includes the same OG meta pattern as the landing so individual
 * guides get the OG image, plus a per-page JSON-LD @graph block.
 */
function shell({
  title,
  description,
  canonical,
  bodyHtml,
  isIndex = false,
  jsonLdGraph = null,
}) {
  const safeTitle = esc(title);
  const safeDesc = esc(description);
  const safeCanonical = esc(canonical);
  const ldBlock = jsonLdGraph ? jsonLdBlock(jsonLdGraph) : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDesc}" />
  <meta name="theme-color" content="#f4eee2" />
  <meta name="robots" content="index, follow" />
  <link rel="canonical" href="${safeCanonical}" />
  <meta property="og:title" content="${safeTitle}" />
  <meta property="og:description" content="${safeDesc}" />
  <meta property="og:image" content="https://fastquote.uk/og.png" />
  <meta property="og:image:width" content="2400" />
  <meta property="og:image:height" content="1260" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:type" content="${isIndex ? 'website' : 'article'}" />
  <meta property="og:url" content="${safeCanonical}" />
  <meta property="og:site_name" content="FastQuote" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${safeTitle}" />
  <meta name="twitter:description" content="${safeDesc}" />
  <meta name="twitter:image" content="https://fastquote.uk/og.png" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${GUIDES_CSS}</style>
  ${ldBlock}
</head>
<body>
  <header class="g-nav">
    <div class="g-nav-inner">
      <a href="/" class="g-brand">FASTQUOTE</a>
      <a href="/guides/" class="g-back">${isIndex ? '&larr; Back to FastQuote' : '&larr; All guides'}</a>
    </div>
  </header>
  <main class="g-wrap">
${bodyHtml}
    <div class="g-foot">
      <p>FastQuote &mdash; Quoting tools for dry stone &amp; mortared walls. <a href="/">Start a free quote</a>.</p>
    </div>
  </main>
</body>
</html>`;
}

/**
 * Render the /guides/ index page. Lists every guide in the directory
 * or shows a "Coming soon" panel when the directory is empty.
 */
export function renderGuidesIndex(guidesDir) {
  const guides = listGuides(guidesDir);
  const title = 'Guides — FastQuote';
  const description =
    'Practical guides for UK wallers — dry stone and mortared. Pricing, measurement methodology, regional rate notes and quoting conventions.';
  const canonical = 'https://fastquote.uk/guides/';

  let listHtml;
  if (guides.length === 0) {
    listHtml = `
    <div class="g-empty">
      <h2>Coming soon</h2>
      <p>Practical guides for UK wallers &mdash; dry stone and mortared &mdash; pricing per metre, measurement methodology, regional rate notes &mdash; are on their way.</p>
      <p><a href="/">Try FastQuote in the meantime</a>.</p>
    </div>`;
  } else {
    const items = guides
      .map((g) => {
        return `      <li>
        <h2><a href="/guides/${esc(g.slug)}">${esc(g.title || g.slug)}</a></h2>
        ${g.description ? `<p>${esc(g.description)}</p>` : ''}
      </li>`;
      })
      .join('\n');
    listHtml = `    <ul class="g-index-list">\n${items}\n    </ul>`;
  }

  const bodyHtml = `    <p class="g-eyebrow">Guides</p>
    <h1>Stone walling guides</h1>
    <p>Practical, no-jargon guides for UK wallers &mdash; dry stone and mortared &mdash; pricing, measurement methodology, regional rate notes and quoting conventions.</p>
${listHtml}`;

  const jsonLdGraph = guides.length > 0 ? buildIndexGraph(guides) : null;

  return shell({
    title,
    description,
    canonical,
    bodyHtml,
    isIndex: true,
    jsonLdGraph,
  });
}

/**
 * Build the visible "Related guides" footer for an individual article.
 * Returns an empty string when there are fewer than 2 other guides.
 */
function renderRelatedNav({ guide, slug, allGuides }) {
  const allSlugs = allGuides.map((g) => g.slug);
  const otherSlugs = allSlugs.filter((s) => s !== slug);
  if (otherSlugs.length < 2) return '';

  // Prefer front-matter `related`; fall back to deterministic pick.
  const fmRelated = (guide.related || []).filter(
    (s) => isValidSlug(s) && otherSlugs.includes(s),
  );
  let chosen;
  if (fmRelated.length >= 3) {
    chosen = fmRelated.slice(0, 3);
  } else if (fmRelated.length > 0) {
    // Top up from deterministic pool excluding already-chosen.
    const fill = pickDeterministicRelated(
      otherSlugs.filter((s) => !fmRelated.includes(s)),
      slug,
      3 - fmRelated.length,
    );
    chosen = [...fmRelated, ...fill];
  } else {
    chosen = pickDeterministicRelated(otherSlugs, slug, 3);
  }

  const items = chosen
    .map((s) => {
      const g = allGuides.find((x) => x.slug === s);
      if (!g) return '';
      const t = g.title || s;
      return `        <li><a href="/guides/${esc(s)}">${esc(t)}</a></li>`;
    })
    .filter(Boolean)
    .join('\n');

  return `    <nav class="g-related" aria-label="Related guides">
      <h2>Read next</h2>
      <ul>
${items}
      </ul>
    </nav>`;
}

/**
 * Render the small author bio block. Marked up with itemtype="…/Person"
 * so the microdata maps to the same Person node as the JSON-LD @graph.
 * Honesty guardrail: "Founder of FastQuote" only — no expert/master
 * claims. The methodology comes from working with Yorkshire wallers.
 */
function renderAuthorBio() {
  return `    <aside class="g-author" itemscope itemtype="https://schema.org/Person">
      <p>
        Written by
        <a href="${SITE_BASE}" itemprop="url"><span class="g-author-name" itemprop="name">Harry Doyle</span></a>,
        <span itemprop="jobTitle">Founder of FastQuote</span>.
        We work with wallers across Yorkshire and the Cotswolds — dry stone and mortared — to help them quote faster.
      </p>
    </aside>`;
}

/**
 * Render a single guide page. Returns null when the slug doesn't
 * resolve so the caller can 404.
 */
export function renderGuidePage(guidesDir, slug) {
  const guide = loadGuide(guidesDir, slug);
  if (!guide) return null;
  const title = `${guide.title || slug} — FastQuote`;
  const description = guide.description || `FastQuote guide: ${guide.title || slug}.`;
  const canonical = `https://fastquote.uk/guides/${slug}`;

  const isPillar = slug === 'index';
  const faqPairs = extractFaqPairs(guide.body);
  const jsonLdGraph = buildArticleGraph({
    guide,
    slug,
    kind: isPillar ? 'pillar' : 'cluster',
    faqPairs,
  });

  const allGuides = listGuides(guidesDir);
  const relatedHtml = isPillar
    ? ''
    : renderRelatedNav({ guide, slug, allGuides });
  const authorHtml = renderAuthorBio();

  const bodyHtml = `    <p class="g-eyebrow">Guide</p>
${renderGuideBodyHtml(guide.body)}
${authorHtml}
${relatedHtml}`;
  return shell({ title, description, canonical, bodyHtml, jsonLdGraph });
}
