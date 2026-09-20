/**
 * exportQuoteAsDocx — package validity + fidelity (2026-09-20, Mark: "Word
 * found unreadable content"). Runs the REAL exporter and inspects the zip the
 * way Word / Microsoft's Open XML validator does. Structural rules live in
 * helpers/docxInspect.js so the RAMS exporter is held to the same standard.
 */
import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { exportQuoteAsDocx } from '../utils/exportDocx.js';
import {
  installFakeImage, JPEG, PNG, WEBP, openBlob, mediaParts, partNames, readPart,
  contentTypeDefaults, docxProblems, paragraphs,
} from './helpers/docxInspect.js';

let restoreImage;
beforeAll(() => { restoreImage = installFakeImage(); });
afterAll(() => restoreImage());

const baseArgs = () => ({
  jobDetails: { quoteDate: '2026-09-20', quoteReference: 'QT-1', clientName: 'Artemis', siteAddress: 'Barn at Rawfold, LA20 6DR' },
  profile: { companyName: 'Doyle Walling', fullName: 'Mark', phone: '07700 900123', email: 'm@example.com', address: '1 Lane', vatRegistered: false, showNotesOnQuote: true },
  term: { title: 'Quote', lower: 'quote', upper: 'QUOTE' },
  reviewData: {
    damageDescription: 'A 6m section has collapsed.\n\nAccess via field gate.',
    measurements: [{ item: 'Length', confirmed: true, value: '6.0 m' }],
    scheduleOfWorks: [{ title: 'Clear site', description: 'Clear debris.' }],
    materials: [{ description: 'Stone', quantity: 2, unit: 't', unitCost: 180, totalCost: 360 }],
    additionalCosts: [{ label: 'Skip hire', amount: 90 }],
    notes: [],
  },
  totals: { subtotal: 1560, vatAmount: 0, total: 1560, labourTotal: 1200 },
  filteredPhotos: [],
});

const withMedia = (over = {}) => {
  const a = baseArgs();
  a.profile.logo = PNG;
  a.filteredPhotos = Array.from({ length: 5 }, (_, i) => ({ data: JPEG, label: `p${i}` }));
  return Object.assign(a, over);
};

const build = async (args) => openBlob(await exportQuoteAsDocx(args));

describe('exportQuoteAsDocx — whole-package structural validity', () => {
  test.each([
    ['plain quote, no images', () => baseArgs()],
    ['logo + 5 photos (multiple sections)', () => withMedia()],
    ['VAT-registered with footer address + VAT no.', () => { const a = withMedia(); a.profile = { ...a.profile, vatRegistered: true, vatNumber: 'GB123', tradingAddress: '2 Yard' }; return a; }],
    ['notes hidden', () => { const a = baseArgs(); a.profile.showNotesOnQuote = false; return a; }],
    ['no additional costs / no materials rows', () => { const a = baseArgs(); a.reviewData.additionalCosts = []; a.reviewData.materials = []; return a; }],
  ])('%s → no structural problems', async (_name, make) => {
    expect(await docxProblems(await build(make()))).toEqual([]);
  });

  test('every <w:shd> carries w:val (Microsoft validator: required attribute missing on EVERY document)', async () => {
    const xml = await readPart(await build(baseArgs()), 'word/document.xml');
    const shds = xml.match(/<w:shd\b[^>]*>/g) || [];
    expect(shds.length).toBeGreaterThan(0); // the shaded reference line
    for (const s of shds) expect(s).toMatch(/w:val="clear"/);
  });

  test('every embedded image has a UNIQUE wp:docPr id (logo + 5 photos)', async () => {
    const xml = await readPart(await build(withMedia()), 'word/document.xml');
    const ids = [...xml.matchAll(/<wp:docPr\b[^>]*\bid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  test('images carry alt text (name + description) for accessibility', async () => {
    const xml = await readPart(await build(withMedia()), 'word/document.xml');
    for (const [tag] of xml.matchAll(/<wp:docPr\b[^>]*>/g)) {
      expect(tag).toMatch(/name="[^"]+"/);
      expect(tag).toMatch(/descr="[^"]+"/);
    }
  });
});

describe('exportQuoteAsDocx — embedded images', () => {
  test('no media part is named *.undefined; each extension has a registered image content type', async () => {
    const zip = await build(withMedia());
    const defaults = await contentTypeDefaults(zip);
    const media = mediaParts(zip);
    expect(media.length).toBeGreaterThan(0);
    for (const m of media) {
      expect(m).not.toMatch(/undefined/);
      expect(defaults[m.split('.').pop().toLowerCase()]).toMatch(/^image\//);
    }
    expect(defaults.png).toBe('image/png');
    expect(defaults.jpg).toBe('image/jpeg');
  });

  test('a PNG logo and JPEG photos are embedded with their true types', async () => {
    const zip = await build(withMedia());
    expect([...new Set(mediaParts(zip).map((m) => m.split('.').pop()))].sort()).toEqual(['jpg', 'png']);
  });

  test('a logo in a format Word cannot embed (webp) is skipped — the document is still valid', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const a = baseArgs(); a.profile.logo = WEBP;
    const zip = await build(a);
    expect(mediaParts(zip)).toHaveLength(0);
    expect(await docxProblems(zip)).toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('one unsupported photo is skipped while the good ones are kept (and ids stay unique)', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const a = baseArgs();
    a.filteredPhotos = [{ data: JPEG, label: 'good' }, { data: WEBP, label: 'bad' }, { data: JPEG, label: 'good2' }];
    const zip = await build(a);
    const xml = await readPart(zip, 'word/document.xml');
    expect((xml.match(/<wp:docPr\b/g) || []).length).toBe(2);
    expect(await docxProblems(zip)).toEqual([]);
    warn.mockRestore();
  });
});

describe('exportQuoteAsDocx — text is XML-safe', () => {
  test('control characters anywhere in user text never reach the XML', async () => {
    const dirty = 'Collapsed\u000b section\u0007 near\u0000 gate\u000c';
    const a = baseArgs();
    a.reviewData.damageDescription = dirty;
    a.reviewData.scheduleOfWorks = [{ title: 'Clear\u000b', description: dirty }];
    a.reviewData.materials = [{ description: dirty, quantity: 1, unit: 't\u0007', unitCost: 1, totalCost: 1 }];
    a.reviewData.measurements = [{ item: dirty, confirmed: true, value: '1\u000b m' }];
    a.reviewData.additionalCosts = [{ label: dirty, amount: 1 }];
    a.reviewData.notes = [dirty];
    a.jobDetails.clientName = dirty;
    a.profile.companyName = dirty;
    expect(await docxProblems(await build(a))).toEqual([]);
  });

  test('legitimate text survives sanitising (£, em dash outside the description, ampersand)', async () => {
    const a = baseArgs();
    a.reviewData.scheduleOfWorks = [{ title: 'Rebuild — phase 1', description: 'Stone & mortar £1,200' }];
    const xml = await readPart(await build(a), 'word/document.xml');
    expect(xml).toContain('Rebuild — phase 1');
    expect(xml).toContain('Stone &amp; mortar £1,200');
  });
});

describe('exportQuoteAsDocx — damage description (parity with the on-screen quote)', () => {
  const descParas = async (text) => {
    const a = baseArgs();
    a.reviewData.damageDescription = text;
    const paras = await paragraphs(await build(a));
    return paras;
  };
  const find = (paras, needle) => paras.filter((p) => p.text.includes(needle));

  test('blank lines become separate Word paragraphs (they used to collapse into one)', async () => {
    const paras = await descParas('First paragraph here.\n\nSecond paragraph here.\n\nThird one.');
    const [p1] = find(paras, 'First paragraph');
    const [p2] = find(paras, 'Second paragraph');
    const [p3] = find(paras, 'Third one');
    expect(p1 && p2 && p3).toBeTruthy();
    expect(p1.text).not.toContain('Second paragraph');
    expect(p2.text).not.toContain('Third one');
  });

  test('a single newline inside a paragraph is a real line break, not a raw \\n in <w:t>', async () => {
    const zip = await build((() => { const a = baseArgs(); a.reviewData.damageDescription = 'Line one\nLine two'; return a; })());
    const paras = await paragraphs(zip);
    const [p] = find(paras, 'Line one');
    expect(p.text).toBe('Line one\nLine two');
    expect(p.xml).toContain('<w:br/>');
    expect(await readPart(zip, 'word/document.xml')).not.toMatch(/<w:t[^>]*>[^<]*\n[^<]*<\/w:t>/);
  });

  test('legacy numbered "1 — Component" headers are stripped, as on screen', async () => {
    const paras = await descParas('1 — Collapsed section\nStones scattered downslope.\n\n2 - Coping\nCopings missing.');
    const joined = paras.map((p) => p.text).join('\n');
    expect(joined).not.toMatch(/^\d+\s*[—–-]\s*Collapsed/m);
    expect(joined).not.toContain('1 — Collapsed section');
    expect(joined).toContain('Stones scattered downslope.');
    expect(joined).toContain('Copings missing.');
  });

  test('em dashes in the description become commas, as on screen', async () => {
    const paras = await descParas('The wall — a 1.2m gritstone section — has failed.');
    const [p] = find(paras, 'has failed');
    expect(p.text).toBe('The wall, a 1.2m gritstone section, has failed.');
  });

  test('an empty description produces no description paragraph but still a valid document', async () => {
    const zip = await build((() => { const a = baseArgs(); a.reviewData.damageDescription = ''; return a; })());
    expect(await docxProblems(zip)).toEqual([]);
  });

  test('the DESCRIPTION OF DAMAGE heading is always present', async () => {
    const paras = await descParas('x');
    expect(find(paras, 'DESCRIPTION OF DAMAGE')).toHaveLength(1);
  });
});
