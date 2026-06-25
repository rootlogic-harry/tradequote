/**
 * FastQuote landing page — "Daylight" (2026-06-25 handoff, Spec v2).
 *
 * The landing is an unauthenticated marketing surface at `/`. Two
 * sources contribute to it:
 *   - LANDING_PAGE_HTML in server.js (markup, meta, copy)
 *   - public/landing/landing-light.css (design tokens + layout + responsive)
 *
 * These tests anchor the spec's verbatim copy + structure + token set so
 * a future refactor can't quietly drop a section, break the trust-first
 * design, or reintroduce banned vocabulary (video analysis, voice notes,
 * testimonials, accuracy percentages). The landing is the most public
 * surface in the product — copy honesty is load-bearing.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const cssSrc = readFileSync(join(repoRoot, 'public/landing/landing-light.css'), 'utf8');

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
      /<title>FastQuote &mdash; Spend less time quoting, more time on the tools\.<\/title>/
    );
  });

  test('meta description present and matches the spec wording (photos-only)', () => {
    expect(html).toMatch(
      /<meta name="description" content="FastQuote turns a few photos[^"]*"\s*\/>/
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

  test('loads landing-light.css from /landing/', () => {
    // Cache-bust query allowed (?v=N).
    expect(html).toMatch(/<link rel="stylesheet" href="\/landing\/landing-light\.css(\?v=\d+)?"/);
  });

  test('imports the three spec fonts in a single Google Fonts call', () => {
    expect(html).toMatch(/Barlow\+Condensed[^"]*Inter[^"]*JetBrains\+Mono/);
  });

  test('favicon.svg linked', () => {
    expect(html).toMatch(/<link rel="icon" href="\/favicon\.svg"/);
  });

  test('does NOT load a landing.js — the page renders without client JS', () => {
    // Daylight spec: "no JavaScript required."
    // The analytics beacon is allowed (it's inline + non-essential), but
    // there must be no external landing.js dependency.
    expect(html).not.toMatch(/<script[^>]+src="\/landing\/landing\.js/);
  });
});

describe('LANDING_PAGE_HTML — structure (8 sections per spec §2)', () => {
  const html = landingHtml();

  test('sticky <header class="nav"> with brand + 3 links + actions', () => {
    expect(html).toMatch(/<header class="nav">/);
    expect(html).toMatch(/class="brand"[^>]*>[\s\S]*?FASTQUOTE/);
    expect(html).toMatch(/<nav class="nav-links"/);
    expect(html).toMatch(/href="#how"[^>]*>How it works/);
    expect(html).toMatch(/href="#answers"[^>]*>Questions/);
    expect(html).toMatch(/href="#pricing"[^>]*>Pricing/);
    expect(html).toMatch(/href="\/login"[^>]*class="link-quiet">Log in</);
    expect(html).toMatch(/href="\/signup"[\s\S]{0,400}?Get started/);
  });

  test('hero — eyebrow, three-line headline (third line amber), sub, CTA, 3 bullets', () => {
    expect(html).toMatch(/<section class="hero">/);
    expect(html).toMatch(/For dry stone wallers/);
    expect(html).toMatch(/<span>Spend less<\/span>/);
    expect(html).toMatch(/<span>time quoting\.<\/span>/);
    expect(html).toMatch(/<span class="hero-title-emph">More on the tools\.<\/span>/);
    expect(html).toMatch(/Take a few photos of the wall\./);
    expect(html).toMatch(/Get started &mdash; no card/);
    expect(html).toMatch(/Free while you make your first 3 quotes/);
    expect(html).toMatch(/Every figure is yours to check and change/);
    expect(html).toMatch(/Built with West Yorkshire wallers/);
  });

  test('hero photo placeholder + floating accepted-quote card', () => {
    expect(html).toMatch(/class="hero-shot"/);
    // Placeholder div with the spec's data-label.
    expect(html).toMatch(/class="ph" data-label="Photo &mdash; finished wall in the landscape"/);
    // TODO comment marks the swap point for Harry's real photography.
    expect(html).toMatch(/TODO:[\s\S]*?real wall photo[\s\S]*?Yorkshire/);
    // HD9 (Holmfirth, West Yorkshire), not SK10 (Cheshire) — spec §1 change #7.
    expect(html).toMatch(/QT-2026-0047 &middot; Brink Farm, HD9/);
    expect(html).toMatch(/&pound;7,581\.60/);
    expect(html).toMatch(/<div class="quote-float-badge">[\s\S]*?Accepted/);
  });

  test('trust strip — 4 cells in spec order: 5 min · 100% · 3 free · DSWA', () => {
    const m = html.match(/<section class="trust">[\s\S]*?<\/section>/);
    expect(m).not.toBeNull();
    const cells = m[0];
    expect(cells).toMatch(/5 min[\s\S]*?Typical quote time/);
    expect(cells).toMatch(/100%[\s\S]*?Editable by you/);
    expect(cells).toMatch(/3 free[\s\S]*?Quotes to start/);
    expect(cells).toMatch(/DSWA[\s\S]*?Built with members/);
    // No accuracy claim in the trust strip (spec §1 change #1).
    expect(cells).not.toMatch(/80%|accuracy|accurate/i);
  });

  test('how-it-works section with three numbered steps (Snap → Check → Send)', () => {
    expect(html).toMatch(/<section class="how" id="how">/);
    expect(html).toMatch(/Three steps\. Roughly five minutes\./);
    expect(html).toMatch(/<h3>Snap the wall<\/h3>/);
    expect(html).toMatch(/<h3>Check the numbers<\/h3>/);
    expect(html).toMatch(/<h3>Send\. Track\. Get on with it\.<\/h3>/);
    // Step body copy contracts (spec §3).
    expect(html).toMatch(/A few photos &mdash; overview, close-up, side profile\./);
    expect(html).toMatch(/Measurements, stone tonnage, materials, labour days\./);
    expect(html).toMatch(/A polished, branded quote your client sees on their phone\./);
  });

  test('"Snap the wall" step has 3 .ph photo placeholders + TODO swap marker', () => {
    const stepSection = html.match(/<h3>Snap the wall<\/h3>[\s\S]*?<\/li>/);
    expect(stepSection).not.toBeNull();
    const block = stepSection[0];
    expect(block).toMatch(/TODO:[\s\S]*?real wall photos/);
    expect(block).toMatch(/<div class="step-photos"[\s\S]*?<\/div>/);
    // Three placeholder tiles.
    const tiles = (block.match(/<div class="ph"><\/div>/g) || []).length;
    expect(tiles).toBe(3);
  });

  test('answers section — 3 cards covering the real objections', () => {
    expect(html).toMatch(/<section class="answers" id="answers">/);
    expect(html).toMatch(/Fair questions\./);
    expect(html).toMatch(/Can a computer really measure my wall\?/);
    expect(html).toMatch(/I'm not good with tech\./);
    expect(html).toMatch(/What's it going to cost me\?/);
    // Answer body copy verbatim (spec §3).
    expect(html).toMatch(/It gives you a starting figure from your photos/);
    expect(html).toMatch(/If you can take a photo and tap a button/);
    // Price in answer matches the live Stripe price (£19.99, not the
    // spec's £19 placeholder — see handoff resolution #1).
    expect(html).toMatch(/&pound;19\.99 a month, cancel any time/);
  });

  test('data section — 4 cards (ICO / UK GDPR / Encrypted / Data ownership)', () => {
    expect(html).toMatch(/<section class="data" id="data">/);
    expect(html).toMatch(/Your clients' details, kept safe\./);
    expect(html).toMatch(/Quotes and customer information sit behind proper data protection/);
    expect(html).toMatch(/Registered with the ICO/);
    expect(html).toMatch(/UK GDPR compliant/);
    expect(html).toMatch(/Encrypted and secure/);
    expect(html).toMatch(/Your data stays yours/);
    // ICO number in the data card (mono, ZC178109).
    expect(html).toMatch(/<p class="data-ref">ICO reg\. ZC178109<\/p>/);
  });

  test('security card uses softened wording per handoff resolution #2', () => {
    // Defensive default — "kept secure" instead of "encrypted in transit
    // and at rest". An HTML comment marks the swap-back point if Harry
    // verifies the Railway-PG control.
    expect(html).toMatch(/Your quotes and client details are kept secure, so they stay private\./);
    expect(html).toMatch(/Defensive default per handoff[\s\S]*?Swap to "encrypted in transit and at rest/);
    // The stronger wording must NOT be present as live copy on the page.
    // The live security card body must say "kept secure"; the only
    // permitted occurrence of the stronger phrase is inside the HTML
    // comment that documents the swap-back path.
    const securityCard = html.match(/<h3>Encrypted and secure<\/h3>[\s\S]*?<\/div>/);
    expect(securityCard).not.toBeNull();
    expect(securityCard[0]).toMatch(/kept secure/);
    // The card's <p> must not say "encrypted in transit and at rest"
    // — the only occurrence is in the comment above it.
    const bodyP = securityCard[0].match(/<p>([^<]+)<\/p>/);
    expect(bodyP).not.toBeNull();
    expect(bodyP[1]).not.toMatch(/encrypted in transit and at rest/);
  });

  test('pricing — £19.99/mo (the live Stripe price), all 4 features, CTA', () => {
    const m = html.match(/<section class="pricing" id="pricing">[\s\S]*?<\/section>/);
    expect(m).not.toBeNull();
    const block = m[0];
    expect(block).toMatch(/One plan\. Built for a one-person trade\./);
    expect(block).toMatch(/<span class="pricing-figure">19\.99<\/span>/);
    expect(block).toMatch(/<span class="pricing-period">\/mo<\/span>/);
    expect(block).toMatch(/\+ VAT &middot; cancel anytime/);
    expect(block).toMatch(/Unlimited quotes &amp; clients/);
    expect(block).toMatch(/Client portal &amp; live quote tracking/);
    expect(block).toMatch(/PDF export &amp; print-ready quotes/);
    expect(block).toMatch(/Your branding on every quote/);
    expect(block).toMatch(/Start free &mdash; no card needed/);
    expect(block).toMatch(/Free while you make your first 3 quotes\./);
    // The placeholder figure (£19/mo) must NOT remain anywhere in pricing.
    expect(block).not.toMatch(/>19<\/span>/);
  });

  test('footer — brand, links, ICO reg line', () => {
    const m = html.match(/<footer class="foot">[\s\S]*?<\/footer>/);
    expect(m).not.toBeNull();
    const block = m[0];
    expect(block).toMatch(/Quoting tools for tradesmen/);
    expect(block).toMatch(/href="\/privacy"/);
    expect(block).toMatch(/href="\/terms"/);
    expect(block).toMatch(/href="mailto:hello@fastquote\.uk"/);
    // Footer copy verbatim (spec §4): © 2026 FastQuote · Built in West
    // Yorkshire · ICO reg. ZC178109
    expect(block).toMatch(/&copy; 2026 FastQuote &middot; Built in West Yorkshire &middot; ICO reg\. ZC178109/);
  });

  test('no .back-bar — the design-review artifact is gone (spec §7)', () => {
    expect(html).not.toMatch(/back-bar/);
    expect(html).not.toMatch(/Back to options/);
  });
});

describe('LANDING_PAGE_HTML — honesty guardrails (spec §5)', () => {
  // These are live business constraints, not style preferences. The
  // landing is the most public surface; reintroducing any of these
  // would misrepresent what FastQuote does today.
  const html = landingHtml();

  test('no video analysis copy — video is disabled in prod (PR #35)', () => {
    expect(html).not.toMatch(/\bvideo\b/i);
    expect(html).not.toMatch(/film the wall/i);
    expect(html).not.toMatch(/short clip/i);
    expect(html).not.toMatch(/walkthrough/i);
  });

  test('no voice notes copy — voice dictation is internal, not a hero feature', () => {
    expect(html).not.toMatch(/voice note/i);
    expect(html).not.toMatch(/voice memo/i);
    expect(html).not.toMatch(/dictat/i);
  });

  test('no testimonials or named-waller quotes — none exist yet', () => {
    // The trust signal is DSWA + West Yorkshire wallers (both genuine).
    // Anything that looks like a quoted testimonial would be fabricated.
    expect(html).not.toMatch(/<blockquote/i);
    expect(html).not.toMatch(/&ldquo;|&rdquo;|&quot;[A-Z][a-z]+ [a-z]+ said/);
    // Named-waller quotes would typically look like "— Name, City".
    expect(html).not.toMatch(/&mdash;\s*[A-Z][a-z]+ [A-Z][a-z]+,\s*[A-Z]/);
  });

  test('no accuracy percentages — claim not backed by measured data', () => {
    // The spec explicitly removed "80%+ accuracy" (§1 change #1). Any
    // numeric percentage on the page risks reading as an accuracy claim
    // — except "65%" stone-reclaimed inside the demo, which would have
    // been a feature mockup. We removed the mockup; assert the page is
    // percentage-free outside the comments.
    const accuracyRe = /\b\d{1,3}%\+?[\s\S]{0,40}?(?:accura|first time)/i;
    expect(html).not.toMatch(accuracyRe);
    // "80%+" specifically must not appear.
    expect(html).not.toMatch(/80%\+/);
  });

  test('DSWA / West Yorkshire wallers wording kept (genuinely true)', () => {
    // Per handoff: Harry is based in West Yorkshire and works with Mark
    // + Paul (real wallers). These claims stay.
    expect(html).toMatch(/Built with West Yorkshire wallers/);
    expect(html).toMatch(/DSWA/);
    expect(html).toMatch(/Built in West Yorkshire/);
  });

  test('SK10 (Cheshire) is not used — HD9 (Holmfirth) is the demo location', () => {
    // Spec §1 change #7: the audience is West Yorkshire.
    expect(html).not.toMatch(/SK10/);
    expect(html).toMatch(/HD9/);
  });

  test('£19/mo placeholder is gone — every price reads £19.99', () => {
    // The handoff resolves the £19 placeholder to £19.99 (the live
    // Stripe price). A literal "£19 " or "£19/" or "£19 a month" must
    // not appear anywhere — only £19.99 variants.
    expect(html).not.toMatch(/&pound;19(?!\.99)\b/);
    expect(html).not.toMatch(/£19(?!\.99)\b/);
  });
});

describe('LANDING_PAGE_HTML — CTAs + ICO presence (acceptance criteria)', () => {
  const html = landingHtml();

  test('every primary CTA links to /signup', () => {
    // Hero CTA + pricing CTA + nav CTA → /signup.
    const signupLinks = (html.match(/href="\/signup"/g) || []).length;
    expect(signupLinks).toBeGreaterThanOrEqual(3);
  });

  test('Log in link → /login', () => {
    expect(html).toMatch(/href="\/login"/);
  });

  test('ICO ZC178109 appears in both footer and data card', () => {
    // Footer (with the prefix "ICO reg.") and data-ref line (mono).
    const occurrences = (html.match(/ZC178109/g) || []).length;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

describe('/ route + /signup route', () => {
  test('server serves LANDING_PAGE_HTML at / for unauthenticated visitors', () => {
    // The route is registered with a next()-pass-through for authed
    // users (legacy switcher OR Passport) so the React SPA takes over.
    expect(serverSrc).toMatch(
      /app\.get\(\s*['"]\/['"][\s\S]{0,400}?if \(req\.isAuthenticated\?\.\(\) \|\| req\.session\?\.legacyUserId\)[\s\S]{0,200}?return next\(\)[\s\S]{0,200}?res\.send\(LANDING_PAGE_HTML\)/
    );
  });

  test('server registers a GET /signup that 302s to /login', () => {
    expect(serverSrc).toMatch(
      /app\.get\(\s*['"]\/signup['"][\s\S]{0,200}?res\.redirect\(\s*302\s*,\s*['"]\/login['"]\s*\)/
    );
  });
});

describe('landing-light.css — design tokens + responsive breakpoints', () => {
  test('declares the full Daylight token palette from the spec', () => {
    for (const token of [
      '--bg', '--bg-2', '--bg-3', '--surface',
      '--rule', '--rule-2',
      '--ink', '--ink-2', '--ink-3', '--ink-4',
      '--brand', '--brand-bright', '--brand-dk', '--brand-soft',
      '--ok', '--ok-bright',
    ]) {
      expect(cssSrc).toMatch(new RegExp(`${token}\\s*:`));
    }
    expect(cssSrc).toContain('#f4eee2'); // warm limestone bg
    expect(cssSrc).toContain('#211a10'); // ink
    expect(cssSrc).toContain('#bd5e09'); // brand amber
  });

  test('declares the three type-family custom properties', () => {
    expect(cssSrc).toMatch(/--display:\s*"Barlow Condensed"/);
    expect(cssSrc).toMatch(/--body:\s*"Inter"/);
    expect(cssSrc).toMatch(/--mono:\s*"JetBrains Mono"/);
  });

  test('two responsive breakpoints (1100px tablet, 720px phone) per spec', () => {
    expect(cssSrc).toMatch(/@media \(max-width:\s*1100px\)/);
    expect(cssSrc).toMatch(/@media \(max-width:\s*720px\)/);
  });

  test('respects prefers-reduced-motion', () => {
    expect(cssSrc).toMatch(/@media \(prefers-reduced-motion:\s*reduce\)/);
  });

  test('visible focus state on every focusable element', () => {
    expect(cssSrc).toMatch(/:focus-visible[\s\S]{0,80}?outline:\s*2px solid var\(--brand\)/);
  });

  test('primary button hits the 44px touch-target minimum', () => {
    expect(cssSrc).toMatch(/\.btn\s*\{[\s\S]*?min-height:\s*44px/);
    expect(cssSrc).toMatch(/\.btn-lg\s*\{[\s\S]*?min-height:\s*56px/);
  });

  test('nav links hidden on mobile (<720px) per spec', () => {
    const mobileBlock = cssSrc.match(/@media \(max-width:\s*720px\)\s*\{[\s\S]*?\n\}/);
    expect(mobileBlock).not.toBeNull();
    expect(mobileBlock[0]).toMatch(/\.nav-links\s*\{\s*display:\s*none/);
  });

  test('quote-float collapses to a static block on mobile', () => {
    const mobileBlock = cssSrc.match(/@media \(max-width:\s*720px\)\s*\{[\s\S]*?\n\}/);
    expect(mobileBlock[0]).toMatch(/\.quote-float\s*\{[\s\S]*?position:\s*static/);
  });
});
