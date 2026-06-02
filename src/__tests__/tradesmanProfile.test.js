/**
 * Profile-aware prompting — multi-tenant context injection.
 *
 * The model sees a TRADESMAN PROFILE block before JOB CONTEXT so it
 * understands which tradesman it's serving before it reasons over the
 * photos. Three signals: region (context only, never used for pricing),
 * preferred stone types (tiebreaker for ambiguous photos), and mortar
 * usage (prior for whether mortar belongs).
 *
 * Critical contract: preferences are PRIORS, not VETOES. The mortar
 * conditionality prompt section already enforces "visible mortar joints
 * → mortar required". `mortarUsage: rarely` only strengthens the
 * absence-of-trigger default; it never overrides photo evidence.
 *
 * Backward compat: missing/empty fields produce an empty block, so
 * legacy users see no behavioural change until they fill in preferences.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');

describe('reducer — new tradesman profile fields', () => {
  test('region defaults to empty string', async () => {
    const { initialState } = await import('../reducer.js');
    expect(initialState.profile.region).toBe('');
  });

  test('preferredStoneTypes defaults to empty array', async () => {
    const { initialState } = await import('../reducer.js');
    expect(initialState.profile.preferredStoneTypes).toEqual([]);
  });

  test('mortarUsage defaults to null (no opinion)', async () => {
    const { initialState } = await import('../reducer.js');
    expect(initialState.profile.mortarUsage).toBeNull();
  });

  test('UPDATE_PROFILE round-trips all three fields', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const initial = reducer(initialState, { type: '@@INIT' });
    const next = reducer(initial, {
      type: 'UPDATE_PROFILE',
      updates: {
        region: 'BD12',
        preferredStoneTypes: ['gritstone', 'sandstone'],
        mortarUsage: 'rarely',
      },
    });
    expect(next.profile.region).toBe('BD12');
    expect(next.profile.preferredStoneTypes).toEqual(['gritstone', 'sandstone']);
    expect(next.profile.mortarUsage).toBe('rarely');
  });

  test('SELECT_USER on a legacy profile (no new fields) leaves defaults intact', async () => {
    const { reducer, initialState } = await import('../reducer.js');
    const initial = reducer(initialState, { type: '@@INIT' });
    const next = reducer(initial, {
      type: 'SELECT_USER',
      userId: 'mark',
      name: 'Mark',
      profile: { companyName: 'Doyle Walling', vatRegistered: true },
      quoteSequence: 1,
    });
    expect(next.profile.region).toBe('');
    expect(next.profile.preferredStoneTypes).toEqual([]);
    expect(next.profile.mortarUsage).toBeNull();
  });
});

describe('buildTradesmanProfileBlock — pure helper', () => {
  test('returns empty string when no fields are populated', async () => {
    const { buildTradesmanProfileBlock } = await import('../utils/tradesmanProfileBlock.js');
    expect(buildTradesmanProfileBlock({})).toBe('');
    expect(
      buildTradesmanProfileBlock({
        region: '',
        preferredStoneTypes: [],
        mortarUsage: null,
      })
    ).toBe('');
  });

  test('treats missing profile / undefined gracefully', async () => {
    const { buildTradesmanProfileBlock } = await import('../utils/tradesmanProfileBlock.js');
    expect(buildTradesmanProfileBlock(undefined)).toBe('');
    expect(buildTradesmanProfileBlock(null)).toBe('');
  });

  test('renders only the lines for populated fields', async () => {
    const { buildTradesmanProfileBlock } = await import('../utils/tradesmanProfileBlock.js');
    const block = buildTradesmanProfileBlock({ region: 'West Yorkshire' });
    expect(block).toMatch(/TRADESMAN PROFILE/);
    expect(block).toMatch(/Region:\s*West Yorkshire/);
    // No noise from absent fields
    expect(block).not.toMatch(/Typical stone/i);
    expect(block).not.toMatch(/Mortar usage/i);
  });

  test('renders preferred stone types as a comma-separated list', async () => {
    const { buildTradesmanProfileBlock } = await import('../utils/tradesmanProfileBlock.js');
    const block = buildTradesmanProfileBlock({
      preferredStoneTypes: ['gritstone', 'sandstone'],
    });
    expect(block).toMatch(/Typical stone types?:\s*gritstone, sandstone/);
  });

  test('renders mortar usage with the prior-not-veto framing', async () => {
    const { buildTradesmanProfileBlock } = await import('../utils/tradesmanProfileBlock.js');
    // The wording must signal: "this is a prior, photos still win".
    // Otherwise Claude could ignore visible mortar joints on a "rarely" tradesman.
    const rarely = buildTradesmanProfileBlock({ mortarUsage: 'rarely' });
    expect(rarely).toMatch(/Mortar usage:\s*rarely/);
    // Allow any wording so long as it says "photos … win/override/prevail".
    expect(rarely.toLowerCase()).toMatch(
      /photos?[^.]{0,40}\b(win|override|prevail|determine|decide)\b/
    );
  });

  test('renders all three fields together in a deterministic order', async () => {
    const { buildTradesmanProfileBlock } = await import('../utils/tradesmanProfileBlock.js');
    const block = buildTradesmanProfileBlock({
      region: 'BD12',
      preferredStoneTypes: ['gritstone'],
      mortarUsage: 'often',
    });
    // Region first, stone types second, mortar third — predictable for
    // diffing prompts and for the regression suite's source-scan tests.
    const regionIdx = block.indexOf('Region');
    const stoneIdx = block.indexOf('stone types');
    const mortarIdx = block.indexOf('Mortar usage');
    expect(regionIdx).toBeGreaterThan(-1);
    expect(stoneIdx).toBeGreaterThan(regionIdx);
    expect(mortarIdx).toBeGreaterThan(stoneIdx);
  });

  test('block does not leak banned vocabulary (design-law compliance)', async () => {
    const { buildTradesmanProfileBlock } = await import('../utils/tradesmanProfileBlock.js');
    const block = buildTradesmanProfileBlock({
      region: 'West Yorkshire',
      preferredStoneTypes: ['gritstone'],
      mortarUsage: 'rarely',
    });
    // CLAUDE.md banned vocab — must not appear as standalone words.
    // Substring match would false-positive on "dry-laid" containing "ai"
    // and other English words. Match word boundaries instead.
    for (const banned of ['AI', 'Claude', 'Sonnet', 'LLM', 'prompt', 'agent', 'confidence']) {
      const wordRe = new RegExp(`\\b${banned}\\b`, 'i');
      expect(block).not.toMatch(wordRe);
    }
  });

  test('block ends with a blank line so it composes cleanly with JOB CONTEXT', async () => {
    const { buildTradesmanProfileBlock } = await import('../utils/tradesmanProfileBlock.js');
    const block = buildTradesmanProfileBlock({ region: 'Yorkshire' });
    expect(block.endsWith('\n')).toBe(true);
  });
});

describe('ProfileSetup UI — Your Trade section', () => {
  const src = readFileSync(join(repoRoot, 'src/components/steps/ProfileSetup.jsx'), 'utf8');

  test('renders a Your Trade section heading', () => {
    expect(src).toMatch(/Your Trade/);
  });

  test('wires region field to update("region", …)', () => {
    expect(src).toMatch(/update\s*\(\s*['"]region['"]/);
  });

  test('wires preferredStoneTypes field to update("preferredStoneTypes", …)', () => {
    expect(src).toMatch(/update\s*\(\s*['"]preferredStoneTypes['"]/);
  });

  test('wires mortarUsage field to update("mortarUsage", …)', () => {
    expect(src).toMatch(/update\s*\(\s*['"]mortarUsage['"]/);
  });

  test('mortar buttons offer all three options (rarely / sometimes / often)', () => {
    for (const opt of ['rarely', 'sometimes', 'often']) {
      expect(src).toMatch(new RegExp(`key:\\s*['"]${opt}['"]`));
    }
  });

  test('stone-type pills include all five supported stones', () => {
    for (const stone of ['gritstone', 'sandstone', 'limestone', 'slate', 'granite']) {
      expect(src).toMatch(new RegExp(`['"]${stone}['"]`));
    }
  });

  test('Your Trade section lives before Quote Preferences (sets context before preferences)', () => {
    const trade = src.indexOf('Your Trade');
    const quotePrefs = src.indexOf('Quote Preferences');
    expect(trade).toBeGreaterThan(-1);
    expect(quotePrefs).toBeGreaterThan(trade);
  });
});

describe('analyse pipelines — both paths wire in the helper', () => {
  const analyseJobSrc = readFileSync(join(repoRoot, 'src/utils/analyseJob.js'), 'utf8');
  const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');

  test('photo path (analyseJob.js) imports buildTradesmanProfileBlock', () => {
    expect(analyseJobSrc).toMatch(/buildTradesmanProfileBlock/);
    // Import path ends in '.js' — allow optional extension before the closing quote.
    expect(analyseJobSrc).toMatch(/from ['"].*tradesmanProfileBlock(\.js)?['"]/);
  });

  test('photo path prepends TRADESMAN PROFILE before JOB CONTEXT in the user message', () => {
    // We're looking at the TEMPLATE LITERAL that builds the user message
    // — not the surrounding comments. The literal interpolates the
    // tradesman block before the "JOB CONTEXT" string.
    const literal = analyseJobSrc.match(
      /text:\s*`[^`]*buildTradesmanProfileBlock|text:\s*`[^`]*tradesmanBlock[^`]*JOB CONTEXT/
    );
    expect(literal).not.toBeNull();
    // And confirm the tradesman variable interpolation lands before JOB CONTEXT
    const userMsg = analyseJobSrc.match(/text:\s*`\$\{[^}]+\}JOB CONTEXT/);
    expect(userMsg).not.toBeNull();
  });

  test('video path (server.js video route) imports + uses the helper', () => {
    expect(serverSrc).toMatch(/buildTradesmanProfileBlock/);
    // The block must be emitted inside the video route specifically,
    // not just imported at the top. Match the route + the call.
    const videoRoute = serverSrc.match(
      /app\.post\(\s*['"]\/api\/users\/:id\/jobs\/:jobId\/video['"][\s\S]*?\n\}\s*\)\s*;/
    );
    expect(videoRoute).not.toBeNull();
    expect(videoRoute[0]).toMatch(/buildTradesmanProfileBlock/);
  });
});
