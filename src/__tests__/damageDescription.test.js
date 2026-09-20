/**
 * damageDescription — ONE normaliser shared by the on-screen quote / PDF
 * (QuoteDocument) and the Word export (exportDocx).
 *
 * Before 2026-09-20 the plain-prose rules (#152: strip numbered headers,
 * em dash → comma) lived inline in QuoteDocument only, so Word still emitted
 * the old bold "1 — Component" headers and, because plain prose went into a
 * single TextRun, lost its paragraph breaks. One shared function stops the
 * two outputs drifting again.
 */
import { describe, test, expect } from '@jest/globals';
import { normaliseDescription, descriptionParagraphs } from '../utils/damageDescription.js';

describe('normaliseDescription', () => {
  test.each([null, undefined, '', '   \n  '])('empty-ish input %p → ""', (v) => {
    expect(normaliseDescription(v)).toBe('');
  });

  test('strips legacy numbered section-header lines (—, – and - variants)', () => {
    const out = normaliseDescription('1 — Collapsed section\nBody one.\n2 – Coping\nBody two.\n3 - Base\nBody three.');
    expect(out).not.toMatch(/Collapsed section|Coping|Base/);
    expect(out).toContain('Body one.');
    expect(out).toContain('Body two.');
    expect(out).toContain('Body three.');
  });

  test('does NOT strip ordinary lines that merely start with a number', () => {
    expect(normaliseDescription('12 stones were displaced.')).toBe('12 stones were displaced.');
    expect(normaliseDescription('3m of coping is missing.')).toBe('3m of coping is missing.');
  });

  test('converts em dashes to commas and tidies the spacing around them', () => {
    expect(normaliseDescription('The wall — a 1.2m section — has failed.')).toBe('The wall, a 1.2m section, has failed.');
    expect(normaliseDescription('The wall—a 1.2m section—has failed.')).toBe('The wall, a 1.2m section, has failed.');
  });

  test('an em dash never swallows a newline (paragraph structure is preserved)', () => {
    expect(normaliseDescription('First line —\nSecond line')).toBe('First line,\nSecond line');
  });

  test('en dashes in ranges are left alone', () => {
    expect(normaliseDescription('Repair 3–4 m of wall.')).toBe('Repair 3–4 m of wall.');
  });

  test('collapses 3+ newlines to a single blank line and trims', () => {
    expect(normaliseDescription('\n\nA\n\n\n\n\nB\n\n')).toBe('A\n\nB');
  });
});

describe('descriptionParagraphs', () => {
  test('splits on blank lines into trimmed paragraphs', () => {
    expect(descriptionParagraphs('First.\n\nSecond.\n\n\nThird.')).toEqual(['First.', 'Second.', 'Third.']);
  });

  test('keeps a single newline INSIDE a paragraph (rendered as a line break)', () => {
    expect(descriptionParagraphs('Line one\nLine two\n\nNext')).toEqual(['Line one\nLine two', 'Next']);
  });

  test('a header-only description yields no paragraphs', () => {
    expect(descriptionParagraphs('1 — Only a header')).toEqual([]);
  });

  test.each([null, undefined, ''])('%p → []', (v) => {
    expect(descriptionParagraphs(v)).toEqual([]);
  });

  test('is idempotent (normalising already-normalised text changes nothing)', () => {
    const once = descriptionParagraphs('A — b\n\n\nC').join('\n\n');
    expect(descriptionParagraphs(once)).toEqual(once.split('\n\n'));
  });
});
