/**
 * Tailwind config for the PDF-only compile step (see scripts/build-pdf-css.js).
 *
 * This config exists ONLY for the static CSS bundle the server-side
 * Puppeteer renderer (`pdfRenderer.js`) reads at boot. It is NOT used
 * by the in-app React SPA — that one keeps loading Tailwind via the
 * CDN runtime in `index.html` because the browser has JS enabled.
 *
 * Why the PDF can't share the CDN approach:
 *   pdfRenderer.js intentionally runs Puppeteer with
 *   `setJavaScriptEnabled(false)` as a defence-in-depth layer of the
 *   SSRF / XSS protections. The Tailwind CDN is a JIT runtime — it
 *   needs JS to execute and scan the DOM. Without it, every utility
 *   class becomes a no-op and the cost-breakdown table / totals
 *   block collapse. Mark caught this in the wild (Pro Drive quote,
 *   June 2026): "the costs section coming out a bit clunky".
 *
 * The fix: compile a tiny static stylesheet ahead of time, scanning
 * QuoteDocument.jsx (and the components it imports) so every class
 * we actually use is in the bundle. Read it from disk at boot, same
 * pattern as `public/print.css`.
 *
 * The theme extension mirrors index.html's inline `tailwind.config`
 * so any `tq-*` color or `fq:` breakpoint used in JSX resolves.
 */
module.exports = {
  // Scan the JSX files whose classes might end up in the rendered
  // QuoteDocument HTML. This is a conservative superset — QuoteDocument
  // itself plus a few siblings that might be referenced by changes
  // downstream.
  content: [
    './src/components/QuoteDocument.jsx',
    './src/components/review/*.jsx',
    './src/components/common/*.jsx',
  ],
  theme: {
    extend: {
      colors: {
        // Mirror index.html — the brand palette uses CSS custom
        // properties from index.html's :root. Inside the PDF those
        // custom properties aren't defined; using them would yield
        // unresolved var(--tq-…). QuoteDocument deliberately uses
        // vanilla Tailwind palette colors (text-gray-700, etc.) so
        // we don't actually emit any tq-* classes — but keep these
        // here so a future change that does use one compiles cleanly.
        'tq-bg':          'var(--tq-bg, #f5f1eb)',
        'tq-surface':     'var(--tq-surface, #ede8de)',
        'tq-card':        'var(--tq-card, #ffffff)',
        'tq-border':      'var(--tq-border, #d4cfc4)',
        'tq-text':        'var(--tq-text, #1a1714)',
        'tq-muted':       'var(--tq-muted, #7a6f5e)',
        'tq-accent':      'var(--tq-accent, #d97706)',
      },
      borderWidth: {
        '1.5': '1.5px',
      },
      fontFamily: {
        heading: ['"Barlow Condensed"', 'sans-serif'],
        body:    ['"Inter"', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      screens: {
        // The fq: breakpoint mirrors the SPA. Some quote-document
        // classes use it (e.g. fq:px-10, fq:py-8) — the PDF render
        // doesn't have media queries so they collapse to no-op, but
        // having them defined avoids JIT compile errors.
        fq: '900px',
      },
    },
  },
  corePlugins: {
    // Preflight resets all browser defaults. The PDF already gets
    // these via print.css; leaving Tailwind's preflight ON would
    // double-apply and could subtly conflict. Off.
    preflight: false,
  },
};
