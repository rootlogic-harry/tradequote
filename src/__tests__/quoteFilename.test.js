import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildQuoteFilename } from '../utils/quoteFilename.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '..');
const quoteOutputJsx = readFileSync(
  join(srcDir, 'components/steps/QuoteOutput.jsx'),
  'utf8'
);
const ramsOutputJsx = readFileSync(
  join(srcDir, 'components/rams/RamsOutput.jsx'),
  'utf8'
);

// TRQ-122 update: filename format is
//   "{Client} - {Property} - {Postcode}.ext"
// No "Quote -" prefix, no quote reference (that lives in the backend).
// Property = first comma-delimited segment of siteAddress.
// Postcode = any UK postcode tokens (we take the last one found).
describe('buildQuoteFilename', () => {
  it('combines client, property and postcode', () => {
    const f = buildQuoteFilename({
      clientName: 'Jordan Fleet',
      siteAddress: '78 Top Station Road, Stoke-on-Trent, ST7 3NP',
    });
    expect(f).toBe('Jordan Fleet - 78 Top Station Road - ST7 3NP');
  });

  it('handles named properties before the street', () => {
    const f = buildQuoteFilename({
      clientName: 'Mark Doyle',
      siteAddress: 'The Gatehouse, Newhall Farm, Newhall Lane, Halifax HX37EE',
    });
    expect(f).toBe('Mark Doyle - The Gatehouse - HX37EE');
  });

  it('extracts postcode even if wrapped in trailing "United Kingdom"', () => {
    const f = buildQuoteFilename({
      clientName: 'Sam Kalanovic',
      siteAddress: '12 High Street, Skipton, BD23 1JD, United Kingdom',
    });
    expect(f).toBe('Sam Kalanovic - 12 High Street - BD23 1JD');
  });

  it('handles postcode without the space', () => {
    const f = buildQuoteFilename({
      clientName: 'Test Client',
      siteAddress: 'The Barn, Harrogate HG45NY',
    });
    expect(f).toBe('Test Client - The Barn - HG45NY');
  });

  it('omits missing segments rather than leaving empty dashes', () => {
    expect(buildQuoteFilename({ clientName: 'Lone Client', siteAddress: '' }))
      .toBe('Lone Client');
    expect(buildQuoteFilename({ clientName: 'Lone Client', siteAddress: 'The Old Mill' }))
      .toBe('Lone Client - The Old Mill');
    expect(buildQuoteFilename({ clientName: '', siteAddress: 'Address, BD23 1JD' }))
      .toBe('Address - BD23 1JD');
  });

  it('gracefully handles completely empty input', () => {
    expect(buildQuoteFilename({ clientName: '', siteAddress: '' })).toBe('Quote');
    expect(buildQuoteFilename({})).toBe('Quote');
    expect(buildQuoteFilename()).toBe('Quote');
  });

  it('strips filesystem-illegal characters but keeps apostrophes/ampersands', () => {
    const f = buildQuoteFilename({
      clientName: "O'Brien & Sons",
      siteAddress: '1 High St, Hebden Bridge HX7 6AA',
    });
    expect(f).toBe("O'Brien & Sons - 1 High St - HX7 6AA");
  });

  it('tolerates whitespace around segments', () => {
    const f = buildQuoteFilename({
      clientName: '  Jordan Fleet  ',
      siteAddress: '  78 Top Station Road  ,  Stoke  ,  ST7 3NP  ',
    });
    expect(f).toBe('Jordan Fleet - 78 Top Station Road - ST7 3NP');
  });

  it('uppercases postcodes even when the user typed lowercase', () => {
    const f = buildQuoteFilename({
      clientName: 'Client',
      siteAddress: 'Building, bd23 1jd',
    });
    expect(f).toBe('Client - Building - BD23 1JD');
  });

  it('never contains slashes / backslashes / reserved Windows characters', () => {
    const f = buildQuoteFilename({
      clientName: 'A<B>C:D"E/F\\G|H?I*J',
      siteAddress: 'X/Y, BD23 1JD',
    });
    expect(f).toMatch(/^[^<>:"/\\|?*]+$/);
  });
});

describe('Call-site wiring (TRQ-122)', () => {
  it('QuoteOutput uses buildQuoteFilename for Puppeteer + legacy + DOCX', () => {
    const hits = quoteOutputJsx.match(/buildQuoteFilename\(/g) || [];
    expect(hits.length).toBeGreaterThanOrEqual(3);
  });

  it('QuoteOutput no longer mentions quoteReference in filename construction', () => {
    // quoteReference still appears in the quote body — check that it is not
    // used in a template literal that ends with .pdf or .docx.
    expect(quoteOutputJsx).not.toMatch(/`[^`]*quoteReference[^`]*\.pdf`/);
    expect(quoteOutputJsx).not.toMatch(/`[^`]*quoteReference[^`]*\.docx`/);
  });

  it('RAMS filename now uses client + property + postcode (not job number)', () => {
    expect(ramsOutputJsx).toMatch(/buildQuoteFilename\(/);
  });
});
