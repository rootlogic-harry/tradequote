/**
 * FastQuote landing page — source-level spec compliance.
 *
 * The landing is an unauthenticated marketing surface at `/`. Three
 * sources contribute to it:
 *   - LANDING_PAGE_HTML in server.js (markup, meta, schema.org)
 *   - public/landing/landing.css (design tokens + layout + responsive)
 *   - public/landing/landing.js  (3-stage demo controller)
 *
 * These tests anchor the spec's verbatim copy + structure + token set so
 * a future refactor can't quietly drop a section or break the demo
 * markup contract that landing.js depends on.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const cssSrc = readFileSync(join(repoRoot, 'public/landing/landing.css'), 'utf8');
const jsSrc  = readFileSync(join(repoRoot, 'public/landing/landing.js'), 'utf8');

// Pull the LANDING_PAGE_HTML template literal out of server.js so the
// assertions don't accidentally match other landing-shaped strings
// (e.g. the 500-page or login-page) elsewhere in the file.
function landingHtml() {
  const m = serverSrc.match(/const LANDING_PAGE_HTML = `([\s\S]*?)`;/);
  if (!m) throw new Error('LANDING_PAGE_HTML not found in server.js');
  return m[1];
}

describe('LANDING_PAGE_HTML — head + meta', () => {
  const html = landingHtml();

  test('title matches the spec verbatim', () => {
    expect(html).toMatch(
      /<title>FastQuote &mdash; From quote to customer, ready in 5 minutes\.<\/title>/
    );
  });

  test('meta description present and matches the spec wording', () => {
    expect(html).toMatch(
      /<meta name="description" content="FastQuote turns a few photos or a short video[^"]*"\s*\/>/
    );
  });

  test('Open Graph tags present (title, description, image, type)', () => {
    expect(html).toMatch(/<meta property="og:title"/);
    expect(html).toMatch(/<meta property="og:description"/);
    expect(html).toMatch(/<meta property="og:image" content="\/og\.png"/);
    expect(html).toMatch(/<meta property="og:type" content="website"/);
  });

  test('Twitter card meta present', () => {
    expect(html).toMatch(/<meta name="twitter:card" content="summary_large_image"/);
  });

  test('schema.org JSON-LD SoftwareApplication block present', () => {
    expect(html).toMatch(/<script type="application\/ld\+json"/);
    expect(html).toMatch(/"@type":\s*"SoftwareApplication"/);
    expect(html).toMatch(/"applicationCategory":\s*"BusinessApplication"/);
  });

  test('loads landing.css and landing.js from /landing/', () => {
    expect(html).toMatch(/<link rel="stylesheet" href="\/landing\/landing\.css"/);
    expect(html).toMatch(/<script src="\/landing\/landing\.js"/);
  });

  test('imports the three spec fonts in a single Google Fonts call', () => {
    expect(html).toMatch(/Barlow\+Condensed[^"]*Inter[^"]*JetBrains\+Mono/);
  });

  test('favicon.svg linked', () => {
    expect(html).toMatch(/<link rel="icon" href="\/favicon\.svg"/);
  });
});

describe('LANDING_PAGE_HTML — structure (one page, 5 sections + footer)', () => {
  const html = landingHtml();

  test('renders a sticky <header class="nav"> with brand + links + actions', () => {
    expect(html).toMatch(/<header class="nav">/);
    expect(html).toMatch(/class="brand"[^>]*>[\s\S]*?FASTQUOTE/);
    expect(html).toMatch(/<nav class="nav-links"/);
    expect(html).toMatch(/href="\/login"[^>]*class="nav-login">Log in</);
    expect(html).toMatch(/href="\/signup"[\s\S]{0,200}?Get started/);
  });

  test('hero section with eyebrow + two-line headline + sub + facts', () => {
    expect(html).toMatch(/<section class="hero">/);
    expect(html).toMatch(/<span class="eyebrow">For dry stone wallers<\/span>/);
    expect(html).toMatch(/From quote to customer\./);
    expect(html).toMatch(/<span class="hero-title-amber">Ready in 5 minutes\.<\/span>/);
    expect(html).toMatch(/Spend less time on paperwork/);
    expect(html).toMatch(/No card needed to try/);
    expect(html).toMatch(/cancel anytime/);
    expect(html).toMatch(/Built with West Yorkshire wallers/);
  });

  test('live demo strip carries the three stages + replay + progress bar', () => {
    expect(html).toMatch(/<div class="demo" data-demo/);
    expect(html).toMatch(/Live &middot; Brink Farm, SK10/);
    expect(html).toMatch(/class="demo-replay"/);
    // All three stages are in the markup so JS can rotate them.
    expect(html).toMatch(/data-stage="1"[\s\S]*?Photos go in/);
    expect(html).toMatch(/data-stage="2"[\s\S]*?Numbers come out/);
    expect(html).toMatch(/data-stage="3"[\s\S]*?Send to client/);
    expect(html).toMatch(/class="demo-progress-bar"/);
  });

  test('demo stage 2 has the five labelled rows with data-target values', () => {
    expect(html).toMatch(/Wall length[\s\S]*?data-target="18m"/);
    expect(html).toMatch(/Stone reclaimed[\s\S]*?data-target="65%"/);
    expect(html).toMatch(/New stone[\s\S]*?data-target="1\.8 t"/);
    expect(html).toMatch(/Labour[\s\S]*?data-target="2 &times; 6 days"/);
    expect(html).toMatch(/Materials cost[\s\S]*?data-target="&pound;1,518"/);
  });

  test('demo stage 3 shows total box + status', () => {
    expect(html).toMatch(/Quote total inc\. VAT/);
    expect(html).toMatch(/&pound;7,581\.60/);
    expect(html).toMatch(/QT-2026-0047 &middot; valid 30 days/);
    expect(html).toMatch(/Sent to James &middot; viewed 12 mins ago/);
  });

  test('trust strip has all four cells in the spec order', () => {
    const trust = html.match(/<section class="trust">[\s\S]*?<\/section>/);
    expect(trust).not.toBeNull();
    const cells = trust[0];
    expect(cells).toMatch(/80%\+[\s\S]*?Accuracy first time/);
    expect(cells).toMatch(/5 mins[\s\S]*?Typical quote time/);
    expect(cells).toMatch(/Improve your win rate/);
    expect(cells).toMatch(/DSWA[\s\S]*?Working with members/);
  });

  test('how-it-works section with three numbered steps', () => {
    expect(html).toMatch(/<section class="how" id="how">/);
    expect(html).toMatch(/Three steps\. Roughly five minutes\./);
    expect(html).toMatch(/Snap or film the wall/);
    expect(html).toMatch(/Check the numbers/);
    expect(html).toMatch(/Send\. Track\. Get on with it\./);
  });

  test('pricing section teases without a numeric price (per spec)', () => {
    const pricing = html.match(/<section class="pricing" id="pricing">[\s\S]*?<\/section>/);
    expect(pricing).not.toBeNull();
    const block = pricing[0];
    expect(block).toMatch(/Fair, monthly,/);
    expect(block).toMatch(/<span>no surprises\.<\/span>/);
    expect(block).toMatch(/Start free &mdash; no card needed/);
    expect(block).toMatch(/Free while you make your first 3 quotes\./);
    // No specific numeric price tease on the page.
    expect(block).not.toMatch(/£\d|&pound;\d|\$\d|€\d/);
  });

  test('pricing card lists all four features with tick badges', () => {
    expect(html).toMatch(/Unlimited quotes &amp; clients/);
    expect(html).toMatch(/Client portal &amp; live quote tracking/);
    expect(html).toMatch(/PDF export &amp; print-ready quotes/);
    expect(html).toMatch(/Your branding on every quote/);
  });

  test('footer present with brand lockup, links, and built-in mention', () => {
    expect(html).toMatch(/<footer class="foot">/);
    expect(html).toMatch(/Quoting tools for tradesmen/);
    expect(html).toMatch(/href="\/privacy"/);
    expect(html).toMatch(/href="\/terms"/);
    expect(html).toMatch(/href="mailto:hello@fastquote\.uk"/);
    expect(html).toMatch(/Built in West Yorkshire/);
  });

  test('does NOT link to /sample (removed in v1 per spec section 9)', () => {
    expect(html).not.toMatch(/href="\/sample"/);
  });
});

describe('/signup route', () => {
  test('server registers a GET /signup that 302s to /login', () => {
    expect(serverSrc).toMatch(
      /app\.get\(\s*['"]\/signup['"][\s\S]{0,200}?res\.redirect\(\s*302\s*,\s*['"]\/login['"]\s*\)/
    );
  });
});

describe('landing.css — design tokens + responsive breakpoints', () => {
  test('declares the full token palette from the spec', () => {
    for (const token of [
      '--bg', '--bg-2', '--bg-3', '--bg-card', '--rule', '--rule-2',
      '--ink', '--ink-2', '--ink-3', '--ink-4',
      '--brand', '--brand-bright', '--brand-dk', '--brand-soft',
      '--ok', '--ok-bright',
    ]) {
      expect(cssSrc).toMatch(new RegExp(`${token}\\s*:`));
    }
    expect(cssSrc).toContain('#d97706'); // brand amber
    expect(cssSrc).toContain('#0d0805'); // bg
    expect(cssSrc).toContain('#65a32d'); // ok
  });

  test('declares the three type-family custom properties', () => {
    expect(cssSrc).toMatch(/--display:\s*"Barlow Condensed"/);
    expect(cssSrc).toMatch(/--body:\s*"Inter"/);
    expect(cssSrc).toMatch(/--mono:\s*"JetBrains Mono"/);
  });

  test('two responsive breakpoints (1100px tablet, 720px phone)', () => {
    expect(cssSrc).toMatch(/@media \(max-width:\s*1099px\)/);
    expect(cssSrc).toMatch(/@media \(max-width:\s*719px\)/);
  });

  test('respects prefers-reduced-motion', () => {
    expect(cssSrc).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
  });

  test('visible focus state on every focusable element', () => {
    expect(cssSrc).toMatch(/:focus-visible[\s\S]*?outline:\s*2px solid var\(--brand\)/);
  });

  test('primary button hits the 44px touch-target minimum', () => {
    expect(cssSrc).toMatch(/\.btn\s*\{[\s\S]*?min-height:\s*44px/);
    expect(cssSrc).toMatch(/\.btn-lg\s*\{[\s\S]*?min-height:\s*56px/);
  });
});

describe('landing.js — demo controller contract', () => {
  test('three-stage rotation with the spec timings 2400 / 2800 / 3200ms', () => {
    expect(jsSrc).toMatch(/STAGE_DURATIONS\s*=\s*\[\s*2400\s*,\s*2800\s*,\s*3200\s*\]/);
  });

  test('uses IntersectionObserver to pause when off-screen', () => {
    expect(jsSrc).toContain('IntersectionObserver');
    expect(jsSrc).toMatch(/threshold:\s*0\.2/);
  });

  test('honours prefers-reduced-motion by holding stage 3', () => {
    expect(jsSrc).toMatch(/prefers-reduced-motion/);
    expect(jsSrc).toMatch(/current\s*=\s*stages\.length\s*-\s*1/);
  });

  test('queries the same data attributes the HTML emits', () => {
    // HTML side: [data-demo], .demo-row-v[data-target], .demo-replay
    expect(jsSrc).toMatch(/\[data-demo\]/);
    expect(jsSrc).toMatch(/data-target/);
    expect(jsSrc).toMatch(/\.demo-replay/);
  });

  test('replay button forces a reflow before restarting', () => {
    // void demo.offsetHeight is the cross-browser reflow trick — without
    // it CSS animations don't restart on .is-active toggling.
    expect(jsSrc).toMatch(/void [a-z]+\.offsetHeight/i);
  });

  test('no external dependencies (vanilla JS)', () => {
    expect(jsSrc).not.toMatch(/require\(|from ['"]/);
  });
});
