import { isAdminPlan } from '../utils/isAdminPlan.js';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

// --- isAdminPlan utility ---

describe('isAdminPlan utility', () => {
  test('returns true for plan === "admin"', () => {
    expect(isAdminPlan('admin')).toBe(true);
  });

  test('returns false for "basic"', () => {
    expect(isAdminPlan('basic')).toBe(false);
  });

  test('returns false for "standard"', () => {
    expect(isAdminPlan('standard')).toBe(false);
  });

  test('returns false for null', () => {
    expect(isAdminPlan(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isAdminPlan(undefined)).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isAdminPlan('')).toBe(false);
  });

  test('accepts user object: { plan: "admin" } → true', () => {
    expect(isAdminPlan({ plan: 'admin' })).toBe(true);
  });

  test('accepts user object: { plan: "basic" } → false', () => {
    expect(isAdminPlan({ plan: 'basic' })).toBe(false);
  });

  test('accepts null user → false', () => {
    expect(isAdminPlan(null)).toBe(false);
  });
});

// --- Source-level assertion: isAdminPlan is sole admin branching primitive ---

describe('isAdminPlan is sole admin branching primitive', () => {
  function collectJsFiles(dir, acc = []) {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (entry === 'node_modules' || entry === '__tests__' || entry === 'dist') continue;
      const stat = statSync(full);
      if (stat.isDirectory()) collectJsFiles(full, acc);
      else if (/\.(js|jsx)$/.test(entry)) acc.push(full);
    }
    return acc;
  }

  test('no raw plan === "admin" or plan !== "admin" outside isAdminPlan definition and requireAdminPlan middleware', () => {
    const srcDir = join(process.cwd(), 'src');
    const files = collectJsFiles(srcDir);
    const violations = [];

    for (const file of files) {
      // Skip the utility file itself
      if (file.endsWith('isAdminPlan.js')) continue;

      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');
      lines.forEach((line, i) => {
        // Match plan === 'admin', plan !== 'admin', plan === "admin", plan !== "admin"
        if (/plan\s*[!=]==?\s*['"]admin['"]/.test(line)) {
          violations.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }

    expect(violations).toEqual([]);
  });
});
