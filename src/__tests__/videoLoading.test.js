import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

describe('AIAnalysis video loading stages', () => {
  let source;

  beforeAll(() => {
    source = readFileSync(join(srcDir, 'components/steps/AIAnalysis.jsx'), 'utf8');
  });

  describe('video mode awareness', () => {
    it('references captureMode from state', () => {
      expect(source).toContain('captureMode');
    });

    it('has video-specific loading messages', () => {
      // Should have messages about video processing stages
      expect(source).toMatch(/[Uu]ploading|[Ee]xtracting.*frame|[Tt]ranscrib|[Aa]nalys/);
    });

    it('shows staged progress for video mode', () => {
      // Should show numbered stages or a progress indicator for video
      expect(source).toMatch(/stage|Stage|VIDEO_LOADING|videoStage/i);
    });
  });

  describe('preserves existing photo flow', () => {
    it('still uses LOADING_MESSAGES', () => {
      expect(source).toContain('LOADING_MESSAGES');
    });

    it('still shows elapsed seconds', () => {
      expect(source).toContain('elapsedSeconds');
    });

    it('still has cancel button', () => {
      expect(source).toMatch(/[Cc]ancel/);
    });

    it('still has error state handling', () => {
      expect(source).toContain('analysisError');
    });
  });

  describe('design law compliance', () => {
    const BANNED_TERMS = [
      /\bAI\b/,
      /\bartificial intelligence\b/i,
      /\bmodel\b/i,
      /\bLLM\b/,
      /\bClaude\b/,
      /\bconfidence\b/i,
      /\bcalibration\b/i,
      /\bsmart\b/i,
      /\bintelligent\b/i,
    ];

    it('contains no banned AI vocabulary in user-facing strings', () => {
      const lines = source.split('\n');
      const violations = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        if (line.trim().startsWith('import ') || line.trim().startsWith('export ')) continue;
        // Skip variable/function names — only check string literals
        for (const pattern of BANNED_TERMS) {
          // Check inside JSX text and string literals
          const stringMatches = line.match(/'[^']*'|"[^"]*"|`[^`]*`|>[^<]+</g);
          if (stringMatches) {
            for (const str of stringMatches) {
              if (pattern.test(str)) {
                violations.push(`Line ${i + 1}: ${str.trim()} (matched ${pattern})`);
              }
            }
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });
});
