/**
 * Realistic FastQuote job fixtures for the QuickBooks CSV exporter.
 *
 * Property names and nesting corrected from Phase 0 source verification
 * (see src/utils/quickbooksExport.notes.md). Do NOT revert to the spec's
 * original fixture — those property names don't exist in this codebase.
 *
 * The exporter reads from quote_snapshot.reviewData.*, which is how
 * every FastQuote job is saved (per SAVE_ALLOWLIST in stripBlobs.js).
 */

export const kebroydProfile = {
  companyName: 'Mark Doyle Walling',
  fullName: 'Mark Doyle',
  phone: '07986 661828',
  email: 'mark@drystonewalling.net',
  dayRate: 400,
  vatRegistered: true,
  vatNumber: 'GB123456789',
};

export const kebroydProfileNonVat = {
  ...kebroydProfile,
  vatRegistered: false,
  vatNumber: null,
};

// A realistic saved-job row as it appears after the reducer builds
// quotePayload and userDB.saveJob persists the snapshot.
// quote_date is stored as ISO (matches reality, not the spec's fiction).
export const kebroydJob = {
  id: 'sq-123',
  user_id: 'mark',
  client_name: 'James Simcock',
  site_address: 'Brink Farm Pott, SK10 5RU',
  quote_reference: 'QT-2026-0047',
  quote_date: '2026-04-16',            // ISO, not DD/MM/YYYY
  saved_at: '2026-04-16T10:23:00Z',
  total_amount: 7581.00,
  quote_snapshot: {
    jobDetails: {
      clientName: 'James Simcock',
      siteAddress: 'Brink Farm Pott, SK10 5RU',
      quoteReference: 'QT-2026-0047',
      quoteDate: '2026-04-16',
    },
    reviewData: {
      materials: [
        { id: 'mat-0', description: 'Sandstone replacement stone',  quantity: 4.5, unit: 't',    unitCost: 185, totalCost: 832.50 },
        { id: 'mat-1', description: 'Chapter 8 traffic management', quantity: 1,   unit: 'Item', unitCost: 415, totalCost: 415 },
        { id: 'mat-2', description: 'Tool and equipment hire',      quantity: 1,   unit: 'Item', unitCost: 150, totalCost: 150 },
        { id: 'mat-3', description: 'Waste disposal and tipping',   quantity: 1,   unit: 'Item', unitCost: 120, totalCost: 120 },
      ],
      additionalCosts: [],
      labourEstimate: {
        estimatedDays: 6,
        numberOfWorkers: 2,
        dayRate: 400,
      },
    },
  },
};

export const jobWithCommaInClientName = {
  ...kebroydJob,
  client_name: 'Smith, John',
  quote_snapshot: {
    ...kebroydJob.quote_snapshot,
    jobDetails: {
      ...kebroydJob.quote_snapshot.jobDetails,
      clientName: 'Smith, John',
    },
  },
};

export const jobWithForbiddenCharsInItem = {
  ...kebroydJob,
  quote_snapshot: {
    ...kebroydJob.quote_snapshot,
    reviewData: {
      ...kebroydJob.quote_snapshot.reviewData,
      materials: [
        { id: 'mat-0', description: 'Special & rare stone (25% premium)', quantity: 1, unit: 't', unitCost: 500, totalCost: 500 },
      ],
    },
  },
};

export const jobWithNoLabour = {
  ...kebroydJob,
  quote_snapshot: {
    ...kebroydJob.quote_snapshot,
    reviewData: {
      ...kebroydJob.quote_snapshot.reviewData,
      labourEstimate: { estimatedDays: 0, numberOfWorkers: 0, dayRate: 0 },
    },
  },
};

export const jobWithNoLineItems = {
  ...kebroydJob,
  quote_snapshot: {
    ...kebroydJob.quote_snapshot,
    reviewData: {
      materials: [],
      additionalCosts: [],
      labourEstimate: { estimatedDays: 0, numberOfWorkers: 0, dayRate: 0 },
    },
  },
};

export const jobWithAdditionalCosts = {
  ...kebroydJob,
  quote_snapshot: {
    ...kebroydJob.quote_snapshot,
    reviewData: {
      ...kebroydJob.quote_snapshot.reviewData,
      additionalCosts: [
        { id: 'ac-0', label: 'Travel',        amount: 85 },
        { id: 'ac-1', label: 'Accommodation', amount: 180 },
      ],
    },
  },
};

// The byte-exact CSV that buildQuickbooksCSV(kebroydJob, kebroydProfile)
// must produce. If this string ever changes, every consumer of the
// exported CSV (QBO, anyone else downstream) gets a new contract.
export const KEBROYD_EXPECTED_CSV =
  'InvoiceNo,Customer,InvoiceDate,DueDate,Item(Product/Service),ItemDescription,ItemQuantity,ItemRate,ItemAmount,ItemTaxCode\r\n' +
  'QT-2026-0047,James Simcock,16/04/2026,16/05/2026,Sandstone replacement stone,"Works at Brink Farm Pott, SK10 5RU. Sandstone replacement stone",4.5,185.00,832.50,20.0% S\r\n' +
  'QT-2026-0047,,,,Chapter 8 traffic management,Chapter 8 traffic management,1,415.00,415.00,20.0% S\r\n' +
  'QT-2026-0047,,,,Tool and equipment hire,Tool and equipment hire,1,150.00,150.00,20.0% S\r\n' +
  'QT-2026-0047,,,,Waste disposal and tipping,Waste disposal and tipping,1,120.00,120.00,20.0% S\r\n' +
  'QT-2026-0047,,,,Labour,Skilled labour (6 days \u00d7 2 workers),12,400.00,4800.00,20.0% S\r\n';
