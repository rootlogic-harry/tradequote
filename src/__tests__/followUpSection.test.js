/**
 * Dashboard "Needs follow-up" section — portal insights surface.
 *
 * Source-level assertions (matching the codebase's test style) for the
 * new section that lists viewed-but-silent quotes and wires Call /
 * WhatsApp / Copy link actions for Paul.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dashboardSrc = readFileSync(
  join(__dirname, '..', 'components', 'Dashboard.jsx'),
  'utf-8'
);

describe('Dashboard — "Needs follow-up" section wiring', () => {
  test('imports the portalFollowUp helpers', () => {
    expect(dashboardSrc).toMatch(/needsFollowUp/);
    expect(dashboardSrc).toMatch(/relativeViewedLabel/);
    expect(dashboardSrc).toMatch(/normaliseUkPhoneForWhatsApp/);
  });

  test('renders <FollowUpSection jobs={jobs} />', () => {
    expect(dashboardSrc).toMatch(/<FollowUpSection[^/]*jobs=\{jobs\}/);
  });

  test('FollowUpSection filters jobs via needsFollowUp()', () => {
    const body = dashboardSrc.match(/function FollowUpSection[\s\S]*?^}/m)?.[0] || '';
    expect(body).toMatch(/needsFollowUp/);
    expect(body).toMatch(/\.filter\(/);
  });

  test('FollowUpSection renders nothing when the list is empty (no empty header)', () => {
    // Paul shouldn't see an empty "Needs follow-up" block on every
    // fresh login — that's noise. Only render when there's actual
    // follow-up work.
    const body = dashboardSrc.match(/function FollowUpSection[\s\S]*?^}/m)?.[0] || '';
    expect(body).toMatch(/followUps\.length === 0/);
    expect(body).toMatch(/return null/);
  });

  test('FollowUpRow shows a Call link with tel: href (all-3 channel brief)', () => {
    const body = dashboardSrc.match(/function FollowUpRow[\s\S]*?^}/m)?.[0] || '';
    expect(body).toMatch(/href=\{`tel:\$\{/);
  });

  test('FollowUpRow shows a WhatsApp link with wa.me URL', () => {
    const body = dashboardSrc.match(/function FollowUpRow[\s\S]*?^}/m)?.[0] || '';
    expect(body).toMatch(/href=\{`https:\/\/wa\.me\/\$\{waPhone\}`\}/);
  });

  test('FollowUpRow shows a Copy link button wired to navigator.clipboard', () => {
    const body = dashboardSrc.match(/function FollowUpRow[\s\S]*?^}/m)?.[0] || '';
    expect(body).toMatch(/navigator\.clipboard/);
    expect(body).toMatch(/Copy link/);
  });

  test('Call + WhatsApp are hidden when no phone is on file (no dead buttons)', () => {
    // Conditional rendering: if clientPhone is blank, Call and
    // WhatsApp must not render. Copy link always works.
    const body = dashboardSrc.match(/function FollowUpRow[\s\S]*?^}/m)?.[0] || '';
    expect(body).toMatch(/\{clientPhone &&[\s\S]*?Call/);
    expect(body).toMatch(/\{waPhone &&[\s\S]*?WhatsApp/);
  });

  test('decline reasons are NOT shown here (quiet per Paul\'s brief)', () => {
    // Declined quotes don't appear in follow-up (filtered out by
    // needsFollowUp), but we also defensively don't render any decline
    // reason field on these rows.
    const body = dashboardSrc.match(/function FollowUpRow[\s\S]*?^}/m)?.[0] || '';
    expect(body).not.toMatch(/declineReason|decline_reason/);
  });

  test('portal URL is built from window.location.origin (not hardcoded)', () => {
    // Works in dev (localhost) and prod (fastquote.uk) without config.
    const body = dashboardSrc.match(/function buildPortalUrl[\s\S]*?^}/m)?.[0] || '';
    expect(body).toMatch(/window\.location\?\.origin/);
  });
});

describe('JobDetails form — optional client phone field', () => {
  const jobDetailsSrc = readFileSync(
    join(__dirname, '..', 'components', 'steps', 'JobDetails.jsx'),
    'utf-8'
  );

  test('adds a phone input field (optional, marked as such)', () => {
    expect(jobDetailsSrc).toMatch(/Client Phone/);
    expect(jobDetailsSrc).toMatch(/optional/i);
    expect(jobDetailsSrc).toMatch(/clientPhone/);
  });

  test('phone input uses type=tel + inputMode=tel for mobile keyboards', () => {
    // Paul often enters data on his iPad — the tel keyboard is the
    // only sane default for a phone number.
    expect(jobDetailsSrc).toMatch(/type="tel"/);
    expect(jobDetailsSrc).toMatch(/inputMode="tel"/);
  });
});

describe('Reducer initial state — clientPhone present', () => {
  const reducerSrc = readFileSync(
    join(__dirname, '..', 'reducer.js'),
    'utf-8'
  );

  test('clientPhone is in the jobDetails initial shape', () => {
    // If it's missing, controlled-input warnings trigger on new quotes
    // and the first save drops the field silently.
    expect(reducerSrc).toMatch(/clientPhone:\s*['"]/);
  });
});
