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

  const fieldClass = (field) =>
    `nq-field ${errors[field] ? '!border-tq-error' : ''}`;

  return (
    <div className={isModal ? '' : 'max-w-2xl mx-auto'}>
      {!isModal && (
        <>
          <h2 className="page-title mb-1" style={{ fontSize: 32 }}>
            Profile Setup
          </h2>
          <p className="text-sm mb-6" style={{ color: 'var(--tq-muted)' }}>
            Enter your business details. These appear on every quote.
          </p>
        </>
      )}

      {/* Company section */}
      <div className="eyebrow mb-3">Company</div>
      <div className="grid grid-cols-1 fq:grid-cols-2 gap-4 mb-8">
        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Company Name
          </label>
          <input
            type="text"
            autoComplete="organization"
            enterKeyHint="next"
            placeholder="e.g. Doyle Stone Works"
            className={fieldClass('companyName')}
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
            type="text"
            autoComplete="name"
            enterKeyHint="next"
            placeholder="e.g. Mark Doyle"
            className={fieldClass('fullName')}
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
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            enterKeyHint="next"
            placeholder="e.g. 07700 900123"
            className={fieldClass('phone')}
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
            inputMode="email"
            autoComplete="email"
            enterKeyHint="next"
            placeholder="e.g. mark@doylestone.co.uk"
            className={fieldClass('email')}
            value={profile.email}
            onChange={(e) => update('email', e.target.value)}
          />
          {errors.email && <p className="text-tq-error text-xs mt-1">{errors.email}</p>}
        </div>

        <div className="fq:col-span-2">
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Business Address *
          </label>
          <textarea
            autoComplete="street-address"
            placeholder="e.g. 12 High Street, Skipton, BD23 1JD"
            className={fieldClass('address')}
            rows={2}
            value={profile.address}
            onChange={(e) => {
              update('address', e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = e.target.scrollHeight + 'px';
            }}
            style={{ overflow: 'hidden', resize: 'none', height: 'auto' }}
          />
          {errors.address && <p className="text-tq-error text-xs mt-1">{errors.address}</p>}
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Company Logo
          </label>
          <div className="flex items-center gap-3">
            {profile.logo && (
              <img src={profile.logo} alt="Logo" className="w-12 h-12 object-contain border border-tq-border" style={{ borderRadius: 2 }} />
            )}
            <input
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="text-sm text-tq-muted file:mr-3 file:py-1.5 file:px-3 file:border-0 file:text-sm file:font-body file:bg-tq-card file:text-tq-text hover:file:bg-tq-border"
              style={{ borderRadius: 2 }}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Accreditations
          </label>
          <input
            type="text"
            autoComplete="off"
            enterKeyHint="done"
            className={fieldClass('accreditations')}
            value={profile.accreditations}
            onChange={(e) => update('accreditations', e.target.value)}
            placeholder="e.g. DSWA Professional Member"
          />
        </div>
      </div>

      {/* Rates & Tax section */}
      <div className="eyebrow mb-3">Rates & Tax</div>
      <div className="grid grid-cols-1 fq:grid-cols-2 gap-4 mb-8">
        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Day Rate ({'\u00A3'}) *
          </label>
          <input
            type="text"
            inputMode="decimal"
            enterKeyHint="done"
            placeholder="e.g. 400"
            className={fieldClass('dayRate')}
            value={profile.dayRate}
            onChange={(e) => update('dayRate', parseFloat(e.target.value) || 0)}
          />
          {errors.dayRate && <p className="text-tq-error text-xs mt-1">{errors.dayRate}</p>}
        </div>

        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 cursor-pointer" style={{ minHeight: 48 }}>
            <input
              type="checkbox"
              checked={profile.vatRegistered}
              onChange={(e) => update('vatRegistered', e.target.checked)}
              className="w-5 h-5 accent-tq-accent"
            />
            <span className="text-sm text-tq-text">VAT Registered</span>
          </label>
        </div>

        {profile.vatRegistered && (
          <div className="fq:col-span-2">
            <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
              VAT Number *
            </label>
            <input
              type="text"
              autoComplete="off"
              enterKeyHint="done"
              placeholder="e.g. GB123456789"
              className={fieldClass('vatNumber')}
              value={profile.vatNumber}
              onChange={(e) => update('vatNumber', e.target.value)}
            />
            {errors.vatNumber && <p className="text-tq-error text-xs mt-1">{errors.vatNumber}</p>}
          </div>
        )}
      </div>

      {/* Quote preferences */}
      <div className="eyebrow mb-3">Quote Preferences</div>
      <div className="mb-8">
        <label className="flex items-center gap-2 cursor-pointer" style={{ minHeight: 48 }}>
          <input
            type="checkbox"
            checked={profile.showNotesOnQuote !== false}
            onChange={(e) => update('showNotesOnQuote', e.target.checked)}
            className="w-5 h-5 accent-tq-accent"
          />
          <span className="text-sm text-tq-text">Show Notes & Conditions on quotes</span>
        </label>
      </div>

      {!isModal && (
        <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--tq-muted)' }}>
          By continuing, you agree that your quoting data (including edits,
          feedback, and completed job outcomes) may be used to improve system
          accuracy and is visible to account administrators.
        </p>
      )}

      {/* Sticky save bar */}
      <div
        className={`${isModal ? 'mt-4' : 'sticky bottom-0 py-4'} flex justify-end`}
        style={isModal ? {} : { backgroundColor: 'var(--tq-bg)', borderTop: '1px solid var(--tq-border)' }}
      >
        <button onClick={handleSave} className="btn-primary">
          {isModal ? 'Save Changes' : 'Save Profile & Continue \u2192'}
        </button>
      </div>
    </div>
  );
}
