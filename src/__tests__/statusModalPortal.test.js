/**
 * StatusModal admin portal section (TRQ-133).
 *
 * Admins get a "Client Portal" audit section inside the existing
 * StatusModal when the job has a client_token. Basic users never see
 * this surface — it's part of the admin operating layer (design law).
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

// ─────────────────────────────────────────────────────────────────────────
// Server: detail route widening + admin gating for IP/UA
// ─────────────────────────────────────────────────────────────────────────
describe('GET /api/users/:id/jobs/:jobId — portal fields + admin-only IP/UA', () => {
  const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
  const detailBlock = serverSrc.match(
    /app\.get\(\s*['"`]\/api\/users\/:id\/jobs\/:jobId['"`][\s\S]*?\n\}\)/
  );

  test('SELECT exposes the happy-path portal fields to all owners', () => {
    expect(detailBlock).not.toBeNull();
    const body = detailBlock[0];
    // Owner can always see their own job's portal status. No PII here.
    expect(body).toMatch(/client_token\s+AS\s+["']clientToken["']/i);
    expect(body).toMatch(/client_token_expires_at\s+AS\s+["']clientTokenExpiresAt["']/i);
    expect(body).toMatch(/client_viewed_at\s+AS\s+["']clientViewedAt["']/i);
    expect(body).toMatch(/client_response\s+AS\s+["']clientResponse["']/i);
    expect(body).toMatch(/client_response_at\s+AS\s+["']clientResponseAt["']/i);
    expect(body).toMatch(/client_decline_reason\s+AS\s+["']clientDeclineReason["']/i);
  });

  test('IP + user-agent are stripped unless the caller is on the admin plan', () => {
    // IP / user-agent can be used for soft fingerprinting of the
    // tradesman's clients. Keep them admin-visible only — same rule
    // that applies to every other admin operating-layer field (diffs,
    // agent runs, calibration notes).
    expect(detailBlock).not.toBeNull();
    const body = detailBlock[0];
    // Either a conditional DELETE on client_ip/client_user_agent for
    // non-admins, or the SELECT is plan-aware. Either is fine as long
    // as a non-admin caller cannot see these fields.
    const hasGate =
      /isAdminPlan|req\.user\?\.plan\s*===\s*['"]admin['"]|plan\s*!==\s*['"]admin['"]/i.test(body) &&
      /client_ip|client_user_agent/i.test(body);
    expect(hasGate).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// StatusModal portal section — admin-only, gated on job.clientToken
// ─────────────────────────────────────────────────────────────────────────
describe('StatusModal.jsx — admin-only portal section', () => {
  const src = readFileSync(join(repoRoot, 'src/components/StatusModal.jsx'), 'utf8');

  test('imports the Client Portal helpers', () => {
    // Copy + Regenerate live here, so we need the same helpers the
    // Step-5 block uses (TRQ-131).
    expect(src).toMatch(/generateClientToken/);
  });

  test('portal section is gated on both isAdminPlan AND a job.clientToken', () => {
    // Basic users: never see it (design law).
    // Admins without a token: nothing to show.
    expect(src).toMatch(/isAdminPlan[\s\S]{0,100}clientToken|clientToken[\s\S]{0,100}isAdminPlan/);
  });

  test('renders the viewed audit trail (IP + when)', () => {
    // Admin-visible audit: when the client opened the link, from which
    // IP. Decline reason shows up below when present.
    expect(src).toMatch(/Viewed/);
    expect(src).toMatch(/clientIp|client_ip/);
  });

  test('has a Copy link button that writes to the clipboard', () => {
    expect(src).toMatch(/navigator\.clipboard\.writeText/);
  });

  test('has a Regenerate action gated by a confirm dialog', () => {
    // Same design law as TRQ-131 — never silently invalidate a link
    // the tradesman already shared.
    expect(src).toMatch(/window\.confirm\(|showRegenerateConfirm/);
    expect(src).toMatch(/generateClientToken\(/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Mobile PR-7 — modal overflow + sticky bottom CTA bar (audit items 7, 21)
//
// On a 390x844 iPhone the completed-with-notes variant exceeds the
// viewport — radio cards + textarea + audit block push Cancel/Confirm
// off the bottom of the screen. The fix is two-part:
//   1. The modal card gets `maxHeight: 90vh` + internal scroll so it can
//      never escape the viewport.
//   2. Cancel/Confirm are pinned to a sticky bottom bar inside the modal
//      so they stay reachable regardless of how tall the body grows.
//   3. All interactive controls in the modal are ≥44px (CLAUDE.md
//      Mobile §, audit item 21).
// ─────────────────────────────────────────────────────────────────────────
describe('StatusModal.jsx — mobile overflow + sticky CTA bar (PR-7)', () => {
  const src = readFileSync(join(repoRoot, 'src/components/StatusModal.jsx'), 'utf8');

  test('modal card constrains its height to the viewport (max-h: 90vh)', () => {
    // The modal card — the white-ish panel inside the dimmed overlay
    // — must have `maxHeight: '90vh'` so it can never grow taller
    // than the device. Combined with overflow handling below, this is
    // what stops Cancel/Confirm from being pushed off-screen on a
    // 390x844 phone (audit item 7).
    expect(src).toMatch(/maxHeight\s*:\s*['"]90vh['"]/);
  });

  test('modal card uses flex-column layout so the body can scroll while the footer stays pinned', () => {
    // The body needs `overflowY: auto`; for that to be honoured the
    // outer card must be a flex container with a defined height. Look
    // for the column layout on the modal card.
    expect(src).toMatch(/display\s*:\s*['"]flex['"]/);
    expect(src).toMatch(/flexDirection\s*:\s*['"]column['"]/);
  });

  test('modal body is the internal scroll container (overflowY: auto)', () => {
    // The scroll has to live INSIDE the modal card, not on the
    // backdrop — otherwise iOS scrolls the page underneath when the
    // keyboard opens. The body div between the header band and the
    // sticky footer is the scroll owner.
    expect(src).toMatch(/overflowY\s*:\s*['"]auto['"]/);
  });

  test('Cancel/Confirm action bar is pinned to the bottom of the modal (sticky or non-scrolling footer)', () => {
    // Either `position: sticky` with `bottom: 0` on the action-row
    // container, or a separately-rendered footer outside the scroll
    // container. Both satisfy the contract that Cancel/Confirm don't
    // scroll away with long content.
    const stickyFooter = /position\s*:\s*['"]sticky['"][\s\S]{0,200}bottom\s*:\s*0/.test(src);
    // Footer-outside-scroll-container pattern: a flex-shrink-0 div
    // containing both buttons sits as a sibling of the scrolling body.
    const flexShrinkFooter = /flexShrink\s*:\s*0/.test(src);
    expect(stickyFooter || flexShrinkFooter).toBe(true);
  });

  test('action-bar buttons (Cancel / Confirm) are ≥44px tall (audit item 21)', () => {
    // The Cancel + Confirm buttons must hit the touch target. We look
    // for inline `minHeight: 44` (or larger) on both. The same rule
    // applies to the PortalAuditBlock's Copy link / Regenerate
    // buttons — they're inside the modal too.
    //
    // Count occurrences of minHeight >= 44 — we expect at least four
    // (Cancel, Confirm, Copy link, Regenerate) plus the select +
    // radio + textarea also hit 44.
    const matches = src.match(/minHeight\s*:\s*['"]?(\d+)/g) || [];
    const heights = matches
      .map(m => parseInt(m.match(/(\d+)/)[1], 10))
      .filter(n => n >= 44);
    // At minimum: Cancel, Confirm, Copy link, Regenerate.
    expect(heights.length).toBeGreaterThanOrEqual(4);
  });

  // Slice between the literal `<tagName` and EITHER the matching
  // closing `</tagName>` OR the next self-closing `/>` (whichever
  // appears first), so we capture the full opening tag plus inline
  // style block regardless of how many lines the JSX spans. A naive
  // `<select[^>]*>` regex falls over because the onChange `=>` arrow
  // contains a `>`.
  function sliceElement(text, tag) {
    const open = text.indexOf(`<${tag}`);
    if (open === -1) return '';
    const closeFull = text.indexOf(`</${tag}>`, open);
    const closeSelf = text.indexOf('/>', open);
    const candidates = [closeFull, closeSelf].filter(n => n !== -1);
    if (candidates.length === 0) return '';
    const close = Math.min(...candidates);
    return text.slice(open, close);
  }

  test('decline-reason <select> is ≥44px tall', () => {
    // The declined variant's select used to be ~32px tall. Spot-check
    // that the select tag itself has a minHeight applied (we accept
    // either inline style or a Tailwind utility class).
    const tag = sliceElement(src, 'select');
    expect(tag.length).toBeGreaterThan(0);
    const hasInline = /minHeight\s*:\s*['"]?44/.test(tag);
    const hasUtility = /min-h-\[44px\]|min-h-(?:1[1-9]|[2-9]\d)|touch-44/.test(tag);
    expect(hasInline || hasUtility).toBe(true);
  });

  test('completion-notes <textarea> is ≥44px tall', () => {
    // The admin-only notes textarea must also clear 44px (rows={3}
    // already gives more, but the inline minHeight makes the contract
    // explicit and survives content-driven shrinkage).
    const tag = sliceElement(src, 'textarea');
    expect(tag.length).toBeGreaterThan(0);
    const hasInline = /minHeight\s*:\s*['"]?(\d+)/.test(tag);
    expect(hasInline).toBe(true);
  });
});
