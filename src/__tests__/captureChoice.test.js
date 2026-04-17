import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

describe('CaptureChoice component', () => {
  let source;

  beforeAll(() => {
    source = readFileSync(join(srcDir, 'components/CaptureChoice.jsx'), 'utf8');
  });

  describe('component contract', () => {
    it('exports a default function component', () => {
      expect(source).toMatch(/export\s+default\s+function\s+CaptureChoice/);
    });

    it('accepts onSelectMode prop', () => {
      expect(source).toContain('onSelectMode');
    });

    it('renders video mode option', () => {
      expect(source).toContain('video');
    });

    it('renders photos mode option', () => {
      expect(source).toContain('photos');
    });

    it('contains "Walk me through it" text', () => {
      expect(source).toContain('Walk me through it');
    });

    it('contains "Show me the photos" text', () => {
      expect(source).toContain('Show me the photos');
    });

    it('calls onSelectMode with mode string on click', () => {
      // Check that onClick handlers pass mode strings
      expect(source).toMatch(/onSelectMode\s*\(\s*['"]video['"]\s*\)/);
      expect(source).toMatch(/onSelectMode\s*\(\s*['"]photos['"]\s*\)/);
    });
  });

  describe('design law compliance', () => {
    const BANNED_TERMS = [
      /\bAI\b/,
      /\bartificial intelligence\b/i,
      /\bmodel\b/i,
      /\bLLM\b/,
      /\bClaude\b/,
      /\bSonnet\b/,
      /\bconfidence\b/i,
      /\bcalibration\b/i,
      /\bsmart estimate\b/i,
      /\bintelligent\b/i,
      /\blearning\b/i,
      /\bagent\b/i,
    ];

    it('contains no banned AI vocabulary', () => {
      const lines = source.split('\n');
      const violations = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip comments
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
        // Skip import/export lines
        if (line.trim().startsWith('import ') || line.trim().startsWith('export ')) continue;
        for (const pattern of BANNED_TERMS) {
          if (pattern.test(line)) {
            violations.push(`Line ${i + 1}: ${line.trim()} (matched ${pattern})`);
          }
        }
      }
      expect(violations).toEqual([]);
    });
  });

  describe('accessibility', () => {
    it('uses semantic button or clickable elements', () => {
      // Should use button, onClick, or role attributes
      expect(source).toMatch(/onClick|button|role/);
    });
  });
});
