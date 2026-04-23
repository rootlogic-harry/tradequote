/**
 * VideoUpload — rejection path surfaces errors (Paul's iPad bug).
 *
 * Paul's video showed him picking a video in the iOS Photos picker,
 * tapping done, and ending up back on the empty drop-zone with no
 * visible outcome. Root cause: every rejection path in handleFile
 * silently `return`ed, and the one callback that was wired
 * (`onDurationError`) wasn't connected to a toast in JobDetails.
 *
 * These source-level asserts lock in the fix: every rejection path
 * calls `reportError`, and the caller wires `onError` to showToast.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const uploadSrc = readFileSync(
  join(repoRoot, 'src/components/VideoUpload.jsx'),
  'utf-8'
);
const jobDetailsSrc = readFileSync(
  join(repoRoot, 'src/components/steps/JobDetails.jsx'),
  'utf-8'
);

describe('VideoUpload — every file rejection reports an error', () => {
  test('null file surfaces a "no file was selected" message', () => {
    const fn = uploadSrc.match(/const\s+handleFile\s*=\s*useCallback\(\([^)]+\)\s*=>\s*\{[\s\S]*?\},\s*\[[\s\S]*?\]\)/);
    expect(fn).not.toBeNull();
    const body = fn[0];
    expect(body).toMatch(/if\s*\(\s*!file\s*\)[\s\S]*?reportError/);
  });

  test('non-video MIME is caught with a descriptive message (not a silent return)', () => {
    const fn = uploadSrc.match(/const\s+handleFile\s*=\s*useCallback\([\s\S]*?\}\s*,\s*\[[\s\S]*?\]\)/);
    expect(fn[0]).toMatch(/file\.type[\s\S]*?video\/[\s\S]*?reportError/);
    // Negative: no silent return on wrong type
    expect(fn[0]).not.toMatch(/!file\.type\.startsWith\('video\/'\)\)\s*return\s*;/);
  });

  test('oversize files report the actual size, not silently fail', () => {
    const fn = uploadSrc.match(/const\s+handleFile\s*=\s*useCallback\([\s\S]*?\}\s*,\s*\[[\s\S]*?\]\)/);
    expect(fn[0]).toMatch(/file\.size\s*>\s*MAX_VIDEO_BYTES[\s\S]*?reportError/);
    // Message must mention both the measured size AND the cap.
    expect(fn[0]).toMatch(/sizeMb/);
    expect(fn[0]).toMatch(/100MB/);
  });

  test('duration-exceeded reports through the same unified path', () => {
    // reportError delegates to onError (preferred) or onDurationError
    // (back-compat). The duration-exceeded branch inside onloadedmetadata
    // must call one of them, not console.log and bail.
    const metaBlock = uploadSrc.match(/videoEl\.onloadedmetadata[\s\S]*?\};/);
    expect(metaBlock).not.toBeNull();
    expect(metaBlock[0]).toMatch(/onErrorRef\.current|onDurationErrorRef\.current/);
  });
});

describe('VideoUpload — drop zone UX (Paul-specific fixes)', () => {
  test('drops the desktop-centric "drop a video" copy', () => {
    // "Tap to record or drop a video" was the old copy; Paul can't
    // drop anything on an iPad. Replaced with "Add a video of the job".
    expect(uploadSrc).not.toMatch(/Tap to record or drop a video/);
    expect(uploadSrc).toMatch(/Add a video of the job/);
  });

  test('offers a Record-now button (capture=environment) for iPad camera', () => {
    // Skips the Photos picker entirely for users who want to shoot
    // fresh footage — Paul got stuck in the picker for 50+ seconds.
    expect(uploadSrc).toMatch(/cameraInputRef/);
    expect(uploadSrc).toMatch(/capture="environment"/);
    expect(uploadSrc).toMatch(/Record now/);
  });

  test('keeps the library picker as a separate, labelled button', () => {
    expect(uploadSrc).toMatch(/Choose from library/);
    // Two distinct inputs — camera vs. library — feeding the same handler.
    expect(uploadSrc).toMatch(/ref=\{cameraInputRef\}/);
    expect(uploadSrc).toMatch(/ref=\{fileInputRef\}/);
  });
});

describe('JobDetails — VideoUpload onError wired to showToast', () => {
  test('passes onError to VideoUpload (Paul saw nothing pre-fix)', () => {
    expect(jobDetailsSrc).toMatch(
      /<VideoUpload[\s\S]*?onError=\{[^}]*showToast/
    );
  });
});
