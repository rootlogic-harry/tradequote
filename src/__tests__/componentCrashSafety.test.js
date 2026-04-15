/**
 * Component crash-safety audit tests.
 *
 * Uses readFileSync source-scan pattern to verify defensive defaults
 * and null-safety guards across all React components.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');

function readComponent(relativePath) {
  return readFileSync(join(srcDir, relativePath), 'utf-8');
}

function collectJsxFiles(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) collectJsxFiles(full, acc);
    else if (/\.jsx$/.test(entry)) acc.push(full);
  }
  return acc;
}

// ─── 1. isAdminPlan defaults to false in every component that accepts it ───

describe('isAdminPlan defaults to false', () => {
  const allJsx = collectJsxFiles(join(srcDir, 'components'));

  const filesWithAdminProp = allJsx.filter(f => {
    const src = readFileSync(f, 'utf-8');
    // Match destructuring patterns that include isAdminPlan in function params
    return /\{\s*[^}]*isAdminPlan[^}]*\}/.test(src) && /export\s+default\s+function/.test(src);
  });

  test('at least 5 components accept isAdminPlan', () => {
    expect(filesWithAdminProp.length).toBeGreaterThanOrEqual(5);
  });

  filesWithAdminProp.forEach(file => {
    const shortName = file.replace(srcDir + '/', '');
    test(`${shortName} defaults isAdminPlan to false`, () => {
      const src = readFileSync(file, 'utf-8');
      // Find the function signature line(s) that contain isAdminPlan
      // Must contain isAdminPlan = false (with optional whitespace)
      const hasDefault = /isAdminPlan\s*=\s*false/.test(src);
      expect(hasDefault).toBe(true);
    });
  });
});

// ─── 2. StatusModal null guard on modal prop ───

describe('StatusModal crash safety', () => {
  const src = readComponent('components/StatusModal.jsx');

  test('has null guard before destructuring modal', () => {
    // Must return early if modal is falsy before destructuring
    const lines = src.split('\n');
    const destructLine = lines.findIndex(l => /const\s*\{\s*jobId/.test(l));
    const guardLine = lines.findIndex(l => /if\s*\(\s*!modal\s*\)/.test(l));
    expect(guardLine).toBeGreaterThan(-1);
    expect(guardLine).toBeLessThan(destructLine);
  });

  test('isAdminPlan defaults to false', () => {
    expect(/isAdminPlan\s*=\s*false/.test(src)).toBe(true);
  });
});

// ─── 3. UserSelector null-safe array and string access ───

describe('UserSelector crash safety', () => {
  const src = readComponent('components/UserSelector.jsx');

  test('users prop has default empty array', () => {
    expect(/users\s*=\s*\[\]/.test(src)).toBe(true);
  });

  test('user.name access is null-safe', () => {
    // Should use (user.name || '') or user.name?.charAt or optional chaining
    const nameAccess = src.match(/user\.name\.charAt/g);
    // If direct .name.charAt exists, it should be guarded
    if (nameAccess) {
      // Must be wrapped in fallback: (user.name || '').charAt or user.name?.charAt
      const safeAccess = src.match(/\(user\.name\s*\|\|\s*['"]['"]?\)\.charAt|user\.name\?\.charAt/g);
      expect(safeAccess).not.toBeNull();
      expect(safeAccess.length).toBeGreaterThanOrEqual(nameAccess.length);
    }
  });
});

// ─── 4. UserSwitcher null-safe guards ───

describe('UserSwitcher crash safety', () => {
  const src = readComponent('components/UserSwitcher.jsx');

  test('allUsers access is null-safe', () => {
    // Must have (allUsers || []) or allUsers?.filter or default param
    const hasGuard = /\(allUsers\s*\|\|\s*\[\]\)\.filter|allUsers\s*=\s*\[\]|allUsers\?\.filter/.test(src);
    expect(hasGuard).toBe(true);
  });

  test('currentUser.name access is null-safe', () => {
    // All .name.charAt calls should be guarded
    const lines = src.split('\n');
    const nameCharAtLines = lines.filter(l => /\.name\.charAt/.test(l) && !/\/\//.test(l));
    nameCharAtLines.forEach(line => {
      const safe = /\(.*\.name\s*\|\|\s*['"]['"]\)\.charAt|\.name\?\.charAt/.test(line);
      expect(safe).toBe(true);
    });
  });
});

// ─── 5. LearningDashboard null-safe data destructuring ───

describe('LearningDashboard crash safety', () => {
  const src = readComponent('components/LearningDashboard.jsx');

  test('data destructuring has fallback defaults', () => {
    // Should have: data || {} or defaults on destructured fields
    const hasDataGuard = /=\s*data\s*\|\|\s*\{\}/.test(src);
    const hasFieldDefaults = /fieldBias\s*=\s*\[\]/.test(src) && /weeklyTrend\s*=\s*\[\]/.test(src);
    expect(hasDataGuard || hasFieldDefaults).toBe(true);
  });
});

// ─── 6. QuoteDocument photos null-safe ───

describe('QuoteDocument crash safety', () => {
  const src = readComponent('components/QuoteDocument.jsx');

  test('photos destructured with default empty object', () => {
    // Must have photos = {} in destructuring
    expect(/photos\s*=\s*\{\}/.test(src)).toBe(true);
  });
});

// ─── 7. QuoteOutput clientName.replace null-safe ───

describe('QuoteOutput crash safety', () => {
  const src = readComponent('components/steps/QuoteOutput.jsx');

  test('clientName.replace calls are null-safe', () => {
    // All .clientName.replace calls must have fallback
    const lines = src.split('\n');
    const replaceLines = lines.filter(l => /clientName.*\.replace/.test(l));
    expect(replaceLines.length).toBeGreaterThan(0);
    replaceLines.forEach(line => {
      const safe = /\(.*clientName\s*\|\|\s*['"]['"]\)\.replace|clientName\?\.replace/.test(line);
      expect(safe).toBe(true);
    });
  });
});

// ─── 8. ScheduleList null-safe array prop ───

describe('ScheduleList crash safety', () => {
  const src = readComponent('components/review/ScheduleList.jsx');

  test('scheduleOfWorks has default empty array', () => {
    expect(/scheduleOfWorks\s*=\s*\[\]/.test(src)).toBe(true);
  });
});

// ─── 9. MaterialsTable null-safe array prop ───

describe('MaterialsTable crash safety', () => {
  const src = readComponent('components/review/MaterialsTable.jsx');

  test('materials has default empty array', () => {
    expect(/materials\s*=\s*\[\]/.test(src)).toBe(true);
  });
});

// ─── 10. AgentActivity API response array guard ───

describe('AgentActivity crash safety', () => {
  const src = readComponent('components/AgentActivity.jsx');

  test('setRuns guards against non-array API response', () => {
    expect(/Array\.isArray\(data\)/.test(src)).toBe(true);
  });
});

// ─── 11. CalibrationManager API response array guard ───

describe('CalibrationManager crash safety', () => {
  const src = readComponent('components/CalibrationManager.jsx');

  test('setNotes guards against non-array API response', () => {
    expect(/Array\.isArray\(data\)/.test(src)).toBe(true);
  });
});

// ─── 12. SavedQuoteViewer null-safe quote access ───

describe('SavedQuoteViewer crash safety', () => {
  const src = readComponent('components/SavedQuoteViewer.jsx');

  test('quote.id access uses optional chaining', () => {
    // Must use quote?.id in the useEffect guard
    expect(/quote\?\.id/.test(src)).toBe(true);
  });
});

// ─── 13. LabourSection null-safe labourEstimate ───

describe('LabourSection crash safety', () => {
  const src = readComponent('components/review/LabourSection.jsx');

  test('labourEstimate has default empty object', () => {
    expect(/labourEstimate\s*=\s*\{\}/.test(src)).toBe(true);
  });
});

// ─── 14. Global scan: no unguarded .map() on non-defaulted props ───

describe('Global safety checks', () => {
  const allJsx = collectJsxFiles(join(srcDir, 'components'));

  test('no component has isAdminPlan defaulting to true', () => {
    const violations = [];
    for (const file of allJsx) {
      const src = readFileSync(file, 'utf-8');
      if (/isAdminPlan\s*=\s*true/.test(src)) {
        violations.push(file.replace(srcDir + '/', ''));
      }
    }
    expect(violations).toEqual([]);
  });

  test('components with photos = {} default in QuoteOutput', () => {
    const src = readComponent('components/steps/QuoteOutput.jsx');
    expect(/photos\s*=\s*\{\}/.test(src)).toBe(true);
  });

  test('components with extraPhotos = [] default in QuoteOutput', () => {
    const src = readComponent('components/steps/QuoteOutput.jsx');
    expect(/extraPhotos\s*=\s*\[\]/.test(src)).toBe(true);
  });
});

// ─── 15. Conditional rendering: no falsy-0 risks on numeric renders ───

describe('Conditional rendering safety', () => {
  const allJsx = collectJsxFiles(join(srcDir, 'components'));

  test('no {count && <Component>} pattern that leaks 0 to DOM', () => {
    const violations = [];
    for (const file of allJsx) {
      const src = readFileSync(file, 'utf-8');
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        // Pattern: {someCount && <...>} where someCount could be 0
        // This catches {count && ...} but not {count > 0 && ...}
        const match = line.match(/\{\s*([\w.]+Count|[\w.]+\.length)\s*&&\s*[<(]/);
        if (match) {
          // Check it's not already guarded with > 0 or !== 0
          if (!/>\s*0\s*&&|!==\s*0\s*&&/.test(line)) {
            violations.push(`${file.replace(srcDir + '/', '')}:${i + 1}: ${line.trim()}`);
          }
        }
      });
    }
    // Document any violations found; currently there should be none in the codebase
    // (the codebase uses > 0 patterns correctly)
    expect(violations).toEqual([]);
  });
});

// ─── 16. StepIndicator isAdminPlan default ───

describe('StepIndicator crash safety', () => {
  const src = readComponent('components/StepIndicator.jsx');

  test('isAdminPlan defaults to false', () => {
    expect(/isAdminPlan\s*=\s*false/.test(src)).toBe(true);
  });
});
