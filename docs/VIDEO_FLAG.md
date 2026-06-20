# Video analysis kill-switch (`VIDEO_ANALYSIS_ENABLED`)

## Why this exists

The video walkthrough pipeline (multer disk upload → ffmpeg frame
extraction → Whisper transcription → Sonnet vision analysis) has
shipped real failures in production. The 2026-06-19 architecture
review concluded that the fix needs a deeper rebuild (single ffmpeg
pass, streaming uploads, presigned R2 path, queue-backed worker)
rather than the small follow-ups the existing pipeline keeps
accumulating.

The kill-switch lets us **turn off video in production today** without
removing the code. Staging keeps the surface live so the rebuild can
be iterated against a real-shaped flow. When the rebuild lands and
proves out on staging, flipping the variable to `true` in production
re-enables the new path with zero code redeploy.

## Contract

| Environment | `VIDEO_ANALYSIS_ENABLED` unset | `="true"` / `"1"` / `"yes"` | `="false"` / `"0"` / `"no"` |
|---|---|---|---|
| `NODE_ENV=production` | **DISABLED** (fail-closed) | ENABLED | DISABLED |
| `NODE_ENV` anything else (staging, dev, test) | **ENABLED** (default-open) | ENABLED | DISABLED |

The asymmetry is deliberate:

- **Production fails closed.** If somebody clears the Railway variable
  by accident, video does not silently re-enable. The surface stays
  off until somebody types `true`.
- **Staging defaults open.** The rebuild work happens in staging.
  Forcing an explicit `true` on every staging seed would be friction
  and a forgotten variable would block the workstream.

Truthy/falsy strings are case-insensitive and whitespace-trimmed:
`true`, `TRUE`, ` True `, `1`, `yes` all enable.

## What gets disabled when the flag is off

| Surface | Disabled behaviour |
|---|---|
| `CaptureChoice` card (Step 2) | "Walk me through it" card is hidden; only "Show me the photos" renders. |
| `JobDetails` video panel | Will not render even if a restored draft has `captureMode='video'`. The component flips `captureMode` back to `null` on mount, snapping the user back to the photos flow. |
| `POST /api/users/:id/jobs/:jobId/video` | `requireVideoAnalysisEnabled` middleware returns **503** with body `{ error: "Video analysis is temporarily unavailable. Please use photos to generate a quote." }` **before multer streams the upload to disk** — no wasted disk / bandwidth. |
| `GET /api/users/:id/jobs/:jobId/video/progress` (SSE) | Returns 503 with the same message before any keep-alive write. The client's progress hook falls back to its time-based estimator (which it already does on any SSE failure). |
| `/auth/me` | `features.videoAnalysisEnabled` reflects the current flag so the SPA can render the right UI without an extra round-trip. |

What **is not** disabled:

- The video processing code paths (`src/utils/videoProcessor.js`,
  `frameExtractor.js`, `audioExtractor.js`, `videoValidator.js`,
  `videoProgress.js`) still ship and still have tests. The flag does
  not delete the surface — it gates it.
- Jobs already saved with `captureMode='video'` keep their data. The
  saved-quote viewer renders fine; only Step 2 (new analyses) is
  blocked.
- The photo path is untouched.

## Operator runbook

### Disable in production

```
railway variables set --service fastquote --environment production \
  VIDEO_ANALYSIS_ENABLED=false
```

Or via the Railway dashboard: Production env → variables →
`VIDEO_ANALYSIS_ENABLED` → set to `false` → redeploy is not needed,
the next request reads the new value (env vars are process-scoped but
Railway restarts the service when a variable changes).

Removing the variable entirely also disables in production
(fail-closed), but explicit `false` is clearer to whoever reads the
config next.

### Re-enable in production (post-rebuild)

```
railway variables set --service fastquote --environment production \
  VIDEO_ANALYSIS_ENABLED=true
```

Verify with:

```
curl -s https://fastquote.uk/auth/me | jq .features
# → { "videoAnalysisEnabled": true }
```

### Keep enabled in staging (default)

Staging needs no action when this PR ships — the default-open
behaviour for non-production environments keeps the surface live.
You can pin it explicitly:

```
railway variables set --service fastquote --environment staging \
  VIDEO_ANALYSIS_ENABLED=true
```

### Verify the current state

Hit `/auth/me` against either environment:

```bash
curl -s https://fastquote.uk/auth/me | jq .features.videoAnalysisEnabled
curl -s https://fastquote-staging.up.railway.app/auth/me | jq .features.videoAnalysisEnabled
```

Or hit the route directly:

```bash
curl -i -X POST https://fastquote.uk/api/users/<id>/jobs/<jobid>/video \
  -H 'Cookie: tq_session=...'
# → HTTP/1.1 503 Service Unavailable
# → {"error":"Video analysis is temporarily unavailable. Please use photos to generate a quote."}
```

## What this does NOT do

- It does not delete the video pipeline code. Rebuild can build on top
  of the existing modules or replace them piecemeal.
- It does not remove video from saved historical jobs. The
  `captureMode='video'` snapshots in the `jobs` table remain valid
  and the saved-quote viewer renders them unchanged.
- It does not affect dictation, voice notes, photo upload, or any
  other surface. Only the Step 2 video walkthrough flow.

## Tests

`src/__tests__/videoAnalysisEnabled.test.js`:

- Pure helper contract (12 tests) — covers production fail-closed,
  staging default-open, truthy/falsy parsing, whitespace + case
  insensitivity, non-string inputs.
- `isVideoAnalysisEnabledFromProcessEnv` wrapper reads
  `process.env` correctly (1 test).
- Disabled message hygiene (banned-vocab check per CLAUDE.md design
  law — 2 tests).
- Server wiring source assertions (5 tests) — the helper is imported,
  the upload route gates on the flag before `processVideo()`, the
  SSE route gates before keep-alive, `/auth/me` includes the flag,
  and the 503 response carries the canonical message.
- Client wiring source assertions (3 tests) — `App.jsx`,
  `JobDetails.jsx`, and `CaptureChoice.jsx` all participate.

## When to retire this doc

When the video rebuild ships and the flag has been held `true` in
production for at least four weeks with the failure rate on the new
pipeline below the photo path's failure rate, delete the variable
and this doc together. Keep the `requireVideoAnalysisEnabled`
middleware as scaffolding for future kill-switches.
