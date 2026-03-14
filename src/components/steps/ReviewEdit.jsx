import React, { useState } from 'react';
import MeasurementRow from '../review/MeasurementRow.jsx';
import MaterialsTable from '../review/MaterialsTable.jsx';
import LabourSection from '../review/LabourSection.jsx';
import ScheduleList from '../review/ScheduleList.jsx';
import LivePreview from '../review/LivePreview.jsx';
import { allMeasurementsConfirmed, countUnconfirmedMeasurements, canGenerateQuote } from '../../utils/validators.js';
import { calculateAllTotals } from '../../utils/calculations.js';
import { formatCurrency } from '../../utils/quoteBuilder.js';

function AccordionSection({ title, isOpen, onToggle, children }) {
  return (
    <div className="border border-tq-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full bg-tq-card px-4 py-3 flex items-center justify-between text-left"
      >
        <span className="font-heading font-bold text-tq-text">{title}</span>
        <span className={`text-tq-muted transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          &#9660;
        </span>
      </button>
      {isOpen && (
        <div className="px-4 py-4 border-t border-tq-border">
          {children}
        </div>
      )}
    </div>
  );
}

export default function ReviewEdit({ state, dispatch }) {
  const { reviewData, profile } = state;
  const [openSections, setOpenSections] = useState({
    damage: true,
    schedule: false,
    costs: false,
  });

  if (!reviewData) {
    return (
      <div className="text-center py-20">
        <p className="text-tq-muted">No analysis data available.</p>
        <button
          onClick={() => dispatch({ type: 'SET_STEP', step: 2 })}
          className="mt-4 px-6 py-2 bg-tq-accent text-tq-bg rounded font-heading uppercase"
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

  const toggleSection = (key) => {
    setOpenSections(prev => ({ ...prev, [key]: !prev[key] }));
  };

  // Extracted content blocks shared between desktop and mobile
  const damageContent = (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-heading font-bold text-tq-text mb-2">
          Damage Description
        </h3>
        <textarea
          value={damageDescription}
          onChange={(e) =>
            dispatch({ type: 'UPDATE_DAMAGE_DESCRIPTION', value: e.target.value })
          }
          rows={5}
          className="w-full bg-tq-card border border-tq-border rounded px-3 py-2 text-sm text-tq-text focus:outline-none focus:border-tq-accent resize-none"
        />
      </div>

      <div>
        <h3 className="text-lg font-heading font-bold text-tq-text mb-2">
          Measurements
          {unconfirmedCount > 0 && (
            <span className="text-tq-unconfirmed text-sm font-body ml-2">
              ({unconfirmedCount} to confirm)
            </span>
          )}
        </h3>

        {/* Desktop: table */}
        <div className="overflow-x-auto hidden sm:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-tq-border text-tq-muted text-xs">
                <th className="text-left px-3 py-1">Item</th>
                <th className="text-left px-3 py-1">AI Value</th>
                <th className="text-left px-3 py-1">Your Value</th>
                <th className="text-center px-3 py-1">Status</th>
                <th className="text-right px-3 py-1">Action</th>
              </tr>
            </thead>
            <tbody>
              {measurements.map((m) => (
                <MeasurementRow
                  key={m.id}
                  measurement={m}
                  dispatch={dispatch}
                  variant="row"
                />
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: cards */}
        <div className="sm:hidden space-y-3">
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
        <h4 className="font-heading font-bold text-sm text-tq-muted uppercase tracking-wide mb-2">
          Additional Costs
        </h4>
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
          <button onClick={() => addAdditionalCost('Site clearance')} className="text-xs text-tq-accent hover:text-tq-accent-dark px-2 py-1 rounded border border-tq-border">
            + Site clearance
          </button>
          <button onClick={() => addAdditionalCost()} className="text-xs text-tq-accent hover:text-tq-accent-dark">
            + Add cost
          </button>
        </div>
      </div>

      <LabourSection labourEstimate={labourEstimate} dispatch={dispatch} />

      {/* Financial Summary */}
      <div className="bg-tq-card border border-tq-border rounded p-4">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-tq-muted">Materials</span>
            <span className="font-mono">{formatCurrency(totals.materialsSubtotal)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-tq-muted">Labour</span>
            <span className="font-mono">{formatCurrency(totals.labourTotal)}</span>
          </div>
          {totals.additionalCostsTotal > 0 && (
            <div className="flex justify-between">
              <span className="text-tq-muted">Additional costs</span>
              <span className="font-mono">{formatCurrency(totals.additionalCostsTotal)}</span>
            </div>
          )}
          <div className="border-t border-tq-border pt-2 flex justify-between">
            <span className="text-tq-muted">Subtotal (ex VAT)</span>
            <span className="font-mono font-medium">{formatCurrency(totals.subtotal)}</span>
          </div>
          {profile.vatRegistered && (
            <div className="flex justify-between">
              <span className="text-tq-muted">VAT (20%)</span>
              <span className="font-mono">{formatCurrency(totals.vatAmount)}</span>
            </div>
          )}
          <div className="border-t border-tq-border pt-2 flex justify-between text-lg">
            <span className="font-heading font-bold">TOTAL</span>
            <span className="font-mono font-bold text-tq-accent">{formatCurrency(totals.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <h2 className="text-2xl font-heading font-bold text-tq-accent mb-1">
        Review & Edit
      </h2>
      <p className="text-tq-muted text-sm mb-6">
        Review the AI analysis. Confirm or edit every measurement before generating your quote.
      </p>

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

      {/* Desktop: three column layout */}
      <div className="hidden md:grid md:grid-cols-3 gap-6">
        <div>{damageContent}</div>
        <div>{scheduleContent}</div>
        <div>{costsContent}</div>
      </div>

      {/* Mobile: accordion */}
      <div className="md:hidden space-y-3">
        <AccordionSection
          title="Damage & Measurements"
          isOpen={openSections.damage}
          onToggle={() => toggleSection('damage')}
        >
          {damageContent}
        </AccordionSection>

        <AccordionSection
          title="Schedule of Works"
          isOpen={openSections.schedule}
          onToggle={() => toggleSection('schedule')}
        >
          {scheduleContent}
        </AccordionSection>

        <AccordionSection
          title="Cost Breakdown"
          isOpen={openSections.costs}
          onToggle={() => toggleSection('costs')}
        >
          {costsContent}
        </AccordionSection>
      </div>

      {/* Live Preview */}
      <LivePreview state={state} />

      {/* Generate Quote CTA */}
      <div className="mt-8 flex flex-col items-end">
        {!allConfirmed && (
          <p className="text-tq-unconfirmed text-sm mb-2">
            {unconfirmedCount} measurement{unconfirmedCount !== 1 ? 's' : ''} to confirm before generating
          </p>
        )}
        <button
          disabled={!generateEnabled}
          onClick={() => dispatch({ type: 'GENERATE_QUOTE' })}
          className={`font-heading font-bold uppercase tracking-wide px-10 py-3 rounded text-lg transition-colors ${
            generateEnabled
              ? 'bg-tq-accent hover:bg-tq-accent-dark text-tq-bg'
              : 'bg-tq-card text-tq-muted cursor-not-allowed'
          }`}
        >
          Generate Quote
        </button>
      </div>
    </div>
  );
}
