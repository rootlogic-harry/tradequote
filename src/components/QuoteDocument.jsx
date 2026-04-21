import React, { useRef, useLayoutEffect } from 'react';
import { formatCurrency, formatDate } from '../utils/quoteBuilder.js';
import { calculateAllTotals } from '../utils/calculations.js';
import { DEFAULT_NOTES } from '../utils/defaultNotes.js';

// Inline-editable text — switches between a static element and an auto-growing
// textarea (or input) based on `editable`. When not editable the markup is
// byte-identical to the previous render so PDF/DOCX exports are unaffected.
function EditableText({ value, onChange, editable, multiline = true, className = '', placeholder, as = 'p' }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!editable) return;
    const el = ref.current;
    if (!el || el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }, [value, editable]);

  if (!editable) {
    const Tag = as;
    return <Tag className={className}>{value}</Tag>;
  }
  const editClass = `${className} bg-amber-50/40 hover:bg-amber-50 focus:bg-white border border-transparent hover:border-amber-200 focus:border-amber-400 outline-none rounded px-1 -mx-1 transition-colors w-full`;
  if (multiline) {
    return (
      <textarea
        ref={ref}
        value={value || ''}
        onChange={onChange}
        placeholder={placeholder}
        className={`${editClass} resize-none`}
        style={{ overflow: 'hidden', minHeight: '1.5em' }}
      />
    );
  }
  return (
    <input
      ref={ref}
      value={value || ''}
      onChange={onChange}
      placeholder={placeholder}
      className={editClass}
    />
  );
}

export default function QuoteDocument({ state, showPhotos = true, selectedPhotos: selectedPhotosProp, editable = false, dispatch }) {
  // editable requires dispatch — guard so we never render edit affordances
  // without a way to commit changes (e.g. SavedQuoteViewer passes no dispatch).
  const canEdit = editable && typeof dispatch === 'function';
  const { profile, jobDetails, reviewData, photos = {}, transcript, captureMode } = state;

  if (!reviewData) return null;

  const {
    damageDescription,
    measurements,
    scheduleOfWorks,
    materials,
    labourEstimate,
    additionalCosts = [],
  } = reviewData;

  const labour = {
    days: labourEstimate?.estimatedDays || 0,
    workers: labourEstimate?.numberOfWorkers || 0,
    dayRate: labourEstimate?.dayRate || profile.dayRate,
  };

  const totals = calculateAllTotals(materials, labour, additionalCosts, profile.vatRegistered);

  // Collect photos for the document — use selectedPhotos prop if provided
  let docPhotos;
  if (selectedPhotosProp) {
    docPhotos = selectedPhotosProp;
  } else {
    docPhotos = [];
    if (photos.overview) docPhotos.push({ label: 'Overview', data: photos.overview.data });
    if (photos.closeup) docPhotos.push({ label: 'Close-up', data: photos.closeup.data });
    if (photos.sideProfile) docPhotos.push({ label: 'Side Profile', data: photos.sideProfile.data });
    if (photos.referenceCard) docPhotos.push({ label: 'Reference Card', data: photos.referenceCard.data });
    if (photos.access) docPhotos.push({ label: 'Access', data: photos.access.data });
  }

  // Filter out empty / £0 material rows for display
  const displayMaterials = materials.filter(mat => mat.description?.trim() && mat.totalCost > 0);

  // Render description with bold numbered section headers
  const renderDescription = (text) => {
    if (!text) return null;
    const lines = text.split('\n');
    const headerPattern = /^\d+\s*[—–-]\s*(.+)$/;
    const elements = [];
    let bodyLines = [];

    const flushBody = () => {
      if (bodyLines.length > 0) {
        const content = bodyLines.join('\n').trim();
        if (content) {
          elements.push(
            <p key={`body-${elements.length}`} className="text-lg text-gray-700 whitespace-pre-wrap mb-3">{content}</p>
          );
        }
        bodyLines = [];
      }
    };

    for (const line of lines) {
      if (headerPattern.test(line)) {
        flushBody();
        elements.push(
          <p key={`hdr-${elements.length}`} className="text-lg text-gray-800 font-bold mt-4 mb-1">{line}</p>
        );
      } else {
        bodyLines.push(line);
      }
    }
    flushBody();

    // Fallback: if no headers detected, render as single paragraph
    if (elements.length === 0) {
      return <p className="text-lg text-gray-700 whitespace-pre-wrap">{text}</p>;
    }
    return <>{elements}</>;
  };

  return (
    <div id="quote-document" className="bg-white text-gray-900 px-10 py-8 font-['Inter',sans-serif] text-lg leading-relaxed" style={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Header */}
      <div className="flex justify-between items-start mb-6 border-b-2 border-gray-200 pb-4">
        <div className="flex items-start gap-4">
          {profile.logo && (
            <img src={profile.logo} alt="Logo" className="max-w-[200px] max-h-[80px] object-contain" />
          )}
          <div>
            {profile.companyName?.trim() && (
              <h1 className="text-3xl font-bold text-gray-900" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                {profile.companyName}
              </h1>
            )}
            {!profile.logo && !profile.companyName?.trim() && (
              <h1 className="text-3xl font-bold text-gray-900" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
                {profile.fullName}
              </h1>
            )}
            {profile.accreditations?.trim() && (
              <p className="text-gray-500 text-base">{profile.accreditations}</p>
            )}
          </div>
        </div>
        <div className="text-right text-base text-gray-600">
          <p>{formatDate(jobDetails.quoteDate)}</p>
          <p>{profile.phone}</p>
          <p>{profile.email}</p>
        </div>
      </div>

      {/* Reference line */}
      <div className="bg-gray-50 px-4 py-2 rounded mb-6 text-base font-medium">
        Quote ref: {jobDetails.quoteReference} — {jobDetails.clientName}, {jobDetails.siteAddress}
      </div>

      {/* Section 1: Damage */}
      <div className="mb-8" data-print-section="damage">
        <h2 className="text-lg font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Description of Damage
        </h2>
        {canEdit ? (
          <EditableText
            editable
            value={damageDescription}
            onChange={(e) => dispatch({ type: 'UPDATE_DAMAGE_DESCRIPTION', value: e.target.value })}
            className="text-lg text-gray-700 whitespace-pre-wrap leading-relaxed"
            placeholder="Description of damage…"
          />
        ) : (
          renderDescription(damageDescription)
        )}
      </div>

      {/* Video Walkthrough Transcript (only for video-mode quotes with transcript) */}
      {captureMode === 'video' && transcript && (
        <div className="mb-8" data-print-section="transcript">
          <h2 className="text-lg font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Site Walkthrough Notes
          </h2>
          <p className="text-lg text-gray-700 whitespace-pre-wrap">{transcript}</p>
        </div>
      )}

      {/* Section 2: Measurements */}
      <div className="mb-8" data-print-section="measurements">
        <h2 className="text-lg font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Measurements
        </h2>
        <ul className="space-y-1">
          {measurements.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-lg">
              <span className="text-gray-700">{m.item}:</span>
              <span className="font-medium" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
                {m.confirmed ? m.value : <em className="text-amber-500">(unconfirmed)</em>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Section 3: Schedule */}
      <div className="mb-8" data-print-section="schedule">
        <h2 className="text-lg font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Schedule of Works
        </h2>
        <ol className="space-y-3">
          {scheduleOfWorks.map((step, i) => (
            <li key={step.id || i}>
              {canEdit ? (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="font-bold text-lg text-gray-800 shrink-0">{i + 1}.</span>
                    <EditableText
                      editable
                      multiline={false}
                      value={step.title}
                      onChange={(e) => dispatch({
                        type: 'UPDATE_SCHEDULE',
                        schedule: scheduleOfWorks.map((s, idx) => idx === i ? { ...s, title: e.target.value } : s),
                      })}
                      className="font-bold text-lg text-gray-800"
                      as="span"
                      placeholder="Step title"
                    />
                  </div>
                  <EditableText
                    editable
                    value={step.description}
                    onChange={(e) => dispatch({
                      type: 'UPDATE_SCHEDULE',
                      schedule: scheduleOfWorks.map((s, idx) => idx === i ? { ...s, description: e.target.value } : s),
                    })}
                    className="text-lg text-gray-600 ml-5 leading-relaxed"
                    placeholder="Step description"
                  />
                </>
              ) : (
                <>
                  <p className="font-bold text-lg text-gray-800">{i + 1}. {step.title}</p>
                  <p className="text-lg text-gray-600 ml-5">{step.description}</p>
                </>
              )}
            </li>
          ))}
        </ol>
      </div>

      {/* Section 4: Cost Breakdown */}
      <div className="mb-12" data-print-section="cost-breakdown">
        <h2 className="text-lg font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Cost Breakdown
        </h2>

        <table className="w-full text-lg mb-4">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500 text-base">
              <th className="text-left py-1">Description</th>
              <th className="text-left py-1">Qty</th>
              <th className="text-left py-1">Unit</th>
              <th className="text-right py-1">Rate</th>
              <th className="text-right py-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {displayMaterials.map((mat) => (
              <tr key={mat.id} className="border-b border-gray-100">
                <td className="py-1">{mat.description}</td>
                <td className="py-1">{mat.quantity}</td>
                <td className="py-1">{mat.unit || '\u2014'}</td>
                <td className="py-1 text-right" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(mat.unitCost)}</td>
                <td className="py-1 text-right" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(mat.totalCost)}</td>
              </tr>
            ))}
            <tr className="border-b border-gray-100">
              <td className="py-1" colSpan={4}>
                Labour
              </td>
              <td className="py-1 text-right" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(totals.labourTotal)}</td>
            </tr>
            {additionalCosts.map((cost) => (
              <tr key={cost.id} className="border-b border-gray-100">
                <td className="py-1" colSpan={4}>{cost.label}</td>
                <td className="py-1 text-right" style={{ fontFamily: "'JetBrains Mono', monospace" }}>{formatCurrency(cost.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals — right-aligned, fixed-width, with a heavier rule above
             TOTAL and brand-accent on the value to read like a proper invoice. */}
        <div className="mt-6 flex justify-end" data-print-section="totals">
          <div className="w-2/3 sm:w-1/2 md:w-2/5">
            <div className="space-y-2 text-lg" style={{ fontFamily: "'JetBrains Mono', monospace" }}>
              <div className="flex justify-between">
                <span className="text-gray-500">Subtotal (ex VAT)</span>
                <span className="text-gray-800">{formatCurrency(totals.subtotal)}</span>
              </div>
              {profile.vatRegistered && (
                <div className="flex justify-between">
                  <span className="text-gray-500">VAT (20%)</span>
                  <span className="text-gray-800">{formatCurrency(totals.vatAmount)}</span>
                </div>
              )}
              <div className="flex justify-between border-t-2 border-gray-800 pt-3 mt-2 text-2xl font-bold">
                <span className="text-gray-900" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>TOTAL</span>
                <span style={{ color: '#d97706' }}>{formatCurrency(totals.total)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Notes & Conditions — hidden when user disables in profile */}
      {profile.showNotesOnQuote !== false && (
        <div className="mb-8" data-print-section="notes">
          <h2 className="text-lg font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Notes &amp; Conditions
          </h2>
          <ol className="list-decimal list-outside pl-6 space-y-1 text-lg text-gray-600">
            {(reviewData.notes && reviewData.notes.length > 0 ? reviewData.notes : DEFAULT_NOTES).map((note, i) => {
              if (!canEdit) {
                return <li key={i} className="pl-1">{note}</li>;
              }
              const allNotes = reviewData.notes && reviewData.notes.length > 0 ? reviewData.notes : DEFAULT_NOTES;
              return (
                <li key={i} className="pl-1">
                  <EditableText
                    editable
                    value={note}
                    onChange={(e) => dispatch({
                      type: 'UPDATE_NOTES',
                      notes: allNotes.map((n, idx) => idx === i ? e.target.value : n),
                    })}
                    className="text-lg text-gray-600 leading-relaxed"
                    as="span"
                  />
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {/* Footer — preview only. handleDownloadPDF overlays a pdf.text footer
          on every page, so we tell html2canvas to skip this element during
          PDF capture; otherwise the final page shows two footers. */}
      <div
        data-html2canvas-ignore="true"
        className="border-t-2 border-gray-200 pt-4 mt-8 text-base text-gray-500 text-center"
      >
        <p>{[profile.companyName, profile.address, profile.vatRegistered && profile.vatNumber ? `VAT No: ${profile.vatNumber}` : null].filter(Boolean).join(' · ')}</p>
      </div>

      {/* Photos — full size (only when showPhotos is true).
          For print: paired so two photos fit per A4 page and each pair stays
          together on a page via data-print-pair + the CSS rule in index.html. */}
      {showPhotos && docPhotos.length > 0 && (
        <div className="mt-8 border-t border-gray-200 pt-4" data-print-section="photos">
          <h2 className="text-lg font-bold uppercase tracking-wide text-gray-700 mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Site Photographs
          </h2>
          <div className="space-y-6">
            {Array.from({ length: Math.ceil(docPhotos.length / 2) }).map((_, pairIdx) => (
              <div key={pairIdx} data-print-pair className="space-y-6">
                {docPhotos.slice(pairIdx * 2, pairIdx * 2 + 2).map((p, i) => (
                  <div key={i}>
                    <img src={p.data} alt={p.label} className="w-full rounded" />
                    <p className="text-base text-gray-400 mt-1">{p.label} — {jobDetails.siteAddress}</p>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
