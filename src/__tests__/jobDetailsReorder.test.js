/**
 * TRQ-171 — JobDetails reorder: photos before paperwork.
 *
 * The persona is a waller standing next to a wall, on a phone. The previous
 * layout asked for 7 text fields above the photo/video chooser. After this
 * reorder, capture (photos/video) happens FIRST and the Client & Site form
 * collapses under a "+ Add client details" disclosure that defaults open
 * only for Quick Quote mode (admin-only).
 *
 * These are source-level assertions — they intentionally lock the visual
 * order in the JSX so a future refactor that drops a text field back above
 * the photo grid fails loudly. The validation contract (siteAddress
 * required before generate) is verified separately by an in-process render
 * test using the live reducer.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

describe('TRQ-171 — JobDetails reorder: photos before paperwork', () => {
  let source;

  beforeAll(() => {
    source = readFileSync(join(srcDir, 'components/steps/JobDetails.jsx'), 'utf8');
  });

  describe('Visual order: capture before Client & Site', () => {
    // The Client & Site form is rendered via the {clientSiteSection} marker.
    // We lock its first *render-site* position (after the definition) to be
    // strictly AFTER the capture-mode rendering blocks. Anchor the search at
    // the JSX `return` statement so comments above it don't leak into the
    // order assertion.
    function getRenderRegion() {
      const returnIdx = source.indexOf('return (');
      expect(returnIdx).toBeGreaterThan(-1);
      return source.slice(returnIdx);
    }

    it('CaptureChoice render position appears before the first {clientSiteSection} render', () => {
      const region = getRenderRegion();
      const captureChoiceIdx = region.indexOf('<CaptureChoice');
      const clientSiteRenderIdx = region.indexOf('{clientSiteSection}');
      expect(captureChoiceIdx).toBeGreaterThan(-1);
      expect(clientSiteRenderIdx).toBeGreaterThan(-1);
      expect(captureChoiceIdx).toBeLessThan(clientSiteRenderIdx);
    });

    it('photo grid (PHOTO_SLOTS.map) appears before the photo-mode {clientSiteSection} render', () => {
      // In the photo mode block, the grid must come before the disclosure.
      // We scan from `captureMode === 'photos'` forward and confirm the
      // PHOTO_SLOTS.map call beats the next {clientSiteSection} marker.
      const region = getRenderRegion();
      const photoBlockStart = region.indexOf("captureMode === 'photos'");
      expect(photoBlockStart).toBeGreaterThan(-1);
      const tail = region.slice(photoBlockStart);
      const photoGridIdx = tail.indexOf('PHOTO_SLOTS.map');
      const clientSiteRenderIdx = tail.indexOf('{clientSiteSection}');
      expect(photoGridIdx).toBeGreaterThan(-1);
      expect(clientSiteRenderIdx).toBeGreaterThan(-1);
      expect(photoGridIdx).toBeLessThan(clientSiteRenderIdx);
    });

    it('VideoUpload component appears before the video-mode {clientSiteSection} render', () => {
      // In the video mode block, VideoUpload must come before the disclosure.
      const region = getRenderRegion();
      const videoBlockStart = region.indexOf("captureMode === 'video'");
      expect(videoBlockStart).toBeGreaterThan(-1);
      const tail = region.slice(videoBlockStart);
      const videoUploadIdx = tail.indexOf('<VideoUpload');
      const clientSiteRenderIdx = tail.indexOf('{clientSiteSection}');
      expect(videoUploadIdx).toBeGreaterThan(-1);
      expect(clientSiteRenderIdx).toBeGreaterThan(-1);
      expect(videoUploadIdx).toBeLessThan(clientSiteRenderIdx);
    });
  });

  describe('Client & Site disclosure', () => {
    it('renders an "Add client details" disclosure toggle', () => {
      // Exact button label is load-bearing for the UX review (2026-06-20).
      expect(source).toContain('Add client details');
    });

    it('disclosure is implemented as a button (44px touch target)', () => {
      // Mobile rule: 44px minimum touch target on all interactive elements.
      // The disclosure toggle is the first thing a waller taps to fill in
      // paperwork — it must clear the 44px floor.
      expect(source).toMatch(/Add client details[\s\S]*?minHeight:\s*44/);
    });

    it('disclosure exposes aria-expanded for screen readers', () => {
      expect(source).toMatch(/aria-expanded/);
    });

    it('Client & Site form fields render inside a conditional block driven by the disclosure state', () => {
      // The grid containing the form fields must be gated by a showClientDetails
      // (or equivalent) state hook so the form collapses when the disclosure
      // is closed.
      expect(source).toMatch(/showClientDetails|clientDetailsOpen/);
    });

    it('disclosure default-collapses for non-Quick Quote (state.quoteMode !== "quick")', () => {
      // Quick Quote mode is admin-only and should keep the form expanded by
      // default. Standard mode should default-collapse the disclosure.
      // The initial value must reference state.quoteMode === 'quick'.
      expect(source).toMatch(/useState\(\s*(?:\(\s*\)\s*=>\s*)?(?:state\.)?quoteMode\s*===\s*['"]quick['"]/);
    });
  });

  describe('Validation gates unchanged', () => {
    it('siteAddress is still required to enable GENERATE (canAnalyse)', () => {
      // The canAnalyse expression must still check jobDetails.siteAddress?.trim()
      expect(source).toMatch(/jobDetails\.siteAddress\?\.trim\(\)/);
    });

    it('canAnalyseVideo still gates on siteAddress', () => {
      expect(source).toMatch(/canAnalyseVideo\s*=[\s\S]*?siteAddress\?\.trim\(\)/);
    });

    it('handleAnalyse still calls validateJobDetails before dispatching ANALYSIS_START', () => {
      expect(source).toMatch(/validateJobDetails\(jobDetails\)/);
      expect(source).toMatch(/dispatch\(\{\s*type:\s*['"]ANALYSIS_START['"]/);
    });
  });

  describe('Required-field onBlur re-sync preserved (TRQ-100)', () => {
    it('siteAddress onBlur re-sync still present', () => {
      expect(source).toMatch(/onBlur=\{\(e\) => \{\s*updateJob\('siteAddress'/);
    });

    it('clientName onBlur re-sync still present', () => {
      expect(source).toMatch(/onBlur=\{\(e\) => updateJob\('clientName'/);
    });
  });
});
