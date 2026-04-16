const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateProfile(profile) {
  const errors = {};

  if (!profile.fullName?.trim()) errors.fullName = 'Enter your full name so clients know who quoted';
  if (!profile.phone?.trim()) errors.phone = 'Enter a phone number so clients can reach you';

  if (!profile.email?.trim()) {
    errors.email = 'Enter your email address';
  } else if (!EMAIL_REGEX.test(profile.email)) {
    errors.email = 'Check your email — it should look like name@example.com';
  }

  if (!profile.address?.trim()) errors.address = 'Enter your business address for the quote header';

  if (!profile.dayRate || isNaN(profile.dayRate) || profile.dayRate <= 0) {
    errors.dayRate = 'Enter your day rate (e.g. 400)';
  }

  if (profile.vatRegistered && !profile.vatNumber?.trim()) {
    errors.vatNumber = 'Enter your VAT number — required when VAT registered';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function validateJobDetails(jobDetails) {
  const errors = {};

  if (!jobDetails.clientName?.trim()) errors.clientName = 'Enter the client or landowner name';
  if (!jobDetails.siteAddress?.trim()) errors.siteAddress = 'Enter the site address so the quote is location-specific';

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
