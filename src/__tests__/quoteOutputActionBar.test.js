/**
 * QuoteOutput action-bar restructure — Mobile PR-2 of 10.
 *
 * Closes audit item 2 in /tmp/mobile-responsive-plan.md (the 12-button
 * wall on a 390px viewport).
 *
 * Harry's UX call (approved 2026-06-26 Q1): regroup the Step 5 action
 * bar into three logical clusters — Download, Send, More — with a
 * disclosure for the More cluster so the visible mobile surface is just
 * three primary chip-buttons instead of 12.
 *
 * These are SOURCE-LEVEL guards (read the .jsx as text, assert on
 * structure) — the same pattern used by workerCopyPdf.test.js and
 * photoLayoutWiring.test.js. No React renderer needed, runs in plain
 * Jest, fast.
 *
 * The mapping is locked: any rearrangement of which button lives in
 * which group must update Harry first.
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

describe('QuoteOutput action bar — three groups exist', () => {
  test('Download group is declared with a labelled wrapper', () => {
    // The wrapper must be discoverable by markup so screen readers and
    // tests can both find it. data-action-group is the contract.
    expect(quoteOutputSrc).toMatch(/data-action-group="download"/);
  });

  test('Send group is declared with a labelled wrapper', () => {
    expect(quoteOutputSrc).toMatch(/data-action-group="send"/);
  });

  test('More group is declared with a labelled wrapper', () => {
    expect(quoteOutputSrc).toMatch(/data-action-group="more"/);
  });

  test('all three groups carry an aria-label so screen readers can announce them', () => {
    for (const label of ['Download', 'Send', 'More']) {
      // Pattern: aria-label="Download" anywhere in the file.
      const re = new RegExp(`aria-label=["']${label}["']`);
      expect(quoteOutputSrc).toMatch(re);
    }
  });
});

describe('QuoteOutput action bar — Download group contents', () => {
  // Download owns the file-export actions per Harry's Q1 mapping:
  //   - Download PDF (server Puppeteer path)
  //   - Download Word (DOCX)
  //   - Save via print (window.print fallback)
  const downloadBlock = extractGroupBlock(quoteOutputSrc, 'download');

  test('Download PDF lives in the Download group', () => {
    expect(downloadBlock).toMatch(/handleDownloadPdfServer/);
    expect(downloadBlock).toMatch(/Download PDF|Generating PDF/);
  });

  test('Download Word lives in the Download group', () => {
    expect(downloadBlock).toMatch(/handleDownloadDocx/);
    expect(downloadBlock).toMatch(/Download Word|Generating Word/);
  });

  test('Save via print lives in the Download group', () => {
    expect(downloadBlock).toMatch(/handlePrint/);
    expect(downloadBlock).toMatch(/Save via print|Preparing preview/);
  });
});

describe('QuoteOutput action bar — Send group contents', () => {
  // Send owns the client-facing transmission actions:
  //   - Send via Email (mailto)
  //   - Send via Outlook (.eml — DO NOT modify buildEmlMessage.js)
  const sendBlock = extractGroupBlock(quoteOutputSrc, 'send');

  test('Send via Email lives in the Send group', () => {
    expect(sendBlock).toMatch(/handleEmail/);
    expect(sendBlock).toMatch(/Send via Email/);
  });

  test('Send via Outlook lives in the Send group', () => {
    expect(sendBlock).toMatch(/handleSendViaOutlook/);
    expect(sendBlock).toMatch(/Send via Outlook|Preparing email|Tap again/);
  });
});

describe('QuoteOutput action bar — More group contents (admin gated)', () => {
  // More owns the admin / occasional / non-primary actions:
  //   - Worker copy (admin)
  //   - Export for QuickBooks (admin)
  //   - Create RAMS (admin)
  //   - Save quote
  const moreBlock = extractGroupBlock(quoteOutputSrc, 'more');

  test('Worker copy lives in the More group, gated by isAdminPlan', () => {
    expect(moreBlock).toMatch(/Download worker copy/);
    // The button must be inside an isAdminPlan guard so basic users
    // never see it. The guard pattern in this codebase is `{isAdminPlan && (`.
    expect(moreBlock).toMatch(/isAdminPlan\s*&&[\s\S]*Download worker copy/);
  });

  test('Export for QuickBooks lives in the More group, gated by isAdminPlan', () => {
    expect(moreBlock).toMatch(/handleExportQuickbooks/);
    expect(moreBlock).toMatch(/Export for QuickBooks|Building CSV/);
    // QuickBooks is admin-only per Harry's grouping (admin-flavoured
    // integration). Guard must surround it.
    expect(moreBlock).toMatch(/isAdminPlan\s*&&[\s\S]*handleExportQuickbooks/);
  });

  test('Save quote lives in the More group', () => {
    expect(moreBlock).toMatch(/handleSave/);
    // Label can be "Save Quote" or "Save Estimate" depending on documentType.
    expect(moreBlock).toMatch(/Save \$\{term\.title\}|Saving\.\.\.|Saved/);
  });

  test('Create RAMS lives in the More group, gated by isAdminPlan', () => {
    expect(moreBlock).toMatch(/onCreateRams/);
    expect(moreBlock).toMatch(/Create RAMS/);
    expect(moreBlock).toMatch(/isAdminPlan\s*&&[\s\S]*Create RAMS/);
  });
});

describe('QuoteOutput action bar — More disclosure has correct ARIA', () => {
  test('More group renders a native <details> element', () => {
    // Native <details>/<summary> is the cheapest accessible disclosure.
    // No dropdown library, ESC-to-close + keyboard works for free.
    const moreBlock = extractGroupBlock(quoteOutputSrc, 'more');
    expect(moreBlock).toMatch(/<details/);
    expect(moreBlock).toMatch(/<summary/);
  });

  test('More disclosure summary text reads "More" to the user', () => {
    const moreBlock = extractGroupBlock(quoteOutputSrc, 'more');
    expect(moreBlock).toMatch(/<summary[\s\S]{0,200}More[\s\S]{0,200}<\/summary>/);
  });

  test('More group is collapsed by default on mobile (no `open` attribute hardcoded)', () => {
    const moreBlock = extractGroupBlock(quoteOutputSrc, 'more');
    // We don't want `open` set as a static attribute — the disclosure
    // must start collapsed so the mobile-fold is just 3 chips.
    // Allow `open={isDesktop}` style conditional, but not literal `open>`
    // or `open ` (with whitespace).
    expect(moreBlock).not.toMatch(/<details\s+open[\s>]/);
  });
});

describe('QuoteOutput action bar — touch targets (44px minimum)', () => {
  // CLAUDE.md Mobile section: 44px minimum touch target.
  // Our buttons use .btn-primary / .btn-ghost which are 48px tall in
  // index.html. Confirm the action-bar buttons stick to one of these
  // existing classes — no text-xs / px-1 rogue compact styles.
  test('Download group primary buttons use btn-primary or btn-ghost', () => {
    const downloadBlock = extractGroupBlock(quoteOutputSrc, 'download');
    // Each interactive button in the download group must carry a
    // touch-safe class. Grab every onClick={handle…} button and check.
    const buttons = downloadBlock.match(/<button[\s\S]*?<\/button>/g) || [];
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    for (const btn of buttons) {
      expect(btn).toMatch(/btn-primary|btn-ghost/);
    }
  });

  test('Send group buttons use btn-primary or btn-ghost', () => {
    const sendBlock = extractGroupBlock(quoteOutputSrc, 'send');
    const buttons = sendBlock.match(/<button[\s\S]*?<\/button>/g) || [];
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    for (const btn of buttons) {
      expect(btn).toMatch(/btn-primary|btn-ghost/);
    }
  });

  test('More group buttons use btn-primary or btn-ghost', () => {
    const moreBlock = extractGroupBlock(quoteOutputSrc, 'more');
    const buttons = moreBlock.match(/<button[\s\S]*?<\/button>/g) || [];
    // More group has at least the Save button (always-visible).
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    for (const btn of buttons) {
      expect(btn).toMatch(/btn-primary|btn-ghost/);
    }
  });
});

describe('QuoteOutput action bar — handlers wired through unchanged', () => {
  // The restructure must NOT break any existing handler wiring. These
  // assertions pin every original onClick → handler pair so a future
  // rename of the wrapper accidentally severing a handler is caught.
  test('handleDownloadPdfServer is still wired', () => {
    expect(quoteOutputSrc).toMatch(/onClick=\{handleDownloadPdfServer\}/);
  });

  test('handleDownloadDocx is still wired', () => {
    expect(quoteOutputSrc).toMatch(/onClick=\{handleDownloadDocx\}/);
  });

  test('handlePrint is still wired', () => {
    expect(quoteOutputSrc).toMatch(/onClick=\{handlePrint\}/);
  });

  test('handleEmail is still wired', () => {
    expect(quoteOutputSrc).toMatch(/onClick=\{handleEmail\}/);
  });

  test('handleSendViaOutlook is still wired', () => {
    expect(quoteOutputSrc).toMatch(/onClick=\{handleSendViaOutlook\}/);
  });

  test('handleExportQuickbooks is still wired', () => {
    expect(quoteOutputSrc).toMatch(/onClick=\{handleExportQuickbooks\}/);
  });

  test('handleSave is still wired', () => {
    expect(quoteOutputSrc).toMatch(/onClick=\{handleSave\}/);
  });

  test('worker-copy variant of handleDownloadPdfServer is still wired', () => {
    // Closed-arrow callback form so the hideCosts=true flag is preserved.
    expect(quoteOutputSrc).toMatch(
      /handleDownloadPdfServer\(\s*\{\s*hideCosts:\s*true\s*\}\s*\)/
    );
  });
});

describe('QuoteOutput action bar — buildEmlMessage import preserved', () => {
  // CLAUDE.md Pitfall #15: the .eml rules in buildEmlMessage.js are
  // load-bearing. The restructure must NOT change how the Outlook send
  // path reaches buildEmlMessage. Pin the import.
  test('buildEmlMessage import is unchanged', () => {
    expect(quoteOutputSrc).toMatch(
      /import\s*\{\s*buildEmlMessage\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/buildEmlMessage(\.js)?['"]/
    );
  });
});

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/**
 * Pull the JSX block that starts with `data-action-group="<name>"` and
 * ends when the bracket depth returns to zero. Each group is one
 * top-level wrapper so we can scope assertions to it.
 *
 * Lightweight balanced-bracket walk — no JSX parser needed. The action
 * bar markup is well-formed JSX so depth tracking on `(` and `)` lines
 * up cleanly with the React.createElement wrapping that JSX desugars to.
 */
function extractGroupBlock(src, groupName) {
  const marker = `data-action-group="${groupName}"`;
  const markerIdx = src.indexOf(marker);
  if (markerIdx < 0) {
    throw new Error(
      `data-action-group="${groupName}" not found in QuoteOutput.jsx — ` +
        'the action-bar restructure must declare it'
    );
  }
  // Walk backwards to find the opening `<` of the element carrying the
  // marker, then forwards until we hit the matching closing tag.
  let openIdx = markerIdx;
  while (openIdx > 0 && src[openIdx] !== '<') openIdx--;
  // Find the tag name (first run of letters after the <).
  const tagMatch = src.slice(openIdx + 1).match(/^([A-Za-z][A-Za-z0-9]*)/);
  if (!tagMatch) {
    throw new Error(`Could not find element tag for ${marker}`);
  }
  const tag = tagMatch[1];
  // Walk forwards, tracking depth of the same tag.
  let depth = 0;
  let i = openIdx;
  const openRe = new RegExp(`<${tag}(\\s|>|/>)`);
  const closeStr = `</${tag}>`;
  while (i < src.length) {
    const rest = src.slice(i);
    if (rest.startsWith(closeStr)) {
      depth--;
      if (depth === 0) {
        return src.slice(openIdx, i + closeStr.length);
      }
      i += closeStr.length;
      continue;
    }
    if (openRe.test(rest)) {
      const m = rest.match(openRe);
      if (m && m.index === 0) {
        depth++;
        i += `<${tag}`.length;
        continue;
      }
    }
    i++;
  }
  throw new Error(`Could not find closing tag for ${marker}`);
}
