import {
  validateProfile,
  validateJobDetails,
  validateRequiredPhotoSlots,
  allMeasurementsConfirmed,
  countUnconfirmedMeasurements,
  canGenerateQuote,
} from '../utils/validators.js';

// --- validateProfile ---

describe('validateProfile', () => {
  const validProfile = {
    companyName: 'Doyle Stone Works',
    fullName: 'Mark Doyle',
    phone: '07700 900123',
    email: 'mark@doylestone.co.uk',
    address: '12 High Street, Skipton',
    dayRate: 400,
    vatRegistered: false,
  };

  test('accepts a valid profile', () => {
    const result = validateProfile(validProfile);
    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  test('fails when companyName is missing', () => {
    const result = validateProfile({ ...validProfile, companyName: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.companyName).toBeDefined();
  });

  test('fails when fullName is missing', () => {
    const result = validateProfile({ ...validProfile, fullName: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.fullName).toBeDefined();
  });

  test('fails when phone is missing', () => {
    const result = validateProfile({ ...validProfile, phone: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.phone).toBeDefined();
  });

  test('fails when email is missing', () => {
    const result = validateProfile({ ...validProfile, email: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.email).toBeDefined();
  });

  test('fails for invalid email format', () => {
    const result = validateProfile({ ...validProfile, email: 'notanemail' });
    expect(result.valid).toBe(false);
    expect(result.errors.email).toBeDefined();
  });

  test('fails when address is missing', () => {
    const result = validateProfile({ ...validProfile, address: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.address).toBeDefined();
  });

  test('fails when dayRate is zero', () => {
    const result = validateProfile({ ...validProfile, dayRate: 0 });
    expect(result.valid).toBe(false);
    expect(result.errors.dayRate).toBeDefined();
  });

  test('fails when dayRate is negative', () => {
    const result = validateProfile({ ...validProfile, dayRate: -100 });
    expect(result.valid).toBe(false);
    expect(result.errors.dayRate).toBeDefined();
  });

  test('fails when dayRate is NaN', () => {
    const result = validateProfile({ ...validProfile, dayRate: NaN });
    expect(result.valid).toBe(false);
    expect(result.errors.dayRate).toBeDefined();
  });

  test('fails when vatNumber missing but vatRegistered is true', () => {
    const result = validateProfile({ ...validProfile, vatRegistered: true, vatNumber: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.vatNumber).toBeDefined();
  });

  test('does not require vatNumber when not VAT registered', () => {
    const result = validateProfile({ ...validProfile, vatRegistered: false, vatNumber: '' });
    expect(result.valid).toBe(true);
  });

  test('accumulates multiple errors', () => {
    const result = validateProfile({ ...validProfile, companyName: '', email: 'bad', dayRate: -1 });
    expect(result.valid).toBe(false);
    expect(Object.keys(result.errors).length).toBeGreaterThanOrEqual(3);
  });
});

// --- validateJobDetails ---

describe('validateJobDetails', () => {
  const validJob = {
    clientName: 'Yorkshire Estates',
    siteAddress: 'Malham Cove, BD23 4DA',
    quoteReference: 'QT-2026-0001',
    quoteDate: '2026-03-13',
  };

  test('accepts valid job details', () => {
    const result = validateJobDetails(validJob);
    expect(result.valid).toBe(true);
    expect(Object.keys(result.errors)).toHaveLength(0);
  });

  test('fails when clientName is missing', () => {
    const result = validateJobDetails({ ...validJob, clientName: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.clientName).toBeDefined();
  });

  test('fails when siteAddress is missing', () => {
    const result = validateJobDetails({ ...validJob, siteAddress: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.siteAddress).toBeDefined();
  });

  test('fails when quoteReference is missing', () => {
    const result = validateJobDetails({ ...validJob, quoteReference: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.quoteReference).toBeDefined();
  });

  test('fails when quoteDate is missing', () => {
    const result = validateJobDetails({ ...validJob, quoteDate: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.quoteDate).toBeDefined();
  });
});

// --- validateRequiredPhotoSlots ---

describe('validateRequiredPhotoSlots', () => {
  const allPhotos = {
    overview: { data: 'base64...' },
    closeup: { data: 'base64...' },
    sideProfile: { data: 'base64...' },
    referenceCard: { data: 'base64...' },
    access: { data: 'base64...' },
  };

  test('valid when all required slots filled', () => {
    const result = validateRequiredPhotoSlots(allPhotos);
    expect(result.valid).toBe(true);
    expect(result.missingSlots).toHaveLength(0);
    expect(result.hasReferenceCard).toBe(true);
  });

  test('invalid when overview is missing', () => {
    const photos = { ...allPhotos, overview: null };
    const result = validateRequiredPhotoSlots(photos);
    expect(result.valid).toBe(false);
    expect(result.missingSlots).toContain('overview');
  });

  test('invalid when closeup is missing', () => {
    const photos = { ...allPhotos, closeup: null };
    const result = validateRequiredPhotoSlots(photos);
    expect(result.valid).toBe(false);
    expect(result.missingSlots).toContain('closeup');
  });

  test('invalid when referenceCard is missing', () => {
    const photos = { ...allPhotos, referenceCard: null };
    const result = validateRequiredPhotoSlots(photos);
    expect(result.valid).toBe(false);
    expect(result.missingSlots).toContain('referenceCard');
    expect(result.hasReferenceCard).toBe(false);
  });

  test('valid when optional slots are missing', () => {
    const photos = { ...allPhotos, sideProfile: null, access: null };
    const result = validateRequiredPhotoSlots(photos);
    expect(result.valid).toBe(true);
    expect(result.missingSlots).toHaveLength(0);
  });

  test('invalid when all slots are empty', () => {
    const photos = { overview: null, closeup: null, sideProfile: null, referenceCard: null, access: null };
    const result = validateRequiredPhotoSlots(photos);
    expect(result.valid).toBe(false);
    expect(result.missingSlots).toHaveLength(3);
  });

  test('hasReferenceCard is true when referenceCard slot filled', () => {
    const result = validateRequiredPhotoSlots(allPhotos);
    expect(result.hasReferenceCard).toBe(true);
  });
});

// --- allMeasurementsConfirmed ---

describe('allMeasurementsConfirmed', () => {
  test('returns true when all measurements confirmed', () => {
    const measurements = [
      { id: 'm-0', confirmed: true },
      { id: 'm-1', confirmed: true },
    ];
    expect(allMeasurementsConfirmed(measurements)).toBe(true);
  });

  test('returns false when any measurement unconfirmed', () => {
    const measurements = [
      { id: 'm-0', confirmed: true },
      { id: 'm-1', confirmed: false },
    ];
    expect(allMeasurementsConfirmed(measurements)).toBe(false);
  });

  test('returns true for empty array (vacuous truth)', () => {
    expect(allMeasurementsConfirmed([])).toBe(true);
  });

  test('treats missing confirmed field as unconfirmed', () => {
    const measurements = [{ id: 'm-0' }];
    expect(allMeasurementsConfirmed(measurements)).toBe(false);
  });
});

// --- countUnconfirmedMeasurements ---

describe('countUnconfirmedMeasurements', () => {
  test('counts unconfirmed measurements', () => {
    const measurements = [
      { id: 'm-0', confirmed: true },
      { id: 'm-1', confirmed: false },
      { id: 'm-2', confirmed: false },
    ];
    expect(countUnconfirmedMeasurements(measurements)).toBe(2);
  });

  test('returns 0 when all confirmed', () => {
    const measurements = [
      { id: 'm-0', confirmed: true },
      { id: 'm-1', confirmed: true },
    ];
    expect(countUnconfirmedMeasurements(measurements)).toBe(0);
  });

  test('returns 0 for empty array', () => {
    expect(countUnconfirmedMeasurements([])).toBe(0);
  });

  test('treats missing confirmed as unconfirmed', () => {
    const measurements = [{ id: 'm-0' }];
    expect(countUnconfirmedMeasurements(measurements)).toBe(1);
  });
});

// --- canGenerateQuote ---

describe('canGenerateQuote', () => {
  const confirmedMeasurements = [
    { id: 'm-0', confirmed: true },
    { id: 'm-1', confirmed: true },
  ];
  const materials = [{ description: 'Stone', totalCost: 500 }];
  const labour = { days: 3, dayRate: 400 };

  test('returns true when all conditions met', () => {
    expect(canGenerateQuote(confirmedMeasurements, materials, labour)).toBe(true);
  });

  test('returns false when a measurement is unconfirmed', () => {
    const unconfirmed = [{ id: 'm-0', confirmed: true }, { id: 'm-1', confirmed: false }];
    expect(canGenerateQuote(unconfirmed, materials, labour)).toBe(false);
  });

  test('returns false when materials is empty', () => {
    expect(canGenerateQuote(confirmedMeasurements, [], labour)).toBe(false);
  });

  test('returns false when labour days is 0', () => {
    expect(canGenerateQuote(confirmedMeasurements, materials, { days: 0, dayRate: 400 })).toBe(false);
  });

  test('returns false when labour dayRate is 0', () => {
    expect(canGenerateQuote(confirmedMeasurements, materials, { days: 3, dayRate: 0 })).toBe(false);
  });
});
