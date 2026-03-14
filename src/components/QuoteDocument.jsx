import React from 'react';
import { formatCurrency, formatDate, calculateValidUntil } from '../utils/quoteBuilder.js';
import { calculateAllTotals } from '../utils/calculations.js';

export default function QuoteDocument({ state, showPhotos = true }) {
  const { profile, jobDetails, reviewData, photos } = state;

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
  const validUntil = calculateValidUntil(jobDetails.quoteDate);

  // Collect photos for the document
  const docPhotos = [];
  if (photos.overview) docPhotos.push({ label: 'Overview', data: photos.overview.data });
  if (photos.closeup) docPhotos.push({ label: 'Close-up', data: photos.closeup.data });
  if (photos.sideProfile) docPhotos.push({ label: 'Side Profile', data: photos.sideProfile.data });
  if (photos.referenceCard) docPhotos.push({ label: 'Reference Card', data: photos.referenceCard.data });
  if (photos.access) docPhotos.push({ label: 'Access', data: photos.access.data });

  return (
    <div id="quote-document" className="bg-white text-gray-900 px-16 py-12 font-['IBM_Plex_Sans',sans-serif] text-sm leading-relaxed" style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
      {/* Header */}
      <div className="flex justify-between items-start mb-6 border-b-2 border-gray-200 pb-4">
        <div className="flex items-start gap-4">
          {profile.logo && (
            <img src={profile.logo} alt="Logo" className="w-16 h-16 object-contain" />
          )}
          <div>
            <h1 className="text-xl font-bold text-gray-900" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
              {profile.companyName}
            </h1>
            <p className="text-gray-500 text-xs">Dry Stone Walling</p>
            {profile.accreditations && (
              <p className="text-gray-500 text-xs">{profile.accreditations}</p>
            )}
          </div>
        </div>
        <div className="text-right text-xs text-gray-600">
          <p>{formatDate(jobDetails.quoteDate)}</p>
          <p>{profile.phone}</p>
          <p>{profile.email}</p>
        </div>
      </div>

      {/* Reference line */}
      <div className="bg-gray-50 px-4 py-2 rounded mb-6 text-xs font-medium">
        Quote ref: {jobDetails.quoteReference} — {jobDetails.clientName}, {jobDetails.siteAddress}
      </div>

      {/* Section 1: Damage */}
      <div className="mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Description of Damage
        </h2>
        <p className="text-sm text-gray-700 whitespace-pre-wrap">{damageDescription}</p>
      </div>

      {/* Section 2: Measurements */}
      <div className="mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Measurements
        </h2>
        <ul className="space-y-1">
          {measurements.map((m) => (
            <li key={m.id} className="flex items-center gap-2 text-sm">
              <span className="text-gray-700">{m.item}:</span>
              <span className="font-medium" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
                {m.confirmed ? m.value : <em className="text-amber-500">(unconfirmed)</em>}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {/* Section 3: Schedule */}
      <div className="mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Schedule of Works
        </h2>
        <ol className="space-y-3">
          {scheduleOfWorks.map((step, i) => (
            <li key={step.id || i}>
              <p className="font-bold text-sm text-gray-800">{i + 1}. {step.title}</p>
              <p className="text-sm text-gray-600 ml-5">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>

      {/* Section 4: Cost Breakdown */}
      <div className="mb-6">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-2 border-b border-gray-200 pb-1" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Cost Breakdown
        </h2>

        <table className="w-full text-sm mb-4">
          <thead>
            <tr className="border-b border-gray-200 text-gray-500 text-xs">
              <th className="text-left py-1">Description</th>
              <th className="text-left py-1">Qty</th>
              <th className="text-right py-1">Unit Cost</th>
              <th className="text-right py-1">Total</th>
            </tr>
          </thead>
          <tbody>
            {materials.map((mat) => (
              <tr key={mat.id} className="border-b border-gray-100">
                <td className="py-1">{mat.description}</td>
                <td className="py-1">{mat.quantity}</td>
                <td className="py-1 text-right" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{formatCurrency(mat.unitCost)}</td>
                <td className="py-1 text-right" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{formatCurrency(mat.totalCost)}</td>
              </tr>
            ))}
            <tr className="border-b border-gray-100">
              <td className="py-1" colSpan={2}>
                Labour — {labourEstimate?.description || `${labour.days} days \u00D7 ${labour.workers} workers`}
              </td>
              <td className="py-1 text-right" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{formatCurrency(labour.dayRate)}/day</td>
              <td className="py-1 text-right" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{formatCurrency(totals.labourTotal)}</td>
            </tr>
            {additionalCosts.map((cost) => (
              <tr key={cost.id} className="border-b border-gray-100">
                <td className="py-1" colSpan={3}>{cost.label}</td>
                <td className="py-1 text-right" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{formatCurrency(cost.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="space-y-1 text-sm text-right" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          <div className="flex justify-end gap-8">
            <span className="text-gray-500">Subtotal (ex VAT)</span>
            <span>{formatCurrency(totals.subtotal)}</span>
          </div>
          {profile.vatRegistered && (
            <div className="flex justify-end gap-8">
              <span className="text-gray-500">VAT (20%)</span>
              <span>{formatCurrency(totals.vatAmount)}</span>
            </div>
          )}
          <div className="flex justify-end gap-8 border-t border-gray-300 pt-2 text-lg font-bold">
            <span>TOTAL</span>
            <span>{formatCurrency(totals.total)}</span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="border-t-2 border-gray-200 pt-4 mt-8 text-xs text-gray-500">
        <p className="mb-1">This quote is valid for 30 days from the date issued (until {formatDate(validUntil)}).</p>
        {profile.vatRegistered && profile.vatNumber && (
          <p className="mb-1">VAT No: {profile.vatNumber}</p>
        )}
        <p className="mb-1">{profile.fullName} — {profile.accreditations}</p>
        <p className="italic">Quote prepared with AI assistance — all figures reviewed and confirmed by {profile.fullName}.</p>
      </div>

      {/* Photos — full size (only when showPhotos is true) */}
      {showPhotos && docPhotos.length > 0 && (
        <div className="mt-8 border-t border-gray-200 pt-4">
          <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700 mb-3" style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
            Site Photographs
          </h2>
          <div className="space-y-6">
            {docPhotos.map((p, i) => (
              <div key={i}>
                <img src={p.data} alt={p.label} className="w-full rounded" />
                <p className="text-xs text-gray-400 mt-1">{p.label} — {jobDetails.siteAddress}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
