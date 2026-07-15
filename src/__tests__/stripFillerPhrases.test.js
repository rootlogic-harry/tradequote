/**
 * stripFillerPhrases — server-side belt-and-braces strip of
 * low-information filler like "as specified by tradesman".
 *
 * Origin: Mark flagged 2026-07-14 that quotes kept saying "as
 * specified by tradesman" a few times per quote, and his manual
 * removal wasn't teaching the model. Same class of bug as Paul's
 * math walkthrough issue (2026-06-30) — the answer is the same:
 * "prompts are probabilistic, regex is not".
 *
 * The fixtures below are the shapes the AI has been observed to
 * emit. When a new variant slips through, paste it in as a failing
 * test first, then extend the regex.
 */
import { stripFillerPhrases, normalizeAIResponse } from '../utils/aiParser.js';

describe('stripFillerPhrases — Mark\'s 2026-07-14 UAT shapes', () => {
  test('strips the exact "as specified by tradesman" phrase inline', () => {
    const input = 'Rebuild collapsed section to 1.2m height, as specified by tradesman.';
    const out = stripFillerPhrases(input);
    expect(out).toBe('Rebuild collapsed section to 1.2m height.');
  });

  test('strips "as specified by the tradesman" (with definite article)', () => {
    const input = 'Rebuild collapsed section to 1.2m height, as specified by the tradesman.';
    const out = stripFillerPhrases(input);
    expect(out).toBe('Rebuild collapsed section to 1.2m height.');
  });

  test('strips the parenthetical form "(as specified by tradesman)"', () => {
    const input = 'Rebuild collapsed section to 1.2m height (as specified by tradesman).';
    const out = stripFillerPhrases(input);
    expect(out).toBe('Rebuild collapsed section to 1.2m height.');
  });

  test('strips the parenthetical form with the definite article', () => {
    const input = 'Rebuild collapsed section to 1.2m height (as specified by the tradesman).';
    const out = stripFillerPhrases(input);
    expect(out).toBe('Rebuild collapsed section to 1.2m height.');
  });

  test('strips multiple occurrences in the same description', () => {
    const input = 'Rebuild wall to 1.2m height, as specified by tradesman. Copestones to be dry-laid, as specified by the tradesman.';
    const out = stripFillerPhrases(input);
    expect(out).toBe('Rebuild wall to 1.2m height. Copestones to be dry-laid.');
  });

  test('strips "as directed by the tradesman" (verb spectrum)', () => {
    const input = 'Foundation to be prepared, as directed by the tradesman.';
    const out = stripFillerPhrases(input);
    expect(out).toBe('Foundation to be prepared.');
  });

  test('strips "as per tradesman\'s specification" (possessive form)', () => {
    const input = 'Copestones dressed to a fair finish, as per tradesman\'s specification.';
    const out = stripFillerPhrases(input);
    expect(out).toBe('Copestones dressed to a fair finish.');
  });

  test('strips "as per the tradesman\'s spec"', () => {
    const input = 'Cheek end formed, as per the tradesman\'s spec.';
    const out = stripFillerPhrases(input);
    expect(out).toBe('Cheek end formed.');
  });

  test('strips legacy nouns: trader / builder / waller / contractor', () => {
    for (const noun of ['trader', 'builder', 'waller', 'contractor']) {
      const input = `Wall to be built to standard, as specified by ${noun}.`;
      expect(stripFillerPhrases(input)).toBe('Wall to be built to standard.');
    }
  });

  test('handles em-dash and semicolon connectors', () => {
    expect(stripFillerPhrases('Wall rebuilt — as specified by tradesman.'))
      .toBe('Wall rebuilt.');
    expect(stripFillerPhrases('Wall rebuilt; as directed by the tradesman.'))
      .toBe('Wall rebuilt.');
  });

  test('mid-sentence: "The wall, as specified by tradesman, will be rebuilt."', () => {
    const input = 'The wall, as specified by tradesman, will be rebuilt.';
    const out = stripFillerPhrases(input);
    // Comma from the mid-sentence position collapses into the surviving text.
    expect(out).toBe('The wall will be rebuilt.');
  });
});

describe('stripFillerPhrases — safety + defaults', () => {
  test('preserves the description when no filler phrase is present', () => {
    const input = 'Rebuild wall to 1.2m height with reclaimed walling stone.';
    expect(stripFillerPhrases(input)).toBe(input);
  });

  test('returns empty/null inputs unchanged', () => {
    expect(stripFillerPhrases('')).toBe('');
    expect(stripFillerPhrases(null)).toBe(null);
    expect(stripFillerPhrases(undefined)).toBe(undefined);
  });

  test('non-string input passes through untouched (never throws)', () => {
    expect(stripFillerPhrases(42)).toBe(42);
    expect(stripFillerPhrases({})).toEqual({});
  });

  test('does NOT strip legitimate uses of the words separately', () => {
    // "specified" on its own is fine — it's the combination with
    // "by tradesman" that's filler. A description that mentions
    // "the tradesman has specified a batter profile" (which the AI
    // shouldn't emit, but if it does, isn't the class of bug Mark
    // reported) stays intact.
    const input = 'The tradesman has full discretion over the batter profile.';
    expect(stripFillerPhrases(input)).toBe(input);
  });

  test('collapses double whitespace + tidies punctuation after strip', () => {
    // Match the same tidy pass as stripMathFromDescription.
    const input = 'Rebuild wall to 1.2m height  ,  as specified by tradesman  .';
    const out = stripFillerPhrases(input);
    expect(out).not.toMatch(/\s{2,}/);
    expect(out).not.toMatch(/\s+[,.]/);
  });
});

describe('normalizeAIResponse wiring — strip applies to both descriptions', () => {
  // The strip must run against BOTH the top-level damageDescription AND
  // every scheduleOfWorks[].description. Mark's real quotes had the
  // phrase in the damage section too, not just the schedule.

  test('strips filler from damageDescription', () => {
    const parsed = {
      damageDescription: 'A ten-metre section has failed, as specified by tradesman.',
      measurements: [],
      materials: [],
      scheduleOfWorks: [{ title: 'Site prep', description: 'Clear the site.' }],
      labourEstimate: { estimatedDays: 5, numberOfWorkers: 2, dayRate: 400 },
    };
    const out = normalizeAIResponse(parsed);
    expect(out.damageDescription).toBe('A ten-metre section has failed.');
  });

  test('strips filler from every scheduleOfWorks description', () => {
    const parsed = {
      damageDescription: 'Damage summary.',
      measurements: [],
      materials: [],
      scheduleOfWorks: [
        { title: 'Site prep', description: 'Clear the site, as specified by tradesman.' },
        { title: 'Rebuild',   description: 'Rebuild wall (as specified by the tradesman).' },
      ],
      labourEstimate: { estimatedDays: 5, numberOfWorkers: 2, dayRate: 400 },
    };
    const out = normalizeAIResponse(parsed);
    expect(out.scheduleOfWorks[0].description).toBe('Clear the site.');
    expect(out.scheduleOfWorks[1].description).toBe('Rebuild wall.');
  });

  test('math strip and filler strip both apply to scheduleOfWorks', () => {
    // Same description can carry both problems.
    const parsed = {
      damageDescription: 'Damage summary.',
      measurements: [],
      materials: [],
      scheduleOfWorks: [
        {
          title: 'Rebuild',
          description: 'Rebuild wall to 1.2m height, as specified by tradesman (50m × 1.2m = 60m²; ~3m²/day/2 wallers = 40 operative-days ÷ 2 = 20 days).',
        },
      ],
      labourEstimate: { estimatedDays: 5, numberOfWorkers: 2, dayRate: 400 },
    };
    const out = normalizeAIResponse(parsed);
    expect(out.scheduleOfWorks[0].description).not.toMatch(/as specified by/);
    expect(out.scheduleOfWorks[0].description).not.toMatch(/operative-days/);
    expect(out.scheduleOfWorks[0].description).not.toMatch(/60m²/);
    expect(out.scheduleOfWorks[0].description).toContain('Rebuild wall to 1.2m height');
  });
});
