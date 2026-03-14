import { calculateAllTotals } from './calculations.js';
import { calculateAIAccuracyScore, enrichDiffWithContext } from './diffTracking.js';

export function generateQuoteReference(year, sequenceNumber) {
  return `QT-${year}-${String(sequenceNumber).padStart(4, '0')}`;
}

export function formatCurrency(amount) {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (amount < 0) return `-£${formatted}`;
  return `£${formatted}`;
}

export function formatDate(isoDate) {
  const [yearStr, monthStr, dayStr] = isoDate.split('-');
  const day = parseInt(dayStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;
  const year = parseInt(yearStr, 10);

  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  const suffix = getOrdinalSuffix(day);
  return `${day}${suffix} ${months[monthIndex]} ${year}`;
}

function getOrdinalSuffix(day) {
  if (day >= 11 && day <= 13) return 'th';
  const lastDigit = day % 10;
  if (lastDigit === 1) return 'st';
  if (lastDigit === 2) return 'nd';
  if (lastDigit === 3) return 'rd';
  return 'th';
}

export function calculateValidUntil(isoDate) {
  const date = new Date(isoDate + 'T00:00:00');
  date.setDate(date.getDate() + 30);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function buildDiffsPayload(diffs, context) {
  return diffs.map(diff => enrichDiffWithContext(diff, context));
}

export function buildQuotePayload(profile, jobDetails, reviewData, diffs) {
  const labour = {
    days: reviewData.labourEstimate.estimatedDays,
    workers: reviewData.labourEstimate.numberOfWorkers,
    dayRate: reviewData.labourEstimate.dayRate || profile.dayRate,
  };

  const totals = calculateAllTotals(
    reviewData.materials,
    labour,
    reviewData.additionalCosts || [],
    profile.vatRegistered,
  );

  const context = {
    referenceCardUsed: reviewData.referenceCardDetected,
    stoneType: reviewData.stoneType,
  };

  const enrichedDiffs = buildDiffsPayload(diffs, context);
  const aiAccuracyScore = calculateAIAccuracyScore(diffs);

  return {
    profile,
    jobDetails,
    quote: {
      damageDescription: reviewData.damageDescription,
      measurements: reviewData.measurements,
      scheduleOfWorks: reviewData.scheduleOfWorks,
      materials: reviewData.materials,
      labourEstimate: reviewData.labourEstimate,
      additionalCosts: reviewData.additionalCosts || [],
      siteConditions: reviewData.siteConditions,
      validUntil: calculateValidUntil(jobDetails.quoteDate),
      aiRawResponse: reviewData.aiRawResponse,
    },
    totals,
    diffs: enrichedDiffs,
    aiAccuracyScore,
  };
}
