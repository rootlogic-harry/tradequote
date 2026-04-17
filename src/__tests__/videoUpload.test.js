import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

describe('VideoUpload component', () => {
  let source;

  beforeAll(() => {
    source = readFileSync(join(srcDir, 'components/VideoUpload.jsx'), 'utf8');
  });

  describe('component contract', () => {
    it('exports a default function component', () => {
      expect(source).toMatch(/export\s+default\s+function\s+VideoUpload/);
    });

    it('accepts video prop', () => {
      expect(source).toContain('video');
    });

    it('accepts onVideoChange prop', () => {
      expect(source).toContain('onVideoChange');
    });

    it('accepts extraPhotos prop', () => {
      expect(source).toContain('extraPhotos');
    });

    it('accepts onExtraPhotosChange prop', () => {
      expect(source).toContain('onExtraPhotosChange');
    });

    it('has a drop zone with accept video/* for file input', () => {
      expect(source).toMatch(/accept.*video\/\*/);
    });

    it('renders a file browse mechanism', () => {
      // Should have an input[type=file] or similar
      expect(source).toMatch(/type.*file|input.*file/);
    });

    it('has a replace/remove video mechanism', () => {
      expect(source).toMatch(/Replace|Remove|Clear/i);
    });

    it('has add photos functionality', () => {
      expect(source).toMatch(/[Aa]dd.*photo/);
    });

    it('limits extra photos to a maximum', () => {
      expect(source).toMatch(/maxExtraPhotos|MAX_EXTRA|\.length\s*>=?\s*3/);
    });
  });

  describe('drag and drop', () => {
    it('handles dragOver events', () => {
      expect(source).toContain('onDragOver');
    });

    it('handles drop events', () => {
      expect(source).toContain('onDrop');
    });

    it('handles dragLeave events', () => {
      expect(source).toContain('onDragLeave');
    });
  });

  describe('video duration display', () => {
    it('creates an object URL for duration detection', () => {
      expect(source).toMatch(/createObjectURL|duration/);
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

    it('contains no banned AI vocabulary', () => {
      const lines = source.split('\n');
      const violations = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) continue;
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
});
