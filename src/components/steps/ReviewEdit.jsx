import React, { useState } from 'react';
import MeasurementRow from '../review/MeasurementRow.jsx';
import MaterialsTable from '../review/MaterialsTable.jsx';
import LabourSection from '../review/LabourSection.jsx';
import ScheduleList from '../review/ScheduleList.jsx';
import LivePreview from '../review/LivePreview.jsx';
import AutoGrowTextarea from '../common/AutoGrowTextarea.jsx';
import { allMeasurementsConfirmed, countUnconfirmedMeasurements, canGenerateQuote } from '../../utils/validators.js';
import { calculateAllTotals } from '../../utils/calculations.js';
import { formatCurrency } from '../../utils/quoteBuilder.js';
import { DEFAULT_NOTES } from '../../utils/defaultNotes.js';
import { saveDraft } from '../../utils/userDB.js';

function AccordionSection({ title, isOpen, onToggle, children }) {
  return (
    <div style={{ border: '1px solid var(--tq-border)', borderRadius: 2, overflow: 'hidden' }}>
      <button
        onClick={onToggle}
        className="w-full px-4 py-3 flex items-center justify-between text-left"
        style={{ backgroundColor: 'var(--tq-card)' }}
      >
        <span className="font-heading font-bold text-tq-text">{title}</span>
        <span className={`text-tq-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          {'\u25BC'}
        </span>
      </button>
      {isOpen && (
        <div className="px-4 py-4" style={{ borderTop: '1px solid var(--tq-border)' }}>
          {children}
        </div>
      )}
    </div>
  );
}

export default function ReviewEdit({ state, dispatch, showToast }) {
  const { reviewData, profile } = state;
  const [openSections, setOpenSections] = useState({
    measurements: true,
    costs: false,
    schedule: false,
    damage: false,
    transcript: false,
  });

  if (!reviewData) {
    return (
      <div className="text-center py-20">
        <p className="text-tq-muted">No analysis data available.</p>
        <button
          onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}
          className="mt-4 btn-primary"
        >
          Back to Job Details
        </button>
      </div>
    );
  }

  const {
    damageDescription,
    measurements,
    scheduleOfWorks,
    materials,
    labourEstimate,
    additionalCosts = [],
    referenceCardDetected,
  } = reviewData;

  const unconfirmedCount = countUnconfirmedMeasurements(measurements);
  const allConfirmed = allMeasurementsConfirmed(measurements);

  const labour = {
    days: labourEstimate.estimatedDays || 0,
    workers: labourEstimate.numberOfWorkers || 0,
    dayRate: labourEstimate.dayRate || profile.dayRate,
  };

  const generateEnabled = canGenerateQuote(measurements, materials, labour);

  const totals = calculateAllTotals(materials, labour, additionalCosts, profile.vatRegistered);

  const addAdditionalCost = (label = '') => {
    dispatch({
      type: 'UPDATE_ADDITIONAL_COSTS',
      additionalCosts: [
        ...additionalCosts,
        { id: `ac-${Date.now()}`, label, amount: 0 },
      ],
    });
  };

  const updateAdditionalCost = (index, field, value) => {
    const updated = additionalCosts.map((c, i) =>
      i === index ? { ...c, [field]: value } : c
    );
    dispatch({ type: 'UPDATE_ADDITIONAL_COSTS', additionalCosts: updated });
  };

  const removeAdditionalCost = (index) => {
    dispatch({
      type: 'UPDATE_ADDITIONAL_COSTS',
      additionalCosts: additionalCosts.filter((_, i) => i !== index),
    });
  };

  const isVideoMode = state.captureMode === 'video';

  const toggleSection = (key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Transcript section — video mode only
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const copyTranscript = async () => {
    if (!state.transcript) return;
    try {
      await navigator.clipboard.writeText(state.transcript);
      setTranscriptCopied(true);
      setTimeout(() => setTranscriptCopied(false), 2000);
    } catch {
      // Fallback for older browsers
      const ta = document.createElement('textarea');
      ta.value = state.transcript;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setTranscriptCopied(true);
      setTimeout(() => setTranscriptCopied(false), 2000);
    }
  };

  const transcriptContent = isVideoMode && state.transcript ? (
    <div className="border border-tq-border overflow-hidden" style={{ borderRadius: 2 }}>
      <button
        onClick={() => toggleSection('transcript')}
        className="w-full bg-tq-card px-4 py-3 flex items-center justify-between text-left"
      >
        <span className="font-heading font-bold text-tq-text text-sm">
          Video Transcript (read-only)
        </span>
        <span className={`text-tq-muted transition-transform ${openSections.transcript ? 'rotate-180' : ''}`}>
          &#9660;
        </span>
      </button>
      {openSections.transcript && (
        <div className="px-4 py-3 border-t border-tq-border">
          <div className="flex justify-end mb-2">
            <button
              onClick={copyTranscript}
              className="text-xs px-3 py-2 rounded border border-tq-border text-tq-muted hover:text-tq-text transition-colors"
              type="button"
              style={{ minHeight: 44 }}
            >
              {transcriptCopied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="text-sm text-tq-text whitespace-pre-wrap leading-relaxed">
            {state.transcript}
          </p>
        </div>
      )}
    </div>
  ) : null;

  // Extracted content blocks shared between desktop and mobile
  const damageDescriptionContent = (
    <div>
      <div className="eyebrow mb-2">Damage Description</div>
      <AutoGrowTextarea
        value={damageDescription}
        onChange={(e) =>
          dispatch({ type: 'UPDATE_DAMAGE_DESCRIPTION', value: e.target.value })
        }
        minHeight={160}
        className="nq-field w-full"
      />
    </div>
  );

  const measurementsContent = (
    <div>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="eyebrow">Measurements</div>
          {unconfirmedCount === 0 ? (
            <div
              className="text-xs mt-1"
              style={{ color: 'var(--tq-confirmed-txt)', textTransform: 'none', letterSpacing: 'normal' }}
            >
              All confirmed {'\u2713'}
            </div>
          ) : (
            <div
              className="text-sm mt-1"
              style={{ color: 'var(--tq-unconf-txt)', textTransform: 'none', letterSpacing: 'normal' }}
            >
              {unconfirmedCount === measurements.length
                ? `${measurements.length} to confirm`
                : `${unconfirmedCount} of ${measurements.length} to confirm`}
            </div>
          )}
        </div>
        {unconfirmedCount > 0 && (
          <button onClick={() => dispatch({ type: 'CONFIRM_ALL_MEASUREMENTS' })} className="btn-primary text-xs" style={{ minHeight: 44 }}>
            CONFIRM ALL ({unconfirmedCount})
          </button>
        )}
      </div>

      {/* Measurement cards */}
      <div className="space-y-2">
        {measurements.map((m) => (
          <MeasurementRow
            key={m.id}
            measurement={m}
            dispatch={dispatch}
            variant="card"
          />
        ))}
      </div>
    </div>
  );

  const scheduleContent = (
    <ScheduleList
      scheduleOfWorks={scheduleOfWorks}
      dispatch={dispatch}
    />
  );

  const costsContent = (
    <div className="space-y-6">
      <MaterialsTable materials={materials} dispatch={dispatch} />

      {/* Additional Costs */}
      <div>
        <div className="eyebrow mb-2">Additional Costs</div>
        {additionalCosts.map((cost, i) => (
          <div key={cost.id || i} className="flex items-center gap-2 mb-2">
            <input
              value={cost.label}
              onChange={(e) => updateAdditionalCost(i, 'label', e.target.value)}
              className="flex-1 bg-transparent border-b border-tq-border text-sm text-tq-text outline-none focus:border-tq-accent"
              placeholder="Label"
            />
            <input
              type="number"
              value={cost.amount}
              onChange={(e) => updateAdditionalCost(i, 'amount', parseFloat(e.target.value) || 0)}
              className="w-24 bg-transparent border-b border-tq-border text-sm font-mono text-tq-text outline-none focus:border-tq-accent text-right"
            />
            <button
              onClick={() => removeAdditionalCost(i)}
              className="text-tq-muted hover:text-tq-error text-sm"
            >
              ×
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2 mt-2">
          <button onClick={() => addAdditionalCost('Travel')} className="text-xs text-tq-accent hover:text-tq-accent-dark px-2 py-1 rounded border border-tq-border">
            + Travel
          </button>
          <button onClick={() => addAdditionalCost('Accommodation')} className="text-xs text-tq-accent hover:text-tq-accent-dark px-2 py-1 rounded border border-tq-border">
            + Accommodation
          </button>
          <button onClick={() => addAdditionalCost('Skip hire')} className="text-xs text-tq-accent hover:text-tq-accent-dark px-2 py-1 rounded border border-tq-border">
            + Skip hire
          </button>
          <button onClick={() => addAdditionalCost()} className="text-xs text-tq-accent hover:text-tq-accent-dark">
            + Add cost
          </button>
        </div>
      </div>

      <LabourSection labourEstimate={labourEstimate} dispatch={dispatch} />

      {/* Financial Summary */}
      <div className="p-4" style={{ backgroundColor: 'var(--tq-card)', border: '1px solid var(--tq-border)', borderRadius: 2 }}>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span style={{ color: 'var(--tq-muted)' }}>Materials</span>
            <span className="font-mono">{formatCurrency(totals.materialsSubtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--tq-muted)' }}>
              Labour
              <span className="text-xs ml-1" style={{ color: 'var(--tq-muted)', opacity: 0.7 }}>
                ({labour.days}d × {labour.workers}w × {formatCurrency(labour.dayRate)})
              </span>
            </span>
            <span className="font-mono">{formatCurrency(totals.labourTotal)}</span>
          </div>
          {additionalCosts.filter(c => c.amount > 0).map((cost, i) => (
            <div key={cost.id || i} className="flex justify-between">
              <span style={{ color: 'var(--tq-muted)' }}>{cost.label || 'Additional cost'}</span>
              <span className="font-mono">{formatCurrency(cost.amount)}</span>
            </div>
          ))}
          <div className="pt-2 flex justify-between" style={{ borderTop: '1px solid var(--tq-border-soft)' }}>
            <span style={{ color: 'var(--tq-muted)' }}>Subtotal (ex VAT)</span>
            <span className="font-mono font-medium">{formatCurrency(totals.subtotal)}</span>
          </div>
          {profile.vatRegistered === true && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--tq-muted)' }}>VAT (20%)</span>
              <span className="font-mono">{formatCurrency(totals.vatAmount)}</span>
            </div>
          )}
          <div className="pt-2 flex justify-between text-lg" style={{ borderTop: '2px solid var(--tq-text)' }}>
            <span className="font-heading font-bold">TOTAL</span>
            <span className="font-mono font-bold" style={{ color: 'var(--tq-accent)' }}>{formatCurrency(totals.total)}</span>
          </div>
        </div>
      </div>

      {/* Notes & Conditions Editor — hidden when disabled in profile */}
      {state.profile.showNotesOnQuote !== false && (
        <div>
          <div className="eyebrow mb-2">Notes & Conditions</div>
          {(reviewData.notes && reviewData.notes.length > 0 ? reviewData.notes : DEFAULT_NOTES).map((note, i) => {
            const notes = reviewData.notes && reviewData.notes.length > 0 ? reviewData.notes : DEFAULT_NOTES;
            return (
              <div key={i} className="flex items-start gap-2 mb-2">
                <span className="text-xs text-tq-muted mt-1.5 shrink-0">{i + 1}.</span>
                <textarea
                  value={note}
                  onChange={(e) => {
                    const updated = [...notes];
                    updated[i] = e.target.value;
                    dispatch({ type: 'UPDATE_NOTES', notes: updated });
                  }}
                  rows={2}
                  className="flex-1 bg-transparent border-b border-tq-border text-xs text-tq-text outline-none focus:border-tq-accent resize-none"
                />
                <button
                  onClick={() => {
                    const updated = notes.filter((_, idx) => idx !== i);
                    dispatch({ type: 'UPDATE_NOTES', notes: updated });
                  }}
                  className="text-tq-muted hover:text-tq-error text-sm shrink-0"
                >
                  ×
                </button>
              </div>
            );
          })}
          <button
            onClick={() => {
              const notes = reviewData.notes && reviewData.notes.length > 0 ? [...reviewData.notes] : [...DEFAULT_NOTES];
              notes.push('');
              dispatch({ type: 'UPDATE_NOTES', notes });
            }}
            className="text-xs text-tq-accent hover:text-tq-accent-dark"
          >
            + Add note
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <button
              onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}
              className="flex items-center gap-1 text-sm font-heading uppercase tracking-wide hover:text-tq-accent transition-colors"
              style={{ color: 'var(--tq-muted)', minHeight: 44, padding: '8px 0' }}
              title="Back to Job Details & Photos"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
              <span className="hidden fq:inline">Job Details</span>
            </button>
            <h2 className="page-title" style={{ fontSize: 28 }}>
              Review & Edit
            </h2>
          </div>
          <p className="text-sm" style={{ color: 'var(--tq-muted)' }}>
            Check each measurement below, then hit Generate Quote when ready.
          </p>
        </div>
        {unconfirmedCount > 0 && (
          <div
            className="shrink-0 text-center px-3 py-2"
            style={{ backgroundColor: 'var(--tq-unconf-bg)', border: '1.5px solid var(--tq-unconf-bd)', borderRadius: 2 }}
          >
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 20, fontWeight: 600, color: 'var(--tq-unconf-txt)' }}>
              {unconfirmedCount}
            </div>
            <div className="text-[10px] uppercase tracking-wide" style={{ color: 'var(--tq-unconf-txt)', fontWeight: 600 }}>
              TO CONFIRM
            </div>
          </div>
        )}
      </div>

      {/* Reference card status banner */}
      <div
        className={`rounded p-3 mb-6 text-sm ${
          referenceCardDetected
            ? 'bg-tq-confirmed/10 border border-tq-confirmed/30 text-tq-confirmed'
            : 'bg-tq-unconfirmed/10 border border-tq-unconfirmed/30 text-tq-unconfirmed'
        }`}
      >
        {referenceCardDetected
          ? '✓ Reference card detected — measurements calculated from known dimensions'
          : '⚠ No reference card detected — all measurements require on-site verification before the quote is issued'}
      </div>

      {/* Desktop: two column layout — costs column wider for materials table.
          Three columns cramped everything at typical laptop widths (~1200px), so
          Schedule of Works now stacks under Measurements in the left column. */}
      <div className="hidden fq:grid gap-6" style={{ gridTemplateColumns: '1fr 1.25fr' }}>
        <div className="space-y-6">{transcriptContent}{damageDescriptionContent}{measurementsContent}{scheduleContent}</div>
        <div>{costsContent}</div>
      </div>

      {/* Mobile: accordion — reordered for field usability */}
      <div className="fq:hidden space-y-3">
        <AccordionSection
          title="Measurements"
          isOpen={openSections.measurements}
          onToggle={() => toggleSection('measurements')}
        >
          {measurementsContent}
        </AccordionSection>

        {/* Duplicate Generate Quote CTA — mobile only */}
        <button
          disabled={!generateEnabled}
          onClick={() => dispatch({ type: 'GENERATE_QUOTE' })}
          className={`w-full ${generateEnabled ? 'btn-primary' : 'btn-ghost'}`}
          style={{
            opacity: generateEnabled ? 1 : 0.6,
            cursor: generateEnabled ? 'pointer' : 'not-allowed',
          }}
        >
          {generateEnabled
            ? 'GENERATE QUOTE \u2192'
            : unconfirmedCount > 0
              ? `CONFIRM ${unconfirmedCount} MEASUREMENT${unconfirmedCount !== 1 ? 'S' : ''} TO CONTINUE`
              : 'COMPLETE ALL SECTIONS TO CONTINUE'
          }
        </button>

        <AccordionSection
          title="Cost Breakdown"
          isOpen={openSections.costs}
          onToggle={() => toggleSection('costs')}
        >
          {costsContent}
        </AccordionSection>

        <AccordionSection
          title="Schedule of Works"
          isOpen={openSections.schedule}
          onToggle={() => toggleSection('schedule')}
        >
          {scheduleContent}
        </AccordionSection>

        <AccordionSection
          title="Damage Description"
          isOpen={openSections.damage}
          onToggle={() => toggleSection('damage')}
        >
          {damageDescriptionContent}
        </AccordionSection>

        {transcriptContent}
      </div>

      {/* Live Preview */}
      <LivePreview state={state} dispatch={dispatch} />

      {/* Generate Quote CTA — sticky bar */}
      <div
        className="sticky bottom-0 mt-8 py-4 flex items-center justify-end gap-3"
        style={{ backgroundColor: 'var(--tq-bg)', borderTop: '1px solid var(--tq-border)' }}
      >
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
            className="btn-ghost"
          >
            Save Progress
          </button>
        )}
        <button
          disabled={!generateEnabled}
          onClick={() => dispatch({ type: 'GENERATE_QUOTE' })}
          className={generateEnabled ? 'btn-primary' : 'btn-ghost'}
          style={{
            fontSize: 16,
            padding: '12px 40px',
            opacity: generateEnabled ? 1 : 0.6,
            cursor: generateEnabled ? 'pointer' : 'not-allowed',
          }}
        >
          {generateEnabled
            ? 'GENERATE QUOTE \u2192'
            : unconfirmedCount > 0
              ? `CONFIRM ${unconfirmedCount} MEASUREMENT${unconfirmedCount !== 1 ? 'S' : ''} FIRST`
              : !materials || materials.length === 0
                ? 'ADD MATERIALS TO CONTINUE'
                : !labour.days || labour.days <= 0
                  ? 'ADD LABOUR DAYS TO CONTINUE'
                  : !labour.dayRate || labour.dayRate <= 0
                    ? 'SET DAY RATE TO CONTINUE'
                    : 'COMPLETE ALL SECTIONS'
          }
        </button>
      </div>
    </div>
  );
}
