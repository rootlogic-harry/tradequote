/**
 * TRQ-94 — Profile setup is no longer a full-page onboarding gate.
 *
 * The change touches three surfaces and we test each at the source level
 * (so this doesn't need a full React render harness, just a guarantee
 * that the wiring is in place):
 *   1. App.jsx — the early-return ProfileSetup block is GONE.
 *   2. server.js — the OAuth callback no longer rewrites to `?onboarding=true`.
 *   3. QuoteOutput.jsx — every customer-facing action (PDF, DOCX, email,
 *      Outlook, client link) calls requireProfile() before doing its
 *      work, and the ProfileGateModal is rendered when raised.
 *
 * The dashboard / quote-builder workflow stays usable with an empty
 * profile; only the moment-of-truth send actions block.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

const appSrc = readFileSync(join(repoRoot, 'src/App.jsx'), 'utf8');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const quoteOutputSrc = readFileSync(
  join(repoRoot, 'src/components/steps/QuoteOutput.jsx'),
  'utf8'
);
const clientLinkSrc = readFileSync(
  join(repoRoot, 'src/components/ClientLinkBlock.jsx'),
  'utf8'
);
const profileGateModalSrc = readFileSync(
  join(repoRoot, 'src/components/ProfileGateModal.jsx'),
  'utf8'
);

describe('App.jsx — onboarding gate removed', () => {
  test('no early-return that locks new users to ProfileSetup', () => {
    // The previous code path: `if (state.currentUser && state.currentUser.profileComplete === false) { return ... ProfileSetup ... }`.
    // Find any `profileComplete === false` check that early-returns at
    // the top level of the App component.
    expect(appSrc).not.toMatch(
      /if\s*\(\s*state\.currentUser\s*&&\s*state\.currentUser\.profileComplete\s*===\s*false\s*\)\s*\{\s*return\s*\([\s\S]{0,2000}?ProfileSetup/
    );
  });

  test('QuoteOutput receives onRequestOpenProfile so the gate can hand off', () => {
    expect(appSrc).toMatch(/onRequestOpenProfile=\{[^}]*setShowProfileModal\(true\)/);
  });

  test('profile modal close flips profile_complete=true when user was incomplete', () => {
    // Before TRQ-94 the only writer to settings/profile_complete was
    // the dedicated onboarding screen. Removing the gate means the
    // gear-icon modal has to take over that responsibility on close.
    expect(appSrc).toMatch(/settings\/profile_complete[\s\S]{0,400}value:\s*true/);
    expect(appSrc).toMatch(/state\.currentUser\.profileComplete\s*===\s*false[\s\S]{0,500}profileComplete:\s*true/);
  });
});

describe('server.js — OAuth callback', () => {
  test('does not redirect new users to `?onboarding=true`', () => {
    expect(serverSrc).not.toMatch(/\/\?onboarding=true/);
  });

  test('always redirects to `/` after OAuth login', () => {
    // Loose anchor — the surrounding block is the OAuth callback
    // handler. There may be other `res.redirect('/')` callers in the
    // file but the OAuth one specifically must be present.
    expect(serverSrc).toMatch(/auth\/google\/callback[\s\S]*?res\.redirect\(['"]\/['"]\)/);
  });
});

describe('QuoteOutput.jsx — gate raised at every customer-facing action', () => {
  test('exports a requireProfile helper that raises the gate when profile is incomplete', () => {
    expect(quoteOutputSrc).toMatch(/const\s+requireProfile\s*=\s*\(\s*\)\s*=>/);
    expect(quoteOutputSrc).toMatch(/profileIncomplete/);
    expect(quoteOutputSrc).toMatch(/setShowProfileGate\(true\)/);
  });

  test('handleDownloadPdfServer calls requireProfile() before generating', () => {
    const start = quoteOutputSrc.indexOf('const handleDownloadPdfServer');
    const next = quoteOutputSrc.indexOf('const handleDownloadPDF', start);
    expect(start).toBeGreaterThan(-1);
    const block = quoteOutputSrc.slice(start, next);
    expect(block).toMatch(/if\s*\(\s*!requireProfile\(\)\s*\)\s*return/);
  });

  test('handleDownloadPDF (legacy html2canvas path) calls requireProfile()', () => {
    const start = quoteOutputSrc.indexOf('const handleDownloadPDF');
    const next = quoteOutputSrc.indexOf('const handleDownloadDocx', start);
    expect(start).toBeGreaterThan(-1);
    const block = quoteOutputSrc.slice(start, next);
    expect(block).toMatch(/if\s*\(\s*!requireProfile\(\)\s*\)\s*return/);
  });

  test('handleDownloadDocx calls requireProfile()', () => {
    const start = quoteOutputSrc.indexOf('const handleDownloadDocx');
    const next = quoteOutputSrc.indexOf('const handleEmail', start);
    expect(start).toBeGreaterThan(-1);
    const block = quoteOutputSrc.slice(start, next);
    expect(block).toMatch(/if\s*\(\s*!requireProfile\(\)\s*\)\s*return/);
  });

  test('handleEmail calls requireProfile()', () => {
    const start = quoteOutputSrc.indexOf('const handleEmail');
    const next = quoteOutputSrc.indexOf('// Build a filename-safe', start);
    expect(start).toBeGreaterThan(-1);
    const block = quoteOutputSrc.slice(start, next);
    expect(block).toMatch(/if\s*\(\s*!requireProfile\(\)\s*\)\s*return/);
  });

  test('handleSendViaOutlook calls requireProfile() BEFORE the email-check toast', () => {
    const start = quoteOutputSrc.indexOf('const handleSendViaOutlook');
    const next = quoteOutputSrc.indexOf('}; // end handleSendViaOutlook', start);
    // The function is long — slice a generous window.
    const block = quoteOutputSrc.slice(start, start + 800);
    expect(block).toMatch(/if\s*\(\s*!requireProfile\(\)\s*\)\s*return/);
    // Gate must fire before the "Add your email address" toast, otherwise
    // a user with no profile sees a confusing email-only error first.
    const gateIdx = block.indexOf('requireProfile');
    const emailIdx = block.indexOf('Add your email address');
    expect(gateIdx).toBeGreaterThan(-1);
    expect(emailIdx).toBeGreaterThan(-1);
    expect(gateIdx).toBeLessThan(emailIdx);
  });

  test('renders ProfileGateModal wired to onRequestOpenProfile + the gate state', () => {
    expect(quoteOutputSrc).toMatch(/<ProfileGateModal[\s\S]{0,400}open=\{showProfileGate\}/);
    expect(quoteOutputSrc).toMatch(/onClose=\{[^}]*setShowProfileGate\(false\)/);
    expect(quoteOutputSrc).toMatch(/onOpenProfile=\{onRequestOpenProfile\}/);
  });
});

describe('ProfileGateModal.jsx — the extracted gate component', () => {
  test('carries the standard copy + "Add details" CTA', () => {
    expect(profileGateModalSrc).toMatch(/Add your business details first/);
    expect(profileGateModalSrc).toMatch(/Add details/);
    expect(profileGateModalSrc).toMatch(/Not now/);
  });

  test('is hidden when open=false (cheap render guard)', () => {
    expect(profileGateModalSrc).toMatch(/if\s*\(\s*!open\s*\)\s*return\s+null/);
  });

  test('handoff: clicking "Add details" closes the gate and opens the profile editor', () => {
    // The CTA's onClick must call onClose AND onOpenProfile. Both
    // matter: without onClose the gate stays mounted under the profile
    // modal; without onOpenProfile the user is stuck.
    expect(profileGateModalSrc).toMatch(/onClick=\{\s*\(\)\s*=>\s*\{[\s\S]{0,150}onClose\(\)[\s\S]{0,150}onOpenProfile\(\)/);
  });

  test('accessibility: dialog role + aria-modal + labelled by title', () => {
    expect(profileGateModalSrc).toMatch(/role="dialog"/);
    expect(profileGateModalSrc).toMatch(/aria-modal="true"/);
    expect(profileGateModalSrc).toMatch(/aria-labelledby="profile-gate-title"/);
    expect(profileGateModalSrc).toMatch(/id="profile-gate-title"/);
  });

  test('passes requireProfile to ClientLinkBlock', () => {
    expect(quoteOutputSrc).toMatch(/<ClientLinkBlock[\s\S]{0,500}?requireProfile=\{requireProfile\}/);
  });
});

describe('ClientLinkBlock.jsx — gate raised before generating', () => {
  test('handleGenerate calls requireProfile() before hitting the server', () => {
    const start = clientLinkSrc.indexOf('async function handleGenerate');
    const next = clientLinkSrc.indexOf('async function handleRegenerate', start);
    expect(start).toBeGreaterThan(-1);
    const block = clientLinkSrc.slice(start, next);
    // Bail-out shape: `if (requireProfile && !requireProfile()) return;`
    expect(block).toMatch(/if\s*\(\s*requireProfile\s*&&\s*!requireProfile\(\)\s*\)\s*return/);
  });
});
