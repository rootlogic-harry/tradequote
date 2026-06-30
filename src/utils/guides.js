/**
 * Tiny guide hub helper.
 *
 * Loads markdown files from `content/guides/*.md`, renders them with
 * `marked`, and wraps each in a stripped-down landing-style HTML shell so
 * individual guide pages get the same OG meta + typography as the
 * marketing surface.
 *
 * The content agent ships the actual markdown in a separate PR. This
 * module gracefully handles an empty content directory ("Coming soon").
 *
 * Discoverability — Wave 1.
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
 * Tiny frontmatter parser. Recognises a leading YAML-ish block of
 * `key: value` lines between `---` fences. No nesting, no arrays —
 * exactly what a guide needs (title, description, date).
 */
function parseFrontmatter(raw) {
  let title = '';
  let description = '';
  let date = '';
  let body = raw;
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (m) {
    body = m[2];
    for (const line of m[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.+?)\s*$/);
      if (!kv) continue;
      const key = kv[1].toLowerCase();
      const val = kv[2].replace(/^["']|["']$/g, '');
      if (key === 'title') title = val;
      else if (key === 'description') description = val;
      else if (key === 'date') date = val;
    }
  }
  if (!title) {
    // Fall back to the first H1 in the body.
    const h1 = body.match(/^#\s+(.+?)\s*$/m);
    if (h1) title = h1[1];
  }
  return { title, description, date, body };
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
`;

/**
 * Build the HTML shell shared by both the index and individual guide
 * pages. Includes the same OG meta pattern as the landing so individual
 * guides get the OG image.
 */
function shell({ title, description, canonical, bodyHtml, isIndex = false }) {
  const safeTitle = esc(title);
  const safeDesc = esc(description);
  const safeCanonical = esc(canonical);
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
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
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
      <p>FastQuote &mdash; Quoting tools for UK dry stone wallers. <a href="/">Start a free quote</a>.</p>
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
    'Practical guides for UK dry stone wallers: pricing, measurement methodology, regional rate notes and quoting conventions.';
  const canonical = 'https://fastquote.uk/guides/';

  let listHtml;
  if (guides.length === 0) {
    listHtml = `
    <div class="g-empty">
      <h2>Coming soon</h2>
      <p>Practical guides for UK dry stone wallers &mdash; pricing per metre, measurement methodology, regional rate notes &mdash; are on their way.</p>
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
    <h1>Dry stone walling guides</h1>
    <p>Practical, no-jargon guides for UK dry stone wallers &mdash; pricing, measurement methodology, regional rate notes and quoting conventions.</p>
${listHtml}`;

  return shell({ title, description, canonical, bodyHtml, isIndex: true });
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
  const bodyHtml = `    <p class="g-eyebrow">Guide</p>
${renderGuideBodyHtml(guide.body)}`;
  return shell({ title, description, canonical, bodyHtml });
}
