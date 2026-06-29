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

  // 2026-06-29 refit: original 10k threshold was unrealistic (base
  // prompt alone is 20k+). Bumped to 30k for the absolute alarm and
  // added a separate notes-share > 50% alarm as the actionable signal.
  test('absolute alarm threshold is 30,000 chars (2026-06-29 refit)', () => {
    expect(routeBody).toMatch(/PROMPT_CHARS_ALARM_THRESHOLD\s*=\s*30000/);
  });

  test('notes-share alarm threshold is 50%', () => {
    expect(routeBody).toMatch(/NOTES_SHARE_ALARM_THRESHOLD\s*=\s*0\.5/);
  });

  test('response payload includes a promptSize block with base/notes breakdown', () => {
    expect(routeBody).toMatch(/promptSize:\s*\{/);
    // Required keys for the dashboard contract.
    expect(routeBody).toContain('current:');
    expect(routeBody).toContain('avg20:');
    expect(routeBody).toContain('alarm:');
    expect(routeBody).toContain('threshold:');
    expect(routeBody).toContain('history:');
    // 2026-06-29 additions
    expect(routeBody).toContain('basePromptChars');
    expect(routeBody).toContain('notesChars');
    expect(routeBody).toContain('notesCount');
    expect(routeBody).toContain('notesShare');
    expect(routeBody).toContain('absoluteAlarm');
    expect(routeBody).toContain('shareAlarm');
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

  test('alarm banner uses the "calibration corpus" admin-only copy (share-alarm variant)', () => {
    // Per the original ticket: "calibration corpus is growing — consider pruning notes".
    // 2026-06-29 refit: the phrase now only appears in the share-alarm
    // variant (when notes are ≥50% of the prompt). Absolute alarm has
    // separate copy. Both must still be admin-vocab.
    expect(dashboardSource).toMatch(/calibration corpus/i);
    expect(dashboardSource).toMatch(/pruning superseded notes/i);
  });

  test('alarm banner shows the base-prompt + notes breakdown (2026-06-29)', () => {
    // Banner copy fragments — match the exact wording.
    expect(dashboardSource).toMatch(/— base/);
    expect(dashboardSource).toMatch(/calibration notes/i);
    expect(dashboardSource).toMatch(/basePromptChars/);
    expect(dashboardSource).toMatch(/notesChars/);
    expect(dashboardSource).toMatch(/notesCount/);
    expect(dashboardSource).toMatch(/sharePct/);
  });

  test('alarm banner has role="alert" for accessibility', () => {
    expect(dashboardSource).toMatch(/role=["']alert["']/);
  });
});

describe('TRQ-176: alarm threshold logic (2026-06-29 dual-condition)', () => {
  // Pure JS replica of the server's alarm rule. Asserting the rule
  // directly so a future refactor can't silently flip the thresholds.
  function shouldAlarm(history, notesChars = 0, opts = {}) {
    const absoluteThreshold = opts.absoluteThreshold ?? 30000;
    const shareThreshold = opts.shareThreshold ?? 0.5;
    if (!Array.isArray(history) || history.length === 0) return false;
    const last20 = history.slice(0, 20);
    const avg = last20.reduce((s, r) => s + r.promptChars, 0) / last20.length;
    const share = avg > 0 ? notesChars / avg : 0;
    return avg > absoluteThreshold || share > shareThreshold;
  }

  test('returns false on empty history (no jobs yet)', () => {
    expect(shouldAlarm([], 0)).toBe(false);
  });

  test('returns false when avg-of-last-20 is well below absolute threshold and notes share is low', () => {
    const history = Array.from({ length: 20 }, () => ({ promptChars: 25000 }));
    expect(shouldAlarm(history, 5000)).toBe(false); // 5k/25k = 20% share
  });

  test('returns false at exactly the absolute threshold (strict >)', () => {
    const history = Array.from({ length: 20 }, () => ({ promptChars: 30000 }));
    expect(shouldAlarm(history, 5000)).toBe(false);
  });

  test('returns true when avg-of-last-20 exceeds 30,000 chars (absolute alarm)', () => {
    const history = Array.from({ length: 20 }, () => ({ promptChars: 30001 }));
    expect(shouldAlarm(history, 5000)).toBe(true);
  });

  test('returns true when notes share exceeds 50% (share alarm) even if absolute is fine', () => {
    // 25k total prompt, 13k notes = 52% share — share alarm fires
    const history = Array.from({ length: 20 }, () => ({ promptChars: 25000 }));
    expect(shouldAlarm(history, 13000)).toBe(true);
  });

  test('returns false at exactly the share threshold (strict >)', () => {
    const history = Array.from({ length: 20 }, () => ({ promptChars: 20000 }));
    expect(shouldAlarm(history, 10000)).toBe(false); // exactly 50%
  });

  test('returns true when both alarms fire', () => {
    const history = Array.from({ length: 20 }, () => ({ promptChars: 40000 }));
    expect(shouldAlarm(history, 25000)).toBe(true);
  });

  test('uses only the last 20 even when more history is present', () => {
    const newest20 = Array.from({ length: 20 }, () => ({ promptChars: 32000 }));
    const olderTail = Array.from({ length: 30 }, () => ({ promptChars: 1000 }));
    expect(shouldAlarm([...newest20, ...olderTail], 5000)).toBe(true);
  });

  test('current production state (~28k total, ~7.7k notes, 27% share) does NOT alarm', () => {
    // Regression guard for the 2026-06-29 refit — the threshold rework
    // was prompted by the alarm firing wrongly on this exact state.
    const history = Array.from({ length: 20 }, () => ({ promptChars: 28757 }));
    expect(shouldAlarm(history, 7736)).toBe(false);
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
