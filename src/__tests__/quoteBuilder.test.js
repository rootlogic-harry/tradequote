import {
  generateQuoteReference,
  formatCurrency,
  formatDate,
  calculateValidUntil,
  calculateExpiresAt,
  buildDiffsPayload,
  buildQuotePayload,
} from '../utils/quoteBuilder.js';

// --- generateQuoteReference ---

describe('generateQuoteReference', () => {
  test('pads sequence to 4 digits: 1 → 0001', () => {
    expect(generateQuoteReference(2026, 1)).toBe('QT-2026-0001');
  });

  test('pads sequence to 4 digits: 47 → 0047', () => {
    expect(generateQuoteReference(2026, 47)).toBe('QT-2026-0047');
  });

  test('does not pad when 4+ digits: 1000 → 1000', () => {
    expect(generateQuoteReference(2026, 1000)).toBe('QT-2026-1000');
  });

  test('uses correct year', () => {
    expect(generateQuoteReference(2027, 1)).toBe('QT-2027-0001');
  });
});

// --- formatCurrency ---

describe('formatCurrency', () => {
  test('formats whole numbers', () => {
    expect(formatCurrency(3781)).toBe('£3,781.00');
  });

  test('formats decimal values', () => {
    expect(formatCurrency(99.50)).toBe('£99.50');
  });

  test('formats zero', () => {
    expect(formatCurrency(0)).toBe('£0.00');
  });

  test('formats large numbers with commas', () => {
    expect(formatCurrency(12500)).toBe('£12,500.00');
  });

  test('formats negative values', () => {
    expect(formatCurrency(-100)).toBe('-£100.00');
  });

  test('rounds to 2 decimal places', () => {
    expect(formatCurrency(99.999)).toBe('£100.00');
  });
});

// --- formatDate ---

describe('formatDate', () => {
  test('formats with st ordinal (1st)', () => {
    expect(formatDate('2026-03-01')).toBe('1st March 2026');
  });

  test('formats with nd ordinal (2nd)', () => {
    expect(formatDate('2026-03-02')).toBe('2nd March 2026');
  });

  test('formats with rd ordinal (3rd)', () => {
    expect(formatDate('2026-03-03')).toBe('3rd March 2026');
  });

  test('formats with th ordinal (4th)', () => {
    expect(formatDate('2026-03-04')).toBe('4th March 2026');
  });

  test('handles 11th (not 11st)', () => {
    expect(formatDate('2026-03-11')).toBe('11th March 2026');
  });

  test('handles 12th (not 12nd)', () => {
    expect(formatDate('2026-03-12')).toBe('12th March 2026');
  });

  test('handles 13th (not 13rd)', () => {
    expect(formatDate('2026-03-13')).toBe('13th March 2026');
  });

  test('handles 21st', () => {
    expect(formatDate('2026-03-21')).toBe('21st March 2026');
  });

  test('handles 22nd', () => {
    expect(formatDate('2026-03-22')).toBe('22nd March 2026');
  });

  test('handles 31st', () => {
    expect(formatDate('2026-03-31')).toBe('31st March 2026');
  });

  // All 12 months
  test('January', () => {
    expect(formatDate('2026-01-15')).toBe('15th January 2026');
  });

  test('February', () => {
    expect(formatDate('2026-02-15')).toBe('15th February 2026');
  });

  test('March', () => {
    expect(formatDate('2026-03-15')).toBe('15th March 2026');
  });

  test('April', () => {
    expect(formatDate('2026-04-15')).toBe('15th April 2026');
  });

  test('May', () => {
    expect(formatDate('2026-05-15')).toBe('15th May 2026');
  });

  test('June', () => {
    expect(formatDate('2026-06-15')).toBe('15th June 2026');
  });

  test('July', () => {
    expect(formatDate('2026-07-15')).toBe('15th July 2026');
  });

  test('August', () => {
    expect(formatDate('2026-08-15')).toBe('15th August 2026');
  });

  test('September', () => {
    expect(formatDate('2026-09-15')).toBe('15th September 2026');
  });

  test('October', () => {
    expect(formatDate('2026-10-15')).toBe('15th October 2026');
  });

  test('November', () => {
    expect(formatDate('2026-11-15')).toBe('15th November 2026');
  });

  test('December', () => {
    expect(formatDate('2026-12-15')).toBe('15th December 2026');
  });
});

// --- calculateValidUntil ---

describe('calculateValidUntil', () => {
  test('adds 30 days to a normal date', () => {
    expect(calculateValidUntil('2026-03-01')).toBe('2026-03-31');
  });

  test('crosses month boundary', () => {
    expect(calculateValidUntil('2026-03-15')).toBe('2026-04-14');
  });

  test('crosses year boundary', () => {
    expect(calculateValidUntil('2026-12-15')).toBe('2027-01-14');
  });

  test('handles leap year (Feb → March in leap year)', () => {
    expect(calculateValidUntil('2028-02-01')).toBe('2028-03-02');
  });
});

// --- calculateExpiresAt ---

describe('calculateExpiresAt', () => {
  test('adds 30 days to sentAt', () => {
    const sentAt = '2026-03-16T12:00:00.000Z';
    const result = calculateExpiresAt(sentAt);
    // 30 days after March 16 = April 15
    const resultDate = new Date(result);
    const sentDate = new Date(sentAt);
    const diffDays = Math.round((resultDate - sentDate) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(30);
  });
});

// --- buildDiffsPayload ---

describe('buildDiffsPayload', () => {
  const diffs = [
    {
      fieldType: 'measurement',
      fieldLabel: 'Wall length',
      aiValue: '4500',
      confirmedValue: '4500',
      wasEdited: false,
      editMagnitude: 0,
      createdAt: 1700000000000,
    },
    {
      fieldType: 'measurement',
      fieldLabel: 'Wall height',
      aiValue: '1400',
      confirmedValue: '1600',
      wasEdited: true,
      editMagnitude: 0.143,
      createdAt: 1700000001000,
    },
  ];

  const context = {
    referenceCardUsed: true,
    stoneType: 'gritstone',
  };

  test('returns correct number of diffs', () => {
    const result = buildDiffsPayload(diffs, context);
    expect(result).toHaveLength(2);
  });

  test('applies context to each diff', () => {
    const result = buildDiffsPayload(diffs, context);
    result.forEach(d => {
      expect(d.referenceCardUsed).toBe(true);
      expect(d.stoneType).toBe('gritstone');
    });
  });

  test('does not mutate original diffs', () => {
    const originals = diffs.map(d => ({ ...d }));
    buildDiffsPayload(diffs, context);
    expect(diffs).toEqual(originals);
  });
});

// --- buildQuotePayload ---

describe('buildQuotePayload', () => {
  const profile = {
    companyName: 'Doyle Stone Works',
    fullName: 'Mark Doyle',
    phone: '07700 900123',
    email: 'mark@doylestone.co.uk',
    address: '12 High Street, Skipton',
    dayRate: 400,
    vatRegistered: true,
    vatNumber: 'GB123456789',
  };

  const jobDetails = {
    clientName: 'Yorkshire Estates',
    siteAddress: 'Malham Cove, BD23 4DA',
    quoteReference: 'QT-2026-0047',
    quoteDate: '2026-03-13',
  };

  const reviewData = {
    damageDescription: 'A 4.5m section has collapsed.',
    measurements: [
      { id: 'm-0', item: 'Breach length', aiValue: '4,500mm', value: '4,500mm', confirmed: true },
    ],
    scheduleOfWorks: [
      { id: 'sow-0', stepNumber: 1, title: 'Site clearance', description: 'Clear debris.' },
    ],
    materials: [
      { id: 'mat-0', description: 'Stone', quantity: '6t', unitCost: 85, totalCost: 510 },
    ],
    labourEstimate: {
      estimatedDays: 3,
      numberOfWorkers: 2,
      dayRate: 400,
      description: '2 wallers for 3 days',
    },
    additionalCosts: [{ label: 'Travel', amount: 150 }],
    aiRawResponse: '{"test":"raw"}',
    siteConditions: { accessDifficulty: 'normal' },
    referenceCardDetected: true,
    stoneType: 'gritstone',
  };

  const diffs = [
    {
      fieldType: 'measurement',
      fieldLabel: 'Breach length',
      aiValue: '4,500mm',
      confirmedValue: '4,500mm',
      wasEdited: false,
      editMagnitude: 0,
      createdAt: 1700000000000,
    },
  ];

  test('includes all required top-level keys', () => {
    const result = buildQuotePayload(profile, jobDetails, reviewData, diffs);
    expect(result).toHaveProperty('profile');
    expect(result).toHaveProperty('jobDetails');
    expect(result).toHaveProperty('quote');
    expect(result).toHaveProperty('totals');
    expect(result).toHaveProperty('diffs');
    expect(result).toHaveProperty('aiAccuracyScore');
  });

  test('calculates totals correctly', () => {
    const result = buildQuotePayload(profile, jobDetails, reviewData, diffs);
    expect(result.totals.materialsSubtotal).toBe(510);
    expect(result.totals.labourTotal).toBe(2400);
    expect(result.totals.additionalCostsTotal).toBe(150);
    expect(result.totals.subtotal).toBe(3060);
    expect(result.totals.vatAmount).toBe(612);
    expect(result.totals.total).toBe(3672);
  });

  test('includes validUntil (30 days from quoteDate)', () => {
    const result = buildQuotePayload(profile, jobDetails, reviewData, diffs);
    expect(result.quote.validUntil).toBe('2026-04-12');
  });

  test('includes aiRawResponse', () => {
    const result = buildQuotePayload(profile, jobDetails, reviewData, diffs);
    expect(result.quote.aiRawResponse).toBe('{"test":"raw"}');
  });

  test('calculates aiAccuracyScore', () => {
    const result = buildQuotePayload(profile, jobDetails, reviewData, diffs);
    expect(result.aiAccuracyScore).toBe(1.0);
  });

  test('aiAccuracyScore is null when only text diffs', () => {
    const textDiffs = [
      {
        fieldType: 'damage_description',
        fieldLabel: 'Damage',
        aiValue: 'old',
        confirmedValue: 'new',
        wasEdited: true,
        editMagnitude: null,
        createdAt: 1700000000000,
      },
    ];
    const result = buildQuotePayload(profile, jobDetails, reviewData, textDiffs);
    expect(result.aiAccuracyScore).toBeNull();
  });
});
