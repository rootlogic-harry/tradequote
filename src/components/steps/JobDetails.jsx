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
[Empty at prototype stage. Updated monthly from aggregated diff data in production.]

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

  const handleExtraPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file || extraPhotos.length >= 5) return;
    const dataUrl = await resizeImage(file);
    dispatch({
      type: 'ADD_EXTRA_PHOTO',
      photo: { data: dataUrl, name: file.name },
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

  const requiredSlotsFilled =
    photos.overview && photos.closeup;
  const canAnalyse =
    requiredSlotsFilled && jobDetails.siteAddress?.trim();

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
            Client / Property Name *
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
              className={`border rounded-lg p-3 ${
                isMissing
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
                <label className="block w-full h-32 border-2 border-dashed border-tq-border rounded cursor-pointer flex items-center justify-center hover:border-tq-accent transition-colors">
                  <span className="text-tq-muted text-sm">Click to upload</span>
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
      {extraPhotos.length < 5 && (
        <div className="mb-6">
          <label className="inline-flex items-center gap-2 text-sm text-tq-accent cursor-pointer hover:text-tq-accent-dark">
            + Add more photos ({extraPhotos.length}/5)
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
