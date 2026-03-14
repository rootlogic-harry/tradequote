const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateProfile(profile) {
  const errors = {};

  if (!profile.companyName?.trim()) errors.companyName = 'Company name is required';
  if (!profile.fullName?.trim()) errors.fullName = 'Full name is required';
  if (!profile.phone?.trim()) errors.phone = 'Phone number is required';

  if (!profile.email?.trim()) {
    errors.email = 'Email is required';
  } else if (!EMAIL_REGEX.test(profile.email)) {
    errors.email = 'Invalid email format';
  }

  if (!profile.address?.trim()) errors.address = 'Address is required';

  if (!profile.dayRate || isNaN(profile.dayRate) || profile.dayRate <= 0) {
    errors.dayRate = 'Day rate must be a positive number';
  }

  if (profile.vatRegistered && !profile.vatNumber?.trim()) {
    errors.vatNumber = 'VAT number is required when VAT registered';
  }

  if (!profile.apiKey?.trim()) errors.apiKey = 'Anthropic API key is required';

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateJobDetails(jobDetails) {
  const errors = {};

  if (!jobDetails.clientName?.trim()) errors.clientName = 'Client name is required';
  if (!jobDetails.siteAddress?.trim()) errors.siteAddress = 'Site address is required';
  if (!jobDetails.quoteReference?.trim()) errors.quoteReference = 'Quote reference is required';
  if (!jobDetails.quoteDate?.trim()) errors.quoteDate = 'Quote date is required';

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateRequiredPhotoSlots(photos) {
  const requiredSlots = ['overview', 'closeup'];
  const missingSlots = requiredSlots.filter(slot => !photos[slot]);

  return {
    valid: missingSlots.length === 0,
    missingSlots,
    hasReferenceCard: !!photos.referenceCard,
  };
}

export function allMeasurementsConfirmed(measurements) {
  return measurements.every(m => m.confirmed === true);
}

export function countUnconfirmedMeasurements(measurements) {
  return measurements.filter(m => !m.confirmed).length;
}

export function canGenerateQuote(measurements, materials, labour) {
  if (!allMeasurementsConfirmed(measurements)) return false;
  if (!materials || materials.length === 0) return false;
  if (!labour.days || labour.days <= 0) return false;
  if (!labour.dayRate || labour.dayRate <= 0) return false;
  return true;
}
