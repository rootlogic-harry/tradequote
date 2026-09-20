/**
 * exportQuoteAsDocx — package-level validity (2026-09-20, Mark: "Word found
 * unreadable content"). Runs the REAL exporter and inspects the zip the way
 * Word does: every media part needs a registered content type, and every XML
 * part must be free of XML-illegal characters.
 */
import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import JSZip from 'jszip';
import { exportQuoteAsDocx } from '../utils/exportDocx.js';

// The exporter is browser-only (Image for aspect ratio). Minimal shim.
class FakeImage {
  set src(v) { this._src = v; queueMicrotask(() => { this.width = 4000; this.height = 3000; this.onload?.(); }); }
  get src() { return this._src; }
}
let origImage;
beforeAll(() => { origImage = globalThis.Image; globalThis.Image = FakeImage; });
afterAll(() => { globalThis.Image = origImage; });

const toUrl = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const JPEG = toUrl('image/jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const PNG = toUrl('image/png', Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const WEBP = toUrl('image/webp', [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

const baseArgs = (over = {}) => ({
  jobDetails: { quoteDate: '2026-09-20', quoteReference: 'QT-1', clientName: 'Artemis', siteAddress: 'Barn at Rawfold, LA20 6DR' },
  profile: { companyName: 'Doyle Walling', fullName: 'Mark', phone: '07700 900123', email: 'm@example.com', address: '1 Lane', vatRegistered: false, showNotesOnQuote: true },
  term: { title: 'Quote', lower: 'quote', upper: 'QUOTE' },
  reviewData: {
    damageDescription: 'A 6m section has collapsed.\n\nAccess via field gate.',
    measurements: [{ item: 'Length', confirmed: true, value: '6.0 m' }],
    scheduleOfWorks: [{ title: 'Clear site', description: 'Clear debris.' }],
    materials: [{ description: 'Stone', quantity: 2, unit: 't', unitCost: 180, totalCost: 360 }],
    additionalCosts: [],
    notes: [],
  },
  totals: { subtotal: 1560, vatAmount: 0, total: 1560, labourTotal: 1200 },
  filteredPhotos: [],
  ...over,
});

async function openDocx(args) {
  const blob = await exportQuoteAsDocx(args);
  return JSZip.loadAsync(await blob.arrayBuffer());
}

const partNames = (zip) => Object.keys(zip.files).filter((n) => !zip.files[n].dir);
const mediaParts = (zip) => partNames(zip).filter((n) => n.startsWith('word/media/'));
// Map of registered extension -> content type. Attribute order in <Default>
// is not guaranteed (docx writes ContentType first), so parse each tag.
async function contentTypeDefaults(zip) {
  const xml = await zip.file('[Content_Types].xml').async('string');
  const map = {};
  for (const [tag] of xml.matchAll(/<Default\b[^>]*>/g)) {
    const ext = /\bExtension="([^"]+)"/.exec(tag)?.[1];
    const type = /\bContentType="([^"]+)"/.exec(tag)?.[1];
    if (ext) map[ext.toLowerCase()] = type;
  }
  return map;
}
// XML 1.0 illegal: C0 controls except \t \n \r
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

describe('exportQuoteAsDocx — embedded images', () => {
  test('logo + photos: no media part is named *.undefined', async () => {
    const zip = await openDocx(baseArgs({
      profile: { ...baseArgs().profile, logo: PNG },
      filteredPhotos: [{ data: JPEG, label: 'a' }, { data: JPEG, label: 'b' }, { data: JPEG, label: 'c' }],
    }));
    const media = mediaParts(zip);
    expect(media.length).toBeGreaterThan(0);
    for (const m of media) expect(m).not.toMatch(/undefined/);
  });

  test('every media part extension has a registered content type (the Word "unreadable content" trigger)', async () => {
    const zip = await openDocx(baseArgs({
      profile: { ...baseArgs().profile, logo: PNG },
      filteredPhotos: [{ data: JPEG, label: 'a' }],
    }));
    const defaults = await contentTypeDefaults(zip);
    const media = mediaParts(zip);
    expect(media.length).toBeGreaterThan(0);
    for (const m of media) {
      const ext = m.split('.').pop().toLowerCase();
      expect(defaults[ext]).toMatch(/^image\//);
    }
    expect(defaults.png).toBe('image/png');
    expect(defaults.jpg).toBe('image/jpeg');
  });

  test('a PNG logo and JPEG photo are embedded with their true types', async () => {
    const zip = await openDocx(baseArgs({
      profile: { ...baseArgs().profile, logo: PNG },
      filteredPhotos: [{ data: JPEG, label: 'a' }],
    }));
    const exts = mediaParts(zip).map((m) => m.split('.').pop());
    expect(exts.sort()).toEqual(['jpg', 'png']);
  });

  test('a logo in a format Word cannot embed (webp) is skipped — the document is still valid', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const zip = await openDocx(baseArgs({ profile: { ...baseArgs().profile, logo: WEBP } }));
    expect(mediaParts(zip)).toHaveLength(0);
    expect(zip.file('word/document.xml')).not.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('one unsupported photo is skipped while the good ones are kept', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const zip = await openDocx(baseArgs({
      filteredPhotos: [{ data: JPEG, label: 'good' }, { data: WEBP, label: 'bad' }],
    }));
    const media = mediaParts(zip);
    expect(media).toHaveLength(1);
    expect(media[0]).toMatch(/\.jpg$/);
    warn.mockRestore();
  });
});

describe('exportQuoteAsDocx — text is XML-safe', () => {
  test('control characters anywhere in user text never reach the XML', async () => {
    const dirty = 'Collapsed\u000b section\u0007 near\u0000 gate\u000c';
    const args = baseArgs();
    args.reviewData.damageDescription = dirty;
    args.reviewData.scheduleOfWorks = [{ title: 'Clear\u000b', description: dirty }];
    args.reviewData.materials = [{ description: dirty, quantity: 1, unit: 't\u0007', unitCost: 1, totalCost: 1 }];
    args.reviewData.measurements = [{ item: dirty, confirmed: true, value: '1\u000b m' }];
    args.reviewData.notes = [dirty];
    args.jobDetails.clientName = dirty;
    args.profile.companyName = dirty;
    const zip = await openDocx(args);
    for (const name of partNames(zip).filter((n) => /\.(xml|rels)$/.test(n))) {
      const xml = await zip.file(name).async('string');
      expect(`${name}: ${ILLEGAL.test(xml)}`).toBe(`${name}: false`);
    }
  });

  test('legitimate text survives sanitising (£, em dash, ampersand)', async () => {
    const args = baseArgs();
    args.reviewData.scheduleOfWorks = [{ title: 'Rebuild — phase 1', description: 'Stone & mortar £1,200' }];
    const zip = await openDocx(args);
    const xml = await zip.file('word/document.xml').async('string');
    expect(xml).toContain('Rebuild — phase 1');
    expect(xml).toContain('Stone &amp; mortar £1,200');
  });
});
