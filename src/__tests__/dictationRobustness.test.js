import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

describe('External dictation tool robustness', () => {
  let jobDetailsSource;
  let profileSetupSource;
  let measurementRowSource;

  beforeAll(() => {
    jobDetailsSource = readFileSync(join(srcDir, 'components/steps/JobDetails.jsx'), 'utf8');
    profileSetupSource = readFileSync(join(srcDir, 'components/steps/ProfileSetup.jsx'), 'utf8');
    measurementRowSource = readFileSync(join(srcDir, 'components/review/MeasurementRow.jsx'), 'utf8');
  });

  // Some external dictation tools (Wispr Flow, accessibility-API typing,
  // password managers, some keyboard extensions) can set input.value without
  // dispatching a native input event, which means React's onChange never fires
  // and controlled-component state stays stale. Every text input whose value
  // gates navigation must have an onBlur re-sync so state catches up when the
  // user taps away to hit the continue button.
  describe('onBlur re-sync on navigation-gating text inputs', () => {
    it('JobDetails clientName has onBlur re-sync', () => {
      expect(jobDetailsSource).toMatch(/onBlur=\{\(e\) => updateJob\('clientName'/);
    });

    it('JobDetails siteAddress has onBlur re-sync', () => {
      expect(jobDetailsSource).toMatch(/onBlur=\{\(e\) => \{\s*updateJob\('siteAddress'/);
    });

    it('JobDetails briefNotes has onBlur re-sync (both copies)', () => {
      const matches = jobDetailsSource.match(/onBlur=\{\(e\) => \{\s*updateJob\('briefNotes'/g) || [];
      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('ProfileSetup fullName has onBlur re-sync', () => {
      expect(profileSetupSource).toMatch(/onBlur=\{\(e\) => update\('fullName'/);
    });

    it('ProfileSetup email has onBlur re-sync', () => {
      expect(profileSetupSource).toMatch(/onBlur=\{\(e\) => update\('email'/);
    });

    it('ProfileSetup phone has onBlur re-sync', () => {
      expect(profileSetupSource).toMatch(/onBlur=\{\(e\) => update\('phone'/);
    });

    it('ProfileSetup address has onBlur re-sync', () => {
      expect(profileSetupSource).toMatch(/onBlur=\{\(e\) => \{\s*update\('address'/);
    });

    it('ProfileSetup dayRate has onBlur re-sync', () => {
      expect(profileSetupSource).toMatch(/onBlur=\{\(e\) => update\('dayRate'/);
    });

    it('MeasurementRow value input has onBlur re-sync', () => {
      expect(measurementRowSource).toMatch(/onBlur=\{\(e\) => setEditValue/);
    });
  });

  describe('Video mode CTA label accuracy', () => {
    // Bug report: in video mode, the Generate button said "ADD VIDEO TO CONTINUE"
    // even when the video was uploaded but siteAddress was empty. The label must
    // distinguish the failure mode so users know what to fix.
    it('video CTA distinguishes missing video from missing site address', () => {
      // Find the video-mode CTA block
      const videoButtonBlock = jobDetailsSource.match(
        /canAnalyseVideo[\s\S]{0,400}ADD SITE ADDRESS TO CONTINUE/
      );
      expect(videoButtonBlock).not.toBeNull();
    });

    it('video CTA still offers ADD VIDEO TO CONTINUE when video is missing', () => {
      expect(jobDetailsSource).toMatch(/ADD VIDEO TO CONTINUE/);
    });
  });
});
