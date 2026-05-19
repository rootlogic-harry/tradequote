/**
 * Video-mode site photos appear on the quote (Mark, 2026-05-19).
 *
 * Before this change: extra photos attached to a video upload were
 * consumed by Sonnet for analysis then deleted with the multer temp files.
 * The QuoteDocument photo grid only read from state.photos (the 5 named
 * slots), which are empty in video mode — so the customer's PDF had no
 * site images.
 *
 * After this change, the contract is:
 *   1. server.js video route persists each `extraPhotoFiles[i]` into
 *      user_photos with context='draft', slot='extra-{i}', label, name —
 *      BEFORE the temp-file cleanup, so the data survives even if Whisper
 *      or Sonnet later fail.
 *   2. QuoteDocument extends docPhotos with state.extraPhotos so the
 *      photo grid renders them in PDF / dashboard preview / saved viewer.
 *   3. JobDetails reloads photos after a successful video ANALYSIS_SUCCESS
 *      so Step 4 shows them without a page refresh.
 *   4. VideoUpload re-labels the affordance from "Extra photos" to
 *      "Site photos for the quote" with an expectation-setting sub-label.
 *
 * These tests anchor each layer of the contract.
 */
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '../../');
const serverSrc = readFileSync(join(repoRoot, 'server.js'), 'utf8');
const quoteDocSrc = readFileSync(join(repoRoot, 'src/components/QuoteDocument.jsx'), 'utf8');
const jobDetailsSrc = readFileSync(join(repoRoot, 'src/components/steps/JobDetails.jsx'), 'utf8');
const videoUploadSrc = readFileSync(join(repoRoot, 'src/components/VideoUpload.jsx'), 'utf8');

// Pull the body of the video POST handler so assertions don't accidentally
// match the photo-mode /photos/:context/:slot upsert elsewhere in server.js.
function videoRouteBody() {
  const m = serverSrc.match(
    /app\.post\(\s*['"]\/api\/users\/:id\/jobs\/:jobId\/video['"][\s\S]*?\n\}\s*\)\s*;/
  );
  if (!m) throw new Error('Video POST route not found in server.js');
  return m[0];
}

describe('Server — video route persists extraPhotos to user_photos', () => {
  const body = videoRouteBody();

  test('inserts a user_photos row per extraPhotoFiles entry with context=draft and slot=extra-N', () => {
    // The upsert against user_photos must reference extra- slots AND must
    // live inside the video route body (not the generic /photos upsert).
    expect(body).toMatch(/user_photos/);
    expect(body).toMatch(/['"]?extra-/);
    expect(body).toMatch(/extraPhotoFiles/);
  });

  test('persists BEFORE the temp-file cleanup in the finally block', () => {
    // The finally block unlinks the multer temp files. We must capture
    // the photo bytes before that runs, otherwise a Whisper / Sonnet
    // failure would lose them. Cheapest source assertion: the user_photos
    // INSERT appears before the finally cleanup.
    const insertIdx = body.search(/INSERT INTO user_photos[\s\S]*?extra-/);
    const finallyIdx = body.search(/}\s*finally\s*\{/);
    expect(insertIdx).toBeGreaterThan(-1);
    expect(finallyIdx).toBeGreaterThan(-1);
    expect(insertIdx).toBeLessThan(finallyIdx);
  });

  test('persistence is best-effort — analysis must succeed even if a single photo insert fails', () => {
    // Wrap the INSERT in try/catch (or per-row best-effort). Defensive:
    // a malformed photo blob shouldn't 500 the whole analysis. The
    // critique-style log shape used elsewhere is "[Video] persist …"
    expect(body).toMatch(/\[Video\][\s\S]{0,80}?(persist|photo)/i);
  });

  test('uses the same upsert shape as the dedicated /photos route', () => {
    // ON CONFLICT (user_id, context, slot) DO UPDATE — matches the
    // existing pattern so reload-and-rewrite stays idempotent.
    expect(body).toMatch(/ON CONFLICT[\s\S]{0,150}?DO UPDATE/);
  });
});

describe('QuoteDocument — photo grid includes state.extraPhotos', () => {
  test('docPhotos appends state.extraPhotos after the 5 named slots', () => {
    // The existing code lists the 5 slots in order. We add a final
    // loop / spread for extraPhotos so video-mode site photos appear
    // alongside photo-mode quotes that already had this content path.
    const block = quoteDocSrc.match(/let docPhotos[\s\S]*?const displayMaterials/);
    expect(block).not.toBeNull();
    const docPhotosBlock = block[0];
    expect(docPhotosBlock).toMatch(/photos\.overview/);
    expect(docPhotosBlock).toMatch(/photos\.access/);
    // The new contract: extraPhotos contribute to docPhotos too.
    expect(docPhotosBlock).toMatch(/extraPhotos/);
  });

  test('each extra photo carries its label through to the rendered grid', () => {
    // Labels (Overview / Close-up / Site photo / etc.) appear under each
    // grid tile. The mapping must preserve photo.label so the customer
    // can read what they're looking at.
    const block = quoteDocSrc.match(/let docPhotos[\s\S]*?const displayMaterials/);
    const docPhotosBlock = block[0];
    expect(docPhotosBlock).toMatch(/label/);
  });
});

describe('JobDetails — video flow reloads photos after ANALYSIS_SUCCESS', () => {
  test('reloads photos via loadPhotos after the video POST resolves', () => {
    // Without this, the tradesman would have to refresh or navigate
    // away and back to see the photos they just uploaded in Step 4.
    // The video submit handler currently dispatches ANALYSIS_SUCCESS
    // and exits — extend to call loadPhotos(currentUserId, 'draft')
    // and dispatch RESTORE_PHOTOS.
    const block = jobDetailsSrc.match(/ANALYSIS_SUCCESS[\s\S]{0,1500}/);
    expect(block).not.toBeNull();
    const window = block[0];
    expect(window).toMatch(/loadPhotos/);
    expect(window).toMatch(/RESTORE_PHOTOS/);
  });

  test('loadPhotos is imported in JobDetails (or an existing equivalent helper)', () => {
    expect(jobDetailsSrc).toMatch(/loadPhotos/);
  });
});

describe('VideoUpload — UX copy makes the quote-impact explicit', () => {
  test('section header reads "Site photos" (not generic "Extra photos")', () => {
    expect(videoUploadSrc).toMatch(/Site photos/i);
  });

  test('sub-label sets the expectation that photos appear on the quote', () => {
    expect(videoUploadSrc).toMatch(/appear.*quote|on the quote|on your quote/i);
  });
});

describe('Photo mode parity — pre-existing behaviour unchanged', () => {
  // Photo mode has rendered extraPhotos via QuoteDocument forever via the
  // photo-mode flow (extras saved via savePhoto). The new contract must
  // not duplicate them or change their order.
  test('the 5 named slots still come BEFORE the extras in docPhotos', () => {
    const block = quoteDocSrc.match(/let docPhotos[\s\S]*?const displayMaterials/);
    const docPhotosBlock = block[0];
    const overviewIdx = docPhotosBlock.indexOf('photos.overview');
    const extraIdx = docPhotosBlock.search(/extraPhotos/);
    expect(overviewIdx).toBeGreaterThan(-1);
    expect(extraIdx).toBeGreaterThan(overviewIdx);
  });
});
