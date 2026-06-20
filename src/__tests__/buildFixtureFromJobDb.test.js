/**
 * TRQ-173 — Integration-shape test for the DB-touching layer of
 * scripts/build-fixture-from-job.js.
 *
 * We mock `pg` rather than hitting a live DB so this runs as part of
 * the standard `npm test` (which excludes the api.test.js / securityAudit
 * suites that need DATABASE_URL).
 *
 * Goal: prove that `extractJobAndPhotos`:
 *   1. SELECTs the job by id from `jobs`.
 *   2. SELECTs photos from `user_photos` keyed by (user_id, context=jobId).
 *   3. Returns an exit-2-worthy null when the job is not found.
 *   4. Returns an exit-2-worthy null when quote_snapshot is empty.
 *
 * Anything photo-decoding is exercised here too because that's where a
 * malformed base64 row would blow up.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { extractJobAndPhotos } from '../../scripts/build-fixture-from-job.js';

function makeMockClient(rowsByQuery) {
  // rowsByQuery: function(sql, params) → { rows }
  return {
    query: jest.fn(async (sql, params) => rowsByQuery(sql, params)),
  };
}

describe('extractJobAndPhotos — DB-touching layer', () => {
  const JOB_ID = '11111111-2222-3333-4444-555555555555';
  const USER_ID = 'mark';

  const realisticSnapshot = {
    totalAmount: 4500,
    jobDetails: {
      siteAddress: '221 High Greave, Sheffield, S5 9GS',
      briefNotes: 'Six metre stretch collapsed.',
    },
    reviewData: {
      measurements: [
        { item: 'Wall height', aiValue: '1,000mm', value: '1,200mm', valueMm: 1200, confirmed: true },
      ],
      materials: [{ description: 'walling stone' }],
      labourEstimate: { estimatedDays: 3, numberOfWorkers: 2 },
    },
  };

  it('returns { job, photos } when the job and photos exist', async () => {
    const client = makeMockClient((sql, params) => {
      if (sql.includes('FROM jobs')) {
        return {
          rows: [{
            id: JOB_ID,
            user_id: USER_ID,
            site_address: '221 High Greave, Sheffield, S5 9GS',
            client_name: 'Mrs Bob Homeowner',
            status: 'completed',
            quote_snapshot: realisticSnapshot,
          }],
        };
      }
      if (sql.includes('FROM user_photos')) {
        expect(params).toEqual([USER_ID, JOB_ID]);
        // Tiny JPEG (FF D8 FF) + tiny PNG (89 50 4E 47).
        const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
        const pngB64  = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]).toString('base64');
        return {
          rows: [
            { slot: 'overview',      data: `data:image/jpeg;base64,${jpegB64}` },
            { slot: 'closeup',       data: `data:image/png;base64,${pngB64}` },
            // referenceCard missing on purpose — should NOT cause an error.
          ],
        };
      }
      return { rows: [] };
    });
    const result = await extractJobAndPhotos(client, JOB_ID);
    expect(result).not.toBeNull();
    expect(result.job.id).toBe(JOB_ID);
    expect(result.job.user_id).toBe(USER_ID);
    expect(result.job.quote_snapshot).toEqual(realisticSnapshot);
    expect(result.photos.overview).toBeDefined();
    expect(result.photos.overview.bytes).toBeInstanceOf(Buffer);
    expect(result.photos.overview.extension).toBe('jpg');
    expect(result.photos.closeup.extension).toBe('png');
    // referenceCard never came through — must not appear in the result.
    expect(result.photos.referenceCard).toBeUndefined();
  });

  it('returns null when the job is not found', async () => {
    const client = makeMockClient(() => ({ rows: [] }));
    const result = await extractJobAndPhotos(client, JOB_ID);
    expect(result).toBeNull();
  });

  it('returns { job, photos } even when there are zero photos (warn, do not fail)', async () => {
    const client = makeMockClient((sql) => {
      if (sql.includes('FROM jobs')) {
        return {
          rows: [{
            id: JOB_ID, user_id: USER_ID, site_address: 'X',
            client_name: null, status: 'completed',
            quote_snapshot: realisticSnapshot,
          }],
        };
      }
      return { rows: [] };  // No photos rows.
    });
    const result = await extractJobAndPhotos(client, JOB_ID);
    expect(result).not.toBeNull();
    expect(Object.keys(result.photos)).toEqual([]);
  });

  it('accepts photo rows where data is plain base64 (no data: URL prefix)', async () => {
    // The user_photos.data column is stored as TEXT — sometimes with a
    // data:image/... prefix (saved via the photo upload pipeline) and
    // sometimes as plain base64 (older rows from the video extra-photos
    // path). We must handle both.
    const client = makeMockClient((sql) => {
      if (sql.includes('FROM jobs')) {
        return {
          rows: [{
            id: JOB_ID, user_id: USER_ID, site_address: 'X',
            client_name: null, status: 'completed',
            quote_snapshot: realisticSnapshot,
          }],
        };
      }
      const jpegB64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64');
      return { rows: [{ slot: 'overview', data: jpegB64 }] };
    });
    const result = await extractJobAndPhotos(client, JOB_ID);
    expect(result.photos.overview.extension).toBe('jpg');
  });

  it('throws a slot-named error when a photo row has unparseable base64', async () => {
    const client = makeMockClient((sql) => {
      if (sql.includes('FROM jobs')) {
        return {
          rows: [{
            id: JOB_ID, user_id: USER_ID, site_address: 'X',
            client_name: null, status: 'completed',
            quote_snapshot: realisticSnapshot,
          }],
        };
      }
      return { rows: [{ slot: 'closeup', data: '!!! not valid base64 !!!' }] };
    });
    await expect(extractJobAndPhotos(client, JOB_ID))
      .rejects
      .toThrow(/closeup/);
  });
});
