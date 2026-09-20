/**
 * docxSafe — helpers that keep generated .docx packages valid for Word.
 *
 * 2026-09-20 (Mark): Word showed "found unreadable content ... recover?" on
 * every quote download. Two root causes, both reproduced from the real
 * exporter and both invisible to a lenient reader:
 *
 *  1. ImageRun was created without the (required) `type`, so docx wrote every
 *     logo/photo as word/media/<hash>.undefined with NO content type
 *     registered — a structurally invalid package.
 *  2. Text was passed to TextRun verbatim. XML 1.0 forbids most control
 *     characters (\u0000-\u0008, \u000B, \u000C, \u000E-\u001F); one stray
 *     vertical-tab from dictation/paste makes document.xml malformed.
 */
import { describe, test, expect } from '@jest/globals';
import { detectImageType, decodeImageDataUrl, sanitizeXmlText } from '../utils/docxSafe.js';

const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
const BMP = [0x42, 0x4d, 0x36, 0x00];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

describe('detectImageType (magic bytes — never trust the data-URL MIME)', () => {
  test.each([
    ['jpeg', JPEG, 'jpg'],
    ['png', PNG, 'png'],
    ['gif89a', GIF, 'gif'],
    ['gif87a', [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], 'gif'],
    ['bmp', BMP, 'bmp'],
  ])('%s → %s', (_n, bytes, expected) => {
    expect(detectImageType(Uint8Array.from(bytes))).toBe(expected);
  });

  test.each([
    ['webp (docx cannot embed it)', WEBP],
    ['random bytes', [1, 2, 3, 4, 5, 6, 7, 8]],
    ['too short', [0xff, 0xd8]],
    ['empty', []],
  ])('%s → null', (_n, bytes) => {
    expect(detectImageType(Uint8Array.from(bytes))).toBeNull();
  });
});

describe('decodeImageDataUrl', () => {
  test('decodes a JPEG data URL to bytes + type "jpg"', () => {
    const r = decodeImageDataUrl(`data:image/jpeg;base64,${b64(JPEG)}`);
    expect(r.type).toBe('jpg');
    expect(r.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(r.data)).toEqual(JPEG);
  });

  test('decodes a PNG data URL to type "png"', () => {
    expect(decodeImageDataUrl(`data:image/png;base64,${b64(PNG)}`).type).toBe('png');
  });

  test('trusts the BYTES when the declared MIME lies', () => {
    expect(decodeImageDataUrl(`data:image/png;base64,${b64(JPEG)}`).type).toBe('jpg');
  });

  test('throws a clear error for a format Word export cannot embed (webp)', () => {
    expect(() => decodeImageDataUrl(`data:image/webp;base64,${b64(WEBP)}`)).toThrow(/unsupported image/i);
  });

  test.each([undefined, null, '', 'not a data url', 'data:image/jpeg;base64,'])(
    'throws for invalid input %p',
    (bad) => { expect(() => decodeImageDataUrl(bad)).toThrow(); }
  );
});

describe('sanitizeXmlText', () => {
  test('strips XML-1.0-illegal control characters', () => {
    expect(sanitizeXmlText('a\u0000b\u0007c\u000bd\u000ce\u001ff')).toBe('abcdef');
  });

  test('keeps tab, newline and carriage return', () => {
    expect(sanitizeXmlText('a\tb\nc\rd')).toBe('a\tb\nc\rd');
  });

  test('keeps ordinary unicode: £, em dash, accents, and valid emoji surrogate pairs', () => {
    const s = '£1,200 — Café 😀';
    expect(sanitizeXmlText(s)).toBe(s);
  });

  test('removes lone surrogates (invalid in XML) but keeps the rest', () => {
    expect(sanitizeXmlText('a\ud800b')).toBe('ab');
    expect(sanitizeXmlText('a\udc00b')).toBe('ab');
  });

  test('removes U+FFFE / U+FFFF non-characters', () => {
    expect(sanitizeXmlText('a￾b￿c')).toBe('abc');
  });

  test.each([undefined, null])('%p → empty string', (v) => {
    expect(sanitizeXmlText(v)).toBe('');
  });

  test('coerces numbers to strings', () => {
    expect(sanitizeXmlText(42)).toBe('42');
  });
});
