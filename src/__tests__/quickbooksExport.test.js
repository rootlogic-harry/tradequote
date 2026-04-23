/**
 * QuickBooks Online UK — invoice CSV exporter (TDD suite).
 *
 * Every rule in the QBO import spec has a test below. The fixture in
 * ./fixtures/quickbooksExport.fixtures.js uses the real FastQuote
 * quote_snapshot shape (see src/utils/quickbooksExport.notes.md).
 */
import {
  buildQuickbooksCSV,
  sanitiseItemName,
  sanitiseCustomerName,
  formatMoney,
  formatQuantity,
  formatDate,
  addDays,
  csvEscape,
  parseUKDate,
  reconcileLineMath,
} from '../utils/quickbooksExport.js';

import { parseCSVRow } from './helpers/parseCSVRow.js';

import {
  kebroydJob,
  kebroydProfile,
  kebroydProfileNonVat,
  jobWithCommaInClientName,
  jobWithForbiddenCharsInItem,
  jobWithNoLabour,
  jobWithNoLineItems,
  jobWithAdditionalCosts,
  KEBROYD_EXPECTED_CSV,
} from './fixtures/quickbooksExport.fixtures.js';

// ──────────────────────────────────────────────────────────────────────
// Test helper — parseCSVRow (the tests themselves need testing)
// ──────────────────────────────────────────────────────────────────────
describe('parseCSVRow (test helper)', () => {
  test('splits simple row correctly', () => {
    expect(parseCSVRow('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  test('preserves comma inside quoted field', () => {
    expect(parseCSVRow('a,"hello, world",c')).toEqual(['a', 'hello, world', 'c']);
  });
  test('handles escaped double quotes', () => {
    expect(parseCSVRow('a,"she said ""hi""",c')).toEqual(['a', 'she said "hi"', 'c']);
  });
  test('handles empty fields', () => {
    expect(parseCSVRow('a,,c')).toEqual(['a', '', 'c']);
  });
  test('handles trailing empty field', () => {
    expect(parseCSVRow('a,b,')).toEqual(['a', 'b', '']);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────────────────
describe('sanitiseItemName', () => {
  test('strips forbidden character #', () => {
    expect(sanitiseItemName('Grade #1 stone')).toBe('Grade 1 stone');
  });
  test('strips forbidden character %', () => {
    expect(sanitiseItemName('25% premium')).toBe('25 premium');
  });
  test('strips forbidden & and collapses resulting whitespace', () => {
    expect(sanitiseItemName('Sand & cement')).toBe('Sand cement');
  });
  test('collapses multiple spaces to single', () => {
    expect(sanitiseItemName('Sand &  cement')).toBe('Sand cement');
  });
  test('trims leading and trailing whitespace', () => {
    expect(sanitiseItemName('  stone  ')).toBe('stone');
  });
  test('truncates to 100 chars', () => {
    expect(sanitiseItemName('x'.repeat(150)).length).toBe(100);
  });
  test('returns empty string for null / undefined / empty', () => {
    expect(sanitiseItemName(null)).toBe('');
    expect(sanitiseItemName(undefined)).toBe('');
    expect(sanitiseItemName('')).toBe('');
  });
  test('preserves hyphens and parentheses', () => {
    expect(sanitiseItemName('Sandstone - gritstone (t)')).toBe('Sandstone - gritstone (t)');
  });
});

describe('sanitiseCustomerName', () => {
  test('replaces single comma with hyphen', () => {
    expect(sanitiseCustomerName('Smith, John')).toBe('Smith - John');
  });
  test('replaces multiple commas', () => {
    expect(sanitiseCustomerName('A, B, C Ltd')).toBe('A - B - C Ltd');
  });
  test('preserves apostrophes', () => {
    expect(sanitiseCustomerName("O'Brien")).toBe("O'Brien");
  });
  test('preserves accented characters', () => {
    expect(sanitiseCustomerName('M\u00fcller')).toBe('M\u00fcller');
  });
  test('falls back to "Unknown Customer" for null / empty', () => {
    expect(sanitiseCustomerName(null)).toBe('Unknown Customer');
    expect(sanitiseCustomerName('')).toBe('Unknown Customer');
  });
  test('truncates to 100 chars', () => {
    expect(sanitiseCustomerName('x'.repeat(150)).length).toBe(100);
  });
});

describe('formatMoney', () => {
  test('integer returns with 2 decimals', () => {
    expect(formatMoney(150)).toBe('150.00');
  });
  test('floats are rounded to 2 decimals', () => {
    expect(formatMoney(832.5)).toBe('832.50');
    expect(formatMoney(832.504)).toBe('832.50');
    expect(formatMoney(832.51)).toBe('832.51');
  });
  test('string number input is accepted', () => {
    expect(formatMoney('185.00')).toBe('185.00');
  });
  test('no commas in thousands', () => {
    expect(formatMoney(1234567.89)).toBe('1234567.89');
  });
  test('null / undefined / NaN / garbage returns 0.00', () => {
    expect(formatMoney(null)).toBe('0.00');
    expect(formatMoney(undefined)).toBe('0.00');
    expect(formatMoney(NaN)).toBe('0.00');
    expect(formatMoney('not-a-number')).toBe('0.00');
  });
  test('negative numbers keep minus sign', () => {
    expect(formatMoney(-50)).toBe('-50.00');
  });
  test('small amounts preserve precision', () => {
    expect(formatMoney(0.01)).toBe('0.01');
    expect(formatMoney(0.1)).toBe('0.10');
  });
});

describe('formatQuantity', () => {
  test('integer returns without decimals', () => {
    expect(formatQuantity(5)).toBe('5');
  });
  test('1.5 returns "1.5"', () => {
    expect(formatQuantity(1.5)).toBe('1.5');
  });
  test('4.5 strips trailing zeros to "4.5"', () => {
    expect(formatQuantity(4.5)).toBe('4.5');
  });
  test('string input is accepted', () => {
    expect(formatQuantity('4.5')).toBe('4.5');
  });
  test('fewer than 3 decimals preserved', () => {
    expect(formatQuantity(0.25)).toBe('0.25');
  });
  test('rounds to 3 decimals maximum', () => {
    expect(formatQuantity(1.23456)).toBe('1.235');
  });
  test('null / undefined returns "1"', () => {
    expect(formatQuantity(null)).toBe('1');
    expect(formatQuantity(undefined)).toBe('1');
  });
});

describe('parseUKDate', () => {
  test('parses DD/MM/YYYY correctly', () => {
    const d = parseUKDate('16/04/2026');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(16);
  });
  test('parses D/M/YYYY (single digits)', () => {
    const d = parseUKDate('1/4/2026');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3);
    expect(d.getDate()).toBe(1);
  });
  test('returns null for empty input', () => {
    expect(parseUKDate('')).toBe(null);
    expect(parseUKDate(null)).toBe(null);
    expect(parseUKDate(undefined)).toBe(null);
  });
  test('returns null for malformed input', () => {
    expect(parseUKDate('not a date')).toBe(null);
    expect(parseUKDate('16-04-2026')).toBe(null);
  });
  test('passes through Date objects', () => {
    const input = new Date(2026, 3, 16);
    expect(parseUKDate(input).getTime()).toBe(input.getTime());
  });
});

describe('formatDate', () => {
  test('Date object returns DD/MM/YYYY', () => {
    expect(formatDate(new Date(2026, 3, 16))).toBe('16/04/2026');
  });
  test('pads single-digit day', () => {
    expect(formatDate(new Date(2026, 3, 1))).toBe('01/04/2026');
  });
  test('pads single-digit month', () => {
    expect(formatDate(new Date(2026, 0, 16))).toBe('16/01/2026');
  });
  test('accepts DD/MM/YYYY string input', () => {
    expect(formatDate('16/04/2026')).toBe('16/04/2026');
  });
  test('accepts ISO string input (how FastQuote actually stores)', () => {
    expect(formatDate('2026-04-16')).toBe('16/04/2026');
    expect(formatDate('2026-04-16T10:23:00Z')).toBe('16/04/2026');
  });
  test('null / garbage returns empty string', () => {
    expect(formatDate(null)).toBe('');
    expect(formatDate('garbage')).toBe('');
  });
});

describe('addDays', () => {
  test('adds 30 days within same month boundary', () => {
    expect(addDays('16/04/2026', 30)).toBe('16/05/2026');
  });
  test('adds 30 days across year boundary', () => {
    expect(addDays('16/12/2026', 30)).toBe('15/01/2027');
  });
  test('accepts ISO string input', () => {
    expect(addDays('2026-04-16', 30)).toBe('16/05/2026');
  });
  test('accepts Date object input', () => {
    expect(addDays(new Date(2026, 3, 16), 30)).toBe('16/05/2026');
  });
  test('returns empty string for invalid input', () => {
    expect(addDays('garbage', 30)).toBe('');
  });
});

describe('csvEscape', () => {
  test('plain text passes through unchanged', () => {
    expect(csvEscape('hello world')).toBe('hello world');
  });
  test('quotes field containing comma', () => {
    expect(csvEscape('Smith, John')).toBe('"Smith, John"');
  });
  test('escapes internal double quotes by doubling', () => {
    expect(csvEscape('Smith "Bob" John')).toBe('"Smith ""Bob"" John"');
  });
  test('quotes field containing newline', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
  });
  test('quotes field containing carriage return', () => {
    expect(csvEscape('line1\rline2')).toBe('"line1\rline2"');
  });
  test('empty / null / undefined returns empty', () => {
    expect(csvEscape('')).toBe('');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(undefined)).toBe('');
  });
  test('numeric input is stringified', () => {
    expect(csvEscape(42)).toBe('42');
  });
});

// ──────────────────────────────────────────────────────────────────────
// buildQuickbooksCSV — integration
// ──────────────────────────────────────────────────────────────────────
describe('buildQuickbooksCSV — structural', () => {
  test('produces the correct header row', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    expect(csv.split('\r\n')[0]).toBe(
      'InvoiceNo,Customer,InvoiceDate,DueDate,Item(Product/Service),' +
      'ItemDescription,ItemQuantity,ItemRate,ItemAmount,ItemTaxCode'
    );
  });

  test('produces one data row per line item', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    const lines = csv.split('\r\n').filter(l => l.length > 0);
    expect(lines.length).toBe(6); // header + 4 materials + 1 labour
  });

  test('first data row has Customer, InvoiceDate, DueDate populated', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    const fields = parseCSVRow(csv.split('\r\n')[1]);
    expect(fields[1]).toBe('James Simcock');
    expect(fields[2]).toBe('16/04/2026');
    expect(fields[3]).toBe('16/05/2026');
  });

  test('subsequent rows have empty Customer/Date/DueDate', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    const fields = parseCSVRow(csv.split('\r\n')[2]);
    expect(fields[1]).toBe('');
    expect(fields[2]).toBe('');
    expect(fields[3]).toBe('');
  });

  test('all rows share the same InvoiceNo', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    const data = csv.split('\r\n').filter(l => l.length > 0).slice(1);
    for (const row of data) {
      expect(parseCSVRow(row)[0]).toBe('QT-2026-0047');
    }
  });

  test('uses CRLF line endings (no bare LF)', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    expect(csv).toContain('\r\n');
    expect(csv.match(/[^\r]\n/g)).toBe(null);
  });

  test('ends with a trailing CRLF', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    expect(csv.endsWith('\r\n')).toBe(true);
  });
});

describe('buildQuickbooksCSV — VAT handling', () => {
  test('VAT-registered profile produces "20.0% S" on all rows', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    const data = csv.split('\r\n').filter(l => l.length > 0).slice(1);
    for (const row of data) {
      expect(parseCSVRow(row)[9]).toBe('20.0% S');
    }
  });

  test('non-VAT-registered profile produces "No VAT" on all rows', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfileNonVat);
    const data = csv.split('\r\n').filter(l => l.length > 0).slice(1);
    for (const row of data) {
      expect(parseCSVRow(row)[9]).toBe('No VAT');
    }
  });

  test('missing vatRegistered treated as false (safe default)', () => {
    const { vatRegistered, ...profileWithoutVat } = kebroydProfile;
    const csv = buildQuickbooksCSV(kebroydJob, profileWithoutVat);
    const first = parseCSVRow(csv.split('\r\n').filter(l => l.length > 0)[1]);
    expect(first[9]).toBe('No VAT');
  });
});

describe('buildQuickbooksCSV — labour line', () => {
  test('labour computed as days × workers × dayRate', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    const rows = csv.split('\r\n').filter(l => l.length > 0);
    const fields = parseCSVRow(rows[rows.length - 1]);
    expect(fields[4]).toBe('Labour');
    expect(fields[6]).toBe('12');       // 6 × 2
    expect(fields[7]).toBe('400.00');
    expect(fields[8]).toBe('4800.00');  // 12 × 400
  });

  test('labour description includes days and workers', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    expect(csv).toContain('Skilled labour (6 days \u00d7 2 workers)');
  });

  test('no labour line when labour amount is zero', () => {
    const csv = buildQuickbooksCSV(jobWithNoLabour, kebroydProfile);
    expect(csv).not.toContain('Skilled labour');
    expect(csv).not.toContain(',Labour,');
  });
});

describe('buildQuickbooksCSV — additional costs', () => {
  test('each additional cost produces its own row', () => {
    const csv = buildQuickbooksCSV(jobWithAdditionalCosts, kebroydProfile);
    expect(csv).toContain('Travel,');
    expect(csv).toContain('Accommodation,');
  });

  test('additional cost rows have correct amount', () => {
    const csv = buildQuickbooksCSV(jobWithAdditionalCosts, kebroydProfile);
    const rows = csv.split('\r\n').filter(l => l.length > 0);
    const travel = rows.find(r => r.startsWith('QT-2026-0047,') && r.includes('Travel,'));
    expect(parseCSVRow(travel)[8]).toBe('85.00');
  });
});

describe('buildQuickbooksCSV — job context prefix', () => {
  test('first line description is prefixed with site address', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    expect(csv).toContain('Works at Brink Farm Pott, SK10 5RU');
  });

  test('only the first line has the prefix (not every row)', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    expect(csv.match(/Works at Brink Farm Pott/g).length).toBe(1);
  });

  test('no prefix when site address is missing', () => {
    const jobNoAddress = {
      ...kebroydJob,
      site_address: null,
      quote_snapshot: {
        ...kebroydJob.quote_snapshot,
        jobDetails: { ...kebroydJob.quote_snapshot.jobDetails, siteAddress: null },
      },
    };
    const csv = buildQuickbooksCSV(jobNoAddress, kebroydProfile);
    expect(csv).not.toContain('Works at');
  });
});

describe('buildQuickbooksCSV — sanitisation', () => {
  test('customer name with commas is hyphenated', () => {
    const csv = buildQuickbooksCSV(jobWithCommaInClientName, kebroydProfile);
    expect(csv).toContain('Smith - John');
    expect(csv).not.toContain(',Smith, John,');
  });

  test('item name and description have # % & stripped', () => {
    const csv = buildQuickbooksCSV(jobWithForbiddenCharsInItem, kebroydProfile);
    const data = csv.split('\r\n').filter(l => l.length > 0).slice(1);
    for (const row of data) {
      const fields = parseCSVRow(row);
      expect(fields[4]).not.toMatch(/[#%&]/); // Item(Product/Service)
      expect(fields[5]).not.toMatch(/[#%&]/); // ItemDescription
    }
  });
});

describe('buildQuickbooksCSV — error cases', () => {
  test('throws when quote has no line items', () => {
    expect(() => buildQuickbooksCSV(jobWithNoLineItems, kebroydProfile))
      .toThrow(/no line items/i);
  });

  test('handles missing profile gracefully (no crash, defaults sensibly)', () => {
    expect(() => buildQuickbooksCSV(kebroydJob, {})).not.toThrow();
  });

  test('empty quote_snapshot throws (nothing to export)', () => {
    const emptyJob = { ...kebroydJob, quote_snapshot: {} };
    expect(() => buildQuickbooksCSV(emptyJob, kebroydProfile)).toThrow();
  });
});

describe('buildQuickbooksCSV — numeric formatting', () => {
  test('money fields always have exactly 2 decimals', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    const data = csv.split('\r\n').filter(l => l.length > 0).slice(1);
    for (const row of data) {
      const fields = parseCSVRow(row);
      expect(fields[7]).toMatch(/^-?\d+\.\d{2}$/);
      expect(fields[8]).toMatch(/^-?\d+\.\d{2}$/);
    }
  });

  test('money fields never contain thousands commas', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    expect(csv).toContain('4800.00');
    expect(csv).not.toContain('4,800');
  });

  test('dates are DD/MM/YYYY', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    const first = parseCSVRow(csv.split('\r\n')[1]);
    expect(first[2]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    expect(first[3]).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });

  test('due date is exactly invoice date + 30 days', () => {
    const csv = buildQuickbooksCSV(kebroydJob, kebroydProfile);
    const first = parseCSVRow(csv.split('\r\n')[1]);
    expect(first[2]).toBe('16/04/2026');
    expect(first[3]).toBe('16/05/2026');
  });
});

// ──────────────────────────────────────────────────────────────────────
// reconcileLineMath — preserves exact totals when qty × rate drifts
// ──────────────────────────────────────────────────────────────────────
describe('reconcileLineMath', () => {
  test('passes through when qty × rate matches amount exactly', () => {
    expect(reconcileLineMath(4.5, 185, 832.50)).toEqual({ qty: 4.5, rate: 185, amount: 832.50 });
  });
  test('passes through when qty × rate is within half-a-penny', () => {
    // 3 × 33.33 = 99.99, amount 99.99 — exact match, keep detail
    expect(reconcileLineMath(3, 33.33, 99.99)).toEqual({ qty: 3, rate: 33.33, amount: 99.99 });
  });
  test('collapses to qty=1 when qty × rate disagrees with amount (Harry bug)', () => {
    // 2.5 × 185 = 462.50 but saved total is 463.00 (upstream rounded up).
    // Must collapse to 1 × 463.00 so QBO's qty × rate === saved total.
    expect(reconcileLineMath(2.5, 185, 463.00)).toEqual({ qty: 1, rate: 463.00, amount: 463.00 });
  });
  test('collapses when numbers are wildly mismatched', () => {
    expect(reconcileLineMath(5, 100, 750)).toEqual({ qty: 1, rate: 750, amount: 750 });
  });
  test('falls back to qty=1 with garbage inputs', () => {
    expect(reconcileLineMath('bad', 185, 463)).toEqual({ qty: 1, rate: 463, amount: 463 });
  });
});

describe('buildQuickbooksCSV — rounding drift (no rounding guarantee)', () => {
  test('material line with drifted totalCost collapses to qty=1, rate=totalCost', () => {
    const driftJob = {
      ...kebroydJob,
      quote_snapshot: {
        ...kebroydJob.quote_snapshot,
        reviewData: {
          ...kebroydJob.quote_snapshot.reviewData,
          materials: [
            { id: 'mat-0', description: 'Sandstone', quantity: 2.5, unit: 't', unitCost: 185, totalCost: 463.00 },
          ],
          labourEstimate: { estimatedDays: 0, numberOfWorkers: 0, dayRate: 0 },
        },
      },
    };
    const csv = buildQuickbooksCSV(driftJob, kebroydProfile);
    const lines = csv.split('\r\n').filter(Boolean);
    const row = parseCSVRow(lines[1]);
    // Columns: InvoiceNo, Customer, InvoiceDate, DueDate, Item, Desc, Qty, Rate, Amount, Tax
    expect(row[6]).toBe('1');       // quantity
    expect(row[7]).toBe('463.00');  // rate (= total)
    expect(row[8]).toBe('463.00');  // amount
  });
});

// ──────────────────────────────────────────────────────────────────────
// Kebroyd snapshot — the big end-to-end lock
// ──────────────────────────────────────────────────────────────────────
describe('buildQuickbooksCSV — Kebroyd snapshot', () => {
  test('Kebroyd job produces expected CSV exactly (byte-for-byte)', () => {
    expect(buildQuickbooksCSV(kebroydJob, kebroydProfile)).toBe(KEBROYD_EXPECTED_CSV);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Wiring — server route + frontend button + modal (source-level asserts)
// ──────────────────────────────────────────────────────────────────────
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const quoteOutputSrc = readFileSync(
  join(repoRoot, 'src/components/steps/QuoteOutput.jsx'),
  'utf8'
);

describe('server route wiring', () => {
  test('GET /api/users/:id/jobs/:jobId/export/quickbooks-csv is defined', () => {
    expect(serverSrc).toMatch(
      /app\.get\(\s*['"`]\/api\/users\/:id\/jobs\/:jobId\/export\/quickbooks-csv['"`]/
    );
  });

  test('response is text/csv + Content-Disposition attachment', () => {
    const idx = serverSrc.indexOf('/export/quickbooks-csv');
    const block = serverSrc.slice(idx, idx + 2000);
    expect(block).toMatch(/text\/csv/);
    expect(block).toMatch(/Content-Disposition[\s\S]*?attachment/);
  });

  test('response prefixes UTF-8 BOM for Excel compatibility', () => {
    const idx = serverSrc.indexOf('/export/quickbooks-csv');
    const block = serverSrc.slice(idx, idx + 2000);
    expect(block).toMatch(/\\uFEFF/);
  });

  test('"no line items" / empty snapshot returns 400, not 500', () => {
    const idx = serverSrc.indexOf('/export/quickbooks-csv');
    const block = serverSrc.slice(idx, idx + 2500);
    expect(block).toMatch(/no line items|snapshot is empty/i);
    expect(block).toMatch(/res\.status\(400\)/);
  });
});

describe('QuoteOutput wiring — Export for QuickBooks', () => {
  test('imports buildQuickbooksCSV is NOT on the client (server-only)', () => {
    // The client component uses fetch() against the API route; it
    // should NOT import the CSV builder directly (would bundle sanitize
    // logic client-side unnecessarily).
    expect(quoteOutputSrc).not.toMatch(/from\s+['"`].*quickbooksExport/);
  });

  test('Export for QuickBooks button is wired + disables without saved job', () => {
    expect(quoteOutputSrc).toMatch(/Export for QuickBooks/);
    expect(quoteOutputSrc).toMatch(/handleExportQuickbooks/);
    // Disabled when no savedJobId — can't export before save.
    expect(quoteOutputSrc).toMatch(/disabled=\{exportingQb\s*\|\|\s*!\(savedJobId/);
  });

  test('instructions modal renders after a successful download', () => {
    expect(quoteOutputSrc).toMatch(/setShowQbInstructions\(true\)/);
    expect(quoteOutputSrc).toMatch(/<QbInstructionsModal/);
  });

  test('modal surfaces the Exclusive-VAT warning loudly', () => {
    const modalBlock = quoteOutputSrc.match(
      /function QbInstructionsModal[\s\S]*?^}/m
    )?.[0] || '';
    expect(modalBlock).toMatch(/Exclusive of tax/);
    // Red/error styling on the warning so it's visually distinct.
    expect(modalBlock).toMatch(/rgba\(239, 68, 68/);
  });

  test('modal shows which VAT setting was used for the export', () => {
    const modalBlock = quoteOutputSrc.match(
      /function QbInstructionsModal[\s\S]*?^}/m
    )?.[0] || '';
    expect(modalBlock).toMatch(/vatRegistered \? ['"]20% VAT['"] : ['"]No VAT['"]/);
  });

  test('modal warns iPad users to Save to Files (not Notes)', () => {
    // Paul hit the Notes trap: he picked Save to Notes from the iPad
    // share sheet, and Notes stored the CSV content as plain text
    // rather than a .csv file. This test locks in the fix.
    const modalBlock = quoteOutputSrc.match(
      /function QbInstructionsModal[\s\S]*?^}/m
    )?.[0] || '';
    expect(modalBlock).toMatch(/Save to Files/);
    expect(modalBlock).toMatch(/Save to Notes/);
  });

  test('modal contains no unresolved \\u escape sequences in JSX text', () => {
    // Regression guard for the Unicode-in-JSX-text bug. JSX treats
    // \u2699 etc. as literal characters, not escapes — they only
    // evaluate inside a JS expression {}. Modal had \u2699, \u2192,
    // \u2014, \u2019 rendering as raw text. Replaced with real chars.
    const modalBlock = quoteOutputSrc.match(
      /function QbInstructionsModal[\s\S]*?^}/m
    )?.[0] || '';
    // Strip anything inside JSX {...} expressions, then hunt for \u.
    const stripped = modalBlock.replace(/\{[^{}]*\}/g, '');
    expect(stripped).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });
});
