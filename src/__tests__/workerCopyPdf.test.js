/**
 * Worker-copy PDF — Mark uses this to send Paul / Jordan to site
 * without exposing the customer's price.
 *
 * Decisions captured in the WhatsApp thread (15-16 June 2026):
 *   - Hide just the Cost Breakdown + Totals block. Nothing else.
 *   - Reframe the reference line as "Job Details" (no "Quote ref")
 *     so the document doesn't read like a customer quote at a glance.
 *   - Filename suffix ` - worker copy.pdf` so Mark can't accidentally
 *     send the unredacted version to a customer.
 *   - Admin-only — `Probs best to keep it for me!`. Visible to Harry
 *     and Mark (both admin plan), not to Paul.
 *   - No watermark.
 *   - Same /api/.../pdf route — the redaction is purely client-side.
 *
 * These tests pin those decisions so a future change can't quietly
 * undo any of them.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const quoteDocSrc = readFileSync(join(repoRoot, 'src/components/QuoteDocument.jsx'), 'utf8');
const quoteOutputSrc = readFileSync(join(repoRoot, 'src/components/steps/QuoteOutput.jsx'), 'utf8');

describe('QuoteDocument — hideCosts prop', () => {
  test('declared on the component with default false', () => {
    expect(quoteDocSrc).toMatch(/hideCosts\s*=\s*false/);
  });

  test('Cost Breakdown block is wrapped in {!hideCosts && (...)}', () => {
    // The conditional must wrap the ENTIRE `data-print-section="cost-breakdown"`
    // div so the totals block (which lives inside the same wrapper) also
    // disappears in worker-copy mode.
    expect(quoteDocSrc).toMatch(
      /\{!hideCosts && \(\s*\n?\s*<div className="mb-12" data-print-section="cost-breakdown">/
    );
  });

  test('reference line shows "Job Details" in worker mode, "Quote ref" otherwise', () => {
    // The ternary in the Reference line block: when hideCosts, show
    // "Job Details — <address>"; otherwise the existing "Quote ref: …".
    // Match across lines because the JSX wraps.
    expect(quoteDocSrc).toMatch(/hideCosts[\s\S]{0,200}Job Details[\s\S]{0,200}jobDetails\.siteAddress/);
    expect(quoteDocSrc).toMatch(/term\.title\} ref:/);
  });

  test('worker mode keeps siteAddress in the header (workers need to find the site)', () => {
    // In the worker branch of the ternary, siteAddress must still appear —
    // otherwise the worker has nothing to navigate to.
    const m = quoteDocSrc.match(
      /\{hideCosts[\s\S]{0,500}?\}/
    );
    expect(m).not.toBeNull();
    expect(m[0]).toMatch(/jobDetails\.siteAddress/);
  });

  test('worker mode does NOT include the quote reference', () => {
    // The reference number is internal pricing context — workers don't
    // need it and it could be used as a key to look up the price later.
    const m = quoteDocSrc.match(
      /\{hideCosts\s*\?\s*<>([\s\S]*?)<\/>/
    );
    expect(m).not.toBeNull();
    expect(m[1]).not.toMatch(/quoteReference/);
    expect(m[1]).not.toMatch(/clientName/);
  });

  test('photos, schedule, measurements, notes are NOT conditional on hideCosts', () => {
    // Workers still need everything except the prices. None of the
    // other data-print-section blocks should be inside a {!hideCosts}
    // conditional.
    for (const section of ['damage', 'measurements', 'schedule', 'notes', 'photos']) {
      const idx = quoteDocSrc.indexOf(`data-print-section="${section}"`);
      expect(idx).toBeGreaterThan(-1);
      // Look backwards from the section opening for the nearest
      // conditional wrapper — should NOT be `{!hideCosts &&`.
      const before = quoteDocSrc.slice(Math.max(0, idx - 200), idx);
      expect(before).not.toMatch(/\{!hideCosts && \(\s*$/);
    }
  });
});

describe('QuoteOutput — Download worker copy button', () => {
  test('handleDownloadPdfServer accepts { hideCosts } parameter', () => {
    // Single parameterised handler is preferred to a duplicated one —
    // avoids drift between the two paths.
    expect(quoteOutputSrc).toMatch(
      /const handleDownloadPdfServer = async \(\{\s*hideCosts\s*=\s*false\s*\}\s*=\s*\{\}\)/
    );
  });

  test('handler passes hideCosts through to <QuoteDocument>', () => {
    // The renderToStaticMarkup call must forward the flag — otherwise
    // the worker-copy button has no effect on the rendered PDF.
    expect(quoteOutputSrc).toMatch(
      /<QuoteDocument[\s\S]{0,200}hideCosts=\{hideCosts\}/
    );
  });

  test('filename gets a " - worker copy" suffix when hideCosts is true', () => {
    expect(quoteOutputSrc).toMatch(/hideCosts \? `\$\{baseTitle\} - worker copy` : baseTitle/);
  });

  test('button is rendered only when isAdminPlan is true', () => {
    // The whole button must sit inside an {isAdminPlan && (...)} guard.
    // Paul (basic plan) shouldn't see it.
    expect(quoteOutputSrc).toMatch(
      /\{isAdminPlan && \(\s*\n?\s*<button[\s\S]{0,800}Download worker copy/
    );
  });

  test('button label is "Download worker copy" (matches Mark\'s own framing)', () => {
    // The WhatsApp thread used "a copy of the job and schedule with
    // the costs removed". "Download worker copy" reads naturally.
    expect(quoteOutputSrc).toMatch(/Download worker copy/);
  });

  test('button calls handleDownloadPdfServer({ hideCosts: true })', () => {
    expect(quoteOutputSrc).toMatch(
      /onClick=\{\(\) => handleDownloadPdfServer\(\{\s*hideCosts:\s*true\s*\}\)/
    );
  });

  test('button shares the same generating-spinner state as the main PDF button', () => {
    // The two paths use the same /api/.../pdf route + render pipeline;
    // disabling both buttons while either is in-flight prevents the
    // user firing two parallel Chromium renders by accident.
    const idx = quoteOutputSrc.indexOf('Download worker copy');
    const block = quoteOutputSrc.slice(Math.max(0, idx - 400), idx);
    expect(block).toMatch(/disabled=\{generatingServerPdf\}/);
  });

  test('button has a tooltip explaining the use case (workers, no costs)', () => {
    // Discoverability matters — Mark might forget what this button is
    // for after the first month. The title attribute is the cheapest
    // explanation.
    const idx = quoteOutputSrc.indexOf('Download worker copy');
    const block = quoteOutputSrc.slice(Math.max(0, idx - 600), idx);
    expect(block).toMatch(/title="[^"]*worker|title="[^"]*costs|title="[^"]*customer/);
  });

  // Mark's 2026-07-20 UAT: "did we lose the download for staff option?"
  // The worker-copy button was still present in the "More actions"
  // disclosure, but users looking for "download without prices"
  // reasonably expect it in the primary Download PDF split-button menu
  // next to PDF / Word / Print. The fix adds the same action to the
  // Download menu without removing the More-actions duplicate.
  test('worker-copy item is also present in the primary Download PDF menu (admin-only)', () => {
    // Anchor on the Download PDF split-button's `items={[ ... ]}` prop
    // (adjacent to mainLabel="Download PDF"). The worker-copy item is
    // conditionally spread via `...(isAdminPlan ? [{...}] : [])` so
    // basic users don't see it.
    const idx = quoteOutputSrc.indexOf('mainLabel="Download PDF"');
    expect(idx).toBeGreaterThan(-1);
    // Grab the next ~1200 chars — that's the items array for the
    // Download menu.
    const block = quoteOutputSrc.slice(idx, idx + 1400);
    // Admin-only conditional spread present.
    expect(block).toMatch(/\.\.\.\(isAdminPlan \?/);
    // The worker-copy item's identity is stable.
    expect(block).toMatch(/id:\s*['"]worker-copy['"]/);
    // Label the user actually reads.
    expect(block).toMatch(/label:\s*['"]Worker copy \(PDF\)['"]/);
    // Wire to the same handler as the More-actions button.
    expect(block).toMatch(/handleDownloadPdfServer\(\{\s*hideCosts:\s*true\s*\}\)/);
  });

  test('the More-actions duplicate stays (belt-and-braces discoverability)', () => {
    // Removing the More-actions button would break the muscle memory
    // Mark has already built. Both entry points coexist by design.
    const menuIdx = quoteOutputSrc.indexOf("id: 'worker-copy'");
    const moreIdx = quoteOutputSrc.indexOf('Download worker copy');
    expect(menuIdx).toBeGreaterThan(-1);
    expect(moreIdx).toBeGreaterThan(-1);
    // Different positions in the file — one in the Download menu
    // items array, one in the More-actions disclosure.
    expect(Math.abs(menuIdx - moreIdx)).toBeGreaterThan(500);
  });
});

describe('Architecture — no server change required', () => {
  test('no new /api/billing or /api/worker route added — pipeline unchanged', () => {
    // The redaction is purely client-side serialisation. The server's
    // /api/.../pdf route just receives HTML and renders. If a future
    // change starts requiring a new server route the architecture
    // assumption needs revisiting.
    const serverJs = readFileSync(join(repoRoot, 'server.js'), 'utf8');
    expect(serverJs).not.toMatch(/\/api\/[^']*\/worker-copy/);
    expect(serverJs).not.toMatch(/\/api\/[^']*\/redacted/);
  });
});
