import { RISK_LEVELS } from '../data/ramsConstants.js';

export function calculateRiskRating(likelihood, consequence) {
  return likelihood * consequence;
}

export function getRiskLevel(rating) {
  for (const level of RISK_LEVELS) {
    if (rating <= level.max) {
      return { label: level.label, color: level.color };
    }
  }
  const last = RISK_LEVELS[RISK_LEVELS.length - 1];
  return { label: last.label, color: last.color };
}

export function calculateRamsCompletion(rams) {
  if (!rams) return 0;

  const checks = [
    () => !!rams.siteAddress,
    () => !!rams.company,
    () => !!rams.client,
    () => !!rams.foreman,
    () => !!rams.commencementDate,
    () => !!rams.projectedCompletionDate,
    () => rams.workTypes?.length > 0,
    () => rams.workStages?.length > 0,
    () => rams.riskAssessments?.length > 0,
    () => rams.ppeRequirements?.length > 0,
    () => !!rams.contactName,
    () => !!rams.contactNumber,
    () => !!rams.workplaceAccess,
    () => !!rams.workplaceLighting,
    () => !!rams.wasteManagement,
  ];

  const passed = checks.filter(fn => fn()).length;
  return Math.round((passed / checks.length) * 100);
}

export function generateRamsId() {
  return `rams-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
