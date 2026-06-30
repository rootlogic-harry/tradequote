/**
 * EditDetailsModal — source-level shape + a11y + banned-vocab guards.
 *
 * Built for Paul Clough's 2026-06-30 WhatsApp ask: "Is there any way I
 * could edit job details without having to regenerate. The address is
 * wrong and if I regenerate it might alter details or figures which
 * are spot on". This modal targets the new
 * PATCH /api/users/:id/jobs/:jobId/details route so reviewData,
 * quotePayload, diffs, and quote_diffs are all untouched on save.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(
  join(__dirname, '..', 'components', 'EditDetailsModal.jsx'),
  'utf8'
);
const VIEWER = readFileSync(
  join(__dirname, '..', 'components', 'SavedQuoteViewer.jsx'),
  'utf8'
);
const APP = readFileSync(
  join(__dirname, '..', 'App.jsx'),
  'utf8'
);

describe('EditDetailsModal — contract', () => {
  test('default-exports a React component', () => {
    expect(SRC).toMatch(/export default function EditDetailsModal/);
  });

  test('imports patchJobDetails from userDB (no other write surface)', () => {
    expect(SRC).toMatch(/import\s+\{\s*patchJobDetails\s*\}\s+from\s+['"]\.\.\/utils\/userDB\.js['"]/);
    // Negative: must NOT touch the bulk PUT / POST / saveDiffs paths.
    expect(SRC).not.toMatch(/\bsaveJob\b/);
    expect(SRC).not.toMatch(/\bupdateJob\b/);
    expect(SRC).not.toMatch(/\bsaveDiffs\b/);
  });

  test('edits ONLY the five whitelisted metadata fields', () => {
    const fields = ['clientName', 'siteAddress', 'clientPhone', 'quoteDate', 'briefNotes'];
    for (const f of fields) {
      expect(SRC).toMatch(new RegExp(`form\\.${f}`));
    }
    // Negative: must NOT access numbers/materials/schedule state. We
    // scan for code-shaped references (form. / state. / patch.) rather
    // than the bare word, since the modal's reassurance copy reads
    // "Numbers, materials and the schedule of works stay exactly as
    // they are." — that's user-facing prose, not data access.
    for (const dataKey of ['measurements', 'materials', 'scheduleOfWorks', 'labourEstimate', 'quotePayload']) {
      const codeAccess = new RegExp(`(?:form|state|patch|snapshot)\\.${dataKey}`);
      expect(SRC).not.toMatch(codeAccess);
    }
  });

  test('sends only changed fields in the patch body (no blank-by-omission risk)', () => {
    // We diff every field against initialDetails before adding to patch.
    expect(SRC).toMatch(/patch\.clientName\s*=/);
    expect(SRC).toMatch(/patch\.siteAddress\s*=/);
    expect(SRC).toMatch(/patch\.clientPhone\s*=/);
    expect(SRC).toMatch(/patch\.quoteDate\s*=/);
    expect(SRC).toMatch(/patch\.briefNotes\s*=/);
  });

  test('Save button is disabled until the form is dirty', () => {
    expect(SRC).toMatch(/disabled=\{\s*!dirty \|\| saving\s*\}/);
  });

  test('client portal notice shows ONLY when hasClientToken is truthy', () => {
    expect(SRC).toMatch(/hasClientToken\s*&&/);
    expect(SRC).toMatch(/Your client's link shows the version you sent/);
  });

  test('a11y: role=dialog, aria-modal, aria-labelledby', () => {
    expect(SRC).toMatch(/role="dialog"/);
    expect(SRC).toMatch(/aria-modal="true"/);
    expect(SRC).toMatch(/aria-labelledby="edit-details-title"/);
  });

  test('ESC closes the modal (unless saving)', () => {
    expect(SRC).toMatch(/e\.key === 'Escape'[\s\S]{0,80}!saving[\s\S]{0,80}onClose/);
  });

  test('every button + textarea meets the 44px touch-target floor', () => {
    // Buttons: cancel, save. Textareas have minHeight: 44 inline.
    const buttonOpens = (SRC.match(/<button\b/g) || []).length;
    const minHeightHits = (SRC.match(/minHeight\s*:\s*44\b/g) || []).length;
    expect(buttonOpens).toBeGreaterThanOrEqual(2);
    expect(minHeightHits).toBeGreaterThanOrEqual(buttonOpens);
  });

  test('uses banned-vocab-safe language only', () => {
    // Strip JS comments before scanning so we can mention "AI" / "model"
    // in implementation-detail comments without tripping the rule.
    const userFacing = SRC
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const banned = [
      /\bAI\b/, /\bClaude\b/, /\bmodel\b/i, /\bLLM\b/,
      /\bprompt\b/i, /\bcalibration\b/i, /\baccuracy\b/i,
      /\bagent\b/i, /\bconfidence\b/i,
    ];
    for (const re of banned) expect(userFacing).not.toMatch(re);
  });
});

describe('SavedQuoteViewer integrates EditDetailsModal', () => {
  test('imports the new modal component', () => {
    expect(VIEWER).toMatch(/import\s+EditDetailsModal/);
  });

  test('renders "Edit details" + "Re-analyse and edit quote" buttons', () => {
    expect(VIEWER).toMatch(/data-testid="saved-quote-edit-details"/);
    expect(VIEWER).toMatch(/Edit details/);
    expect(VIEWER).toMatch(/data-testid="saved-quote-reanalyse"/);
    expect(VIEWER).toMatch(/Re-analyse and edit quote/);
    // Old button label must be gone.
    expect(VIEWER).not.toMatch(/Edit &amp; Re-generate/);
  });

  test('mounts EditDetailsModal with the right props', () => {
    expect(VIEWER).toMatch(/<EditDetailsModal[\s\S]{0,800}open=\{editDetailsOpen\}/);
    expect(VIEWER).toMatch(/userId=\{currentUserId\}/);
    expect(VIEWER).toMatch(/initialDetails=\{virtualState\.jobDetails\}/);
    expect(VIEWER).toMatch(/hasClientToken=\{!!quote\?\.clientToken\}/);
  });

  test('locally overlays edited jobDetails so the saved view reflects the edit immediately', () => {
    expect(VIEWER).toMatch(/setEditedDetails\(nextDetails\)/);
    expect(VIEWER).toMatch(/editedDetails[\s\S]{0,100}snapshot\.jobDetails/);
  });
});

describe('App.jsx forwards showToast so the modal can confirm', () => {
  test('SavedQuoteViewer receives showToast', () => {
    expect(APP).toMatch(/<SavedQuoteViewer[\s\S]{0,400}showToast=\{showToast\}/);
  });
});
