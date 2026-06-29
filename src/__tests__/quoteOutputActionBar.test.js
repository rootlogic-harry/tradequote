/**
 * QuoteOutput action region — Quote Screen Send-to-client rewire
 * (2026-06-29 follow-up to PR #85, see docs/EMAIL_FLAG.md).
 *
 * The "Send to client" primary button is now a STATUS action
 * (advances draft → sent via the existing /status route). The caret
 * menu carries Copy link + contextual status-change items + the
 * Email / Outlook items behind the EMAIL_INTEGRATION_ENABLED flag.
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

  test('the primary SplitButton uses the primary variant and the "Send to client" / "Sent to client" label', () => {
    // The primary button's label is state-dependent: "Send to client"
    // when draft, "Sent to client" when already advanced.
    expect(quoteOutputSrc).toMatch(/<SplitButton[\s\S]{0,400}variant="primary"/);
    expect(quoteOutputSrc).toMatch(/sentLocked\s*\?\s*['"]Sent to client['"][^:]*:\s*['"]Send to client['"]/);
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
    expect(quoteOutputSrc).toMatch(/qo-edit-link[\s\S]{0,300}BACK_TO_REVIEW/);
  });
});

describe('QuoteOutput — "Send to client" is now a STATUS action', () => {
  test('handleSendToClient calls updateJobStatus with target="sent"', () => {
    expect(quoteOutputSrc).toMatch(
      /const handleSendToClient = async[\s\S]{0,800}updateJobStatus\(\s*state\.currentUserId\s*,\s*jobId\s*,\s*['"]sent['"]/
    );
  });

  test('handleSendToClient uses calculateExpiresAt to set the 30-day expiry', () => {
    // Mirror parity with the dashboard's Send button (App.jsx
    // handleStatusConfirm path).
    expect(quoteOutputSrc).toMatch(/calculateExpiresAt\(sentAtIso\)/);
  });

  test('updateJobStatus + calculateExpiresAt are imported (no new helpers introduced)', () => {
    expect(quoteOutputSrc).toMatch(
      /import\s*\{[^}]*\bupdateJobStatus\b[^}]*\}\s*from\s*['"]\.\.\/\.\.\/utils\/userDB(\.js)?['"]/
    );
    expect(quoteOutputSrc).toMatch(
      /import\s*\{\s*calculateExpiresAt\s*\}\s*from\s*['"]\.\.\/\.\.\/utils\/quoteBuilder(\.js)?['"]/
    );
  });

  test('the primary SplitButton wires its onMain to handleSendToClient', () => {
    expect(quoteOutputSrc).toMatch(
      /<SplitButton[\s\S]{0,500}variant="primary"[\s\S]{0,500}onMain=\{handleSendToClient\}/
    );
  });

  test('success dispatches JOBS_UPDATED so the dashboard reflects the new status', () => {
    expect(quoteOutputSrc).toMatch(
      /handleSendToClient[\s\S]{0,1200}dispatch\(\{[\s\S]{0,200}type:\s*['"]JOBS_UPDATED['"]/
    );
  });

  test('success fires a toast confirming the quote was marked as sent', () => {
    expect(quoteOutputSrc).toMatch(/['"]Quote marked as sent['"]/);
  });

  test('failure fires the canonical "Failed to update status" fallback toast', () => {
    expect(quoteOutputSrc).toMatch(/['"]Failed to update status['"]/);
  });
});

describe('QuoteOutput — primary button locks into green "Sent to client" state', () => {
  test('sentLocked is true for any status other than draft', () => {
    expect(quoteOutputSrc).toMatch(/const sentLocked = effectiveStatus !== ['"]draft['"]/);
  });

  test('button icon swaps from paper-plane to checkmark when locked', () => {
    expect(quoteOutputSrc).toMatch(
      /mainIcon=\{sentLocked\s*\?\s*['"]check['"][^:]*:\s*['"]send['"]\}/
    );
  });

  test('mainConfirmed prop is passed so the SplitButton renders the green variant', () => {
    expect(quoteOutputSrc).toMatch(/mainConfirmed=\{sentLocked\}/);
  });

  test('SplitButton main button becomes non-actionable when mainConfirmed is true', () => {
    // Confirmed-state main button uses no onClick handler so a stray
    // tap can't re-fire the status flip.
    expect(quoteOutputSrc).toMatch(/onClick=\{mainConfirmed \? undefined : onMain\}/);
    expect(quoteOutputSrc).toMatch(/aria-disabled=\{mainConfirmed \? ['"]true['"] : undefined\}/);
  });

  test('SplitButton reuses --tq-confirmed-* tokens (no new colour variable)', () => {
    // Pin the styling-by-token contract.
    const styleBlock = readFileSync(join(repoRoot, 'index.html'), 'utf8');
    expect(styleBlock).toMatch(/\.qo-split-main--confirmed/);
    expect(styleBlock).toMatch(/--tq-confirmed-(bd|bg|txt)/);
  });
});

describe('QuoteOutput — caret menu is built contextually per status', () => {
  test('buildSendMenuItems exists and is computed per render', () => {
    expect(quoteOutputSrc).toMatch(/const buildSendMenuItems = \(\) =>/);
    expect(quoteOutputSrc).toMatch(/const sendMenuItems = buildSendMenuItems\(\)/);
  });

  test('Copy client link is in every menu (canonical share action)', () => {
    expect(quoteOutputSrc).toMatch(/label:\s*['"]Copy client link['"][\s\S]{0,200}onClick:\s*handleCopyClientLink/);
  });

  test('Mark declined item exists for the draft + sent statuses', () => {
    expect(quoteOutputSrc).toMatch(/label:\s*['"]Mark declined['"]/);
    expect(quoteOutputSrc).toMatch(/openStatusModal\(['"]declined['"]\)/);
  });

  test('Mark accepted item exists for the sent status', () => {
    expect(quoteOutputSrc).toMatch(/label:\s*['"]Mark accepted['"]/);
    expect(quoteOutputSrc).toMatch(/openStatusModal\(['"]accepted['"]\)/);
  });

  test('Mark complete item exists for the accepted status', () => {
    expect(quoteOutputSrc).toMatch(/label:\s*['"]Mark complete['"]/);
    expect(quoteOutputSrc).toMatch(/openStatusModal\(['"]completed['"]\)/);
  });

  test('Re-open item exists for the declined status and targets draft', () => {
    expect(quoteOutputSrc).toMatch(/label:\s*['"]Re-open['"]/);
    expect(quoteOutputSrc).toMatch(/openStatusModal\(['"]draft['"]\)/);
  });

  test('openStatusModal dispatches OPEN_STATUS_MODAL — reuses the App-level modal', () => {
    expect(quoteOutputSrc).toMatch(
      /const openStatusModal = \(targetStatus\) =>[\s\S]{0,300}OPEN_STATUS_MODAL/
    );
  });

  test('Email + Outlook items are flag-gated', () => {
    // Read the source: the items are inside an
    // `if (emailIntegrationEnabled)` block, which keeps them hidden
    // when the flag is off (production default).
    expect(quoteOutputSrc).toMatch(
      /if \(emailIntegrationEnabled\)[\s\S]{0,800}label:\s*['"]Send via Email['"][\s\S]{0,800}label:\s*['"]Send via Outlook['"]/
    );
  });

  test('caret is hidden when the items array is empty (terminal status, flag off)', () => {
    expect(quoteOutputSrc).toMatch(/hasItems\s*=\s*Array\.isArray\(items\)\s*&&\s*items\.length\s*>\s*0/);
    // Both the caret render block and the menu render block check hasItems.
    expect(quoteOutputSrc).toMatch(/\{hasItems && \(\s*<button/);
    expect(quoteOutputSrc).toMatch(/\{open && hasItems &&/);
  });

  test('a divider separates the share group from the status-change group', () => {
    expect(quoteOutputSrc).toMatch(/divider:\s*true/);
    // The divider renders as a non-button row in the menu.
    expect(quoteOutputSrc).toMatch(/it\.divider[\s\S]{0,200}qo-split-menu-div/);
  });
});

describe('QuoteOutput — feature-flag prop wiring', () => {
  test('component accepts an emailIntegrationEnabled prop with a safe default', () => {
    expect(quoteOutputSrc).toMatch(/emailIntegrationEnabled\s*=\s*false/);
  });
});

describe('QuoteOutput — status banner is state-dependent', () => {
  test('renders a <div role="status"> banner', () => {
    expect(quoteOutputSrc).toMatch(/className=\{?`?qo-status\b[\s\S]{0,200}role="status"|role="status"[\s\S]{0,200}qo-status/);
  });

  test('drives status kind from clientStatus (draft / sent / viewed / accepted / declined)', () => {
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
    expect(quoteOutputSrc).toMatch(/await buildEmlMessage\(/);
  });
});

describe('QuoteOutput — touch targets (44px minimum)', () => {
  test('every <SplitButton> is rendered with the canonical 44px-safe primitives', () => {
    // The mainClass + caret render sites are further apart now that
    // the SplitButton supports the confirmed-locked variant + hides
    // its caret on empty items. The window was widened to 1500 chars
    // to absorb the added branching without losing the lint intent.
    expect(quoteOutputSrc).toMatch(/qo-split-main[\s\S]{0,1500}minHeight:\s*44/);
    expect(quoteOutputSrc).toMatch(/qo-split-caret[\s\S]{0,1500}minHeight:\s*44/);
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
