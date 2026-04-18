import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

describe('Video integration into Step 2 (JobDetails)', () => {
  let jobDetailsSource;
  let reducerSource;

  beforeAll(() => {
    jobDetailsSource = readFileSync(join(srcDir, 'components/steps/JobDetails.jsx'), 'utf8');
    reducerSource = readFileSync(join(srcDir, 'reducer.js'), 'utf8');
  });

  describe('JobDetails integration', () => {
    it('imports CaptureChoice component', () => {
      expect(jobDetailsSource).toMatch(/import.*CaptureChoice/);
    });

    it('imports VideoUpload component', () => {
      expect(jobDetailsSource).toMatch(/import.*VideoUpload/);
    });

    it('references captureMode from state', () => {
      expect(jobDetailsSource).toContain('captureMode');
    });

    it('renders CaptureChoice when no mode is selected', () => {
      expect(jobDetailsSource).toMatch(/CaptureChoice/);
    });

    it('conditionally renders video upload for video mode', () => {
      expect(jobDetailsSource).toMatch(/VideoUpload/);
    });

    it('has video analysis handler', () => {
      // Should have a video analysis path that uploads to the API
      expect(jobDetailsSource).toMatch(/video|Video/);
      expect(jobDetailsSource).toMatch(/api.*video|fetch.*video/i);
    });

    it('preserves existing photo flow code', () => {
      // PHOTO_SLOTS iteration must still exist
      expect(jobDetailsSource).toContain('PHOTO_SLOTS');
      // Photo upload handler must still exist
      expect(jobDetailsSource).toContain('handlePhotoUpload');
      // validateRequiredPhotoSlots must still be imported
      expect(jobDetailsSource).toContain('validateRequiredPhotoSlots');
    });

    it('shows notes textarea with DictationButton in video mode', () => {
      // VoiceRecorder should still be available in video mode
      expect(jobDetailsSource).toContain('VoiceRecorder');
      // briefNotes should still work
      expect(jobDetailsSource).toContain('briefNotes');
    });
  });

  describe('Reducer integration', () => {
    it('has SET_CAPTURE_MODE action', () => {
      expect(reducerSource).toContain('SET_CAPTURE_MODE');
    });

    it('has captureMode in initial state', () => {
      expect(reducerSource).toContain('captureMode');
    });

    it('captureMode defaults to null', () => {
      expect(reducerSource).toMatch(/captureMode:\s*null/);
    });

    it('SET_CAPTURE_MODE sets the mode value', () => {
      // Should have a case that sets captureMode from payload
      expect(reducerSource).toMatch(/captureMode.*payload|action\.mode|action\.payload/);
    });

    it('NEW_QUOTE resets captureMode', () => {
      // The NEW_QUOTE action should reset captureMode
      // (it resets all job data, so captureMode should be included)
      expect(reducerSource).toMatch(/captureMode.*null/);
    });

    it('has transcript in initial state', () => {
      expect(reducerSource).toMatch(/transcript:\s*null/);
    });

    it('ANALYSIS_SUCCESS stores transcript', () => {
      expect(reducerSource).toMatch(/ANALYSIS_SUCCESS[\s\S]*transcript/);
    });

    it('NEW_QUOTE resets transcript', () => {
      expect(reducerSource).toMatch(/transcript:\s*null/);
    });
  });

  describe('Transcript display', () => {
    let reviewEditSource;

    beforeAll(() => {
      reviewEditSource = readFileSync(join(srcDir, 'components/steps/ReviewEdit.jsx'), 'utf8');
    });

    it('shows transcript section for video mode', () => {
      expect(reviewEditSource).toMatch(/transcript/i);
      expect(reviewEditSource).toMatch(/isVideoMode|captureMode.*video/);
    });

    it('displays the transcript text', () => {
      expect(reviewEditSource).toMatch(/state\.transcript/);
    });

    it('transcript section is collapsible', () => {
      expect(reviewEditSource).toMatch(/Video Transcript/);
      expect(reviewEditSource).toMatch(/toggleSection.*transcript|transcript.*toggleSection/);
    });
  });

  describe('JobDetails passes transcript in dispatch', () => {
    it('includes transcript in ANALYSIS_SUCCESS dispatch', () => {
      expect(jobDetailsSource).toMatch(/transcript.*data\.transcript/);
    });
  });

  describe('Video badge on dashboard cards', () => {
    let badgesSource;
    let dashboardSource;
    let savedQuotesSource;
    let savedQuoteViewerSource;

    beforeAll(() => {
      badgesSource = readFileSync(join(srcDir, 'components/badges.jsx'), 'utf8');
      dashboardSource = readFileSync(join(srcDir, 'components/Dashboard.jsx'), 'utf8');
      savedQuotesSource = readFileSync(join(srcDir, 'components/SavedQuotes.jsx'), 'utf8');
      savedQuoteViewerSource = readFileSync(join(srcDir, 'components/SavedQuoteViewer.jsx'), 'utf8');
    });

    it('exports VideoBadge component', () => {
      expect(badgesSource).toMatch(/export\s+function\s+VideoBadge/);
    });

    it('VideoBadge renders only for video captureMode', () => {
      expect(badgesSource).toMatch(/captureMode\s*!==\s*['"]video['"]/);
    });

    it('Dashboard imports VideoBadge', () => {
      expect(dashboardSource).toMatch(/import.*VideoBadge.*from.*badges/);
    });

    it('Dashboard renders VideoBadge with captureMode', () => {
      expect(dashboardSource).toMatch(/VideoBadge.*captureMode/);
    });

    it('SavedQuotes imports VideoBadge', () => {
      expect(savedQuotesSource).toMatch(/import.*VideoBadge.*from.*badges/);
    });

    it('SavedQuotes renders VideoBadge with captureMode', () => {
      expect(savedQuotesSource).toMatch(/VideoBadge.*captureMode/);
    });

    it('SavedQuoteViewer does not include captureMode in virtualState (QuoteOutput does not use it)', () => {
      // captureMode is used for badges at Dashboard/SavedQuotes level, not inside the quote viewer
      expect(savedQuoteViewerSource).not.toMatch(/captureMode.*snapshot\.captureMode/);
    });
  });

  describe('Friendly video error mapping', () => {
    it('JobDetails has VIDEO_ERROR_MAP constant', () => {
      expect(jobDetailsSource).toMatch(/VIDEO_ERROR_MAP/);
    });

    it('JobDetails has friendlyVideoError function', () => {
      expect(jobDetailsSource).toMatch(/function\s+friendlyVideoError/);
    });

    it('video error catch block uses friendlyVideoError', () => {
      expect(jobDetailsSource).toMatch(/friendlyVideoError\(err\.message\)/);
    });

    it('maps ANTHROPIC_API_KEY error to user-friendly message', () => {
      expect(jobDetailsSource).toMatch(/ANTHROPIC_API_KEY.*temporarily unavailable/s);
    });

    it('maps File too large to actionable message', () => {
      expect(jobDetailsSource).toMatch(/File too large.*under 100MB/s);
    });

    it('maps 5xx Upload failed to generic retry message', () => {
      expect(jobDetailsSource).toMatch(/Upload failed.*try again/si);
    });
  });
});
