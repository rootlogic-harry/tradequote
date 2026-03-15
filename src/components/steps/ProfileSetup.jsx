import React, { useState } from 'react';
import { validateProfile } from '../../utils/validators.js';
import { DEFAULT_DAY_RATE } from '../../constants.js';

export default function ProfileSetup({ state, dispatch, isModal, onClose, onProfileComplete }) {
  const [errors, setErrors] = useState({});
  const { profile } = state;

  const update = (field, value) => {
    dispatch({ type: 'UPDATE_PROFILE', updates: { [field]: value } });
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => update('logo', reader.result);
    reader.readAsDataURL(file);
  };

  const handleSave = () => {
    const result = validateProfile(profile);
    setErrors(result.errors);
    if (result.valid) {
      if (isModal && onClose) {
        onClose();
      } else if (onProfileComplete) {
        onProfileComplete();
      } else {
        dispatch({ type: 'SET_STEP', step: 2 });
      }
    }
  };

  const inputClass = (field) =>
    `w-full h-10 bg-tq-card border-1.5 ${
      errors[field] ? 'border-tq-error' : 'border-tq-border'
    } rounded px-3 py-2.5 text-tq-text font-body text-sm focus:outline-none focus:border-tq-accent`;

  return (
    <div className={isModal ? '' : 'max-w-2xl mx-auto'}>
      {!isModal && (
        <>
          <h2 className="text-2xl font-heading font-bold text-tq-accent mb-1">
            Profile Setup
          </h2>
          <p className="text-tq-muted text-sm mb-6">
            Enter your business details. These appear on every quote.
          </p>
        </>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Company Name *
          </label>
          <input
            className={inputClass('companyName')}
            value={profile.companyName}
            onChange={(e) => update('companyName', e.target.value)}
          />
          {errors.companyName && <p className="text-tq-error text-xs mt-1">{errors.companyName}</p>}
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Full Name *
          </label>
          <input
            className={inputClass('fullName')}
            value={profile.fullName}
            onChange={(e) => update('fullName', e.target.value)}
          />
          {errors.fullName && <p className="text-tq-error text-xs mt-1">{errors.fullName}</p>}
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Phone *
          </label>
          <input
            className={inputClass('phone')}
            value={profile.phone}
            onChange={(e) => update('phone', e.target.value)}
          />
          {errors.phone && <p className="text-tq-error text-xs mt-1">{errors.phone}</p>}
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Email *
          </label>
          <input
            type="email"
            className={inputClass('email')}
            value={profile.email}
            onChange={(e) => update('email', e.target.value)}
          />
          {errors.email && <p className="text-tq-error text-xs mt-1">{errors.email}</p>}
        </div>

        <div className="sm:col-span-2">
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Business Address *
          </label>
          <textarea
            className={inputClass('address')}
            rows={2}
            value={profile.address}
            onChange={(e) => update('address', e.target.value)}
          />
          {errors.address && <p className="text-tq-error text-xs mt-1">{errors.address}</p>}
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Company Logo
          </label>
          <div className="flex items-center gap-3">
            {profile.logo && (
              <img src={profile.logo} alt="Logo" className="w-12 h-12 object-contain rounded border border-tq-border" />
            )}
            <input
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="text-sm text-tq-muted file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-sm file:font-body file:bg-tq-card file:text-tq-text hover:file:bg-tq-border"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Day Rate (£) *
          </label>
          <input
            type="number"
            className={inputClass('dayRate')}
            value={profile.dayRate}
            onChange={(e) => update('dayRate', parseFloat(e.target.value) || 0)}
          />
          {errors.dayRate && <p className="text-tq-error text-xs mt-1">{errors.dayRate}</p>}
        </div>

        <div className="sm:col-span-2 flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={profile.vatRegistered}
              onChange={(e) => update('vatRegistered', e.target.checked)}
              className="w-4 h-4 accent-tq-accent"
            />
            <span className="text-sm text-tq-text">VAT Registered</span>
          </label>
        </div>

        {profile.vatRegistered && (
          <div className="sm:col-span-2">
            <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
              VAT Number *
            </label>
            <input
              className={inputClass('vatNumber')}
              value={profile.vatNumber}
              onChange={(e) => update('vatNumber', e.target.value)}
            />
            {errors.vatNumber && <p className="text-tq-error text-xs mt-1">{errors.vatNumber}</p>}
          </div>
        )}

        <div className="sm:col-span-2">
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Accreditations
          </label>
          <input
            className={inputClass('accreditations')}
            value={profile.accreditations}
            onChange={(e) => update('accreditations', e.target.value)}
            placeholder="e.g. DSWA Professional Member"
          />
        </div>

      </div>

      <div className="mt-6 flex justify-end">
        <button
          onClick={handleSave}
          className="bg-tq-accent hover:bg-tq-accent-dark text-tq-bg font-heading font-bold uppercase tracking-wide px-8 py-3 rounded transition-colors"
        >
          {isModal ? 'Save Changes' : 'Save Profile & Continue'}
        </button>
      </div>
    </div>
  );
}
