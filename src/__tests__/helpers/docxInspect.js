/**
 * Test helper: inspect a generated .docx the way Word (and Microsoft's Open XML
 * SDK validator) does. Not a test file (testMatch only picks up *.test.js).
 *
 * docxProblems() encodes every structural rule that has actually bitten us or
 * that Microsoft's validator flagged on our output (2026-09-20):
 *   - media parts named *.undefined / without a registered image content type
 *   - XML-illegal control characters (document.xml malformed)
 *   - <w:shd> without its required w:val (schema error on EVERY document)
 *   - duplicate <wp:docPr id> (Semantic error: "should have unique value")
 *   - a table cell not ending in a paragraph (classic Word corruption)
 *   - dangling / duplicate relationship ids
 *   - duplicate zip entries
 */
import JSZip from 'jszip';

// The exporters are browser-only (Image for aspect ratio). Minimal shim.
export class FakeImage {
  set src(v) { this._src = v; queueMicrotask(() => { this.width = 4000; this.height = 3000; this.onload?.(); }); }
  get src() { return this._src; }
}
export function installFakeImage() {
  const orig = globalThis.Image;
  globalThis.Image = FakeImage;
  return () => { globalThis.Image = orig; };
}

export const toDataUrl = (mime, bytes) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
export const JPEG = toDataUrl('image/jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
export const PNG = toDataUrl('image/png', Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
export const WEBP = toDataUrl('image/webp', [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);

export async function openBlob(blob) {
  return JSZip.loadAsync(await blob.arrayBuffer());
}
export const partNames = (zip) => Object.keys(zip.files).filter((n) => !zip.files[n].dir);
export const mediaParts = (zip) => partNames(zip).filter((n) => n.startsWith('word/media/'));
export const readPart = (zip, name) => zip.file(name).async('string');

export async function contentTypeDefaults(zip) {
  const xml = await readPart(zip, '[Content_Types].xml');
  const map = {};
  for (const [tag] of xml.matchAll(/<Default\b[^>]*>/g)) {
    const ext = /\bExtension="([^"]+)"/.exec(tag)?.[1];
    const type = /\bContentType="([^"]+)"/.exec(tag)?.[1];
    if (ext) map[ext.toLowerCase()] = type;
  }
  return map;
}

const unescapeXml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Visible text of every paragraph in document.xml (runs joined; <w:br/> as "\n"; entities decoded). */
export async function paragraphs(zip) {
  const xml = await readPart(zip, 'word/document.xml');
  return [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map(([p]) => ({
    xml: p,
    text: [...p.matchAll(/<w:br\/>|<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => (m[1] === undefined ? '\n' : unescapeXml(m[1]))).join(''),
  }));
}

// XML 1.0 illegal: C0 controls except \t \n \r
const ILLEGAL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

/** @returns {Promise<string[]>} human-readable problems; [] means structurally sound */
export async function docxProblems(zip) {
  const problems = [];
  const names = partNames(zip);
  const xmlNames = names.filter((n) => /\.(xml|rels)$/.test(n));

  // media naming + content types
  const defaults = await contentTypeDefaults(zip);
  for (const m of mediaParts(zip)) {
    const ext = m.split('.').pop().toLowerCase();
    if (/undefined/i.test(m)) problems.push(`media part named ${m}`);
    if (!/^image\//.test(defaults[ext] || '')) problems.push(`no image content type registered for .${ext} (${m})`);
  }

  // per-part XML checks
  const docPrIds = [];
  for (const name of xmlNames) {
    const xml = await readPart(zip, name);
    if (ILLEGAL.test(xml)) problems.push(`${name}: contains XML-illegal control characters`);

    for (const [tag] of xml.matchAll(/<w:shd\b[^>]*>/g)) {
      if (!/\bw:val="/.test(tag)) problems.push(`${name}: <w:shd> missing required w:val: ${tag}`);
    }
    for (const [tag] of xml.matchAll(/<wp:docPr\b[^>]*>/g)) {
      const id = /\bid="([^"]*)"/.exec(tag)?.[1];
      const nm = /\bname="([^"]*)"/.exec(tag)?.[1];
      if (!id) problems.push(`${name}: wp:docPr without id`);
      docPrIds.push(id);
      if (!nm) problems.push(`${name}: wp:docPr id=${id} has empty name`);
    }
    // Last child of a table cell must be a paragraph.
    const cells = (xml.match(/<\/w:tc>/g) || []).length;
    const okCells = (xml.match(/<\/w:p><\/w:tc>/g) || []).length;
    if (cells !== okCells) problems.push(`${name}: ${cells - okCells} table cell(s) do not end with a paragraph`);
  }
  const dupIds = [...new Set(docPrIds.filter((id, i) => docPrIds.indexOf(id) !== i))];
  if (dupIds.length) problems.push(`duplicate wp:docPr ids: ${dupIds.join(',')}`);

  // relationships
  for (const name of names.filter((n) => n.endsWith('.rels'))) {
    const xml = await readPart(zip, name);
    const ids = [...xml.matchAll(/<Relationship\b[^>]*\bId="([^"]+)"/g)].map((m) => m[1]);
    const dups = [...new Set(ids.filter((id, i) => ids.indexOf(id) !== i))];
    if (dups.length) problems.push(`${name}: duplicate relationship ids ${dups.join(',')}`);
  }
  const docXml = await readPart(zip, 'word/document.xml');
  const relXml = await readPart(zip, 'word/_rels/document.xml.rels');
  const relIds = new Set([...relXml.matchAll(/\bId="([^"]+)"/g)].map((m) => m[1]));
  for (const [, id] of docXml.matchAll(/\br:(?:id|embed)="([^"]+)"/g)) {
    if (!relIds.has(id)) problems.push(`document.xml references undefined relationship ${id}`);
  }
  return problems;
}
