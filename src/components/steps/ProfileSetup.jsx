import React, { useState } from 'react';
import { validateProfile } from '../../utils/validators.js';
import { DEFAULT_DAY_RATE } from '../../constants.js';
import ReferralPanel from '../ReferralPanel.jsx';

export default function ProfileSetup({
  state,
  dispatch,
  isModal,
  onClose,
  onProfileComplete,
  onLogout,
  currentUserId,
  userName,
  showToast,
}) {
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
          <h2 className="page-title mb-1">
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
            onBlur={(e) => update('companyName', e.target.value)}
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
            onBlur={(e) => update('fullName', e.target.value)}
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
            onBlur={(e) => update('phone', e.target.value)}
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
            onBlur={(e) => update('email', e.target.value)}
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
            onBlur={(e) => {
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
          {/*
            Logo upload — visually-hidden file input behind a label
            styled as a 44px-tall button. The default file picker
            renders a sub-44px pill that's visually inconsistent with
            every other CTA in the form (audit #18, PR-9). The label
            element forwards the click to the native file input, so
            screen readers + keyboard users + mobile tap all reach the
            picker without any JS bridge.
          */}
          <div className="flex items-center gap-3">
            {profile.logo && (
              <img src={profile.logo} alt="Logo" className="w-12 h-12 object-contain border border-tq-border" style={{ borderRadius: 2 }} />
            )}
            <label
              className="btn-ghost cursor-pointer touch-44 inline-flex items-center"
              style={{ minHeight: 44 }}
            >
              {profile.logo ? 'Change logo' : 'Upload logo'}
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoUpload}
                className="sr-only"
                aria-label="Upload company logo"
                data-touch-exempt="true"
              />
            </label>
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
            onBlur={(e) => update('accreditations', e.target.value)}
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
            onBlur={(e) => update('dayRate', parseFloat(e.target.value) || 0)}
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
              onBlur={(e) => update('vatNumber', e.target.value)}
            />
            {errors.vatNumber && <p className="text-tq-error text-xs mt-1">{errors.vatNumber}</p>}
          </div>
        )}
      </div>

      {/* Your trade — preferences that tell the system who you are and
          how you work. Drives prompt context per analysis: region (for
          local style + access assumptions, NOT pricing), preferred
          stone types (tiebreaker when stone is ambiguous from photos),
          and mortar usage (strong prior for whether mortar belongs
          in the materials list). Photos always win — these are priors,
          not vetoes. (Profile-aware prompting, 2026-06-02.) */}
      <div className="eyebrow mb-3">Your Trade</div>
      <p className="text-xs mb-3" style={{ color: 'var(--tq-muted)' }}>
        Optional. Helps tailor your quotes to how you work. You can leave any of these blank and update later.
      </p>
      <div className="mb-8 grid grid-cols-1 fq:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Region or postcode area
          </label>
          <input
            type="text"
            autoComplete="off"
            placeholder="e.g. West Yorkshire, BD12, Lake District"
            className={fieldClass('region')}
            value={profile.region || ''}
            onChange={(e) => update('region', e.target.value)}
            onBlur={(e) => update('region', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Mortar usage
          </label>
          <div className="flex gap-2" role="radiogroup" aria-label="Mortar usage">
            {[
              { key: 'rarely',    label: 'Rarely',    sub: 'mostly dry-laid' },
              { key: 'sometimes', label: 'Sometimes', sub: 'mixed' },
              { key: 'often',     label: 'Often',     sub: 'mortared specs common' },
            ].map((opt) => {
              const selected = profile.mortarUsage === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => update('mortarUsage', selected ? null : opt.key)}
                  className="flex-1 p-2 text-sm rounded transition-colors"
                  style={{
                    border: `1.5px solid ${selected ? 'var(--tq-accent)' : 'var(--tq-border)'}`,
                    background: selected ? 'var(--tq-accent-bg)' : 'transparent',
                    color: 'var(--tq-text)',
                    minHeight: 48,
                  }}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-xs" style={{ color: 'var(--tq-muted)' }}>{opt.sub}</div>
                </button>
              );
            })}
          </div>
        </div>
        <div className="fq:col-span-2">
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Typical stone types
          </label>
          <div className="flex flex-wrap gap-2">
            {['gritstone', 'sandstone', 'limestone', 'slate', 'granite'].map((stone) => {
              const list = Array.isArray(profile.preferredStoneTypes) ? profile.preferredStoneTypes : [];
              const selected = list.includes(stone);
              return (
                <button
                  key={stone}
                  type="button"
                  onClick={() => {
                    const next = selected
                      ? list.filter((s) => s !== stone)
                      : [...list, stone];
                    update('preferredStoneTypes', next);
                  }}
                  aria-pressed={selected}
                  className="px-3 py-2 text-sm rounded-full transition-colors"
                  style={{
                    border: `1.5px solid ${selected ? 'var(--tq-accent)' : 'var(--tq-border)'}`,
                    background: selected ? 'var(--tq-accent-bg)' : 'transparent',
                    color: 'var(--tq-text)',
                    minHeight: 40,
                    textTransform: 'capitalize',
                  }}
                >
                  {stone}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Quote preferences */}
      <div className="eyebrow mb-3">Quote Preferences</div>
      <div className="mb-8 flex flex-col gap-3">
        <label className="flex items-center gap-2 cursor-pointer" style={{ minHeight: 48 }}>
          <input
            type="checkbox"
            checked={profile.showNotesOnQuote !== false}
            onChange={(e) => update('showNotesOnQuote', e.target.checked)}
            className="w-5 h-5 accent-tq-accent"
          />
          <span className="text-sm text-tq-text">Show Notes & Conditions on quotes</span>
        </label>
        <label className="flex items-start gap-2 cursor-pointer" style={{ minHeight: 48 }}>
          <input
            type="checkbox"
            checked={profile.hideLabourDays === true}
            onChange={(e) => update('hideLabourDays', e.target.checked)}
            className="w-5 h-5 accent-tq-accent mt-0.5"
          />
          <span className="text-sm text-tq-text">
            Hide labour days from the customer's quote
            <span className="block text-xs mt-0.5" style={{ color: 'var(--tq-muted)' }}>
              You still see the full breakdown when editing. The customer sees only the labour total.
            </span>
          </span>
        </label>
      </div>

      {/* Document type — some tradesmen send "Quotes" (fixed prices),
           others send "Estimates" (approximate figures confirmed on
           site). Choose once; every quote-like surface the client sees
           uses the chosen term. */}
      <div className="eyebrow mb-3">Document Type</div>
      <p className="text-xs mb-3" style={{ color: 'var(--tq-muted)' }}>
        What do you call the document your clients receive?
      </p>
      <div className="mb-8 flex gap-2" role="radiogroup" aria-label="Document type">
        {[
          { key: 'quote',    label: 'Quote' },
          { key: 'estimate', label: 'Estimate' },
        ].map((opt) => {
          const selected = (profile.documentType || 'quote') === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => update('documentType', opt.key)}
              data-document-type-option={opt.key}
              className="flex-1 px-4 py-3 rounded transition-all"
              style={{
                border: `2px solid ${selected ? 'var(--tq-accent)' : 'var(--tq-border)'}`,
                background: selected ? 'var(--tq-accent-bg, rgba(217,119,6,0.08))' : 'transparent',
                color: selected ? 'var(--tq-accent)' : 'var(--tq-muted)',
                fontFamily: 'Barlow Condensed, sans-serif',
                fontWeight: 700,
                fontSize: 14,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                cursor: 'pointer',
                minHeight: 48,
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      {/* Portal accent — tints the client-facing quote link's CTA and
           total-box. Four values: amber (default) / rust / moss / slate. */}
      <div className="eyebrow mb-3">Quote Accent Colour</div>
      <p className="text-xs mb-3" style={{ color: 'var(--tq-muted)' }}>
        Tints the colour of the client link you share. Choose what matches your brand.
      </p>
      <div className="mb-8 flex flex-wrap gap-3" role="radiogroup" aria-label="Quote accent colour">
        {[
          { key: 'amber', label: 'Amber', hex: '#c4610a' },
          { key: 'rust',  label: 'Rust',  hex: '#a33d1c' },
          { key: 'moss',  label: 'Moss',  hex: '#4c6b2e' },
          { key: 'slate', label: 'Slate', hex: '#2f4557' },
        ].map((swatch) => {
          const selected = (profile.accent || 'amber') === swatch.key;
          return (
            <button
              key={swatch.key}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={swatch.label}
              onClick={() => update('accent', swatch.key)}
              data-accent-swatch={swatch.key}
              className="flex flex-col items-center gap-2 p-2 rounded transition-all"
              style={{
                minWidth: 64,
                minHeight: 72,
                border: `2px solid ${selected ? swatch.hex : 'var(--tq-border)'}`,
                background: selected ? `${swatch.hex}12` : 'transparent',
                cursor: 'pointer',
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 4,
                  background: swatch.hex,
                  boxShadow: selected ? `0 0 0 2px ${swatch.hex}40` : 'none',
                }}
              />
              <span className="text-xs font-heading uppercase tracking-wide" style={{ color: 'var(--tq-muted)' }}>
                {swatch.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Referrals Phase 1 (2026-06-23) — referrer surface, relocated
          from Dashboard to Profile on 2026-06-25 (Harry's ask). Lives
          here because it's personal configuration (your code, your
          share link, your bonus balance), not a quote-management tool.
          The panel self-hides while loading and if the user has no
          code yet, so it gracefully omits itself for the first-run
          Step 1 mount where currentUserId may not yet be set. */}
      <ReferralPanel
        currentUserId={currentUserId}
        userName={userName}
        showToast={showToast}
      />

      {!isModal && (
        <p className="text-xs leading-relaxed mb-4" style={{ color: 'var(--tq-muted)' }}>
          By continuing, you agree that your quoting data (including edits,
          feedback, and completed job outcomes) may be used to improve system
          accuracy and is visible to account administrators.
        </p>
      )}

      {/*
        Sticky save bar \u2014 on mobile (<fq), sit above the fixed 64px
        BottomNav and respect any iOS safe-area inset (home-indicator).
        On desktop (>=fq) the BottomNav is hidden so bottom returns to 0.
        Mirrors the ReviewEdit sticky-CTA pattern (TRQ-172) \u2014 without
        this, the Save button on Step 1 can overlap the BottomNav and
        sit under the iOS home indicator. Inside the modal mount the
        save bar is non-sticky (the modal scrolls internally), so the
        adjustment is only applied to the full-page Step 1 mount.
      */}
      <div
        className={`${isModal ? 'mt-4' : 'sticky bottom-[calc(env(safe-area-inset-bottom)+64px)] fq:bottom-0 py-4'} flex justify-end`}
        style={isModal ? {} : { backgroundColor: 'var(--tq-bg)', borderTop: '1px solid var(--tq-border)' }}
      >
        <button onClick={handleSave} className="btn-primary">
          {isModal ? 'Save Changes' : 'Save Profile & Continue \u2192'}
        </button>
      </div>

      {/* TRQ-170: Sign-out affordance for the mobile profile modal.
          BottomNav has Home / New / Quotes / Profile; tapping Profile
          opens this modal. Without this link mobile users have no way
          to log out (Sidebar's logout is desktop-only \u2265900px).
          Gated by `isModal && onLogout` so:
            - the full-page Step 1 onboarding mount (no onLogout) stays
              clean for first-run users with nothing to log out of yet;
            - any future modal mount can opt out by omitting the prop. */}
      {isModal && onLogout && (
        <div className="mt-6 pt-4 border-t border-tq-border flex justify-center">
          <button
            type="button"
            onClick={onLogout}
            className="text-sm underline transition-colors"
            style={{ color: 'var(--tq-muted)', minHeight: 44 }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
