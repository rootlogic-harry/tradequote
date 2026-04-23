# QuickBooks Export — Source Verification Notes (Phase 0)

Recorded: 2026-04-23. The spec's fixture used placeholder property
names that did not match reality. Actual paths verified against
reducer.js, quoteBuilder.js, aiParser.js, stripBlobs.js.

## Save-snapshot contract

`SAVE_ALLOWLIST` in `src/utils/stripBlobs.js` persists these keys:

    profile, jobDetails, reviewData, quotePayload, quoteSequence,
    quoteMode, captureMode, diffs, transcript

So `job.quote_snapshot` on a saved row contains both a flat `reviewData`
block AND a nested `quotePayload.quote.*` block with the same data.

**Decision: the exporter reads from `reviewData.*` (flatter, no risk of
the nested `quote` sub-object ever being absent on pre-payload quotes).**

## Materials array

- Path on a saved job: `job.quote_snapshot.reviewData.materials`
- Shape (from `src/utils/aiParser.js:143`):
  ```
  {
    id: 'mat-0',
    description: string,    // NOT `name`
    quantity: number,       // numeric, NOT a string
    unit: string,           // 't' | 'Item' | 'm' | default 'Item'
    unitCost: number,
    totalCost: number,      // NOT `lineTotal`
    aiUnitCost: number,     // immutable
    aiQuantity: number,     // immutable
    aiTotalCost: number,    // immutable
  }
  ```

## Additional costs

- Path: `job.quote_snapshot.reviewData.additionalCosts`
- Shape (from `src/components/steps/ReviewEdit.jsx:90`):
  ```
  { id: string, label: string, amount: number }
  ```
- No per-unit structure — each is a flat `amount`.

## Labour

- Path: `job.quote_snapshot.reviewData.labourEstimate`
- Shape (from `src/utils/quoteBuilder.js:62` and aiParser:159):
  ```
  {
    estimatedDays: number,
    numberOfWorkers: number,   // NOT `workers`
    dayRate: number,           // NOT always present; fall back to profile.dayRate
    aiEstimatedDays: number,   // immutable
  }
  ```
- NB: the nested `quotePayload.quote.labour` DOES use `days`, `workers`,
  `dayRate` (different names!) but we read from `reviewData.labourEstimate`,
  so the reducer names are what matter.

## Client / job metadata

- Path: `job.quote_snapshot.jobDetails.clientName` (also mirrored to
  `job.client_name` column).
- Path: `job.quote_snapshot.jobDetails.siteAddress` (mirrored to
  `job.site_address`).
- Path: `job.quote_snapshot.jobDetails.quoteReference` (mirrored to
  `job.quote_reference`).
- Path: `job.quote_snapshot.jobDetails.quoteDate` — stored as
  ISO-ish string (`'2026-04-16'`), **NOT DD/MM/YYYY**. The spec's
  fixture assumed DD/MM/YYYY; reality is ISO. The exporter must accept
  both (formatDate already does).

## VAT

- `profile.vatRegistered`: boolean
- `profile.vatNumber`: string or null

## Spec fixture deltas

The spec's `kebroydJob` fixture must be rewritten to match the above:

| Spec wrote | Replace with |
|---|---|
| `payload.materials` | `reviewData.materials` |
| `payload.labour` | `reviewData.labourEstimate` |
| `payload.additionalCosts` | `reviewData.additionalCosts` |
| `m.lineTotal` | `m.totalCost` |
| `labour.workers` | `labour.numberOfWorkers` |
| string numerics | actual numerics |
| `'16/04/2026'` quoteDate | `'2026-04-16'` (ISO) |

## Property-access defaults for the exporter

`buildQuickbooksCSV(job, profile)` reads:

    job.quote_reference || job.quote_snapshot.jobDetails.quoteReference
    job.client_name     || job.quote_snapshot.jobDetails.clientName
    job.site_address    || job.quote_snapshot.jobDetails.siteAddress
    job.quote_date      || job.quote_snapshot.jobDetails.quoteDate
                        || job.saved_at
    job.quote_snapshot.reviewData.materials || []
    job.quote_snapshot.reviewData.additionalCosts || []
    job.quote_snapshot.reviewData.labourEstimate || {}
