/**
 * resolveClientRollup — pure function behavioural coverage.
 *
 * These tests are the contract. If the implementation in
 * src/utils/clientRollup.js doesn't return exactly what these tests
 * assert, the client detail rollup is wrong.
 *
 * See docs/CLIENTS_SPEC_v3.md § 4 for the formulas + rationale.
 */
import { resolveClientRollup } from '../utils/clientRollup.js';

describe('resolveClientRollup — no jobs', () => {
  test('empty array → all zeros', () => {
    expect(resolveClientRollup([])).toEqual({
      totalWon: 0,
      outstanding: 0,
      livePipeline: 0,
      lifetimeQuoteCount: 0,
    });
  });

  test('null / undefined → all zeros (defensive)', () => {
    expect(resolveClientRollup(null)).toEqual({
      totalWon: 0,
      outstanding: 0,
      livePipeline: 0,
      lifetimeQuoteCount: 0,
    });
    expect(resolveClientRollup(undefined)).toEqual({
      totalWon: 0,
      outstanding: 0,
      livePipeline: 0,
      lifetimeQuoteCount: 0,
    });
  });
});

describe('resolveClientRollup — totalWon', () => {
  test('sums accepted + completed status jobs', () => {
    const jobs = [
      { status: 'accepted',  totalAmount: 1000 },
      { status: 'completed', totalAmount: 2500 },
      { status: 'sent',      totalAmount:  500 }, // excluded
      { status: 'draft',     totalAmount:  999 }, // excluded
      { status: 'declined',  totalAmount:  888 }, // excluded
    ];
    const result = resolveClientRollup(jobs);
    expect(result.totalWon).toBe(3500);
  });

  test('handles null / missing totalAmount as 0', () => {
    const jobs = [
      { status: 'accepted',  totalAmount: 1000 },
      { status: 'completed', totalAmount: null },
      { status: 'completed' /* no totalAmount */ },
    ];
    expect(resolveClientRollup(jobs).totalWon).toBe(1000);
  });

  test('handles string-typed totalAmount (denormalised column may return as text)', () => {
    const jobs = [
      { status: 'accepted',  totalAmount: '1000.50' },
      { status: 'completed', totalAmount: '2000' },
    ];
    expect(resolveClientRollup(jobs).totalWon).toBeCloseTo(3000.5, 2);
  });
});

describe('resolveClientRollup — outstanding', () => {
  test('sums ONLY sent status jobs', () => {
    const jobs = [
      { status: 'sent',      totalAmount: 1500 },
      { status: 'sent',      totalAmount:  750 },
      { status: 'accepted',  totalAmount: 5000 }, // excluded
      { status: 'draft',     totalAmount:  200 }, // excluded
      { status: 'declined',  totalAmount:  100 }, // excluded
      { status: 'completed', totalAmount: 9999 }, // excluded
    ];
    expect(resolveClientRollup(jobs).outstanding).toBe(2250);
  });

  test('empty when no sent jobs', () => {
    const jobs = [
      { status: 'accepted', totalAmount: 1000 },
      { status: 'draft',    totalAmount: 500 },
    ];
    expect(resolveClientRollup(jobs).outstanding).toBe(0);
  });
});

describe('resolveClientRollup — livePipeline', () => {
  test('sums accepted-but-not-completed (accepted with no completedAt)', () => {
    const jobs = [
      { status: 'accepted',  totalAmount: 1200, completedAt: null      },
      { status: 'accepted',  totalAmount:  800, completedAt: undefined },
      { status: 'accepted',  totalAmount:  400, completedAt: '2026-06-15T10:00:00Z' }, // excluded — completed
      { status: 'completed', totalAmount:  999, completedAt: '2026-06-01T10:00:00Z' }, // excluded — wrong status
    ];
    expect(resolveClientRollup(jobs).livePipeline).toBe(2000);
  });

  test('empty when no accepted-without-completion jobs', () => {
    const jobs = [
      { status: 'sent',     totalAmount: 5000 },
      { status: 'draft',    totalAmount: 5000 },
      { status: 'declined', totalAmount: 5000 },
    ];
    expect(resolveClientRollup(jobs).livePipeline).toBe(0);
  });

  test('accepted job with completedAt still counts toward totalWon but NOT livePipeline', () => {
    const jobs = [
      { status: 'accepted', totalAmount: 3000, completedAt: '2026-06-01T10:00:00Z' },
    ];
    const r = resolveClientRollup(jobs);
    expect(r.totalWon).toBe(3000);      // still won
    expect(r.livePipeline).toBe(0);     // work is done
  });
});

describe('resolveClientRollup — lifetimeQuoteCount', () => {
  test('counts EVERY job regardless of status (including declined, drafts, completed)', () => {
    const jobs = [
      { status: 'draft' },
      { status: 'sent' },
      { status: 'accepted' },
      { status: 'declined' },
      { status: 'completed' },
      { status: 'unknown-future-status' }, // included — count is total
    ];
    expect(resolveClientRollup(jobs).lifetimeQuoteCount).toBe(6);
  });

  test('handles single job', () => {
    expect(resolveClientRollup([{ status: 'draft' }]).lifetimeQuoteCount).toBe(1);
  });
});

describe('resolveClientRollup — realistic mixed case', () => {
  // A realistic Paul client with a repeat customer: 5 quotes, mixed
  // statuses, one still awaiting reply, one being worked on now.
  const jobs = [
    { status: 'completed', totalAmount: 4500, completedAt: '2026-03-10T14:00:00Z' },
    { status: 'completed', totalAmount: 3200, completedAt: '2026-04-22T16:00:00Z' },
    { status: 'accepted',  totalAmount: 5100, completedAt: null }, // live work
    { status: 'sent',      totalAmount: 2800, completedAt: null }, // awaiting reply
    { status: 'declined',  totalAmount: 1500, completedAt: null },
  ];

  test('totalWon combines completed jobs + the accepted-not-completed one', () => {
    // accepted-not-completed still counts as won (customer has said yes).
    expect(resolveClientRollup(jobs).totalWon).toBe(4500 + 3200 + 5100);
  });

  test('outstanding is only the sent one', () => {
    expect(resolveClientRollup(jobs).outstanding).toBe(2800);
  });

  test('livePipeline is only the accepted-not-completed one', () => {
    expect(resolveClientRollup(jobs).livePipeline).toBe(5100);
  });

  test('lifetimeQuoteCount is all 5', () => {
    expect(resolveClientRollup(jobs).lifetimeQuoteCount).toBe(5);
  });
});

describe('resolveClientRollup — returns numbers, not strings', () => {
  test('every field is a Number (safe to arithmetic on downstream)', () => {
    const jobs = [
      { status: 'accepted', totalAmount: '1000' },
      { status: 'sent',     totalAmount: '500' },
    ];
    const r = resolveClientRollup(jobs);
    expect(typeof r.totalWon).toBe('number');
    expect(typeof r.outstanding).toBe('number');
    expect(typeof r.livePipeline).toBe('number');
    expect(typeof r.lifetimeQuoteCount).toBe('number');
    // No NaN.
    expect(Number.isFinite(r.totalWon)).toBe(true);
    expect(Number.isFinite(r.outstanding)).toBe(true);
    expect(Number.isFinite(r.livePipeline)).toBe(true);
    expect(Number.isFinite(r.lifetimeQuoteCount)).toBe(true);
  });
});
