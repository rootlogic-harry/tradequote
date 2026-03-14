import React, { useState, useRef } from 'react';
import { PHOTO_SLOTS } from '../../constants.js';
import { validateJobDetails, validateRequiredPhotoSlots } from '../../utils/validators.js';
import { parseAIResponse, validateAIResponse, normalizeAIResponse } from '../../utils/aiParser.js';

function resizeImage(file, maxSize = 2048) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width <= maxSize && height <= maxSize) {
          resolve(e.target.result);
          return;
        }
        const ratio = Math.min(maxSize / width, maxSize / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const SYSTEM_PROMPT = `You are an expert dry stone waller with over 20 years of experience and £500k+ annual
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
- Dismantling: £200–£240 per m² (careful removal, sorting salvageable stone)
- Rebuilding: £360–£400 per m² (random rubble technique, NHL 3.5 lime mortar)
- Repointing: £100–£120 per m² (raked to 20mm, hydraulic lime, flush finish)
- Replacement stone supply: £170–£200 per tonne (matched rubble, gritstone/sandstone)
- Stone consumption: ~0.3 tonnes per m² of wall face
- Hydraulic lime mortar (NHL 3.5): £80–£100 per batch (small-to-medium job)
- Preliminaries & site survey: £150–£200 flat
- Core/hearting consolidation: £130–£170 flat
- Making good & photographic record: £80–£110 flat
- Waste disposal & site clearance: £100–£140 flat
- Temporary propping (Strongboy supports): £200–£250 when required

Typical repointing area is 1.5–2× the rebuilt area (extends to surround).
Fixed baseline costs (prelims + core + mortar + making good + waste) run £550–£700
regardless of wall area.

ALWAYS generate these as separate line items with Qty, Unit (m², t, or Item), and
Rate. Never lump costs together.

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
}`;

export default function JobDetails({ state, dispatch, abortRef }) {
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
  };

  const [extraPhotoLabel, setExtraPhotoLabel] = useState('Other');
  const EXTRA_PHOTO_CATEGORIES = ['Overview', 'Close-up', 'Side Profile', 'Reference Card', 'Access', 'Other'];

  const handleExtraPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file || extraPhotos.length >= 10) return;
    const dataUrl = await resizeImage(file);
    dispatch({
      type: 'ADD_EXTRA_PHOTO',
      photo: { data: dataUrl, name: file.name, label: extraPhotoLabel },
    });
  };

  const handleAnalyse = async () => {
    const jobResult = validateJobDetails(jobDetails);
    const photoResult = validateRequiredPhotoSlots(photos);

    setErrors(jobResult.errors);
    setPhotoWarnings(photoResult);

    if (!jobResult.valid || !photoResult.valid) return;

    dispatch({ type: 'ANALYSIS_START' });

    try {
      const imageContent = [];
      for (const slot of PHOTO_SLOTS) {
        const photo = photos[slot.key];
        if (photo) {
          imageContent.push({
            type: 'text',
            text: `--- Photo: ${slot.label} ---`,
          });
          const base64Data = photo.data.split(',')[1];
          imageContent.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Data,
            },
          });
        }
      }

      for (let i = 0; i < extraPhotos.length; i++) {
        imageContent.push({
          type: 'text',
          text: `--- Additional Photo ${i + 1} ---`,
        });
        const base64Data = extraPhotos[i].data.split(',')[1];
        imageContent.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: 'image/jpeg',
            data: base64Data,
          },
        });
      }

      imageContent.push({
        type: 'text',
        text: `Site address: ${jobDetails.siteAddress}${jobDetails.briefNotes ? `\nTradesman notes: ${jobDetails.briefNotes}` : ''}`,
      });

      const controller = new AbortController();
      if (abortRef) abortRef.current = controller;
      const timeoutId = setTimeout(() => controller.abort(), 60000);

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': profile.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: imageContent,
            },
          ],
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API error ${response.status}: ${errText}`);
      }

      const data = await response.json();
      const rawText = data.content?.[0]?.text || '';
      const parsed = parseAIResponse(rawText);

      if (!parsed) {
        dispatch({
          type: 'ANALYSIS_ERROR',
          error: 'AI returned an unreadable response. Try again or enter details manually.',
        });
        return;
      }

      const validation = validateAIResponse(parsed);
      if (!validation.valid) {
        console.warn('AI response validation warnings:', validation.errors);
      }

      const normalised = normalizeAIResponse(parsed);
      normalised.referenceCardDetected = parsed.referenceCardDetected;
      normalised.stoneType = parsed.stoneType;
      normalised.additionalCosts = [];
      normalised.labourEstimate.dayRate = profile.dayRate;

      dispatch({
        type: 'ANALYSIS_SUCCESS',
        rawResponse: rawText,
        normalised,
      });
    } catch (err) {
      let errorMessage;
      if (err.name === 'AbortError') {
        errorMessage = 'Analysis was cancelled.';
      } else if (err instanceof TypeError) {
        errorMessage = 'Network error — check your internet connection and try again.';
      } else {
        errorMessage = err.message;
      }
      dispatch({
        type: 'ANALYSIS_ERROR',
        error: errorMessage,
      });
    }
  };

  const hasAnyPhoto = Object.values(photos).some(p => p != null) || extraPhotos.length > 0;
  const canAnalyse =
    hasAnyPhoto && jobDetails.siteAddress?.trim() && profile.apiKey?.trim();

  const inputClass = (field) =>
    `w-full bg-tq-card border ${
      errors[field] ? 'border-tq-error' : 'border-tq-border'
    } rounded px-3 py-2 text-tq-text font-body text-sm focus:outline-none focus:border-tq-accent`;

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
      <div className="bg-tq-accent/10 border border-tq-accent/30 rounded-lg p-4 mb-6">
        <p className="text-tq-accent font-heading font-bold text-sm">
          📐 Using your TradeQuote Reference Card?
        </p>
        <p className="text-tq-text text-sm mt-1">
          Place it flat against the wall in Slot 4. The AI uses its known 148×210mm dimensions to calculate real measurements.
        </p>
      </div>

      {/* Photo slots */}
      <h3 className="text-lg font-heading font-bold text-tq-text mb-4">
        Photo Upload
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {PHOTO_SLOTS.map((slot) => {
          const photo = photos[slot.key];
          const isMissing = photoWarnings.missingSlots?.includes(slot.key);

          return (
            <div
              key={slot.key}
              onDragOver={handleSlotDragOver}
              onDragEnter={(e) => handleSlotDragEnter(slot.key, e)}
              onDragLeave={(e) => handleSlotDragLeave(slot.key, e)}
              onDrop={(e) => handleSlotDrop(slot.key, e)}
              className={`border rounded-lg p-3 transition-all ${
                dragOverSlot === slot.key
                  ? 'border-tq-accent ring-2 ring-tq-accent border-solid bg-tq-accent/5'
                  : isMissing
                    ? 'border-tq-error bg-tq-error/5'
                    : photo
                      ? 'border-tq-confirmed/50 bg-tq-confirmed/5'
                      : 'border-tq-border bg-tq-card'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-heading font-bold text-tq-text">
                  {slot.label}
                  {slot.required && <span className="text-tq-accent ml-1">*</span>}
                </span>
                {photo && (
                  <span className="text-tq-confirmed text-xs">✓ Uploaded</span>
                )}
              </div>
              <p className="text-xs text-tq-muted mb-3">{slot.instruction}</p>

              {photo ? (
                <div className="relative">
                  <img
                    src={photo.data}
                    alt={slot.label}
                    className="w-full h-32 object-cover rounded"
                  />
                  <button
                    onClick={() => dispatch({ type: 'SET_PHOTO', slot: slot.key, photo: null })}
                    className="absolute top-1 right-1 bg-tq-bg/80 text-tq-error w-6 h-6 rounded-full flex items-center justify-center text-sm hover:bg-tq-bg"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <label className={`block w-full h-32 border-2 rounded cursor-pointer flex items-center justify-center hover:border-tq-accent transition-colors ${
                  dragOverSlot === slot.key ? 'border-solid border-tq-accent' : 'border-dashed border-tq-border'
                }`}>
                  <span className="text-tq-muted text-sm">Click or drop photo here</span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handlePhotoUpload(slot.key, e)}
                  />
                </label>
              )}
              {isMissing && <p className="text-tq-error text-xs mt-1">Required photo missing</p>}
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
            dispatch({
              type: 'ADD_EXTRA_PHOTO',
              photo: { data: dataUrl, name: file.name, label: extraPhotoLabel },
            });
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
                onClick={() => dispatch({ type: 'REMOVE_EXTRA_PHOTO', index: i })}
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
      <div className="flex justify-end">
        <button
          disabled={!canAnalyse}
          onClick={handleAnalyse}
          className={`font-heading font-bold uppercase tracking-wide px-8 py-3 rounded transition-colors ${
            canAnalyse
              ? 'bg-tq-accent hover:bg-tq-accent-dark text-tq-bg'
              : 'bg-tq-card text-tq-muted cursor-not-allowed'
          }`}
        >
          Analyse Job
        </button>
      </div>
    </div>
  );
}
