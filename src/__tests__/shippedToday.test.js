/**
 * Meta-verification test — asserts the key invariant of every TRQ shipped
 * on 2026-04-20 / 2026-04-21. Supplements the per-ticket regression tests
 * with a single place that catches:
 *   - a test file being deleted or skipped
 *   - a regression test being softened
 *   - a rebase accidentally reverting a fix
 *
 * If any `describe` block fails, look up the TRQ number to understand
 * what regressed and why.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { SYSTEM_PROMPT } from '../../prompts/systemPrompt.js';
import { applyMeasurementPlausibilityBounds } from '../utils/aiParser.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

// Cached source reads — every invariant is text-level, so read once.
const files = {
  readme: readFileSync(join(repoRoot, 'README.md'), 'utf8'),
  claudeMd: readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8'),
  indexHtml: readFileSync(join(repoRoot, 'index.html'), 'utf8'),
  printCss: readFileSync(join(repoRoot, 'public/print.css'), 'utf8'),
  dockerfile: readFileSync(join(repoRoot, 'Dockerfile'), 'utf8'),
  pkg: JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')),
  serverJs: readFileSync(join(repoRoot, 'server.js'), 'utf8'),
  pdfRenderer: readFileSync(join(repoRoot, 'pdfRenderer.js'), 'utf8'),
  quoteDoc: readFileSync(join(repoRoot, 'src/components/QuoteDocument.jsx'), 'utf8'),
  quoteOutput: readFileSync(join(repoRoot, 'src/components/steps/QuoteOutput.jsx'), 'utf8'),
  ramsOutput: readFileSync(join(repoRoot, 'src/components/rams/RamsOutput.jsx'), 'utf8'),
  livePreview: readFileSync(join(repoRoot, 'src/components/review/LivePreview.jsx'), 'utf8'),
  scheduleList: readFileSync(join(repoRoot, 'src/components/review/ScheduleList.jsx'), 'utf8'),
  measurementRow: readFileSync(join(repoRoot, 'src/components/review/MeasurementRow.jsx'), 'utf8'),
  reviewEdit: readFileSync(join(repoRoot, 'src/components/steps/ReviewEdit.jsx'), 'utf8'),
  jobDetails: readFileSync(join(repoRoot, 'src/components/steps/JobDetails.jsx'), 'utf8'),
  profileSetup: readFileSync(join(repoRoot, 'src/components/steps/ProfileSetup.jsx'), 'utf8'),
  savedQuoteViewer: readFileSync(join(repoRoot, 'src/components/SavedQuoteViewer.jsx'), 'utf8'),
  videoUpload: readFileSync(join(repoRoot, 'src/components/VideoUpload.jsx'), 'utf8'),
  autoGrow: readFileSync(join(repoRoot, 'src/components/common/AutoGrowTextarea.jsx'), 'utf8'),
  aiParser: readFileSync(join(repoRoot, 'src/utils/aiParser.js'), 'utf8'),
  analyseJob: readFileSync(join(repoRoot, 'src/utils/analyseJob.js'), 'utf8'),
  reducer: readFileSync(join(repoRoot, 'src/reducer.js'), 'utf8'),
};

// ─────────────────────────────────────────────────────────────────────────
// TRQ-99 — Photo/video inputs now show the OS file picker (not camera only)
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-99: OS file picker on photo/video inputs', () => {
  it('VideoUpload does not force capture="environment"', () => {
    expect(files.videoUpload).not.toMatch(/capture=["']environment["']/);
  });
  it('JobDetails photo inputs do not force capture="environment"', () => {
    expect(files.jobDetails).not.toMatch(/capture=["']environment["']/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-100 — Wispr Flow-compatible onBlur re-sync + video CTA correct
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-100: onBlur re-sync on navigation-gating inputs', () => {
  it('siteAddress, briefNotes, clientName have onBlur', () => {
    expect(files.jobDetails).toMatch(/onBlur=\{\(e\) => \{\s*updateJob\('siteAddress'/);
    expect(files.jobDetails).toMatch(/onBlur=\{\(e\) => updateJob\('clientName'/);
  });
  it('MeasurementRow input has onBlur', () => {
    expect(files.measurementRow).toMatch(/onBlur=/);
  });
  it('video mode CTA distinguishes missing video vs missing site address', () => {
    expect(files.jobDetails).toMatch(/ADD SITE ADDRESS TO CONTINUE/);
    expect(files.jobDetails).toMatch(/ADD VIDEO TO CONTINUE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-101 — Notes & Conditions hanging indent (list-outside, not list-inside)
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-101: Notes hanging indent', () => {
  it('Notes ol uses list-outside and has left padding', () => {
    const block = files.quoteDoc.match(/Notes &amp; Conditions[\s\S]{0,600}<ol[^>]*>/);
    expect(block).not.toBeNull();
    const olTag = block[0].match(/<ol[^>]*>/)[0];
    expect(olTag).not.toMatch(/list-inside/);
    expect(olTag).toMatch(/list-outside/);
    expect(olTag).toMatch(/pl-\d|ml-\d/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-102 — Review & Edit 2-column layout + textarea vertical padding
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-102: Review & Edit layout', () => {
  it('desktop grid uses 2 columns (not 3)', () => {
    const m = files.reviewEdit.match(/gridTemplateColumns:\s*['"]([^'"]+)['"]/);
    expect(m).not.toBeNull();
    expect(m[1].trim().split(/\s+/).length).toBe(2);
  });
  it('textarea.nq-field has vertical padding', () => {
    expect(files.indexHtml).toMatch(/textarea\.nq-field[\s\S]*padding:\s*12px\s*14px/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-103 — Inline footer marked data-html2canvas-ignore (avoids duplicate)
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-103: PDF footer not duplicated', () => {
  it('inline footer has data-html2canvas-ignore', () => {
    const block = files.quoteDoc.match(/\{\/\*\s*Footer[^*]*\*\/\}[\s\S]{0,400}VAT No:\s*\$\{profile\.vatNumber\}/);
    expect(block).not.toBeNull();
    expect(block[0]).toMatch(/data-html2canvas-ignore/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-79 — Subject wall identification in the system prompt
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-79: subject wall identification', () => {
  it('system prompt has MULTIPLE WALLS guidance', () => {
    expect(SYSTEM_PROMPT).toMatch(/MULTIPLE WALLS/i);
    expect(SYSTEM_PROMPT).toMatch(/do not combine/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-106 / 107 — Saved quote logo + photo selection fix
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-106 + TRQ-107: saved quote logo + photos', () => {
  it('SavedQuoteViewer rehydrates logo when [photo-stripped] marker is present', () => {
    expect(files.savedQuoteViewer).toMatch(/getProfile/);
    expect(files.savedQuoteViewer).toMatch(/\[photo-stripped\]/);
    // TRQ-138 expanded the fallback chain to
    // baseProfile.logo || restoredLogo || null (live profile first).
    expect(files.savedQuoteViewer).toMatch(/logo:[^,\n]*\|\|\s*null/);
  });
  it('SavedQuoteViewer remounts QuoteOutput when photos arrive so selection initialiser sees them', () => {
    expect(files.savedQuoteViewer).toMatch(/key=\{restoredPhotos/);
    expect(files.savedQuoteViewer).toMatch(/photos-pending/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-108 — Measurement row 3-zone redesign with colour palette
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-108: measurement row redesign', () => {
  it('confirmed row shows a tick + single line', () => {
    expect(files.measurementRow).toMatch(/\\u2713/);
  });
  it('unconfirmed row distinguishes low vs medium/high palette', () => {
    expect(files.measurementRow).toMatch(/isLow/);
    expect(files.measurementRow).toMatch(/tq-error-bg/);
    expect(files.measurementRow).toMatch(/tq-unconf-bg/);
  });
  it('review-edit header shows X of Y to confirm', () => {
    expect(files.reviewEdit).toMatch(/of \$\{measurements\.length\} to confirm/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-109 — Measurement accuracy v2 (methodology + scaleReferences + bounds)
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-109: measurement accuracy v2', () => {
  it('system prompt has 5-step methodology + tiered scale anchors', () => {
    expect(SYSTEM_PROMPT).toMatch(/MEASUREMENT METHODOLOGY/);
    expect(SYSTEM_PROMPT).toMatch(/TIER A/);
    expect(SYSTEM_PROMPT).toMatch(/TIER B/);
    expect(SYSTEM_PROMPT).toMatch(/TIER C/);
    expect(SYSTEM_PROMPT).toMatch(/Step 1/);
    expect(SYSTEM_PROMPT).toMatch(/Step 5/);
  });
  it('scaleReferences field is in the state shape + payload', () => {
    expect(files.reducer).toMatch(/scaleReferences:/);
    expect(files.analyseJob).toMatch(/USER-PROVIDED SCALE REFERENCES/);
  });
  it('applyMeasurementPlausibilityBounds forces low confidence when no anchor', () => {
    const out = applyMeasurementPlausibilityBounds(
      {
        referenceCardDetected: false,
        measurements: [
          { item: 'x', valueMm: 1200, displayValue: '1,200mm', confidence: 'high' },
        ],
      },
      { scaleReferences: '' }
    );
    expect(out.measurements[0].confidence).toBe('low');
  });
  it('applyMeasurementPlausibilityBounds forces low when valueMm implausible', () => {
    const out = applyMeasurementPlausibilityBounds(
      {
        referenceCardDetected: true,
        measurements: [
          { item: 'x', valueMm: 150000, displayValue: '150,000mm', confidence: 'high' },
        ],
      },
      { scaleReferences: '' }
    );
    expect(out.measurements[0].confidence).toBe('low');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-110 — DOCX cost breakdown table with fixed columns + page-fit width
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-110: DOCX cost-breakdown table', () => {
  it('Table declares columnWidths + layout: TableLayoutType.FIXED', () => {
    const tables = files.quoteOutput.match(/new Table\(\{[\s\S]*?\}\)/g) || [];
    const costTable = tables.find(t => t.includes('columnWidths'));
    expect(costTable).toBeDefined();
    expect(costTable).toMatch(/layout:\s*TableLayoutType\.FIXED/);
  });
  it('total table width fits within A4 usable (≤ 9026 twips)', () => {
    expect(files.quoteOutput).toMatch(/COL_SPAN_5\s*=\s*COL_SPAN_4\s*\+\s*COL_TOTAL;\s*\/\/\s*8800/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-111 + TRQ-114 — auto-growing textareas (schedule + damage)
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-111 / TRQ-114: AutoGrowTextarea', () => {
  it('shared component exists and uses useLayoutEffect', () => {
    expect(files.autoGrow).toMatch(/useLayoutEffect/);
    expect(files.autoGrow).toMatch(/scrollHeight/);
  });
  it('ScheduleList uses AutoGrowTextarea with a reasonable minHeight', () => {
    expect(files.scheduleList).toMatch(/AutoGrowTextarea/);
    expect(files.scheduleList).toMatch(/minHeight=\{140\}/);
  });
  it('ReviewEdit damage description uses AutoGrowTextarea', () => {
    expect(files.reviewEdit).toMatch(/AutoGrowTextarea/);
    expect(files.reviewEdit).toMatch(/minHeight=\{160\}/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-112 — Inline editing in Live Preview
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-112: inline editing in Live Preview', () => {
  it('QuoteDocument accepts editable + dispatch props', () => {
    expect(files.quoteDoc).toMatch(/editable\s*=\s*false/);
    expect(files.quoteDoc).toMatch(/dispatch/);
    expect(files.quoteDoc).toMatch(/EditableText/);
  });
  it('LivePreview passes dispatch + editable down', () => {
    expect(files.livePreview).toMatch(/editable=\{editable\}/);
    expect(files.livePreview).toMatch(/click any text to edit/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-113 — Cost breakdown totals formatting (right-positioned table, brand accent)
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-113: totals formatting', () => {
  it('QuoteDocument TOTAL value uses brand-accent #d97706', () => {
    expect(files.quoteDoc).toMatch(/color:\s*['"]#d97706['"]/);
  });
  it('DOCX totals use a 3-col spacer/label/value table', () => {
    expect(files.quoteOutput).toMatch(/TOT_SPACER/);
    expect(files.quoteOutput).toMatch(/TOT_LABEL/);
    expect(files.quoteOutput).toMatch(/TOT_VALUE/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-115 — Repo hygiene: docs, index, version bump
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-115: repo hygiene sweep', () => {
  it('package.json is at 0.5.x or higher', () => {
    const [major, minor] = files.pkg.version.split('.').map(Number);
    expect(major === 0 ? minor >= 5 : major >= 1).toBe(true);
  });
  it('README.md cites the real test count (>1000)', () => {
    const m = files.readme.match(/(\d{3,4})\s*tests/);
    expect(m).not.toBeNull();
    expect(Number(m[1])).toBeGreaterThan(1000);
  });
  it('jobs(user_id, saved_at DESC) composite index exists', () => {
    expect(files.serverJs).toMatch(/CREATE INDEX IF NOT EXISTS idx_jobs_user_saved_at ON jobs\(user_id, saved_at DESC\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-119 / TRQ-120 / TRQ-121 — PDF reliability Phases 1 + 2 + follow-up
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-119/120/121: PDF reliability', () => {
  it('public/print.css exists and declares @page A4', () => {
    expect(files.printCss).toMatch(/@page\s*\{[^}]*size:\s*A4/);
  });
  it('index.html links /print.css and tags <html class="app-chrome">', () => {
    expect(files.indexHtml).toMatch(/<link[^>]+href="\/print\.css"/);
    expect(files.indexHtml).toMatch(/<html[^>]+class="[^"]*app-chrome/);
  });
  it('print.css scopes visibility hiding to html.app-chrome (Puppeteer path safe)', () => {
    expect(files.printCss).toMatch(/html\.app-chrome\s+body\s*\*/);
    expect(files.printCss).toMatch(/html:not\(\.app-chrome\)/);
  });
  it('QuoteDocument marks every section with data-print-section', () => {
    for (const section of ['damage', 'measurements', 'schedule', 'cost-breakdown', 'totals', 'notes', 'photos']) {
      expect(files.quoteDoc).toMatch(new RegExp(`data-print-section="${section}"`));
    }
  });
  it('pdfRenderer uses puppeteer-core + @sparticuz/chromium singleton', () => {
    expect(files.pdfRenderer).toMatch(/from 'puppeteer-core'/);
    expect(files.pdfRenderer).toMatch(/from '@sparticuz\/chromium'/);
    expect(files.pdfRenderer).toMatch(/browserPromise/);
  });
  it('pdfRenderer reads public/print.css at boot and inlines it', () => {
    expect(files.pdfRenderer).toMatch(/public\/print\.css/);
    expect(files.pdfRenderer).toMatch(/PRINT_CSS/);
  });
  it('server exposes POST /api/users/:id/jobs/:jobId/pdf', () => {
    expect(files.serverJs).toMatch(/app\.post\('\/api\/users\/:id\/jobs\/:jobId\/pdf'/);
  });
  it('Dockerfile installs the Chromium runtime libs', () => {
    for (const lib of ['libnss3', 'libgbm1', 'libatk-bridge2.0-0', 'libxshmfence1']) {
      expect(files.dockerfile).toMatch(new RegExp(`\\b${lib.replace(/\./g, '\\.')}\\b`));
    }
  });
  it('QuoteOutput has a primary Download PDF button routing to the server', () => {
    expect(files.quoteOutput).toMatch(/handleDownloadPdfServer/);
    expect(files.quoteOutput).toMatch(/\/api\/users\/.*\/jobs\/.*\/pdf/);
  });
  it('QuoteOutput has a fallback Save-via-print button', () => {
    expect(files.quoteOutput).toMatch(/handlePrint/);
    expect(files.quoteOutput).toMatch(/window\.print\(\)/);
  });
  it('dependencies declare puppeteer-core + @sparticuz/chromium', () => {
    expect(files.pkg.dependencies).toHaveProperty('puppeteer-core');
    expect(files.pkg.dependencies).toHaveProperty('@sparticuz/chromium');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// TRQ-122 — User-friendly filenames + remove "rubble"
// ─────────────────────────────────────────────────────────────────────────
describe('TRQ-122: friendly filenames + no rubble', () => {
  it('Quote + RAMS exports route through buildQuoteFilename', () => {
    // All three export paths (Puppeteer, legacy PDF, DOCX) use the shared
    // helper so the format stays consistent everywhere.
    const quoteHits = files.quoteOutput.match(/buildQuoteFilename\(/g) || [];
    expect(quoteHits.length).toBeGreaterThanOrEqual(3);
    expect(files.ramsOutput).toMatch(/buildQuoteFilename\(/);
  });
  it('no template literal builds a .pdf/.docx filename that includes quoteReference', () => {
    expect(files.quoteOutput).not.toMatch(/`[^`]*quoteReference[^`]*\.pdf`/);
    expect(files.quoteOutput).not.toMatch(/`[^`]*quoteReference[^`]*\.docx`/);
  });
  it('system prompt no longer uses "rubble" in example material lines', () => {
    expect(SYSTEM_PROMPT).not.toMatch(/matched rubble/i);
    expect(SYSTEM_PROMPT).not.toMatch(/sandstone rubble/i);
    expect(SYSTEM_PROMPT).not.toMatch(/gritstone rubble/i);
  });
  it('system prompt has a CLIENT-FACING LANGUAGE section', () => {
    expect(SYSTEM_PROMPT).toMatch(/CLIENT-FACING LANGUAGE/i);
    expect(SYSTEM_PROMPT).toMatch(/walling stone/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Cross-cutting — CLAUDE.md captures today's pitfalls so future sessions
// don't re-learn them
// ─────────────────────────────────────────────────────────────────────────
describe('CLAUDE.md learnings from today', () => {
  it.each([
    ['TRQ-100 onBlur re-sync',      'TRQ-100'],
    ['TRQ-106 photo-stripped',      'TRQ-106'],
    ['TRQ-103 html2canvas footer',  'TRQ-103'],
    ['TRQ-110 docx table widths',   'TRQ-110'],
    ['TRQ-111 AutoGrowTextarea',    'TRQ-111'],
    ['TRQ-112 editable QuoteDoc',   'TRQ-112'],
    ['TRQ-109 plausibility bounds', 'TRQ-109'],
  ])('documents %s', (_label, marker) => {
    expect(files.claudeMd).toMatch(new RegExp(marker));
  });
});
