/**
 * QuoteOutput action region — Quote Screen Redesign (2026-06-29).
 *
 * Replaces the PR #73 Download / Send / More 6-button grouping with:
 *   • 2 split-buttons: "Send to client" (primary) + "Download PDF" (secondary)
 *   • 1 tertiary text link: "Edit & re-generate"
 *   • A state-dependent status banner (draft/sent/viewed/accepted/declined)
 *   • A promoted hero client-link card (refactored ClientLinkBlock)
 *   • A slim "Full quote document" preview strip
 *
 * Spec: /tmp/fastquote-quote-handoff/design_handoff_dashboard/FastQuote Quote Screen Spec.md
 *
 * Source-level guards (read the .jsx as text, assert on structure) —
 * same pattern as workerCopyPdf.test.js and photoLayoutWiring.test.js.
 * No React renderer needed, runs in plain Jest, fast.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const quoteOutputSrc = readFileSync(
  join(repoRoot, 'src/components/steps/QuoteOutput.jsx'),
  'utf8'
);

describe('QuoteOutput — two split-buttons replace the PR #73 6-button layout', () => {
  test('the action region carries the data-action-group="primary" contract', () => {
    expect(quoteOutputSrc).toMatch(/data-action-group="primary"/);
  });

  test('the action region carries an aria-label so screen readers announce it', () => {
    expect(quoteOutputSrc).toMatch(/aria-label="Quote actions"/);
  });

  test('exactly two SplitButton components render in the action region', () => {
    const matches = quoteOutputSrc.match(/<SplitButton\b/g) || [];
    expect(matches.length).toBe(2);
  });

  test('the primary SplitButton is "Send to client" and uses the primary variant', () => {
    expect(quoteOutputSrc).toMatch(
      /<SplitButton[\s\S]{0,400}variant="primary"[\s\S]{0,400}mainLabel="Send to client"/
    );
  });

  test('the secondary SplitButton is "Download PDF" and uses the secondary variant', () => {
    expect(quoteOutputSrc).toMatch(
      /<SplitButton[\s\S]{0,400}variant="secondary"[\s\S]{0,400}mainLabel="Download PDF"/
    );
  });

  test('a tertiary "Edit & re-generate" ghost link exists in the action region', () => {
    expect(quoteOutputSrc).toMatch(/Edit &amp; re-generate|Edit & re-generate/);
    expect(quoteOutputSrc).toMatch(/qo-edit-link/);
  });

  test('the tertiary link dispatches BACK_TO_REVIEW (not a new reducer action)', () => {
    // Pin the existing reducer action so the redesign doesn't fork
    // navigation logic.
    expect(quoteOutputSrc).toMatch(/qo-edit-link[\s\S]{0,300}BACK_TO_REVIEW/);
  });
});

describe('QuoteOutput — primary SplitButton menu items wire to the right handlers', () => {
  // Email = handleEmail, Outlook = handleSendViaOutlook (load-bearing,
  // see CLAUDE.md Pitfall #15), Copy = handleCopyClientLink.

  test('Send-via-Email menu item is wired to handleEmail', () => {
    expect(quoteOutputSrc).toMatch(/label:\s*['"]Email['"][\s\S]{0,200}onClick:\s*handleEmail/);
  });

  test('Outlook menu item is wired to handleSendViaOutlook', () => {
    expect(quoteOutputSrc).toMatch(
      /label:\s*['"]Outlook['"][\s\S]{0,200}onClick:\s*handleSendViaOutlook/
    );
  });

  test('Copy-client-link menu item is wired to handleCopyClientLink', () => {
    expect(quoteOutputSrc).toMatch(
      /label:\s*['"]Copy client link['"][\s\S]{0,200}onClick:\s*handleCopyClientLink/
    );
  });
});

describe('QuoteOutput — secondary SplitButton menu items wire to the right handlers', () => {
  // PDF = handleDownloadPdfServer, Word = handleDownloadDocx, Print = handlePrint.

  test('PDF menu item is wired to handleDownloadPdfServer', () => {
    expect(quoteOutputSrc).toMatch(
      /label:\s*['"]PDF['"][\s\S]{0,200}onClick:[^,}]*handleDownloadPdfServer/
    );
  });

  test('Word menu item is wired to handleDownloadDocx', () => {
    expect(quoteOutputSrc).toMatch(
      /label:\s*['"]Word['"][\s\S]{0,200}onClick:\s*handleDownloadDocx/
    );
  });

  test('Print menu item is wired to handlePrint', () => {
    expect(quoteOutputSrc).toMatch(
      /label:\s*['"]Print[^'"]*['"][\s\S]{0,200}onClick:\s*handlePrint/
    );
  });
});

describe('QuoteOutput — status banner is state-dependent', () => {
  test('renders a <div role="status"> banner', () => {
    expect(quoteOutputSrc).toMatch(/className=\{?`?qo-status\b[\s\S]{0,200}role="status"|role="status"[\s\S]{0,200}qo-status/);
  });

  test('drives status kind from clientStatus (draft / sent / viewed / accepted / declined)', () => {
    // The `statusBannerKind` derivation must cover the five states.
    expect(quoteOutputSrc).toMatch(/statusBannerKind/);
    for (const kind of ['draft', 'sent', 'viewed', 'accepted', 'declined']) {
      expect(quoteOutputSrc).toMatch(new RegExp(`['"]${kind}['"]`));
    }
  });

  test('renders specific copy per state — Accepted, Sent · awaiting reply, Not sent yet', () => {
    expect(quoteOutputSrc).toMatch(/Accepted by the client/);
    expect(quoteOutputSrc).toMatch(/Sent · awaiting reply/);
    expect(quoteOutputSrc).toMatch(/Not sent yet/);
  });

  test('does NOT render the wide top-of-page quota bar (moved to the side rail)', () => {
    // Pitfall the spec calls out: NO duplicate quota chip. The
    // QuotaCounter top-strip and the wide upsell bar must not appear
    // here.
    expect(quoteOutputSrc).not.toMatch(/<QuotaCounter\b/);
  });
});

describe('QuoteOutput — header copy is locked to the redesign', () => {
  test('title reads "Your quote is ready" (app-chrome override of documentTerm)', () => {
    expect(quoteOutputSrc).toMatch(/Your quote is ready/);
  });

  test('subtitle reads "Send it straight to your client, or download a copy to keep."', () => {
    expect(quoteOutputSrc).toMatch(/Send it straight to your client, or download a copy to keep\./);
  });

  test('back link reads "Back to quote"', () => {
    expect(quoteOutputSrc).toMatch(/Back to quote/);
  });
});

describe('QuoteOutput — document strip + Preview button at the bottom', () => {
  test('a doc strip renders "Full quote document" and a Preview button', () => {
    expect(quoteOutputSrc).toMatch(/Full quote document/);
    expect(quoteOutputSrc).toMatch(/qo-doc-preview/);
  });

  test('Preview button toggles the QuoteDocument render', () => {
    // The preview overlay is gated on the local `previewOpen` state
    // — pin the toggle.
    expect(quoteOutputSrc).toMatch(/setPreviewOpen\(o\s*=>\s*!o\)/);
  });
});

describe('QuoteOutput — buildEmlMessage import is preserved (CLAUDE.md Pitfall #15)', () => {
  test('buildEmlMessage import is unchanged', () => {
    expect(quoteOutputSrc).toMatch(
      /import\s*\{\s*buildEmlMessage\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/buildEmlMessage(\.js)?['"]/
    );
  });

  test('handleSendViaOutlook is still wired through unchanged', () => {
    expect(quoteOutputSrc).toMatch(/handleSendViaOutlook/);
    // And the handler still calls buildEmlMessage.
    expect(quoteOutputSrc).toMatch(/await buildEmlMessage\(/);
  });
});

describe('QuoteOutput — touch targets (44px minimum)', () => {
  test('every <SplitButton> is rendered with the canonical 44px-safe primitives', () => {
    // SplitButton internally applies minHeight: 44 to both the main
    // and caret buttons. Pin the inline style so the Q8 lint will
    // never complain about the component.
    expect(quoteOutputSrc).toMatch(/qo-split-main[\s\S]{0,800}minHeight:\s*44/);
    expect(quoteOutputSrc).toMatch(/qo-split-caret[\s\S]{0,800}minHeight:\s*44/);
  });

  test('the tertiary "Edit & re-generate" link carries minHeight: 44', () => {
    expect(quoteOutputSrc).toMatch(/qo-edit-link[\s\S]{0,400}minHeight:\s*44/);
  });

  test('the doc-strip Preview button carries minHeight: 44', () => {
    expect(quoteOutputSrc).toMatch(/qo-doc-preview[\s\S]{0,400}minHeight:\s*44/);
  });
});

describe('QuoteOutput — hero client-link card placement', () => {
  test('ClientLinkBlock renders directly under the action region (above the doc strip)', () => {
    // The contract: client-link card lives between qo-actions and the
    // qo-doc-strip. Match in order with a tolerant window.
    const actionsIdx = quoteOutputSrc.indexOf('data-action-group="primary"');
    const linkIdx = quoteOutputSrc.indexOf('<ClientLinkBlock');
    const docIdx = quoteOutputSrc.indexOf('data-doc-strip');
    expect(actionsIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeGreaterThan(-1);
    expect(docIdx).toBeGreaterThan(-1);
    expect(linkIdx).toBeGreaterThan(actionsIdx);
    expect(docIdx).toBeGreaterThan(linkIdx);
  });
});
