/**
 * mergeGroups.test.js — pure-function coverage for the Union-Find
 * grouping that turns pair-shaped `/clients/duplicates` output into
 * user-facing "keep one, merge the rest" groups.
 *
 * These are the semantics the ClientMergeReview modal renders — a
 * regression here would silently reintroduce the "3 pairs, 6 keep
 * buttons" UX bug that Harry caught during UAT (2026-07-07).
 */
import { computeDuplicateGroups } from '../utils/mergeGroups.js';

function mkClient(id, name = `Client ${id}`) {
  return { id, name };
}
function mkPair(a, b, matchType = 'name', confidence = 'medium') {
  return { candidateClientIds: [a, b], matchType, confidence };
}

describe('computeDuplicateGroups', () => {
  test('returns [] for an empty pair list', () => {
    expect(computeDuplicateGroups([], new Map())).toEqual([]);
  });

  test('returns [] when the input is not an array', () => {
    expect(computeDuplicateGroups(null, new Map())).toEqual([]);
    expect(computeDuplicateGroups(undefined, new Map())).toEqual([]);
  });

  test('two disjoint pairs → two groups of 2 each', () => {
    const clients = new Map([
      ['a', mkClient('a')],
      ['b', mkClient('b')],
      ['c', mkClient('c')],
      ['d', mkClient('d')],
    ]);
    const pairs = [mkPair('a', 'b'), mkPair('c', 'd')];
    const groups = computeDuplicateGroups(pairs, clients);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.clients.length === 2)).toBe(true);
  });

  test('three clients with same name → one group of 3 (not three pairs)', () => {
    // This is Harry's UAT case — three "Yorkshire Estates" show up as
    // three pairs (AB, AC, BC). Grouping must collapse them into one
    // group of size 3 so the user picks a target ONCE.
    const clients = new Map([
      ['a', mkClient('a', 'Yorkshire Estates')],
      ['b', mkClient('b', 'Yorkshire Estates')],
      ['c', mkClient('c', 'Yorkshire Estates')],
    ]);
    const pairs = [
      mkPair('a', 'b'),
      mkPair('a', 'c'),
      mkPair('b', 'c'),
    ];
    const groups = computeDuplicateGroups(pairs, clients);
    expect(groups).toHaveLength(1);
    expect(groups[0].clients).toHaveLength(3);
    const ids = new Set(groups[0].clients.map((c) => c.id));
    expect(ids).toEqual(new Set(['a', 'b', 'c']));
  });

  test('chain A-B, B-C, C-D → one group of 4 (transitive closure)', () => {
    const clients = new Map([
      ['a', mkClient('a')],
      ['b', mkClient('b')],
      ['c', mkClient('c')],
      ['d', mkClient('d')],
    ]);
    const pairs = [
      mkPair('a', 'b', 'name'),
      mkPair('b', 'c', 'phone'),
      mkPair('c', 'd', 'name'),
    ];
    const groups = computeDuplicateGroups(pairs, clients);
    expect(groups).toHaveLength(1);
    expect(groups[0].clients).toHaveLength(4);
  });

  test('group carries all matchTypes / confidences from its pairs', () => {
    const clients = new Map([
      ['a', mkClient('a')],
      ['b', mkClient('b')],
      ['c', mkClient('c')],
    ]);
    const pairs = [
      mkPair('a', 'b', 'name+phone', 'high'),
      mkPair('a', 'c', 'name', 'medium'),
    ];
    const [group] = computeDuplicateGroups(pairs, clients);
    expect(new Set(group.matchTypes)).toEqual(new Set(['name+phone', 'name']));
    expect(new Set(group.confidences)).toEqual(new Set(['high', 'medium']));
  });

  test('drops clients not present in cache; group discarded if <2 survive', () => {
    // If `b` was merged away earlier in the session, the group collapses
    // to just `a` — no longer a duplicate group.
    const clients = new Map([['a', mkClient('a')]]);
    const pairs = [mkPair('a', 'b')];
    expect(computeDuplicateGroups(pairs, clients)).toEqual([]);
  });

  test('groups sort by highest confidence first, then by size desc', () => {
    // Group 1: 2 clients, high confidence.
    // Group 2: 3 clients, medium confidence.
    // Order: [high (size 2), medium (size 3)].
    const clients = new Map([
      ['a', mkClient('a')],
      ['b', mkClient('b')],
      ['c', mkClient('c')],
      ['d', mkClient('d')],
      ['e', mkClient('e')],
    ]);
    const pairs = [
      mkPair('a', 'b', 'name+phone', 'high'),
      mkPair('c', 'd', 'name', 'medium'),
      mkPair('d', 'e', 'name', 'medium'),
    ];
    const groups = computeDuplicateGroups(pairs, clients);
    expect(groups).toHaveLength(2);
    expect(groups[0].confidences).toContain('high');
    expect(groups[1].clients).toHaveLength(3);
  });

  test('ignores malformed pairs without crashing', () => {
    const clients = new Map([
      ['a', mkClient('a')],
      ['b', mkClient('b')],
    ]);
    const pairs = [
      null,
      {},
      { candidateClientIds: [] },
      { candidateClientIds: ['a'] },
      mkPair('a', 'b'),
    ];
    const groups = computeDuplicateGroups(pairs, clients);
    expect(groups).toHaveLength(1);
    expect(groups[0].clients).toHaveLength(2);
  });
});
