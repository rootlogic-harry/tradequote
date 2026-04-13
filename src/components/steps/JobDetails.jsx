import React, { useState, useRef } from 'react';
import { PHOTO_SLOTS } from '../../constants.js';
import { validateJobDetails, validateRequiredPhotoSlots } from '../../utils/validators.js';
import { runAnalysis } from '../../utils/analyseJob.js';
import { savePhoto, deletePhoto, saveDraft } from '../../utils/userDB.js';

function resizeImage(file, maxSize = 2048) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        // Always re-encode to JPEG to ensure consistent compression
        // (raw PNGs or high-quality JPEGs can be 5-10x larger)
        if (width > maxSize || height > maxSize) {
          const ratio = Math.min(maxSize / width, maxSize / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.80));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

export const SYSTEM_PROMPT = `You are an expert dry stone waller with over 20 years of experience and £500k+ annual
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
- Always assess the standing sections either side of the breach — unstable abutting
  stonework typically requires taking back 300-600mm before rebuilding

MEASUREMENT INSTRUCTIONS:
- If a FastQuote Reference Card (A5 white card, 148mm x 210mm, with a geometric
  calibration pattern) is visible in any photograph, use it as your ONLY scale
  reference. Calculate all absolute measurements from its known dimensions.
  Set referenceCardDetected: true and note which photo it appeared in.
- If no reference card is present, make your best visual estimate but set confidence
  to "low" for all absolute measurements. Set referenceCardDetected: false.
- NEVER fabricate a confident measurement without a scale reference.
- Report all measurements in millimetres.

KNOWN CALIBRATION NOTES (last updated April 2026, based on confirmed job comparisons):

1. TRAFFIC MANAGEMENT — ROADSIDE JOBS
If any uploaded photograph shows the wall is adjacent to a public carriageway
(road markings, kerb edges, drain covers, white lines, or tarmac surface visible
in frame), you MUST include a Chapter 8 traffic management line item in the cost
breakdown. This is a legal requirement for roadside works and must never be omitted.
Typical cost: £380–450 for up to one week's duration.
Add it as a separate line item labelled "Chapter 8 traffic management."
If you are uncertain whether the site is roadside, include it anyway and note
the uncertainty.

2. FOUNDATION SCOPE — WHEN FAILURE IS DESCRIBED THROUGHOUT
If the damage description indicates that the foundation has failed along the
full length of the wall (not just at a localised collapse point), the foundation
excavation and reinstatement must cover the FULL wall length, not just the
collapsed section.
Common phrases indicating full-length foundation failure: "foundation has tipped,"
"foundation no longer structurally sound along the run," "failed foundation
throughout," "strip foundation failed."
Do not limit foundation scope to the collapsed section alone when full-length
failure is indicated.

3. MORTAR SPECIFICATION — NATURAL STONE WALLS
For natural sandstone or natural stone boundary walls that require bedding and
pointing, always specify 1:1:6 cement-lime-sand mortar — NOT sand and cement only.
Lime mortar is the correct specification for natural stone: it is more flexible,
allows the wall to breathe, and is the standard expected by loss adjusters and
insurance companies.
Material cost for mortar materials (sand, cement, hydrated lime): £130–165 for
a 10–14 linear metre run.
Always write "1:1:6 cement-lime-sand mortar" in the schedule of works description,
not "sand and cement mortar."

4. PLANTING AND HEDGING — CHERRY LAUREL AND SIMILAR SHRUBS
Cherry Laurel (Prunus laurocerasus) at 600–1000mm height, pot grown, supply
and plant including topsoil and slow-release fertiliser: £38–50 per plant.
For a 12 linear metre run at 600mm planting centres: approximately 20 plants,
total supply and plant cost £760–1,000 depending on plant size and site access.
For 5-year-old specimens at 1000mm height: budget £45–52 per plant.
Do not estimate planting costs above this range without specific justification
(e.g. very large specimen trees, crane access required).

5. LABOUR — MORTAR-POINTED SANDSTONE BOUNDARY WALL
For a mortar-pointed natural sandstone boundary wall with foundation reinstatement,
realistic labour estimates for two operatives:
- 10–12 linear metres, 900mm height, full rebuild: 7–9 days for 2 operatives
- Per linear metre rate: approximately 0.7–0.8 operative-days/metre for rebuild
  including foundation, pointing and coping reinstatement
- Dismantling adds approximately 1.5–2 days for 10–12 metres
Always use the conservative end of the range for quoting.
For this wall type, 2 operatives for 8 days (£6,400 at £400/day) is the
established benchmark. Do not exceed 9 days without specific site complexity
justification (steep gradient, restricted access, scaffolding required).

Source: Professional waller quote data, March–April 2026, West Yorkshire / Cumbria.
These are verified rates from accepted quotes — use as baseline for the region.

IMPORTANT — MATERIALS vs LABOUR DISTINCTION:
The "materials" array must ONLY contain physical supplies and expenses — things you
buy or hire. All labour activities (dismantling, rebuilding, repointing, site survey,
making good, core consolidation) are covered by the daily labour rate and must NOT
appear as material line items.

MATERIALS (include in "materials" array):
- Replacement stone supply: £170–£200 per tonne (matched rubble, gritstone/sandstone)
- Stone consumption: ~0.3 tonnes per m² of wall face
- Natural stone (facing/coping): price varies by type
- Hydraulic lime mortar (NHL 3.5): £80–£100 per batch
- Mortar & sand: price varies
- Mobile scaffolding hire: £50–£60 per day
- Temporary propping (Strongboy supports): £200–£250 when required
- Tool and equipment hire: £100–£200 per job
- Waste disposal & tipping fees: £100–£140 flat
- Accommodation: if overnight stays required
- Travel and fuel expenses: mileage/fuel costs

PLANT HIRE (include in "materials" array when the job requires them):
- Hiab / lorry-mounted crane hire: £350–£500 per day
- Mini digger hire (1.5t): £120–£180 per day
- Cement mixer hire: £40–£60 per day
- Plant trailer hire: £60–£80 per day
- Generator hire: £50–£80 per day
Include plant hire as separate material line items with quantity in days.
Only include items the job genuinely requires based on scope and access.

LABOUR (covered by daily rate — do NOT put in materials):
The following are all labour activities. They must NEVER appear as line items
in the "materials" array. They are accounted for ONLY through the
estimatedDays × numberOfWorkers × dayRate calculation.

Use these benchmarks to estimate labour DAYS only:
- Dismantling: an experienced waller dismantles ~6 m² per day
- Rebuilding to DSWA standards: ~3 m² per day for 2 wallers
- Repointing: ~8–10 m² per day for 1 waller
- Site clearance of scattered stone: included in dismantling time
- Preliminaries & site survey: typically half a day
- Core/hearting consolidation: included in rebuild time
- Making good & photographic record: typically half a day

These benchmarks are for estimating days of work. They have NO per-m² price.
Do NOT create material line items for dismantling, rebuilding, repointing,
site clearance, making good, core consolidation, or any other walling activity.

ESTIMATING LABOUR DAYS:
Calculate total days from the benchmarks above. Example for a 6 m² gritstone
rebuild: ~1 day dismantling + ~2 days rebuilding for 2 wallers + ~0.5 day
preliminaries + ~0.5 day making good = ~2 days for 2 wallers (4 man-days).
Always round UP to the nearest half-day. Show this working in calculationBasis.

Typical repointing area is 1.5–2× the rebuilt area (extends to surround).

Generate material line items with Qty, Unit (t, Item, Nr, days), and Rate.

CRITICAL RULE — MATERIALS ARRAY MUST NOT CONTAIN:
- Any line item for dismantling, rebuilding, repointing, or site clearance
- Any line item with a per-m² rate for walling work
- Any item that describes work a waller performs (as opposed to a physical
  supply purchased or equipment hired)
If in doubt, ask: "Is this something I BUY or HIRE?" If no, it is labour.

DAMAGE DESCRIPTION FORMAT:
The damageDescription must be structured as numbered sections, one per damaged
component or area. Each section starts with a numbered header line in the format:
  1 — Component Name
followed by a detailed paragraph describing that component's damage, dimensions,
construction style, and structural observations. Example:

  1 — Sandstone Gate Pier
  The principal sandstone gate pier, measuring approximately 300mm x 300mm x 1350mm,
  has suffered significant structural displacement...

  2 — Brick Retaining Wall
  The brick retaining wall adjacent to the gate entrance extends approximately 2400mm...

Use an em dash (—) between the number and title. Include specific dimensions,
stone types, mortar conditions, and structural observations in each section.
If there is only one damaged component, still use "1 — [component name]".

SCHEDULE OF WORKS DETAIL:
Each schedule step description must include:
- Specific dimensions of the work area
- Material specifications (e.g. "NHL 3.5 hydraulic lime mortar", "matched sandstone rubble")
- Construction techniques (e.g. "bedded and set plumb on a cement and lime mortar bed")
- Stone coursing or bond pattern details where applicable
- Mortar types where applicable
Do NOT use vague descriptions like "Rebuild wall section". Specify exactly what is
being rebuilt, with what materials, to what dimensions, using what technique.

Return ONLY valid JSON. No preamble, no markdown fences. Schema:

{
  "referenceCardDetected": boolean,
  "referenceCardNote": "string",
  "stoneType": "sandstone | gritstone | limestone | slate | unknown",
  "damageDescription": "string — numbered sections (1 — Component Name\\n paragraph),
    one per damaged component, with dimensions, stone types, mortar conditions,
    and structural observations",
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
      "description": "string — include dimensions, material specs, techniques, mortar types"
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
}`;

export default function JobDetails({ state, dispatch, abortRef, showToast }) {
  const [errors, setErrors] = useState({});
  const [photoWarnings, setPhotoWarnings] = useState({ missingSlots: [] });
  const fileInputRefs = useRef({});
  const [dragOverSlot, setDragOverSlot] = useState(null); // key of slot being dragged over
  const [dragOverExtra, setDragOverExtra] = useState(false); // extra photos drop zone

  const { jobDetails, photos, extraPhotos, profile } = state;

  const updateJob = (field, value) => {
    dispatch({ type: 'UPDATE_JOB_DETAILS', updates: { [field]: value } });
  };

  const handlePhotoUpload = async (slotKey, e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const dataUrl = await resizeImage(file);
    dispatch({
      type: 'SET_PHOTO',
      slot: slotKey,
      photo: { data: dataUrl, name: file.name },
    });
    if (state.currentUserId) {
      savePhoto(state.currentUserId, 'draft', slotKey, { data: dataUrl, name: file.name });
    }
  };

  // Drag-and-drop handlers for photo slots
  const handleSlotDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleSlotDragEnter = (slotKey, e) => {
    e.preventDefault();
    setDragOverSlot(slotKey);
  };

  const handleSlotDragLeave = (slotKey, e) => {
    // Only clear if we're actually leaving the slot (not entering a child)
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverSlot(null);
    }
  };

  const handleSlotDrop = async (slotKey, e) => {
    e.preventDefault();
    setDragOverSlot(null);
    const file = e.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const dataUrl = await resizeImage(file);
    dispatch({
      type: 'SET_PHOTO',
      slot: slotKey,
      photo: { data: dataUrl, name: file.name },
    });
    if (state.currentUserId) {
      savePhoto(state.currentUserId, 'draft', slotKey, { data: dataUrl, name: file.name });
    }
  };

  const [extraPhotoLabel, setExtraPhotoLabel] = useState('Other');
  const EXTRA_PHOTO_CATEGORIES = ['Overview', 'Close-up', 'Side Profile', 'Reference Card', 'Access', 'Other'];

  const handleExtraPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file || extraPhotos.length >= 10) return;
    const dataUrl = await resizeImage(file);
    const newIndex = extraPhotos.length;
    dispatch({
      type: 'ADD_EXTRA_PHOTO',
      photo: { data: dataUrl, name: file.name, label: extraPhotoLabel },
    });
    if (state.currentUserId) {
      savePhoto(state.currentUserId, 'draft', `extra-${newIndex}`, { data: dataUrl, name: file.name, label: extraPhotoLabel });
    }
  };

  const handleAnalyse = async () => {
    const jobResult = validateJobDetails(jobDetails);
    const photoResult = validateRequiredPhotoSlots(photos);

    setErrors(jobResult.errors);
    setPhotoWarnings(photoResult);

    if (!jobResult.valid || !photoResult.valid) return;

    dispatch({ type: 'ANALYSIS_START' });

    runAnalysis({
      photos,
      extraPhotos,
      jobDetails,
      profile,
      systemPrompt: SYSTEM_PROMPT,
      abortRef,
      dispatch,
    });
  };

  const hasAnyPhoto = Object.values(photos).some(p => p != null) || extraPhotos.length > 0;
  const canAnalyse =
    hasAnyPhoto && jobDetails.siteAddress?.trim();

  // Count missing required photos for CTA label
  const filledCount = Object.values(photos).filter(p => p != null).length + extraPhotos.length;
  const neededPhotos = canAnalyse ? 0 : Math.max(0, 1 - filledCount);

  const inputClass = (field) =>
    `w-full bg-tq-card border-1.5 ${
      errors[field] ? 'border-tq-error' : 'border-tq-border'
    } rounded px-3 py-2.5 text-tq-text font-body text-sm focus:outline-none focus:border-tq-accent`;

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-heading font-bold text-tq-accent mb-1">
        Job Details & Photos
      </h2>
      <p className="text-tq-muted text-sm mb-6">
        Enter the job details and upload photos of the damaged wall.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Client Name *
          </label>
          <input
            className={inputClass('clientName')}
            value={jobDetails.clientName}
            onChange={(e) => updateJob('clientName', e.target.value)}
          />
          {errors.clientName && <p className="text-tq-error text-xs mt-1">{errors.clientName}</p>}
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Quote Reference
          </label>
          <input
            className={inputClass('quoteReference')}
            value={jobDetails.quoteReference}
            onChange={(e) => updateJob('quoteReference', e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Site Address *
          </label>
          <textarea
            className={inputClass('siteAddress')}
            rows={2}
            value={jobDetails.siteAddress}
            onChange={(e) => updateJob('siteAddress', e.target.value)}
          />
          {errors.siteAddress && <p className="text-tq-error text-xs mt-1">{errors.siteAddress}</p>}
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Quote Date
          </label>
          <input
            type="date"
            className={inputClass('quoteDate')}
            value={jobDetails.quoteDate}
            onChange={(e) => updateJob('quoteDate', e.target.value)}
          />
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Brief Notes (optional)
          </label>
          <textarea
            className={inputClass('briefNotes')}
            rows={2}
            value={jobDetails.briefNotes}
            onChange={(e) => updateJob('briefNotes', e.target.value)}
            placeholder="Anything the AI should know — e.g. wall is on a slope, needs through stones replacing..."
          />
        </div>
      </div>

      {/* Reference card banner */}
      <div
        className="flex items-start gap-3 rounded-lg p-4 mb-6"
        style={{ backgroundColor: 'var(--tq-accent-bg)', border: '1.5px solid var(--tq-accent-bd)', borderRadius: 10 }}
      >
        <span className="text-2xl shrink-0">📐</span>
        <div>
          <p className="font-heading font-bold text-sm" style={{ color: 'var(--tq-accent)' }}>
            Using your FastQuote Reference Card?
          </p>
          <p className="text-sm mt-1" style={{ color: 'var(--tq-text)' }}>
            Place it flat against the wall in Slot 4. The AI uses its known 148×210mm dimensions to calculate real measurements.
          </p>
        </div>
      </div>

      {/* Missing-photos warning (shown when restored draft had photos that are now null) */}
      {state._photoSlots && Object.values(photos).every(p => p == null) && (
        <div className="bg-tq-unconfirmed/10 border border-tq-unconfirmed/30 rounded p-3 mb-6">
          <p className="text-tq-unconfirmed text-sm">
            ⚠ Photos from your previous session could not be restored. Please re-upload them to continue.
          </p>
        </div>
      )}

      {/* Photo slots */}
      <h3 className="text-lg font-heading font-bold text-tq-text mb-4">
        Photo Upload
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {PHOTO_SLOTS.map((slot, slotIndex) => {
          const photo = photos[slot.key];
          const isMissing = photoWarnings.missingSlots?.includes(slot.key);
          const isReference = slot.key === 'referenceCard';
          const isRequired = slotIndex === 0 || slotIndex === 1; // overview, closeup
          const isRecommended = slotIndex === 2 || slotIndex === 4; // sideProfile, access
          const slotNum = slotIndex + 1;

          // Number circle colors
          const circleStyle = isReference
            ? { backgroundColor: '#c07e12', color: '#ffffff' }
            : isRequired
              ? { backgroundColor: '#1a1714', color: '#f5f0e8' }
              : { backgroundColor: '#7a6f5e', color: '#f5f0e8' };

          // Card border
          const cardBorder = isReference
            ? '2px solid #e8a838'
            : '1.5px solid var(--tq-border)';

          // Header bg for reference slot
          const headerBg = isReference ? '#fdf6e8' : 'var(--tq-card)';
          const headerBorder = isReference ? '#fae8b8' : 'var(--tq-border-soft)';

          return (
            <div
              key={slot.key}
              onDragOver={handleSlotDragOver}
              onDragEnter={(e) => handleSlotDragEnter(slot.key, e)}
              onDragLeave={(e) => handleSlotDragLeave(slot.key, e)}
              onDrop={(e) => handleSlotDrop(slot.key, e)}
              className="overflow-hidden transition-all"
              style={{
                backgroundColor: 'var(--tq-card)',
                border: dragOverSlot === slot.key ? '2px solid var(--tq-accent)' : cardBorder,
                borderRadius: 10,
              }}
            >
              {/* Card header */}
              <div
                className="flex items-center gap-2 px-3.5 py-3"
                style={{ backgroundColor: headerBg, borderBottom: `1px solid ${headerBorder}` }}
              >
                <span
                  className="flex items-center justify-center rounded-full shrink-0"
                  style={{ width: 22, height: 22, fontSize: 11, fontWeight: 700, ...circleStyle }}
                >
                  {slotNum}
                </span>
                <span className="text-sm font-heading font-bold flex-1" style={{ color: 'var(--tq-text)' }}>
                  {slot.label}
                </span>
                {isRequired && (
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--tq-accent)', fontWeight: 600 }}>Required</span>
                )}
                {isRecommended && (
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--tq-muted)', fontWeight: 600 }}>Recommended</span>
                )}
                {isReference && (
                  <span className="text-[10px] uppercase tracking-wide" style={{ color: '#c07e12', fontWeight: 600 }}>Recommended</span>
                )}
                {photo && (
                  <span className="text-xs" style={{ color: 'var(--tq-confirmed-txt)' }}>✓</span>
                )}
              </div>

              {/* Card body: drop zone or image */}
              <div className="p-3">
                {photo ? (
                  <div className="relative">
                    <img
                      src={photo.data}
                      alt={slot.label}
                      className="w-full h-28 object-cover rounded"
                    />
                    <button
                      onClick={() => {
                        dispatch({ type: 'SET_PHOTO', slot: slot.key, photo: null });
                        if (state.currentUserId) deletePhoto(state.currentUserId, 'draft', slot.key);
                      }}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full flex items-center justify-center text-sm"
                      style={{ backgroundColor: 'rgba(0,0,0,0.5)', color: '#ffffff' }}
                    >
                      ×
                    </button>
                  </div>
                ) : (
                  <label
                    className="flex flex-col items-center justify-center cursor-pointer rounded transition-colors"
                    style={{
                      minHeight: 110,
                      border: isReference
                        ? '2px dashed #e8c870'
                        : dragOverSlot === slot.key
                          ? '2px dashed var(--tq-accent)'
                          : '2px dashed var(--tq-border)',
                      backgroundColor: isReference ? '#fef8ee' : 'transparent',
                    }}
                  >
                    <span className="text-2xl mb-1 opacity-30">📷</span>
                    <span className="text-xs" style={{ color: 'var(--tq-muted)' }}>Click or drop photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handlePhotoUpload(slot.key, e)}
                    />
                  </label>
                )}
                {isMissing && (
                  <p className="text-xs mt-2" style={{ color: 'var(--tq-error-txt)' }}>Required photo missing</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Extra photos */}
      {extraPhotos.length < 10 && (
        <div
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }}
          onDragEnter={(e) => { e.preventDefault(); setDragOverExtra(true); }}
          onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDragOverExtra(false); }}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOverExtra(false);
            const file = e.dataTransfer.files?.[0];
            if (!file || !file.type.startsWith('image/') || extraPhotos.length >= 10) return;
            const dataUrl = await resizeImage(file);
            const newIndex = extraPhotos.length;
            dispatch({
              type: 'ADD_EXTRA_PHOTO',
              photo: { data: dataUrl, name: file.name, label: extraPhotoLabel },
            });
            if (state.currentUserId) {
              savePhoto(state.currentUserId, 'draft', `extra-${newIndex}`, { data: dataUrl, name: file.name, label: extraPhotoLabel });
            }
          }}
          className={`mb-6 flex items-center gap-3 flex-wrap p-3 rounded-lg border-2 transition-all ${
            dragOverExtra
              ? 'border-tq-accent ring-2 ring-tq-accent/50 border-solid bg-tq-accent/5'
              : 'border-transparent'
          }`}
        >
          <select
            value={extraPhotoLabel}
            onChange={(e) => setExtraPhotoLabel(e.target.value)}
            className="bg-tq-card border border-tq-border rounded px-2 py-1.5 text-tq-text text-sm focus:outline-none focus:border-tq-accent"
          >
            {EXTRA_PHOTO_CATEGORIES.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
          <label className="inline-flex items-center gap-2 text-sm text-tq-accent cursor-pointer hover:text-tq-accent-dark">
            + Add more photos ({extraPhotos.length}/10) — or drop here
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleExtraPhoto}
            />
          </label>
        </div>
      )}

      {extraPhotos.length > 0 && (
        <div className="flex gap-3 mb-6 flex-wrap">
          {extraPhotos.map((p, i) => (
            <div key={i} className="relative">
              <img src={p.data} alt={`Extra ${i + 1}`} className="w-20 h-20 object-cover rounded border border-tq-border" />
              {p.label && (
                <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-white text-[10px] text-center py-0.5 rounded-b">
                  {p.label}
                </span>
              )}
              <button
                onClick={() => {
                  dispatch({ type: 'REMOVE_EXTRA_PHOTO', index: i });
                  if (state.currentUserId) {
                    // Delete all extras then re-upload remaining (re-index)
                    const remaining = extraPhotos.filter((_, idx) => idx !== i);
                    // Delete all extra-* slots
                    for (let j = 0; j < extraPhotos.length; j++) {
                      deletePhoto(state.currentUserId, 'draft', `extra-${j}`);
                    }
                    // Re-upload remaining with corrected indices
                    remaining.forEach((p, idx) => {
                      savePhoto(state.currentUserId, 'draft', `extra-${idx}`, { data: p.data, name: p.name, label: p.label });
                    });
                  }
                }}
                className="absolute -top-1 -right-1 bg-tq-error text-white w-5 h-5 rounded-full flex items-center justify-center text-xs"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Soft warning if no reference card */}
      {!photos.referenceCard && (photos.overview || photos.closeup) && (
        <div className="bg-tq-unconfirmed/10 border border-tq-unconfirmed/30 rounded p-3 mb-6">
          <p className="text-tq-unconfirmed text-sm">
            ⚠ No reference card photo — measurements will be estimated and must each be confirmed before the quote can be generated.
          </p>
        </div>
      )}

      {/* Analyse CTA */}
      <div className="flex justify-end gap-3">
        {state.currentUserId && (
          <button
            onClick={async () => {
              try {
                await saveDraft(state.currentUserId, state);
                if (showToast) showToast('Progress saved', 'success');
              } catch {
                if (showToast) showToast('Failed to save progress', 'error');
              }
            }}
            className="border border-tq-border text-tq-text hover:bg-tq-card font-heading font-bold uppercase tracking-wide px-6 py-3 rounded transition-colors"
          >
            Save Progress
          </button>
        )}
        {state.reviewData && (
          <button
            onClick={() => dispatch({ type: 'SET_STEP', step: 4 })}
            className="border border-tq-border text-tq-text hover:bg-tq-card font-heading font-bold uppercase tracking-wide px-6 py-3 rounded transition-colors"
          >
            Back to Review
          </button>
        )}
        <button
          disabled={!canAnalyse}
          onClick={handleAnalyse}
          className="font-heading font-bold uppercase tracking-wide px-8 py-3 rounded transition-colors"
          style={{
            backgroundColor: canAnalyse ? 'var(--tq-accent)' : 'var(--tq-surface)',
            color: canAnalyse ? '#ffffff' : 'var(--tq-muted)',
            opacity: canAnalyse ? 1 : 0.45,
            cursor: canAnalyse ? 'pointer' : 'not-allowed',
          }}
        >
          {state.reviewData
            ? 'RE-ANALYSE JOB'
            : canAnalyse
              ? 'ANALYSE JOB'
              : `ANALYSE JOB — ${neededPhotos > 0 ? `${neededPhotos} PHOTO${neededPhotos !== 1 ? 'S' : ''} NEEDED` : 'ADD SITE ADDRESS'}`
          }
        </button>
      </div>
    </div>
  );
}
