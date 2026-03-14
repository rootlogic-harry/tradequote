# CLAUDE.md — TradeQuote Prototype
## Complete specification for Claude Code. Read fully before writing any code.

---

## What You Are Building

TradeQuote is an AI-powered quote generator for dry stone walling professionals. A tradesman photographs a damaged wall, enters a job address, and receives a professionally formatted, print-ready quote in under 5 minutes.

This document specifies the **Phase 0 prototype**: a React application with no backend. The prototype validates the core AI-to-quote loop before any infrastructure is built.

**Prototype constraints:**
- React with Vite
- Client-side Anthropic API call — user enters their own API key in the profile
- No persistence — state lives in React only, resets on refresh
- Tailwind CSS (CDN), no build step for styles
- `jsPDF` + `html2canvas` via CDN for PDF

**This is dry stone walling only.** No trade dropdown. No generic builder logic. The AI prompt must be obsessively domain-specific.

---

## Development Approach: TDD First

**Write every test before writing any implementation.** This is non-negotiable.

The order is:
1. Create the test file
2. Run tests — confirm they fail with "module not found" or equivalent
3. Write the implementation
4. Run tests — all must pass
5. Refactor if needed, keeping tests green

All utility functions must be pure (no side effects, no external dependencies) so they are trivially testable in isolation.

Use **Jest** with ESM support. Test command: `node --experimental-vm-modules node_modules/.bin/jest --runInBand`

---

## Project Structure

```
tradequote/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx
    ├── App.jsx                        ← useReducer orchestrator, AI call lives here
    ├── utils/
    │   ├── calculations.js            ← pure financial functions
    │   ├── diffTracking.js            ← learning loop: diffs, accuracy scores
    │   ├── aiParser.js                ← parse / validate / normalise AI JSON
    │   ├── validators.js              ← profile, job, photo, measurement gates
    │   └── quoteBuilder.js            ← quote reference, formatting, payload assembly
    ├── components/
    │   ├── StepIndicator.jsx
    │   ├── steps/
    │   │   ├── ProfileSetup.jsx
    │   │   ├── JobDetails.jsx         ← includes photo upload slots
    │   │   ├── AIAnalysis.jsx         ← loading screen only
    │   │   ├── ReviewEdit.jsx         ← most complex screen
    │   │   └── QuoteOutput.jsx        ← document preview + PDF + email
    │   └── review/
    │       ├── MeasurementRow.jsx     ← unconfirmed/confirmed state
    │       ├── MaterialsTable.jsx
    │       ├── LabourSection.jsx
    │       ├── ScheduleList.jsx
    │       └── LivePreview.jsx        ← real-time quote document preview
    └── __tests__/
        ├── calculations.test.js
        ├── diffTracking.test.js
        ├── aiParser.test.js
        ├── validators.test.js
        └── quoteBuilder.test.js
```

---

## The Immutability Contract

**This is the most important rule in the codebase. Violating it corrupts the learning loop permanently.**

Every AI-suggested numeric value has two properties in React state:

```javascript
{
  aiValue: "4500",    // set ONCE when AI response arrives — NEVER overwrite
  value:   "4500",    // editable by the user — starts equal to aiValue
}
```

When a user edits a field, only `value` changes. `aiValue` is read-only from the moment it is set. The diff is always `(value - aiValue)`. If `aiValue` gets overwritten, the diff data is meaningless.

Enforce this structurally — not by convention. The normalisation function in `aiParser.js` sets both; only `value` is ever updated by reducer actions.

---

## Utility Modules — Full Specifications

Write the test file for each module first, then implement.

---

### `calculations.js`

Pure financial calculation functions. No side effects.

```javascript
// All monetary values in GBP.

calculateMaterialsSubtotal(materials: Material[]) → number
// Sum the `totalCost` field across all material line items.
// Treat missing/null totalCost as 0.

calculateLabourTotal(days: number, workers: number, dayRate: number) → number
// days × workers × dayRate

calculateAdditionalCostsTotal(additionalCosts: AdditionalCost[]) → number
// Sum `amount` field. Treat missing as 0.
// These are always manually entered — never AI-generated.

calculateSubtotal(materialsSubtotal, labourTotal, additionalCostsTotal) → number
// Sum of all three components.

calculateVAT(subtotal: number, vatRegistered: boolean) → number
// 20% if vatRegistered, else 0. Round to 2 decimal places.

calculateTotal(subtotal: number, vatAmount: number) → number
// subtotal + vatAmount

calculateAllTotals(materials, labour, additionalCosts, vatRegistered) → {
  materialsSubtotal, labourTotal, additionalCostsTotal,
  subtotal, vatAmount, total
}
// Convenience wrapper. labour = { days, workers, dayRate }
```

**Test cases to cover:**
- Empty materials array → 0
- Multiple materials summed correctly
- Decimal totalCost values (precision)
- Missing/null totalCost treated as 0
- Labour: 0 days, 0 workers, 0 rate all return 0
- Decimal days and rates
- VAT: registered returns 20%, unregistered returns 0
- VAT on 0 subtotal returns 0
- calculateAllTotals integration: VAT-registered and non-registered paths

---

### `diffTracking.js`

Captures the gap between AI suggestions and tradesman confirmations. The learning loop foundation. Append-only in spirit — diffs are never mutated after creation.

```javascript
NUMERIC_FIELD_TYPES = Set([
  'measurement', 'material_quantity', 'material_unit_cost',
  'labour_days', 'labour_workers'
])

isNumericFieldType(fieldType: string) → boolean
// Returns true only for the types above.

calculateEditMagnitude(aiValue: string, confirmedValue: string) → number | null
// (confirmed - ai) / ai
// Returns null for: non-numeric values, ai = 0 (division by zero), unparseable strings.
// Positive = AI underestimated. Negative = AI overestimated.

buildDiff(fieldType, fieldLabel, aiValue, confirmedValue) → Diff
// Constructs a diff record. Sets wasEdited, editMagnitude, createdAt.
// editMagnitude is 0 (not null) when accepted without edit on a numeric field.
// editMagnitude is null for text fields even when edited.
// createdAt is Date.now().

calculateAIAccuracyScore(diffs: Diff[]) → number | null
// Proportion of NUMERIC fields accepted without edit (0.0–1.0).
// Returns null if no numeric diffs exist.
// Rounded to 3 decimal places.
// Text field diffs are excluded from calculation.

shouldExcludeUser(accuracyScores: number[], threshold = 0.4) → boolean
// Returns true when average score is below threshold.
// Returns false if fewer than 3 quotes (insufficient data).
// Used to exclude outlier users from aggregate bias calculations.

enrichDiffWithContext(diff: Diff, context: Context) → Diff
// Returns new object — does NOT mutate the original diff.
// Merges context: { referenceCardUsed, stoneType, wallHeightMm, wallLengthMm, terrainGradientDeg }
```

**Test cases to cover:**
- calculateEditMagnitude: numeric increase, decrease, no change, zero aiValue, non-numeric inputs
- buildDiff: accepted (wasEdited=false, magnitude=0), edited (wasEdited=true), text field (magnitude=null)
- buildDiff: aiValue and confirmedValue stored independently — changing one must not affect the other
- buildDiff: createdAt timestamp within expected range
- calculateAIAccuracyScore: empty → null, all accepted → 1.0, all edited → 0.0, mixed, text-only → null
- calculateAIAccuracyScore: rounds to 3dp (2/3 = 0.667)
- shouldExcludeUser: below threshold → true, above → false, < 3 quotes → false, custom threshold
- enrichDiffWithContext: does not mutate original, preserves all original fields, handles partial context

---

### `aiParser.js`

Parse, validate, and normalise the AI's JSON response into React state shape.

```javascript
parseAIResponse(raw: string) → object | null
// Extract and parse JSON from AI text response.
// Handles: clean JSON, ```json fences, plain ``` fences, leading preamble text, whitespace.
// Returns null on any failure (malformed, empty, null input).

validateAIResponse(parsed: object) → { valid: boolean, errors: string[] }
// Validates structure and content of parsed response.
// Required fields: referenceCardDetected (boolean), stoneType, damageDescription,
//   measurements (non-empty array), scheduleOfWorks (non-empty array),
//   materials (array), labourEstimate (with positive estimatedDays)
// stoneType must be one of: sandstone | gritstone | limestone | slate | unknown
// Each measurement must have: item, valueMm (number), displayValue, confidence (high|medium|low)
// Accumulates ALL errors — does not stop at first failure.
// Returns valid:false for null or non-object input.

normalizeAIResponse(parsed: object) → NormalisedResponse
// Transforms validated AI response into React state shape.
// Does NOT mutate the original parsed object.
// For each measurement adds: id (unique string), aiValue (= displayValue, immutable),
//   value (editable, starts = aiValue), confirmed: false
// For each material adds: id, unit (defaults to 'Item'), aiUnitCost (= unitCost), aiTotalCost (= totalCost)
// For labourEstimate adds: aiEstimatedDays (= estimatedDays, immutable)
// For scheduleOfWorks adds: id to each step
// Defaults siteConditions if missing: accessDifficulty:'normal', foundationCondition:'sound', etc.
// All generated IDs must be unique within their array.
```

**Test cases to cover:**
- parseAIResponse: clean JSON, ```json fence, plain fence, preamble text, malformed, empty, null, truncated
- validateAIResponse: complete valid response, each required field missing individually,
  empty measurements, empty scheduleOfWorks, invalid stoneType, invalid confidence,
  estimatedDays missing / negative / zero, null input, accumulates multiple errors
- normalizeAIResponse: confirmed=false on all measurements, aiValue set correctly,
  value starts equal to aiValue, ids are unique, does not mutate original,
  aiEstimatedDays set, siteConditions defaults applied when missing

---

### `validators.js`

UI-layer validation. Returns structured error objects — never throws.

```javascript
validateProfile(profile) → { valid: boolean, errors: { [field]: string } }
// Required: companyName, fullName, phone, email, address, dayRate (positive number)
// email must match basic email format
// vatNumber required when vatRegistered = true
// accreditations and logo are optional

validateJobDetails(jobDetails) → { valid: boolean, errors: { [field]: string } }
// Required: clientName, siteAddress, quoteReference, quoteDate
// briefNotes is optional

validateRequiredPhotoSlots(photos) → { valid: boolean, missingSlots: string[], hasReferenceCard: boolean }
// Required slots: overview, closeup, referenceCard
// Optional slots: sideProfile, access
// hasReferenceCard reflects whether referenceCard slot is filled

allMeasurementsConfirmed(measurements) → boolean
// True when every measurement has confirmed: true
// Empty array returns true (vacuous)
// Missing confirmed field treated as unconfirmed

countUnconfirmedMeasurements(measurements) → number
// Used for CTA label: "3 measurements to confirm"

canGenerateQuote(measurements, materials, labour) → boolean
// All of: measurements confirmed, materials non-empty,
//   labour.days > 0, labour.dayRate > 0
```

**Test cases to cover:**
- validateProfile: each required field missing, invalid email, zero/negative/NaN dayRate,
  vatNumber required when registered, vatNumber not required when not registered,
  multiple errors accumulate
- validateJobDetails: each required field missing
- validateRequiredPhotoSlots: each required slot missing, optional slots missing (not an error),
  hasReferenceCard true/false, multiple missing slots accumulated
- allMeasurementsConfirmed: all confirmed, any unconfirmed, empty array, missing confirmed field
- countUnconfirmedMeasurements: various counts
- canGenerateQuote: all valid, unconfirmed measurement, empty materials, zero days, zero rate

---

### `quoteBuilder.js`

Quote reference generation, formatting, and final payload assembly.

```javascript
generateQuoteReference(year: number, sequenceNumber: number) → string
// Format: QT-YYYY-NNNN
// Sequence padded to 4 digits minimum: 1 → '0001', 47 → '0047', 1000 → '1000'

formatCurrency(amount: number) → string
// £X,XXX.XX format. Negative: -£X.XX. Rounds to 2dp.
// Examples: 3781 → '£3,781.00', 0 → '£0.00', -100 → '-£100.00'

formatDate(isoDate: string) → string
// ISO YYYY-MM-DD → UK ordinal format
// '2026-03-07' → '7th March 2026'
// Correct ordinals: 1st, 2nd, 3rd, 4–20th all 'th', 21st, 22nd, 23rd, 24–30th 'th', 31st
// Special cases: 11th, 12th, 13th (NOT 11st/12nd/13rd)

calculateValidUntil(isoDate: string) → string
// Returns ISO date string 30 days after input.
// Handles month/year boundary crossing and leap years.

buildDiffsPayload(diffs: Diff[], context: Context) → Diff[]
// Enriches all diffs with context. Does not mutate originals.

buildQuotePayload(profile, jobDetails, reviewData, diffs) → QuotePayload
// Single assembly point — called once when tradesman clicks Generate Quote.
// Returns: { profile, jobDetails, quote, totals, diffs, aiAccuracyScore }
// quote includes: validUntil (30 days), aiRawResponse (stored, never used for display values)
// totals: full calculateAllTotals result
// aiAccuracyScore: from calculateAIAccuracyScore(diffs), may be null
```

**Test cases to cover:**
- generateQuoteReference: padding (1→0001, 47→0047, 1000→1000), year used correctly
- formatCurrency: whole numbers, decimals, zero, large (commas), negative, rounding
- formatDate: each ordinal (1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 22nd, 31st), all 12 months
- calculateValidUntil: normal case, month boundary, year boundary, leap year
- buildDiffsPayload: correct length, context applied to each, no mutation
- buildQuotePayload: all required keys present, totals calculated, validUntil correct,
  aiRawResponse included, aiAccuracyScore calculated, null when text-only diffs

---

## Application State — `useReducer`

All state lives in a single reducer in `App.jsx`. No component-level state except for transient UI (e.g. hover, focus).

```javascript
// Top-level state shape
{
  step: 1,            // 1–5
  profile: { ... },  // tradesman profile
  jobDetails: { ... },
  photos: {           // null or { file, dataUrl }
    overview: null,
    closeup: null,
    sideProfile: null,
    referenceCard: null,
    access: null,
  },
  extraPhotos: [],    // overflow photos, max 5
  isAnalysing: false,
  analysisError: null,
  aiRawResponse: null,    // immutable original — never used for display
  reviewData: null,       // normalised AI response + user edits
  diffs: [],              // accumulates on each measurement confirmation
  quotePayload: null,     // assembled at Generate Quote
}
```

**Reducer actions:**
```
SET_STEP
UPDATE_PROFILE          updates (partial profile)
UPDATE_JOB_DETAILS      updates (partial jobDetails)
SET_PHOTO               slot, photo
ADD_EXTRA_PHOTO         photo
REMOVE_EXTRA_PHOTO      index
ANALYSIS_START
ANALYSIS_SUCCESS        rawResponse, normalised
ANALYSIS_ERROR          error (string)
CONFIRM_MEASUREMENT     id, value, diff
EDIT_MEASUREMENT        id (re-opens for editing, clears confirmed)
UPDATE_MATERIALS        materials
UPDATE_LABOUR           labour
UPDATE_ADDITIONAL_COSTS additionalCosts
UPDATE_SCHEDULE         schedule
UPDATE_DAMAGE_DESCRIPTION value
GENERATE_QUOTE          (builds context, enriches diffs, assembles payload, step → 5)
NEW_QUOTE               (reset to step 2, retain profile, increment reference)
```

---

## Application Flow

```
Step 1: Profile Setup
Step 2: Job Details + Photo Upload
Step 3: AI Analysis (loading — auto-advances to Step 4 on success)
Step 4: Review & Edit
Step 5: Quote Output + PDF
```

---

## Step 1: Profile Setup

**Fields:**
- Company name (required)
- Full name (required)
- Phone (required)
- Email (required)
- Business address (required)
- Logo (optional — file upload, stored as base64 dataUrl)
- VAT registered toggle
- VAT number (shown only when VAT registered = true)
- Day rate £ (pre-filled: 400, required, positive number)
- Accreditations (optional, pre-filled: "DSWA Professional Member")
- **Anthropic API key** (required for analysis — stored in profile state only, never logged)

On save: `validateProfile` runs. Field-level errors shown inline. If valid, advance to Step 2.
Profile accessible via ⚙ settings icon on all subsequent screens.

**No trade dropdown.** Dry stone walling is fixed.

---

## Step 2: Job Details + Photo Upload

**Job fields:**
- Client / property name (required)
- Job site address (required)
- Quote reference (auto-generated QT-YYYY-NNNN, editable)
- Quote date (pre-filled today, editable)
- Brief notes (optional)

**Photo upload — five structured slots:**

| Slot | Label | Required | Instruction |
|---|---|---|---|
| 1 | Overview | ✅ | Full damaged section, straight on, landscape |
| 2 | Close-up | ✅ | Worst damage — collapse and scattered stone |
| 3 | Side profile | Recommended | Along wall face — height, batter angle, standing sections |
| 4 | Reference card | ✅ | TradeQuote Reference Card flat against wall |
| 5 | Access & approach | Recommended | Road, gate, or field approach |

Each slot: click to upload or drag-and-drop. Shows thumbnail on fill. ✕ to replace.
Images resized client-side to max 2048px before base64 encoding.
"Add more photos" overflow for up to 5 additional images.

**Reference card callout banner (always shown above slots):**
> 📐 Place your TradeQuote Reference Card in Slot 4. The AI uses its known 148×210mm dimensions to calculate real measurements.
> *[Download print-at-home card →]*

**"Analyse Job" CTA:**
- Disabled until: slots 1, 2, 4 filled AND siteAddress non-empty
- If slot 4 missing: amber soft warning — *"No reference card photo — measurements will be estimated and must each be confirmed before the quote can be generated"*
- On click: run `validateRequiredPhotoSlots` and `validateJobDetails`, then dispatch ANALYSIS_START and trigger AI call

---

## Step 3: AI Analysis (Loading Screen)

Shown while API call is in flight. Auto-advances to Step 4 on success.

Loading messages cycle through (rotate every 3–4 seconds):
1. Analysing photographs...
2. Identifying damage and stone type...
3. Calculating measurements...
4. Estimating stone tonnage and materials...
5. Building schedule of works...
6. Preparing your quote...

On error: error message + Retry button + Back button.
On malformed JSON: "AI returned an unreadable response. Try again or enter details manually." — offer to proceed to blank Step 4.

---

## AI System Prompt

Use this prompt verbatim. `KNOWN CALIBRATION NOTES` is empty at prototype stage — it is updated monthly from production diff data.

```
You are an expert dry stone waller with over 20 years of experience and £500k+ annual
turnover. You are a Professional Member of the Dry Stone Walling Association of Great
Britain (DSWA). You are highly skilled at assessing wall damage from photographs,
estimating scope of work, and producing accurate, professional quotes.

DOMAIN KNOWLEDGE:
- Double-faced and single-faced dry stone wall construction
- Through stone placement at appropriate intervals (typically every 600-900mm of height)
- Hearting material — packed tightly to each course as the build progresses
- Batter profiles: walls typically narrow from base to cope at a ratio of 1:6 per face
- Stone types: sandstone, gritstone, limestone, slate — each with different working
  characteristics and weight
- DSWA construction standards throughout
- Labour rates: experienced wallers build 1-2 sq m of wall face per hour depending on
  stone type, height, and ground conditions. Always use the CONSERVATIVE end for
  quoting. For double-faced walls, calculate both faces combined.
- Material tonnage: a typical double-faced dry stone wall requires approximately
  1 tonne of stone per sq m of wall face (both faces combined). Gritstone runs
  heavier (~1.1-1.2t/sqm), limestone lighter (~0.9t/sqm).
- Always include site clearance as a line item when scattered stone is visible
- Always assess the standing sections either side of the breach — unstable abutting
  stonework typically requires taking back 300-600mm before rebuilding

MEASUREMENT INSTRUCTIONS:
- If a TradeQuote Reference Card (A5 white card, 148mm x 210mm, with a geometric
  calibration pattern) is visible in any photograph, use it as your ONLY scale
  reference. Calculate all absolute measurements from its known dimensions.
  Set referenceCardDetected: true and note which photo it appeared in.
- If no reference card is present, make your best visual estimate but set confidence
  to "low" for all absolute measurements. Set referenceCardDetected: false.
- NEVER fabricate a confident measurement without a scale reference.
- Report all measurements in millimetres.

KNOWN CALIBRATION NOTES:
Source: Professional waller quote data, March 2026, West Yorkshire / Cumbria.
These are verified rates from accepted quotes — use as baseline for the region.

Rubble stone wall repair (gritstone/sandstone/slate, lime mortar):
- Dismantling: £200–£240 per m²
- Rebuilding: £360–£400 per m²
- Repointing: £100–£120 per m²
- Replacement stone supply: £170–£200 per tonne
- Stone consumption: ~0.3 tonnes per m² of wall face
- Hydraulic lime mortar (NHL 3.5): £80–£100 per batch
- Preliminaries & site survey: £150–£200 flat
- Core/hearting consolidation: £130–£170 flat
- Making good & photographic record: £80–£110 flat
- Waste disposal & site clearance: £100–£140 flat
- Temporary propping (Strongboy supports): £200–£250 when required

Typical repointing area is 1.5–2× the rebuilt area.
Fixed baseline costs (prelims + core + mortar + making good + waste) run £550–£700.

ALWAYS generate separate line items with Qty, Unit (m², t, or Item), and Rate.

Return ONLY valid JSON. No preamble, no markdown fences. Schema:

{
  "referenceCardDetected": boolean,
  "referenceCardNote": "string",
  "stoneType": "sandstone | gritstone | limestone | slate | unknown",
  "damageDescription": "string — detailed narrative: stone type, construction style,
    extent of collapse, condition of standing sections either side, structural
    observations",
  "measurements": [
    {
      "item": "string",
      "valueMm": number,
      "displayValue": "string (e.g. '4,500mm')",
      "confidence": "high | medium | low",
      "note": null
    }
  ],
  "scheduleOfWorks": [
    {
      "stepNumber": number,
      "title": "string",
      "description": "string — professional, specific, DSWA-aligned"
    }
  ],
  "materials": [
    {
      "description": "string",
      "quantity": "string",
      "unit": "string (e.g. 'm²', 't', 'Item')",
      "unitCost": number,
      "totalCost": number
    }
  ],
  "labourEstimate": {
    "description": "string",
    "estimatedDays": number,
    "numberOfWorkers": number,
    "calculationBasis": "string — show working: sq m x hrs/sq m / 8hr day"
  },
  "siteConditions": {
    "accessDifficulty": "normal | difficult | severe",
    "accessNote": null,
    "foundationCondition": "sound | uncertain | requires_rebuild",
    "foundationNote": null,
    "adjacentStructureRisk": false,
    "adjacentStructureNote": null
  },
  "additionalNotes": "string"
}
```

**API call construction:**
- Model: `claude-sonnet-4-20250514`
- Max tokens: 4000
- Send all images as base64 content blocks, tagged by slot label as adjacent text
- Include site address and optional tradesman notes in user message
- Header: `anthropic-dangerous-direct-browser-access: true` (required for browser calls)

---

## Step 4: Review & Edit

The most important screen. Three-column layout on desktop, single-column on mobile.

### Left column — Damage & Measurements

**Damage description:** Editable textarea, pre-filled with AI narrative. Every keystroke updates the live preview.

**Reference card banner:**
- Green if `referenceCardDetected: true` — "Reference card detected — measurements calculated from known dimensions"
- Amber if `referenceCardDetected: false` — "No reference card detected — all measurements require on-site verification before the quote is issued"

**Measurements table:**

Every row arrives UNCONFIRMED. The `aiValue` is shown as a greyed read-only reference. The editable `value` input is pre-filled with `aiValue`.

Row states:
- **Unconfirmed (default):** Amber background, ⚠️ badge, editable value input, "Confirm" button. Subtle pulse animation.
- **Confirmed:** Green background, ✓ badge, value shown as text, "Edit" button to re-open.

On "Confirm" click:
1. Read current `value` from input
2. Call `buildDiff('measurement', m.item, m.aiValue, value)`
3. Dispatch `CONFIRM_MEASUREMENT` with `{ id, value, diff }`
4. Live preview updates immediately

`aiValue` is NEVER an editable input. It is shown as a greyed label only.

Add/remove measurement rows. Removed rows do not generate diffs.

**Generate Quote CTA is disabled until `allMeasurementsConfirmed` returns true.**
Show count below button: *"3 measurements to confirm before generating"*

### Centre column — Schedule of Works

Numbered list. Each step: editable title (bold) and description (paragraph). Add / Remove / drag to reorder. Every change updates live preview.

### Right column — Cost Breakdown

**Materials table:**
| Description | Qty | Unit | Rate £ | Total | |
|---|---|---|---|---|---|
| editable | editable | dropdown (m², t, Item, lin.m, Nr) | editable £ | auto-calc | ✕ |

"+ Add material" button appends blank row.

**Additional costs section** (manual only — never AI-generated):
| Label | Amount £ | |
|---|---|---|
| editable | editable | ✕ |

"+ Add cost" with quick-add chips: Travel / Accommodation / Site clearance.

**Labour:**
- Estimated days (editable — pre-filled from AI, `aiEstimatedDays` is immutable reference)
- Number of workers (editable — pre-filled from AI)
- Day rate £ (editable — pre-filled from profile)
- Labour total = days × workers × rate (auto-calculated, read-only)
- Editing days generates a diff for `labour_days` against `aiEstimatedDays`

**Financial summary (auto-updating):**
```
Materials:              £X,XXX.XX
Labour:                 £X,XXX.XX
Additional costs:       £XXX.XX
────────────────────────────────
Subtotal (ex VAT):      £X,XXX.XX
VAT (20%):              £XXX.XX     ← hidden if not VAT registered
────────────────────────────────
TOTAL:                  £X,XXX.XX
```

All figures via `formatCurrency`. Recalculates on every keystroke.

### Live Preview Panel

Always visible below the three columns. Scrollable. Read-only. White background, dark text — professional document aesthetic.

Updates in real-time on every change in Step 4. Unconfirmed measurements render as *(unconfirmed)*.

**"Generate Quote" CTA:**
- Disabled when any measurement is unconfirmed
- On click: dispatch `GENERATE_QUOTE` → advance to Step 5

---

## Step 5: Quote Output + PDF

### Quote Document Structure

Match the Mark Doyle template aesthetic: clean, formal, professional.

**Header:**
```
[LOGO]              Company Name
                    Accreditations
Date                Phone | Email
```

**Reference line:**
`Quote ref: QT-2026-XXXX — [Client Name], [Address]`

**Section 1: Description of Damage**
Full narrative paragraph.

**Section 2: Measurements**
Clean list.

**Section 3: Schedule of Works**
Numbered. Bold titles. Paragraphs.

**Section 4: Cost Breakdown**
Itemised materials table (Description, Qty, Unit, Rate, Total), then Labour, then Additional Costs, then Subtotal / VAT / TOTAL (large, prominent).

**Section 5: Notes & Conditions**
Numbered list of standard terms. Defaults to 5 standard notes covering: damage-contingency clause, lime mortar technique, Listed Building Consent responsibility, 30-day validity, 50/50 payment terms. Editable via `reviewData.notes`.

**Footer:**
- *"This quote is valid for 30 days from the date issued."*
- VAT number if registered
- Tradesman name + accreditations
- *"Quote prepared with AI assistance — all figures reviewed and confirmed by [Full Name]."*

**Photos:**
Max 4 images in a 2×2 grid at end of document. Each labelled with site address.

### Actions

**"Download PDF"** — `html2canvas` captures the quote div → `jsPDF` compiles PDF.
Filename: `Quote-[REF]-[ClientName].pdf`

**"Send via Email"** — `mailto:` with pre-filled subject and covering note body.
Note shown in UI: *"Attach your downloaded PDF before sending."*

**"Start New Quote"** — dispatches `NEW_QUOTE`. Resets to Step 2. Retains profile. Reference auto-increments.

---

## UI Design Specification

**Aesthetic:** Industrial-professional. Built for craftspeople. Not SaaS. Not consumer.

**Palette:**
```
bg-primary:   #0f0f0f
bg-surface:   #1a1a1a
bg-card:      #222222
border:       #333333
accent:       #e8a838   (amber/gold)
accent-dark:  #c4872a
text-primary: #f0ede8
text-muted:   #999999
confirmed:    #4ade80   (green)
unconfirmed:  #fbbf24   (amber)
error:        #f87171
```

**Typography (Google Fonts):**
- Headings / step titles / labels: `Barlow Condensed` — bold, utilitarian
- Body / form / descriptions: `IBM Plex Sans`
- All monetary values: `IBM Plex Mono` — precision feel

**Step indicator:** Persistent top bar. Steps 1–5. Current step highlighted in accent. Completed steps show ✓.

**Quote preview / PDF:** White background, dark text — print aesthetic.

**Measurement confirmation rows:** Amber pulse animation while unconfirmed. Instant green flash on confirmation.

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| API call fails (network) | Error message + Retry button. Preserve all photos and form state. |
| API returns non-200 | Show specific error from API response |
| Image too large | Client-side resize to max 2048px longest dimension before encoding |
| AI returns malformed JSON | "AI returned an unreadable response." + option to proceed to blank Step 4 |
| AI response fails validation | Log warnings to console, proceed with normalisation — do not hard-fail |
| Missing required photo slots | Inline slot-level warnings. CTA disabled. |
| Generate Quote with unconfirmed measurements | CTA disabled with count. Cannot be bypassed. |
| Profile API key missing | Error shown before analysis starts |

---

## Learning Loop — What to Build in the Prototype

The prototype captures diffs so no data is lost when the backend arrives.

**In React state:** Every numeric AI suggestion stores `aiValue` immutably alongside editable `value`. On confirmation, `buildDiff` is called and the result is stored in `state.diffs`. This happens for measurements, material unit costs, and labour days.

**At Generate Quote:** `buildQuotePayload` calculates `aiAccuracyScore` from all diffs and includes it in the payload alongside the diffs array.

**Console output:** Log the full payload to console on Generate Quote so the structure can be inspected and confirmed as production-ready before the backend exists.

**The prototype does not POST anywhere.** But the payload is fully assembled and correct.

---

## Accuracy & Trust Safeguards — Non-Negotiable

1. **All measurements are unconfirmed by default.** Generate Quote is gated on full confirmation. Cannot be bypassed.

2. **No AI cost figures are presented as final.** Every figure passes through the editable Step 4 screen.

3. **The quote document is generated from Step 4 data only.** `aiRawResponse` is stored but never used for display.

4. **Every edit in Step 4 updates the live preview instantly.** No refresh step. PDF captures exactly what is on screen.

5. **Labour is always: days × workers × rate.** The AI estimates days, the tradesman sets the rate. Never a single opaque "AI labour cost".

6. **`aiValue` is set once and never overwritten.** Enforce structurally — not by convention.

---

## Package Configuration

```json
{
  "name": "tradequote",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "test": "node --experimental-vm-modules node_modules/.bin/jest --runInBand",
    "test:watch": "node --experimental-vm-modules node_modules/.bin/jest --watch",
    "test:coverage": "node --experimental-vm-modules node_modules/.bin/jest --coverage"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "jest": "^29.7.0",
    "jest-environment-node": "^29.7.0",
    "vite": "^5.0.0"
  },
  "jest": {
    "testEnvironment": "node",
    "transform": {},
    "testMatch": ["**/src/__tests__/**/*.test.js"],
    "collectCoverageFrom": ["src/utils/**/*.js"]
  }
}
```

Tailwind via CDN in `index.html`. `jsPDF` and `html2canvas` via CDN in `index.html`. No PostCSS, no Tailwind CLI.

---

## Definition of Done

The prototype is complete when:

1. `npm test` passes with 100% of tests green. All utility functions have full test coverage before any component code is written.
2. A tradesman can go from 3 uploaded photos to a downloaded PDF quote in under 5 minutes.
3. The Generate Quote CTA cannot be reached with any unconfirmed measurement — this must be structurally impossible, not just visually disabled.
4. The PDF downloads and is professional enough to send to a client without modification.
5. The diff payload logged to console on Generate Quote matches the expected structure: `{ fieldType, fieldLabel, aiValue, confirmedValue, wasEdited, editMagnitude, createdAt }`.
6. Changing `value` on any measurement in React state does not change `aiValue` — verify in React DevTools.

---

*CLAUDE.md — TradeQuote Prototype. Prepared March 2026.*
*Update KNOWN CALIBRATION NOTES in the AI system prompt after each bias analysis cycle in production.*
