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
 *
 * 2026-06-26 — re-themed to the Daylight palette. Content (3-stage demo,
 * "From quote to customer" headline, How-It-Works steps) is preserved
 * verbatim from the Dark stylesheet era; only colour tokens, pricing
 * surface, data-trust band, email, and the demo-strip site name changed.
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

  test('meta description present and does not mention video (PR #35 kill-switch)', () => {
    expect(html).toMatch(
      /<meta name="description" content="FastQuote turns a few photos[^"]*"\s*\/>/
    );
    const desc = html.match(/<meta name="description" content="([^"]+)"/)[1];
    expect(desc).not.toMatch(/video/i);
    expect(desc).not.toMatch(/film/i);
  });

  test('Open Graph tags present (title, description, image, type)', () => {
    expect(html).toMatch(/<meta property="og:title"/);
    expect(html).toMatch(/<meta property="og:description"/);
    // 2026-06-30: absolute URL for the og:image. LinkedIn / Twitter
    // crawlers handle absolute more reliably than root-relative, and
    // the og:image:width + og:image:height + og:image:type quartet is
    // the standard hint set crawlers prefer for sizing decisions.
    expect(html).toMatch(/<meta property="og:image" content="https:\/\/fastquote\.uk\/og\.png"/);
    expect(html).toMatch(/<meta property="og:image:width" content="1200"/);
    expect(html).toMatch(/<meta property="og:image:height" content="630"/);
    expect(html).toMatch(/<meta property="og:image:type" content="image\/png"/);
    expect(html).toMatch(/<meta property="og:type" content="website"/);
    expect(html).toMatch(/<meta name="twitter:image" content="https:\/\/fastquote\.uk\/og\.png"/);
  });

  test('OG description honours the no-video honesty guardrail', () => {
    const og = html.match(/<meta property="og:description" content="([^"]+)"/)[1];
    expect(og).not.toMatch(/video/i);
    expect(og).not.toMatch(/film/i);
  });

  test('theme-color matches the Daylight bg (warm limestone)', () => {
    expect(html).toMatch(/<meta name="theme-color" content="#f4eee2"/);
  });

  test('Twitter card meta present', () => {
    expect(html).toMatch(/<meta name="twitter:card" content="summary_large_image"/);
  });

  test('schema.org JSON-LD SoftwareApplication block present', () => {
    expect(html).toMatch(/<script type="application\/ld\+json"/);
    expect(html).toMatch(/"@type":\s*"SoftwareApplication"/);
    expect(html).toMatch(/"applicationCategory":\s*"BusinessApplication"/);
  });

  test('schema.org description honours the no-video honesty guardrail', () => {
    const m = html.match(/"description":\s*"([^"]+)"/);
    expect(m).not.toBeNull();
    expect(m[1]).not.toMatch(/video/i);
    expect(m[1]).not.toMatch(/film/i);
  });

  test('loads landing.css and landing.js from /landing/', () => {
    // Cache-bust query allowed (?v=N) — the URL must point at the file but
    // can carry a version query so a CSS / JS update propagates without
    // requiring a hard refresh.
    expect(html).toMatch(/<link rel="stylesheet" href="\/landing\/landing\.css(\?v=\d+)?"/);
    expect(html).toMatch(/<script src="\/landing\/landing\.js(\?v=\d+)?"/);
  });

  test('imports the three spec fonts in a single Google Fonts call', () => {
    expect(html).toMatch(/Barlow\+Condensed[^"]*Inter[^"]*JetBrains\+Mono/);
  });

  test('favicon.svg linked', () => {
    expect(html).toMatch(/<link rel="icon" href="\/favicon\.svg"/);
  });
});

describe('LANDING_PAGE_HTML — structure (one page, 6 sections + footer)', () => {
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

  test('hero sub-copy stays photos-only (honesty guardrail)', () => {
    // Take a photo or "short video" was dropped here. Production video is
    // disabled via PR #35's kill-switch — landing copy claiming video is
    // a lie. Verify it stays gone.
    const sub = html.match(/<p class="hero-sub">([\s\S]*?)<\/p>/);
    expect(sub).not.toBeNull();
    expect(sub[1]).not.toMatch(/video/i);
    expect(sub[1]).not.toMatch(/film/i);
    expect(sub[1]).toMatch(/few\s+photos/i);
  });

  test('live demo strip carries the three stages + replay + progress bar', () => {
    expect(html).toMatch(/<div class="demo" data-demo/);
    // PII sanitisation: fictional farm + Holmfirth postcode (Harry lives
    // there), no reference to any real customer.
    expect(html).toMatch(/Live &middot; Beck Farm, HD8/);
    expect(html).toMatch(/class="demo-replay"/);
    // All three stages are in the markup so JS can rotate them.
    expect(html).toMatch(/data-stage="1"[\s\S]*?Photos go in/);
    expect(html).toMatch(/data-stage="2"[\s\S]*?Numbers come out/);
    expect(html).toMatch(/data-stage="3"[\s\S]*?Send to client/);
    expect(html).toMatch(/class="demo-progress-bar"/);
  });

  test('no customer-pointing PII anywhere in the landing template', () => {
    expect(html).not.toMatch(/Brink Farm/i);
    expect(html).not.toMatch(/SK10/i);
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
    expect(html).toMatch(/Snap the wall/);
    expect(html).toMatch(/Check the numbers/);
    expect(html).toMatch(/Send\. Track\. Get on with it\./);
  });

  test('step 1 body honours the no-video honesty guardrail', () => {
    // Step 1 used to say "A few photos or a short video — overview, ...".
    // Video phrasing dropped because video is disabled in prod (PR #35).
    const step1 = html.match(
      /<h3 class="step-title">Snap the wall<\/h3>\s*<p class="step-body">([\s\S]*?)<\/p>/
    );
    expect(step1).not.toBeNull();
    expect(step1[1]).not.toMatch(/video/i);
    expect(step1[1]).not.toMatch(/film/i);
  });

  test('"Snap the wall" mock shows three real photos, not placeholder divs', () => {
    // Mark (2026-06-03): the placeholder stone-gradient tiles became
    // real photos from his job archive. Lock all three references.
    expect(html).toMatch(/<img class="step-mock-photo"[^>]*src="\/landing\/photos\/wall-1-urban\.jpg"/);
    expect(html).toMatch(/<img class="step-mock-photo"[^>]*src="\/landing\/photos\/wall-2-village\.jpg"/);
    expect(html).toMatch(/<img class="step-mock-photo"[^>]*src="\/landing\/photos\/wall-3-moorland\.jpg"/);
    // Decorative; no alt text leakage required (aria-hidden on parent)
    expect(html).toMatch(/loading="lazy"/);
  });

  test('hero live-demo strip uses the same three real photos for "Photos go in"', () => {
    // The hero demo is the highest-impact surface — Mark's screenshot
    // showed the placeholder tiles still in place there. The .demo-photo
    // divs now wrap an <img> over the gradient fallback so the user
    // watches three real photos slot in, ✓ checks landing on top.
    const demoBlock = html.match(/<div class="demo-photos">[\s\S]*?<\/div>\s*<\/div>/);
    expect(demoBlock).not.toBeNull();
    const inner = demoBlock[0];
    expect(inner).toMatch(/src="\/landing\/photos\/wall-1-urban\.jpg"/);
    expect(inner).toMatch(/src="\/landing\/photos\/wall-2-village\.jpg"/);
    expect(inner).toMatch(/src="\/landing\/photos\/wall-3-moorland\.jpg"/);
  });

  test('data-trust band present with all four cards', () => {
    expect(html).toMatch(/<section class="data" id="data-trust">/);
    expect(html).toMatch(/Your clients' details, kept safe/);
    expect(html).toMatch(/Registered with the ICO/);
    expect(html).toMatch(/UK GDPR compliant/);
    expect(html).toMatch(/Kept secure/);
    expect(html).toMatch(/Your data stays yours/);
  });

  test('data-trust does NOT make unverified at-rest encryption claim', () => {
    // Per spec §3 the "encrypted in transit and at rest" line is softened
    // to "kept secure" until the Railway-PG at-rest control is confirmed.
    expect(html).not.toMatch(/at rest/i);
    expect(html).toMatch(/kept secure/i);
  });

  test('pricing section headline no longer signals "one-person trade"', () => {
    // Mark's brief (2026-06-03): "Get rid of the 'built for a one
    // person trade' — we need another strap line." Signals to growing
    // tradesmen that the product is for them, not just Mark.
    expect(html).not.toMatch(/one-person trade/i);
    expect(html).toMatch(/Built to grow your trade/);
  });

  test('subscription pricing card shows £19.99/month (visible price)', () => {
    const pricing = html.match(/<section class="pricing" id="pricing">[\s\S]*?<\/section>/);
    expect(pricing).not.toBeNull();
    const block = pricing[0];
    expect(block).toMatch(/Fair, monthly,/);
    expect(block).toMatch(/<span>no surprises\.<\/span>/);
    expect(block).toMatch(/<span class="pricing-figure">19\.99<\/span>/);
    expect(block).toMatch(/<span class="pricing-period">\/month<\/span>/);
    expect(block).toMatch(/Start free &mdash; no card needed/);
    expect(block).toMatch(/Free while you make your first 3 quotes\./);
  });

  test('pricing card lists all four features with tick badges', () => {
    expect(html).toMatch(/Unlimited quotes &amp; clients/);
    expect(html).toMatch(/Client portal &amp; live quote tracking/);
    expect(html).toMatch(/PDF export &amp; print-ready quotes/);
    expect(html).toMatch(/Your branding on every quote/);
  });

  test('pay-as-you-go panel shows £9.99 for 5 quotes', () => {
    const pricing = html.match(/<section class="pricing" id="pricing">[\s\S]*?<\/section>/);
    expect(pricing).not.toBeNull();
    const block = pricing[0];
    expect(block).toMatch(/class="pricing-pack"/);
    expect(block).toMatch(/Or pay as you go/);
    expect(block).toMatch(/5 quotes &mdash; &pound;9\.99/);
    expect(block).toMatch(/Buy 5 quotes &mdash; &pound;9\.99/);
    expect(block).toMatch(/don't expire/);
  });

  test('footer present with brand lockup, links, and built-in mention', () => {
    expect(html).toMatch(/<footer class="foot">/);
    expect(html).toMatch(/Quoting tools for tradesmen/);
    expect(html).toMatch(/href="\/privacy"/);
    expect(html).toMatch(/href="\/terms"/);
    expect(html).toMatch(/href="mailto:fastquote@harrydoyle\.uk"/);
    expect(html).toMatch(/Built in West Yorkshire/);
  });

  test('footer uses the real working email, not the unmonitored hello@', () => {
    // fastquote.uk MX does not accept hello@. Harry's actual inbox is
    // fastquote@harrydoyle.uk — that's the only contact point that
    // delivers.
    expect(html).not.toMatch(/hello@fastquote\.uk/);
    expect(html).toMatch(/fastquote@harrydoyle\.uk/);
  });

  test('footer cites the ICO registration verbatim', () => {
    expect(html).toMatch(/ICO reg\. ZC178109/);
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

describe('landing.css — Daylight design tokens + responsive breakpoints', () => {
  test('declares the full Daylight token palette', () => {
    for (const token of [
      '--bg', '--bg-2', '--bg-3', '--bg-card', '--rule', '--rule-2',
      '--ink', '--ink-2', '--ink-3', '--ink-4',
      '--brand', '--brand-bright', '--brand-dk', '--brand-soft',
      '--ok', '--ok-bright',
    ]) {
      expect(cssSrc).toMatch(new RegExp(`${token}\\s*:`));
    }
    // Daylight palette values — verbatim from the design handoff.
    expect(cssSrc).toContain('#bd5e09'); // brand amber (unchanged across themes)
    expect(cssSrc).toContain('#f4eee2'); // warm limestone bg
    expect(cssSrc).toContain('#fffdf8'); // cream card surface
    expect(cssSrc).toContain('#211a10'); // ink (body text)
    expect(cssSrc).toContain('#3f7d18'); // ok green
  });

  test('does NOT contain dark-theme tokens (Daylight is the only stylesheet)', () => {
    // The dark palette's bg / surface / ink. If any of these survive
    // the re-theme, the page will read as a mismatched dark/light hybrid.
    expect(cssSrc).not.toMatch(/#0d0805/);
    expect(cssSrc).not.toMatch(/#1c1612/);
    expect(cssSrc).not.toMatch(/#f8f2e6/);
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

  test('pricing-pack panel styled (Daylight pay-as-you-go surface)', () => {
    expect(cssSrc).toMatch(/\.pricing-pack\s*\{/);
    expect(cssSrc).toMatch(/\.pricing-pack-title\s*\{/);
  });

  test('data-trust band styled', () => {
    expect(cssSrc).toMatch(/\.data\s*\{/);
    expect(cssSrc).toMatch(/\.data-grid\s*\{/);
    expect(cssSrc).toMatch(/\.data-item\s*\{/);
  });
});

describe('landing.js — demo controller contract (UNCHANGED across re-theme)', () => {
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
