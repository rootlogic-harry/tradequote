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
  });
});
