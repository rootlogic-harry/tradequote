# Pro Drive 221 High Greave — PDF regression fixture

Seed fixture for the PDF-output regression suite established by TRQ-178.
Captures Mark Doyle Walling's real-customer Pro Drive quote from June
2026 — the one that exposed structural blank-space and footer-duplication
bugs in the server-side PDF renderer.

## Files

| File | Status | Purpose |
|---|---|---|
| `input.json` | committed | Sanitised reconstruction of Mark's quote. Every PII field is `[redacted-*]` per `scripts/sanitise-prod-dump.js` conventions. The shape (6 measurements, 7 schedule items, 4 portrait photos) matches the real quote so the page-break behaviour is exercised faithfully. |
| `after-fix.pdf` | committed | Post-fix render of the sanitised `input.json` through the live PDF pipeline. The 6-page baseline that the regression test asserts against. Re-generate with `node renderFixture.js` after any change to `QuoteDocument.jsx`, `print.css`, or `quotePageChrome.js`. |
| `renderFixture.js` | committed | The render harness. Loads `input.json`, hydrates placeholder photos, runs the same composition `pdfRenderer.js` uses, and writes `after-fix.pdf`. Picks the local Chrome on macOS; falls back to `@sparticuz/chromium`'s bundled binary on Linux/CI. |
| `private/before-fix.pdf` | **gitignored** | Mark's actual buggy PDF (9 pages, includes his live contact details, customer name, and address). Kept locally for incident reference but never committed — there is no scenario in which his customer's PII belongs in a public repo. |
| `private/` | gitignored | General catch-all for any other PII-bearing artefacts (live photos, raw `quote_snapshot` exports, etc.) related to this fixture. |

## Why both before- and after- PDFs?

`before-fix.pdf` is the bug evidence — the document Mark received that
prompted the ticket. Reviewing it is the fastest way to understand the
failure modes (per-page header strip duplicating the hero, sections
bumping to leave 70% blank bands, 5th photo stranded on its own page).
We keep it locally because that evidence is load-bearing during code
review and incident retros, but the file itself contains live customer
PII so it cannot be committed.

`after-fix.pdf` is the baseline the test asserts against. It uses the
**sanitised** `input.json`, so committing it is safe — the only "real"
thing it shows is the layout, which is the whole point.

## Asserting against the fixture

`src/__tests__/proDrivePdfRegression.test.js` reads `after-fix.pdf`
directly and asserts:

- Total page count is `≤ 6` (was 9 pre-fix).
- The repeating footer carries the address + VAT line only — no date
  pattern, no UK mobile number, no email anywhere in the chrome.
- No more than ~one-third of pages may be sparse (catches a regression
  where a section bumps mid-quote and leaves 70% empty space).

The test parses the PDF with minimal regex tooling (no `pdf-parse`
dep) so it runs fast and doesn't need Chromium on CI. Chromium is
only spawned when re-baselining via `renderFixture.js`.

## Re-baselining workflow

After any intentional change to PDF rendering rules:

```bash
# 1. Build the inlined Tailwind CSS (renderer reads from public/)
npm run build:pdf-css

# 2. Render the fixture
node regression/pdf-fixtures/pro-drive-221-high-greave/renderFixture.js

# 3. Eyeball after-fix.pdf — does it look like a quote a tradesman
#    would send a customer? Page count sensible? No new blank bands?

# 4. Run the test suite
npm test -- --testPathPattern=proDrivePdfRegression

# 5. If you bumped MAX_PAGE_COUNT or relaxed the blank-page ratio,
#    note WHY in the commit message — those bounds are tight on
#    purpose.
```

## Convention for future PDF fixtures

This directory is the seed for a parallel PDF-output suite under
`regression/pdf-fixtures/<fixture-id>/`. The AI-accuracy fixtures
under `regression/fixtures/` are unrelated (different concern —
they test analysis output, not rendering).

When adding a new PDF fixture:

1. Create `regression/pdf-fixtures/<descriptive-id>/`.
2. Add `input.json` — sanitised quote-state JSON. Use the
   `[redacted-*]` markers from `scripts/sanitise-prod-dump.js`.
3. Add `renderFixture.js` — same shape as the one in this directory,
   loading `input.json` through the live render path.
4. Run the renderer, commit the resulting `after-fix.pdf`.
5. If the original PDF that prompted the fixture contains live PII,
   keep it in `private/` (which is gitignored at the suite root).
6. Add a `README.md` in the fixture directory explaining what the
   fixture captures and what bug class it guards against.
7. Add a test under `src/__tests__/` following the
   `proDrivePdfRegression.test.js` pattern — load the committed
   `after-fix.pdf` and assert layout invariants.
