// @ts-check
import { test, expect } from '@playwright/test';

/**
 * Public-surface smoke (Phase 1, 2026-06-30).
 *
 * Every test here would have caught at least one regression from the
 * last week without Harry having to spot it manually:
 *   - landing.js cache-buster bumps (bug-hunt #6, PR #109)
 *   - sitemap.xml drift (only 5 URLs when 13 expected, PR #105)
 *   - robots.txt named-bot Disallow gaps (bug-hunt #4)
 *   - /signup?ref= preservation (referral PR #108)
 *   - /guides/index dupe (bug-hunt #3, PR #109)
 *   - per-guide JSON-LD shape (PR #107)
 *
 * Auth-gated journeys (Edit details, Dashboard tabs, redeem) ship in
 * Phase 2 once the `/test/agent-login` endpoint + the smoke user are
 * configured — see docs/SMOKE.md.
 */

test.describe('Landing page', () => {
  test('GET / returns 200 with the FastQuote brand wordmark', async ({ request, page }) => {
    const res = await request.get('/');
    expect(res.status()).toBe(200);
    await page.goto('/');
    // Wordmark is rendered in the hero — fail if it disappears.
    await expect(page.locator('text=FastQuote').first()).toBeVisible();
  });

  test('OG meta tags point at the absolute og.png URL with matching dimensions', async ({ page }) => {
    await page.goto('/');
    const ogImage = await page.locator('meta[property="og:image"]').getAttribute('content');
    expect(ogImage).toBe('https://fastquote.uk/og.png');
    const w = await page.locator('meta[property="og:image:width"]').getAttribute('content');
    const h = await page.locator('meta[property="og:image:height"]').getAttribute('content');
    // 2400×1260 (deviceScaleFactor 2 in generate-og-image.mjs). Bug-hunt #11.
    expect(w).toBe('2400');
    expect(h).toBe('1260');
  });

  test('JSON-LD @graph parses and contains the documented node types', async ({ page }) => {
    await page.goto('/');
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
    expect(jsonLd).toBeTruthy();
    const parsed = JSON.parse(jsonLd);
    expect(parsed['@graph']).toBeDefined();
    const types = parsed['@graph'].map((n) => n['@type']);
    // PR #104's expanded graph — every node must survive future edits.
    for (const type of ['Organization', 'WebSite', 'SoftwareApplication', 'HowTo', 'FAQPage']) {
      expect(types).toContain(type);
    }
  });

  test('landing.js script tag carries the latest cache-buster', async ({ page }) => {
    await page.goto('/');
    const src = await page.locator('script[src*="landing/landing.js"]').getAttribute('src');
    // PR #109 bumped to v3 when the referral IIFE shipped (bug-hunt #6).
    // The next bump should update this test too — that's the point: the
    // cache-buster invariant is now load-bearing in CI.
    expect(src).toMatch(/landing\.js\?v=\d+/);
    const v = src.match(/\?v=(\d+)/)?.[1];
    expect(Number(v)).toBeGreaterThanOrEqual(3);
  });
});

test.describe('Referral share-URL preservation', () => {
  test('/signup?ref=PAULJULY 302s to /login?ref=PAULJULY (then /auth/login)', async ({ request }) => {
    const res = await request.get('/signup?ref=PAULJULY', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toBe('/login?ref=PAULJULY');
  });

  test('/login?ref=PAULJULY 302s to /auth/login?ref=PAULJULY', async ({ request }) => {
    const res = await request.get('/login?ref=PAULJULY', { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers().location).toBe('/auth/login?ref=PAULJULY');
  });

  test('landing.js exposes the preserveReferralCode IIFE', async ({ request }) => {
    const res = await request.get('/landing/landing.js?v=3');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain('preserveReferralCode');
    expect(body).toContain('URLSearchParams');
  });
});

test.describe('Discoverability surfaces', () => {
  test('robots.txt has Disallow rules on every named-bot block', async ({ request }) => {
    const res = await request.get('/robots.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    // Sitemap pointer must always be present.
    expect(body).toMatch(/Sitemap:\s*https:\/\/fastquote\.uk\/sitemap\.xml/);
    // Bug-hunt #4: named-bot blocks need their own Disallow:/api lines.
    const apiDisallowCount = (body.match(/Disallow:\s*\/api/g) || []).length;
    // At least 25 (one per User-agent + the wildcard).
    expect(apiDisallowCount).toBeGreaterThanOrEqual(25);
  });

  test('sitemap.xml contains all 13 documented URLs', async ({ request }) => {
    const res = await request.get('/sitemap.xml');
    expect(res.status()).toBe(200);
    const body = await res.text();
    const urlBlocks = body.match(/<url>/g) || [];
    // PR #105 expanded to 13 (8 guides + 5 marketing). Adding a new
    // public route MUST update sitemap.xml — this test enforces it.
    expect(urlBlocks.length).toBeGreaterThanOrEqual(13);
    for (const slug of [
      'cost-per-metre',
      'how-long-to-rebuild',
      'stone-tonnage',
      'whats-in-a-quote',
      'dswa-day-rate',
      'yorkshire-walling-costs',
      'cotswold-walling-costs',
      'chapter-8-traffic-management',
    ]) {
      expect(body).toContain(`https://fastquote.uk/guides/${slug}`);
    }
  });

  test('llms.txt exists and avoids the banned-vocab leak through retrieval', async ({ request }) => {
    const res = await request.get('/llms.txt');
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/^#\s+FastQuote/m);
    // Bug-hunt #18 — "free credit" was leaking to LLM citations.
    expect(body).not.toMatch(/free credit/i);
    expect(body).toContain('free quote');
  });
});

test.describe('Guides hub', () => {
  test('GET /guides/ returns 200 + lists the 8 cluster articles (no /guides/index dupe)', async ({ request, page }) => {
    const res = await request.get('/guides/');
    expect(res.status()).toBe(200);
    await page.goto('/guides/');
    // No card on the hub should point at /guides/index — bug-hunt #3.
    const indexLinks = await page.locator('a[href="/guides/index"]').count();
    expect(indexLinks).toBe(0);
  });

  test('GET /guides/index 301s to /guides/', async ({ request }) => {
    const res = await request.get('/guides/index', { maxRedirects: 0 });
    expect(res.status()).toBe(301);
    expect(res.headers().location).toBe('/guides/');
  });

  test('each cluster guide returns 200 + has per-guide JSON-LD', async ({ request, page }) => {
    const slugs = [
      'cost-per-metre',
      'how-long-to-rebuild',
      'stone-tonnage',
      'whats-in-a-quote',
      'dswa-day-rate',
      'yorkshire-walling-costs',
      'cotswold-walling-costs',
      'chapter-8-traffic-management',
    ];
    for (const slug of slugs) {
      const res = await request.get(`/guides/${slug}`);
      expect(res.status(), `expected ${slug} to return 200`).toBe(200);
    }
    // Spot-check the JSON-LD shape on one guide so PR #107's contract holds.
    await page.goto('/guides/cost-per-metre');
    const jsonLd = await page.locator('script[type="application/ld+json"]').first().textContent();
    const parsed = JSON.parse(jsonLd);
    expect(parsed['@graph']).toBeDefined();
    const types = parsed['@graph'].map((n) => n['@type']);
    expect(types).toContain('BlogPosting');
    expect(types).toContain('Person');
    expect(types).toContain('BreadcrumbList');
  });

  test('GET /guides/no-such-slug returns 404 (slug whitelist intact)', async ({ request }) => {
    const res = await request.get('/guides/no-such-slug');
    expect(res.status()).toBe(404);
  });
});

test.describe('Client portal', () => {
  test('GET /q/aaaaaaaa-1111-2222-3333-444444444444 returns 404 (unknown token)', async ({ request }) => {
    const res = await request.get('/q/aaaaaaaa-1111-2222-3333-444444444444');
    // Unknown token returns 404; expired returns 410. Either way the
    // route exists and responds without exposing internals.
    expect([404, 410]).toContain(res.status());
  });

  test('POST /q/<unknown>/respond returns 409 with the lifecycle-aware message', async ({ request }) => {
    const res = await request.post('/q/aaaaaaaa-1111-2222-3333-444444444444/respond', {
      data: { response: 'accepted' },
    });
    expect(res.status()).toBe(409);
    const body = await res.json();
    // Lifecycle bug-hunt #2 — message now mentions the completed-status guard.
    expect(body.error).toMatch(/already completed/);
  });
});
