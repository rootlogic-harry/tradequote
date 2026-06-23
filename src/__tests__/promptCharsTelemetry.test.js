/**
 * TRQ-176: Prompt-length budget telemetry.
 *
 * The DYNAMIC CALIBRATION NOTES section is appended to SYSTEM_PROMPT on
 * every analyse call. There was previously no telemetry on the grown
 * prompt size — after enough approved notes Sonnet's accuracy could
 * degrade from instruction overload with nobody knowing.
 *
 * Storage: `jobs.prompt_chars INT` (matches the prompt_version pattern
 * landed in PR #47). Stamped at job-save time via a helper that mirrors
 * computeCurrentPromptVersion, so both observability fields agree on
 * the same calibration-notes snapshot.
 *
 * Source-level scans (no DB required) + a unit test of the alarm
 * threshold logic. The 2026-06-20 eval review surfaced this gap;
 * 2026-06-23 implementation.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverSource = readFileSync(join(__dirname, '../../server.js'), 'utf8');
const dashboardSource = readFileSync(
  join(__dirname, '../components/LearningDashboard.jsx'),
  'utf8'
);

describe('TRQ-176: prompt_chars schema additive migration', () => {
  test('initDB adds prompt_chars column with IF NOT EXISTS (additive)', () => {
    expect(serverSource).toMatch(
      /ALTER TABLE jobs ADD COLUMN IF NOT EXISTS prompt_chars\s+INTEGER/
    );
  });

  test('migration is additive — no DROP / RENAME of prompt_chars', () => {
    expect(serverSource).not.toMatch(/DROP COLUMN[^;]*prompt_chars/);
    expect(serverSource).not.toMatch(/RENAME COLUMN[^;]*prompt_chars/);
  });
});

describe('TRQ-176: computeCurrentPromptChars helper', () => {
  // Bound the helper body by the next async function declaration so we
  // don't false-positive against unrelated code further down server.js.
  const helperStart = serverSource.indexOf(
    'async function computeCurrentPromptChars'
  );
  const helperEnd = serverSource.indexOf('async function logAdminAction');
  const helperBody = serverSource.slice(helperStart, helperEnd);

  test('helper is defined', () => {
    expect(helperStart).toBeGreaterThan(-1);
  });

  test('helper queries approved calibration notes (same shape as version helper)', () => {
    expect(helperBody).toContain('calibration_notes');
    expect(helperBody).toContain("status = 'approved'");
    expect(helperBody).toContain('ORDER BY approved_at ASC');
  });

  test('helper appends DYNAMIC CALIBRATION NOTES section to match /analyse augmentation', () => {
    // Char count must reflect what's actually sent to Sonnet at analyse
    // time. The photo path appends "DYNAMIC CALIBRATION NOTES (auto-
    // generated…)" exactly — the helper must too.
    expect(helperBody).toContain('DYNAMIC CALIBRATION NOTES');
  });

  test('helper returns augmentedPrompt.length, not the version hash', () => {
    expect(helperBody).toContain('augmentedPrompt.length');
    expect(helperBody).not.toContain('computePromptVersion');
  });

  test('helper returns null on DB failure rather than throwing', () => {
    // A failing prompt-chars compute must not break job save —
    // observability data, not load-bearing.
    expect(helperBody).toMatch(/try\s*\{/);
    expect(helperBody).toContain('catch');
    expect(helperBody).toContain('return null');
  });
});

describe('TRQ-176: POST /api/users/:id/jobs stamps prompt_chars', () => {
  // Bound the POST handler body so assertions don't match unrelated
  // jobs routes further down the file.
  const routeStart = serverSource.indexOf("app.post('/api/users/:id/jobs',");
  const routeEnd = serverSource.indexOf(
    "app.put('/api/users/:id/jobs/:jobId',"
  );
  const routeBody = serverSource.slice(routeStart, routeEnd);

  test('POST handler calls computeCurrentPromptChars()', () => {
    expect(routeBody).toContain('computeCurrentPromptChars()');
  });

  test('INSERT statement references prompt_chars as a column', () => {
    expect(routeBody).toMatch(/INSERT INTO jobs[^;]*prompt_chars/);
  });

  test('INSERT parameters include the promptChars binding', () => {
    // Belt-and-braces: confirm the values list passes promptChars to the
    // bound parameter (immediately followed by promptVersion in the
    // current ordering — see server.js INSERT column order).
    expect(routeBody).toMatch(/promptChars,\s*\n?\s*promptVersion/);
  });
});

describe('TRQ-176: /api/admin/learning surfaces prompt size data', () => {
  // Bound the learning route body so assertions can't match later routes.
  const routeStart = serverSource.indexOf("'/api/admin/learning'");
  const routeEnd = serverSource.indexOf('// --- Admin User Management ---');
  const routeBody = serverSource.slice(routeStart, routeEnd);

  test('route fetches the last 50 saved jobs ordered by saved_at DESC', () => {
    // Newest-first so sparkline left→right shows oldest→newest after
    // reverse on the client. Last 50 chosen so the alarm metric (avg-
    // of-last-20) is always derivable from the same payload.
    expect(routeBody).toMatch(/FROM jobs[\s\S]*ORDER BY saved_at DESC[\s\S]*LIMIT 50/);
    expect(routeBody).toMatch(/prompt_chars IS NOT NULL/);
  });

  test('route computes avg-of-last-20 for the alarm threshold', () => {
    expect(routeBody).toContain('promptCharsAvg20');
    expect(routeBody).toContain('slice(0, 20)');
  });

  test('alarm threshold is 10,000 chars per the brief', () => {
    expect(routeBody).toMatch(/PROMPT_CHARS_ALARM_THRESHOLD\s*=\s*10000/);
  });

  test('response payload includes a promptSize block', () => {
    expect(routeBody).toMatch(/promptSize:\s*\{/);
    // Required keys for the dashboard contract.
    expect(routeBody).toContain('current:');
    expect(routeBody).toContain('avg20:');
    expect(routeBody).toContain('alarm:');
    expect(routeBody).toContain('threshold:');
    expect(routeBody).toContain('history:');
  });

  test('route is gated by requireAdminPlan (Visibility Rules)', () => {
    // The route signature must include requireAdminPlan so basic users
    // can never reach the endpoint. /api/admin/learning is the only
    // surface that exposes prompt size data.
    const sigStart = serverSource.indexOf("app.get('/api/admin/learning'");
    const sigEnd = serverSource.indexOf(',', serverSource.indexOf('async (req, res)', sigStart));
    const sig = serverSource.slice(sigStart, sigEnd);
    expect(sig).toContain('requireAdminPlan');
  });
});

describe('TRQ-176: LearningDashboard renders prompt size + alarm', () => {
  test('destructures promptSize from the API payload', () => {
    expect(dashboardSource).toContain('promptSize');
  });

  test('renders the PromptSizePanel inside a Section titled "Prompt Size"', () => {
    expect(dashboardSource).toContain('Prompt Size (Last 50 Quotes)');
    expect(dashboardSource).toContain('PromptSizePanel');
  });

  test('PromptSizePanel renders a sparkline component', () => {
    expect(dashboardSource).toContain('Sparkline');
    // Must use SVG (no chart library)
    expect(dashboardSource).toMatch(/<svg[\s\S]*viewBox=/);
  });

  test('PromptSizePanel shows current + avg-of-last-20 + threshold stats', () => {
    expect(dashboardSource).toContain('Current');
    expect(dashboardSource).toContain('Avg (Last 20)');
    expect(dashboardSource).toContain('Threshold');
  });

  test('alarm banner renders only when promptSize.alarm is true', () => {
    // Conditional render — banner must be gated on .alarm so it doesn't
    // shout at admin every page load.
    expect(dashboardSource).toMatch(
      /promptSize\s*&&\s*promptSize\.alarm\s*&&[\s\S]*PromptBudgetAlarm/
    );
  });

  test('alarm banner uses the "calibration corpus" admin-only copy', () => {
    // Per the ticket: "calibration corpus is growing — consider pruning notes".
    expect(dashboardSource).toMatch(/calibration corpus/i);
    expect(dashboardSource).toMatch(/pruning notes/i);
  });

  test('alarm banner has role="alert" for accessibility', () => {
    expect(dashboardSource).toMatch(/role=["']alert["']/);
  });
});

describe('TRQ-176: alarm threshold logic', () => {
  // Pure JS replica of the server's alarm rule. Asserting the rule
  // directly so a future refactor can't silently flip the threshold.
  function shouldAlarm(history, threshold = 10000) {
    if (!Array.isArray(history) || history.length === 0) return false;
    const last20 = history.slice(0, 20);
    const avg = last20.reduce((s, r) => s + r.promptChars, 0) / last20.length;
    return avg > threshold;
  }

  test('returns false on empty history (no jobs yet)', () => {
    expect(shouldAlarm([])).toBe(false);
  });

  test('returns false when avg-of-last-20 is well below threshold', () => {
    const history = Array.from({ length: 20 }, () => ({ promptChars: 5000 }));
    expect(shouldAlarm(history)).toBe(false);
  });

  test('returns false at exactly the threshold (strict >)', () => {
    const history = Array.from({ length: 20 }, () => ({ promptChars: 10000 }));
    expect(shouldAlarm(history)).toBe(false);
  });

  test('returns true when avg-of-last-20 exceeds 10,000 chars', () => {
    const history = Array.from({ length: 20 }, () => ({ promptChars: 10001 }));
    expect(shouldAlarm(history)).toBe(true);
  });

  test('uses only the last 20 even when more history is present', () => {
    // First 20 jobs avg 12,000 (over threshold). Older 30 jobs are 1,000.
    // shouldAlarm receives newest-first history, so slice(0,20) is the
    // newest 20 — alarm fires.
    const newest20 = Array.from({ length: 20 }, () => ({ promptChars: 12000 }));
    const olderTail = Array.from({ length: 30 }, () => ({ promptChars: 1000 }));
    expect(shouldAlarm([...newest20, ...olderTail])).toBe(true);
  });

  test('alarm respects a smaller sample size (< 20 jobs)', () => {
    // 3 jobs at 11,000 — avg is 11,000, above threshold.
    const history = [
      { promptChars: 11000 },
      { promptChars: 11000 },
      { promptChars: 11000 },
    ];
    expect(shouldAlarm(history)).toBe(true);
  });
});

describe('TRQ-176: prompt size data is admin-only (Visibility Rules)', () => {
  test('no basic-user component imports promptSize from the API', () => {
    // The /api/admin/learning endpoint is the sole source of promptSize.
    // Basic-user components must never read from it.
    const userFacingFiles = [
      '../components/steps/ReviewEdit.jsx',
      '../components/steps/JobDetails.jsx',
      '../components/Dashboard.jsx',
      '../components/SavedQuotes.jsx',
    ];
    for (const rel of userFacingFiles) {
      const src = readFileSync(join(__dirname, rel), 'utf8');
      expect(src).not.toContain('/api/admin/learning');
      expect(src).not.toContain('promptSize');
    }
  });

  test('LearningDashboard is mounted under isAdmin gate in App.jsx', () => {
    const appSource = readFileSync(join(__dirname, '../App.jsx'), 'utf8');
    expect(appSource).toMatch(
      /currentView === 'learning' && isAdmin[\s\S]*LearningDashboard/
    );
  });
});
