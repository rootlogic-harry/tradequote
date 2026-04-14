/**
 * Verification test: user-facing components must not contain visible "AI" text references.
 * Admin-only components (LearningDashboard, AgentActivity, CalibrationManager) are excluded.
 *
 * This test reads the source files and checks for "AI" as a standalone word or in phrases
 * like "AI analysis", "AI suggested", "AI returned", etc.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

// Files that are user-facing (non-admin) and should NOT contain "AI" text
const USER_FACING_FILES = [
  'components/review/MeasurementRow.jsx',
  'components/review/LabourSection.jsx',
  'components/steps/ReviewEdit.jsx',
  'utils/analyseJob.js',
];

// Patterns that indicate user-visible "AI" text (case-sensitive to avoid false positives on e.g. "repair")
// Each pattern catches "AI" as a standalone word in user-visible strings
const AI_PATTERNS = [
  /['"`].*\bAI\b.*['"`]/g,           // "AI" inside quotes (string literals)
  />\s*AI\s/g,                         // >AI  (JSX text content)
  /\bAI suggested\b/gi,               // "AI suggested" anywhere
  /\bAI analysis\b/gi,                // "AI analysis" anywhere
  /\bAI returned\b/gi,                // "AI returned" anywhere
  /\bAI service\b/gi,                 // "AI service" anywhere
  /\bthe AI\b/gi,                     // "the AI" anywhere
  /\bfrom AI\b/gi,                    // "from AI" (e.g. "Edited from AI")
  /\bAccepted AI\b/gi,               // "Accepted AI suggestion"
];

// Lines that are OK to have "AI" (comments, variable names, prop names, etc.)
const ALLOWED_LINE_PATTERNS = [
  /^\s*\/\//,                          // Single-line comments
  /^\s*\*/,                            // Block comment lines
  /^\s*\{\/\*/,                        // JSX comment opening
  /aiValue|aiUnitCost|aiEstimatedDays|aiRawResponse/i,  // Internal variable names (not user-visible)
  /import\s/,                          // Import statements
  /console\.(log|warn|error)/,         // Console statements
];

function isAllowedLine(line) {
  return ALLOWED_LINE_PATTERNS.some(p => p.test(line));
}

describe('AI text removal from user-facing components', () => {
  USER_FACING_FILES.forEach(filePath => {
    test(`${filePath} contains no user-visible "AI" text`, () => {
      const fullPath = join(srcDir, filePath);
      const content = readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n');
      const violations = [];

      lines.forEach((line, idx) => {
        if (isAllowedLine(line)) return;

        for (const pattern of AI_PATTERNS) {
          pattern.lastIndex = 0; // Reset regex state
          const match = pattern.exec(line);
          if (match) {
            violations.push({
              line: idx + 1,
              text: line.trim(),
              match: match[0],
            });
          }
        }
      });

      if (violations.length > 0) {
        const details = violations.map(v => `  Line ${v.line}: "${v.match}" in: ${v.text}`).join('\n');
        fail(`Found ${violations.length} user-visible "AI" reference(s) in ${filePath}:\n${details}`);
      }
    });
  });

  test('JobDetails.jsx does not contain user-facing "AI" text (excluding system prompt and comments)', () => {
    const fullPath = join(srcDir, 'components/steps/JobDetails.jsx');
    const content = readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const violations = [];

    // Only check outside the SYSTEM_PROMPT constant (which is the AI's own instructions)
    let insideSystemPrompt = false;

    lines.forEach((line, idx) => {
      // Track whether we're inside the SYSTEM_PROMPT template literal
      if (line.includes('const SYSTEM_PROMPT = `') || line.includes("SYSTEM_PROMPT = `")) {
        insideSystemPrompt = true;
        return;
      }
      if (insideSystemPrompt && line.includes('`;')) {
        insideSystemPrompt = false;
        return;
      }
      if (insideSystemPrompt) return;
      if (isAllowedLine(line)) return;

      // Check for user-facing strings with "AI" in JSX/string contexts
      const userFacingPatterns = [
        /['"`].*\bthe AI\b.*['"`]/gi,
        /['"`].*\bAI should\b.*['"`]/gi,
        /['"`].*\bAI uses\b.*['"`]/gi,
        /['"`].*\bAI returned\b.*['"`]/gi,
        /['"`].*\bAI analysis\b.*['"`]/gi,
      ];

      for (const pattern of userFacingPatterns) {
        pattern.lastIndex = 0;
        const match = pattern.exec(line);
        if (match) {
          violations.push({
            line: idx + 1,
            text: line.trim(),
            match: match[0],
          });
        }
      }
    });

    if (violations.length > 0) {
      const details = violations.map(v => `  Line ${v.line}: "${v.match}" in: ${v.text}`).join('\n');
      fail(`Found ${violations.length} user-visible "AI" reference(s) in JobDetails.jsx:\n${details}`);
    }
  });
});
