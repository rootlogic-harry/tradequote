/**
 * HelpModal — in-app help/contact surface (Harry's launch checklist
 * 2026-06-30).
 *
 * Source-level guard for the new modal. Before this, confused users
 * hitting bugs mid-flow had no escape hatch — the footer email was on
 * the landing page only, and once past the auth gate, there was no
 * in-app help path. This modal mounts globally in App.jsx (gated on
 * `showHelp` state) and is reachable from:
 *   - Desktop: a small "Help" link in the side rail (Sidebar.jsx),
 *     below the rail-quota chip and above the avatar block.
 *   - Mobile: a "Need help?" link inside the existing Profile modal
 *     (mounted from App.jsx, opened by the BottomNav profile button).
 *
 * Both routes open the same HelpModal — single source of truth.
 *
 * The modal is intentionally NOT a contact form. It directs the user
 * to email (fastquote@harrydoyle.uk) and surfaces a tight micro-FAQ
 * for the four most-likely real questions.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modalSrc = readFileSync(
  join(__dirname, '../components/HelpModal.jsx'),
  'utf8',
);
const appSrc = readFileSync(join(__dirname, '../App.jsx'), 'utf8');
const sidebarSrc = readFileSync(
  join(__dirname, '../components/Sidebar.jsx'),
  'utf8',
);
const profileSrc = readFileSync(
  join(__dirname, '../components/steps/ProfileSetup.jsx'),
  'utf8',
);

describe('HelpModal component', () => {
  test('exports a default React component', () => {
    expect(modalSrc).toMatch(/export default function HelpModal/);
  });

  test('accepts open + onClose + showToast props', () => {
    // `open` gates the render (returns null when false) so the parent
    // can mount it unconditionally without flash-on-mount.
    expect(modalSrc).toMatch(/function HelpModal\(\{[^}]*open[^}]*\}\)/);
    expect(modalSrc).toMatch(/onClose/);
    // showToast is optional — used by the Copy email button.
    expect(modalSrc).toMatch(/showToast/);
  });

  test('renders null when not open (no flash on mount)', () => {
    expect(modalSrc).toMatch(/if \(!open\) return null/);
  });

  test('has dialog role + aria-modal + aria-labelledby for a11y', () => {
    expect(modalSrc).toMatch(/role="dialog"/);
    expect(modalSrc).toMatch(/aria-modal="true"/);
    expect(modalSrc).toMatch(/aria-labelledby=/);
  });

  test('header reads "Need a hand?"', () => {
    expect(modalSrc).toMatch(/Need a hand\?/);
  });

  test('sub-header sets expectations on reply window', () => {
    expect(modalSrc).toMatch(/small team/);
    expect(modalSrc).toMatch(/few hours/);
  });

  test('email section surfaces the working inbox with a mailto: link', () => {
    expect(modalSrc).toMatch(/fastquote@harrydoyle\.uk/);
    expect(modalSrc).toMatch(/mailto:fastquote@harrydoyle\.uk/);
  });

  test('Copy email button copies to clipboard and toasts', () => {
    expect(modalSrc).toMatch(/navigator\.clipboard\.writeText\(['"]fastquote@harrydoyle\.uk['"]\)/);
    expect(modalSrc).toMatch(/Copy email/);
    // showToast invocation on the success path (matches StatusModal
    // and ClientLinkBlock patterns).
    expect(modalSrc).toMatch(/showToast/);
  });

  test('"What to include" bullet list covers screenshot, intent, email', () => {
    expect(modalSrc).toMatch(/screenshot/i);
    expect(modalSrc).toMatch(/trying to do/i);
    expect(modalSrc).toMatch(/email address/i);
  });

  test('Quick answers section uses <details> accordion with 4 items', () => {
    const detailsMatches = modalSrc.match(/<details/g) || [];
    expect(detailsMatches.length).toBe(4);
    const summaryMatches = modalSrc.match(/<summary/g) || [];
    expect(summaryMatches.length).toBe(4);
  });

  test('FAQ covers the four canonical questions', () => {
    // Stuck on AI Analysis (UI label the user has actually seen — fine
    // inside the FAQ even though "AI" is banned elsewhere).
    expect(modalSrc).toMatch(/stuck on AI Analysis/i);
    // Change logo / day rate.
    expect(modalSrc).toMatch(/logo/i);
    expect(modalSrc).toMatch(/day rate/i);
    // Bought 5 quotes but counter still says exhausted.
    expect(modalSrc).toMatch(/bought 5 quotes/i);
    // Download a copy of my data.
    expect(modalSrc).toMatch(/download a copy of my data/i);
  });

  test('footer has a single Close button — no Send (not a contact form)', () => {
    expect(modalSrc).toMatch(/Close/);
    // No "send" verbs that imply a contact form submission.
    expect(modalSrc).not.toMatch(/<button[^>]*>\s*Send/);
    // No textarea for a message — email is the channel.
    expect(modalSrc).not.toMatch(/<textarea/);
  });

  test('closes on overlay click + ESC + close button', () => {
    // Overlay click handler.
    expect(modalSrc).toMatch(/onClick=\{onClose\}/);
    // ESC handler — keydown listener on the document or dialog.
    expect(modalSrc).toMatch(/Escape/);
    // stopPropagation on the inner card so overlay clicks don't fire
    // when the user clicks inside the modal.
    expect(modalSrc).toMatch(/stopPropagation/);
  });

  test('modal card uses max-h: 90vh + scrolling body + sticky footer', () => {
    expect(modalSrc).toMatch(/maxHeight:\s*['"]90vh['"]/);
    expect(modalSrc).toMatch(/overflowY:\s*['"]auto['"]/);
    expect(modalSrc).toMatch(/position:\s*['"]sticky['"]/);
  });

  test('all interactive elements meet the 44px touch target rule', () => {
    const inlineMatches = modalSrc.match(/minHeight:\s*\d+/g) || [];
    // At minimum: Copy email button + Close button.
    expect(inlineMatches.length).toBeGreaterThanOrEqual(2);
    for (const m of inlineMatches) {
      const n = parseInt(m.replace(/minHeight:\s*/, ''), 10);
      expect(n).toBeGreaterThanOrEqual(44);
    }
  });

  test('no banned vocabulary outside the FAQ summary context', () => {
    // The micro-FAQ summary "Why is my quote stuck on AI Analysis?"
    // is exempt because it mirrors the UI label the user has actually
    // seen. Strip that line + comments before checking the rest.
    const stripped = modalSrc
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/stuck on AI Analysis/gi, 'stuck on Analysis');
    expect(stripped).not.toMatch(/\b(agent|confidence|calibration|model|LLM|Claude|Sonnet|prompt)\b/i);
  });
});

describe('App.jsx wires the HelpModal globally', () => {
  test('imports HelpModal', () => {
    expect(appSrc).toMatch(/import HelpModal from '\.\/components\/HelpModal\.jsx'/);
  });

  test('tracks showHelp state', () => {
    expect(appSrc).toMatch(/showHelp/);
    expect(appSrc).toMatch(/setShowHelp/);
  });

  test('mounts the modal gated on showHelp', () => {
    expect(appSrc).toMatch(/<HelpModal[\s\S]*?open=\{showHelp\}/);
  });

  test('passes onClose that clears showHelp', () => {
    expect(appSrc).toMatch(/onClose=\{\(\)\s*=>\s*setShowHelp\(false\)\}/);
  });

  test('Sidebar receives onHelpClick that opens the modal', () => {
    expect(appSrc).toMatch(/onHelpClick=\{\(\)\s*=>\s*setShowHelp\(true\)\}/);
  });

  test('ProfileSetup receives onHelpClick that opens the modal', () => {
    // The same callback is forwarded to ProfileSetup so the mobile
    // path (BottomNav → Profile modal → Need help?) opens the modal.
    const matches = appSrc.match(/onHelpClick=\{\(\)\s*=>\s*setShowHelp\(true\)\}/g) || [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  test('passes showToast through to HelpModal', () => {
    expect(appSrc).toMatch(/<HelpModal[\s\S]*?showToast=\{showToast\}/);
  });
});

describe('Sidebar.jsx Help entry point', () => {
  test('accepts onHelpClick prop', () => {
    expect(sidebarSrc).toMatch(/onHelpClick/);
  });

  test('renders a Help link/button below the rail-quota chip', () => {
    // The Help link sits between the RailQuotaChip and the avatar
    // block. Source-level check: the literal "Help" string appears
    // and is wired to onHelpClick.
    expect(sidebarSrc).toMatch(/onClick=\{onHelpClick\}/);
    // Whitespace-tolerant: the literal "Help" label sits as the
    // button's text content.
    expect(sidebarSrc).toMatch(/>\s*Help\s*</);
  });
});

describe('ProfileSetup.jsx mobile Help entry point', () => {
  test('accepts onHelpClick prop', () => {
    expect(profileSrc).toMatch(/onHelpClick/);
  });

  test('renders a "Need help?" link wired to onHelpClick', () => {
    expect(profileSrc).toMatch(/Need help\?/);
    expect(profileSrc).toMatch(/onClick=\{onHelpClick\}/);
  });
});
