/**
 * exportRamsAsDocx — the RAMS Word export, held to the same structural
 * standard as the quote export (helpers/docxInspect.js).
 *
 * Extracted from RamsOutput.jsx (2026-09-20) so it can be run and validated
 * outside React. It had the same flaws as the quote exporter: ImageRun without
 * `type`, unsanitised text, <w:shd> without w:val, duplicate wp:docPr ids.
 */
import { describe, test, expect, beforeAll, afterAll, jest } from '@jest/globals';
import { exportRamsAsDocx } from '../utils/exportRamsDocx.js';
import { WORK_TYPE_LABELS } from '../data/ramsConstants.js';
import { COMMON_PPE } from '../data/ramsDefaults.js';
import {
  installFakeImage, JPEG, PNG, WEBP, openBlob, mediaParts, readPart, docxProblems, paragraphs,
} from './helpers/docxInspect.js';

let restoreImage;
beforeAll(() => { restoreImage = installFakeImage(); });
afterAll(() => restoreImage());

const firstType = Object.keys(WORK_TYPE_LABELS)[0];

const baseRams = () => ({
  company: 'Doyle Walling',
  documentDate: '2026-09-20',
  jobNumber: 'QT-2026-0042',
  client: 'Artemis',
  siteAddress: 'Barn at Rawfold, LA20 6DR',
  foreman: 'Mark Doyle',
  commencementDate: '2026-10-01',
  projectedCompletionDate: '2026-10-05',
  workStages: [
    { type: firstType, stage: 'Set up signage and barriers' },
    { type: firstType, stage: 'Clear fallen stone' },
    { type: 'custom', stage: 'Rebuild wall to original profile' },
  ],
  riskAssessments: [{
    task: 'Lifting stone', riskRating: 12, hazardDescription: 'Manual handling injury',
    whoMightBeHarmed: 'Operatives', existingControls: ['Team lift', 'Lifting aids'],
    likelihood: 3, consequence: 4, furtherActionRequired: 'Use mechanical aids above 25kg',
  }],
  workplaceAccess: 'Via field gate.',
  workplaceLighting: 'Daylight working only.',
  hazardousMaterials: 'None.',
  wasteManagement: 'Spoil retained on site.',
  specialControlMeasures: 'Keep livestock clear.',
  ppeRequirements: COMMON_PPE.slice(0, 3).map((p) => p.id),
  employeesOnJob: ['Mark Doyle', 'Paul Clough'],
  communicatedEmployees: ['Mark Doyle'],
  contactTitle: 'Site Contact', contactName: 'Mark Doyle', contactNumber: '07700 900123',
});
const baseProfile = () => ({ fullName: 'Mark Doyle', phone: '07700 900123', email: 'mark@example.com' });

const build = async (over = {}) => {
  const args = { rams: baseRams(), profile: baseProfile(), filteredPhotos: [], ...over };
  return openBlob(await exportRamsAsDocx(args));
};

describe('exportRamsAsDocx — structural validity', () => {
  test.each([
    ['fully populated, no images', () => ({})],
    ['with logo + 5 photos (multiple sections)', () => ({
      profile: { ...baseProfile(), logo: PNG },
      filteredPhotos: Array.from({ length: 5 }, (_, i) => ({ data: JPEG, label: `Photo ${i + 1}` })),
    })],
    ['sparse RAMS (optional sections empty)', () => ({
      rams: { ...baseRams(), workplaceAccess: '', workplaceLighting: '', hazardousMaterials: '', wasteManagement: '', specialControlMeasures: '', ppeRequirements: [], employeesOnJob: [], communicatedEmployees: [], riskAssessments: [], workStages: [] },
    })],
  ])('%s → no structural problems', async (_n, make) => {
    expect(await docxProblems(await build(make()))).toEqual([]);
  });

  test('every <w:shd> carries w:val', async () => {
    const xml = await readPart(await build(), 'word/document.xml');
    const shds = xml.match(/<w:shd\b[^>]*>/g) || [];
    expect(shds.length).toBeGreaterThan(0);
    for (const s of shds) expect(s).toMatch(/w:val="clear"/);
  });

  test('images: true types, unique docPr ids, alt text', async () => {
    const zip = await build({
      profile: { ...baseProfile(), logo: PNG },
      filteredPhotos: Array.from({ length: 3 }, (_, i) => ({ data: JPEG, label: `Photo ${i + 1}` })),
    });
    expect([...new Set(mediaParts(zip).map((m) => m.split('.').pop()))].sort()).toEqual(['jpg', 'png']);
    const xml = await readPart(zip, 'word/document.xml');
    const tags = xml.match(/<wp:docPr\b[^>]*>/g) || [];
    expect(tags).toHaveLength(4);
    const ids = tags.map((t) => /\bid="([^"]+)"/.exec(t)[1]);
    expect(new Set(ids).size).toBe(4);
    for (const t of tags) { expect(t).toMatch(/name="[^"]+"/); expect(t).toMatch(/descr="[^"]+"/); }
  });

  test('unsupported logo/photo formats are skipped, document stays valid', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const zip = await build({
      profile: { ...baseProfile(), logo: WEBP },
      filteredPhotos: [{ data: WEBP, label: 'bad' }, { data: JPEG, label: 'good' }],
    });
    expect(mediaParts(zip)).toHaveLength(1);
    expect(await docxProblems(zip)).toEqual([]);
    warn.mockRestore();
  });

  test('control characters in any RAMS text never reach the XML', async () => {
    const dirty = 'Unsafe\u000b text\u0007 here\u0000';
    const r = baseRams();
    for (const k of ['company', 'client', 'siteAddress', 'foreman', 'workplaceAccess', 'workplaceLighting', 'hazardousMaterials', 'wasteManagement', 'specialControlMeasures', 'contactName']) r[k] = dirty;
    r.workStages = [{ type: 'custom', stage: dirty }];
    r.riskAssessments = [{ ...r.riskAssessments[0], task: dirty, hazardDescription: dirty, whoMightBeHarmed: dirty, existingControls: [dirty], furtherActionRequired: dirty }];
    r.employeesOnJob = [dirty];
    expect(await docxProblems(await build({ rams: r, filteredPhotos: [{ data: JPEG, label: dirty }] }))).toEqual([]);
  });
});

describe('exportRamsAsDocx — content fidelity (behaviour preserved by the extraction)', () => {
  test('contains the headline sections, job ref, risk rating and stages', async () => {
    const paras = (await paragraphs(await build())).map((p) => p.text);
    const all = paras.join('\n');
    for (const h of ['RISK ASSESSMENT & METHOD STATEMENT', 'JOB DETAILS', 'SCOPE OF WORKS & METHOD STATEMENT', 'RISK ASSESSMENT', 'COMMUNICATION', 'EMERGENCY CONTACT']) {
      expect(paras).toContain(h);
    }
    expect(all).toContain('Job ref: QT-2026-0042 — Artemis, Barn at Rawfold, LA20 6DR');
    expect(all).toContain('L:3 x C:4 = 12');
    expect(all).toContain('1. Set up signage and barriers');
    expect(all).toContain('2. Clear fallen stone');
    expect(all).toContain('Emergency Services: 999');
  });

  test('photo captions include label and site address', async () => {
    const zip = await build({ filteredPhotos: [{ data: JPEG, label: 'North face' }] });
    const all = (await paragraphs(zip)).map((p) => p.text).join('\n');
    expect(all).toContain('North face — Barn at Rawfold, LA20 6DR');
  });

  test('optional sections are omitted when empty', async () => {
    const r = baseRams(); r.workplaceLighting = '';
    const paras = (await paragraphs(await build({ rams: r }))).map((p) => p.text);
    expect(paras).not.toContain('WORKPLACE LIGHTING');
    expect(paras).toContain('WORKPLACE ACCESS');
  });
});

describe('exportRamsAsDocx — parity with the on-screen RAMS', () => {
  const types = Object.keys(WORK_TYPE_LABELS).slice(0, 2);

  test('Work types are listed (the on-screen RAMS shows them; Word used to omit them)', async () => {
    const r = baseRams(); r.workTypes = types;
    const all = (await paragraphs(await build({ rams: r }))).map((p) => p.text).join('\n');
    expect(all).toContain('Work types: ' + types.map((t) => WORK_TYPE_LABELS[t]).join(', '));
  });

  test('Additional Method Description is included, with its line breaks (Word used to omit it)', async () => {
    const r = baseRams(); r.methodDescription = 'Rebuild in two lifts.\nBed each course on lime mortar.';
    const paras = await paragraphs(await build({ rams: r }));
    const texts = paras.map((p) => p.text);
    expect(texts).toContain('Additional Method Description');
    const body = paras.find((p) => p.text.includes('Rebuild in two lifts.'));
    expect(body.text).toBe('Rebuild in two lifts.\nBed each course on lime mortar.');
    expect(body.xml).toContain('<w:br/>');
  });

  test('neither is emitted when empty', async () => {
    const texts = (await paragraphs(await build())).map((p) => p.text).join('\n');
    expect(texts).not.toContain('Work types:');
    expect(texts).not.toContain('Additional Method Description');
  });

  test('free-text sections keep their line breaks (on screen they are whitespace-pre-wrap)', async () => {
    const r = baseRams(); r.workplaceAccess = 'Via field gate.\nKeep gate closed.';
    const paras = await paragraphs(await build({ rams: r }));
    const p = paras.find((x) => x.text.includes('Via field gate.'));
    expect(p.text).toBe('Via field gate.\nKeep gate closed.');
    expect(p.xml).toContain('<w:br/>');
  });

  test('a document using every new element is still structurally valid', async () => {
    const r = baseRams(); r.workTypes = types; r.methodDescription = 'a\nb\n\nc';
    expect(await docxProblems(await build({ rams: r, profile: { ...baseProfile(), logo: PNG }, filteredPhotos: [{ data: JPEG, label: 'x' }] }))).toEqual([]);
  });
});

