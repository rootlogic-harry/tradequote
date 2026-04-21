/**
 * Profile accent colour — picker UI + server whitelist + reducer default.
 *
 * Tradesmen pick the colour that tints the customer portal's primary
 * actions and total-box trim (TRQ-126). Four options, stored in
 * `profiles.data.accent`. Fail-closed on bad values — unknown strings
 * default to `amber` on render and are rejected with 400 on save.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

describe('reducer — accent in default profile', () => {
  test('initial state.profile.accent defaults to "amber"', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const state = reducer(initialState, { type: '@@INIT' });
    expect(state.profile.accent).toBe('amber');
  });

  test('UPDATE_PROFILE action can change the accent', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const initial = reducer(initialState, { type: '@@INIT' });
    const next = reducer(initial, { type: 'UPDATE_PROFILE', updates: { accent: 'moss' } });
    expect(next.profile.accent).toBe('moss');
    // Other fields untouched.
    expect(next.profile.companyName).toBe(initial.profile.companyName);
    expect(next.profile.vatRegistered).toBe(initial.profile.vatRegistered);
  });

  test('SELECT_USER merges a loaded profile without an accent → still amber', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const initial = reducer(initialState, { type: '@@INIT' });
    const next = reducer(initial, {
      type: 'SELECT_USER',
      userId: 'u',
      name: 'U',
      profile: { companyName: 'Old Co', vatRegistered: true }, // no accent key
      quoteSequence: 1,
    });
    expect(next.profile.accent).toBe('amber');
  });

  test('SELECT_USER with accent="rust" round-trips', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const initial = reducer(initialState, { type: '@@INIT' });
    const next = reducer(initial, {
      type: 'SELECT_USER',
      userId: 'u',
      name: 'U',
      profile: { accent: 'rust' },
      quoteSequence: 1,
    });
    expect(next.profile.accent).toBe('rust');
  });
});

describe('ProfileSetup.jsx — swatch picker UI', () => {
  const src = readFileSync(join(repoRoot, 'src/components/steps/ProfileSetup.jsx'), 'utf8');

  test('renders a heading/eyebrow for the accent picker', () => {
    // Either "Quote Accent" or "Portal Accent" — either is acceptable
    // copy. Just need the user-facing label present somewhere.
    expect(src).toMatch(/Quote Accent|Portal Accent|Accent Colour/i);
  });

  test('ships all four allowed values (amber, rust, moss, slate)', () => {
    for (const accent of ['amber', 'rust', 'moss', 'slate']) {
      expect(src).toMatch(new RegExp(`['"]${accent}['"]`));
    }
  });

  test('wires each swatch to UPDATE_PROFILE via update("accent", …)', () => {
    // A consistent pattern in this file: buttons / inputs call update(key, value).
    // The accent picker must follow the same pattern so the auto-save kicks in.
    expect(src).toMatch(/update\s*\(\s*['"]accent['"]/);
  });
});

describe('server — PUT /profile rejects non-whitelisted accent values', () => {
  const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

  test('has an accent whitelist constant', () => {
    // Named constant makes the whitelist greppable and reusable
    // (same shape as ACCENT_WHITELIST in portalRenderer).
    expect(serverSrc).toMatch(/ACCENT_WHITELIST\s*=\s*\[?\{?\s*['"`]amber['"`]/);
  });

  test('PUT /api/users/:id/profile validates the accent field', () => {
    const block = serverSrc.match(
      /app\.put\(\s*['"`]\/api\/users\/:id\/profile['"`][\s\S]*?\n\}\)/
    );
    expect(block).not.toBeNull();
    const body = block[0];
    // Either explicit guard or delegation to a helper that throws 400.
    expect(body).toMatch(/accent/);
    expect(body).toMatch(/400|bad request|invalid/i);
  });
});
