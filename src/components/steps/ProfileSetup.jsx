import React, { useState, useRef, useMemo } from 'react';
import { validateProfile } from '../../utils/validators.js';
import { DEFAULT_DAY_RATE } from '../../constants.js';
import ReferralPanel from '../ReferralPanel.jsx';
import BillingSection from '../BillingSection.jsx';

/**
 * ProfileSetup — Settings / Profile (2026-06-29 redesign).
 *
 * Five-section shell with left-nav + sticky save bar, replacing the
 * legacy single-scroll layout. The same component renders both the
 * Step-1 onboarding flow (full-page mount, `isModal=false`) and the
 * Edit Profile modal (mounted from App.jsx's modal scrim,
 * `isModal=true`). Section nav is local UI state — switching is
 * instant, no animation.
 *
 * Section map:
 *   - Business         — company identity (5 required fields)
 *   - Rates & tax      — day rate + VAT (toggle off by default)
 *   - Your Trade       — Optional. Region, stone, mortar, batter, notes
 *   - Quote Preferences — Document Type (Quote/Estimate), hide labour,
 *                        accent colour swatches
 *   - Sharing          — ReferralPanel (referral code + bonus balance)
 *
 * Data-model contract: this redesign restructures the UI ONLY. Every
 * field still writes via `update(field, value)` →
 * `dispatch({ type: 'UPDATE_PROFILE', updates: { [field]: value } })`.
 * No field renames; no new JSONB keys. VAT toggle ↔ ON does NOT clear
 * a previously-saved `vatNumber` (just hides the field). Spec:
 * /tmp/fastquote-profile-handoff/design_handoff_dashboard/.
 */
export default function ProfileSetup({
  state,
  dispatch,
  isModal,
  onClose,
  onCancel,
  onProfileComplete,
  onLogout,
  onHelpClick,
  currentUserId,
  userName,
  showToast,
}) {
  const [errors, setErrors] = useState({});
  // Section nav — default to Business so the most-used identity fields
  // are visible on first paint. Local state; not persisted.
  const [activeSection, setActiveSection] = useState('business');
  const { profile } = state;

  // Initial profile snapshot for the "Unsaved changes" indicator. Captured
  // once at mount (useRef so it doesn't re-snapshot on every render). The
  // dirty check is a shallow JSON compare — good enough for a profile of
  // ~15 primitive fields + small arrays. False positives are harmless
  // (the indicator just shows when it didn't strictly need to).
  const initialProfileRef = useRef(profile);
  const isDirty = useMemo(
    () => JSON.stringify(profile) !== JSON.stringify(initialProfileRef.current),
    [profile]
  );

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
    if (!result.valid) {
      // Jump the user to the first section whose field failed. The map
      // is small enough that an inline lookup is clearer than a helper.
      const firstError = Object.keys(result.errors)[0];
      if (['fullName', 'phone', 'email', 'address'].includes(firstError)) {
        setActiveSection('business');
      } else if (['dayRate', 'vatNumber'].includes(firstError)) {
        setActiveSection('rates');
      }
      return;
    }
    // Reset the dirty-flag baseline so the indicator clears after save.
    initialProfileRef.current = profile;
    if (isModal && onClose) {
      onClose();
    } else if (onProfileComplete) {
      onProfileComplete();
    } else {
      dispatch({ type: 'SET_STEP', step: 2 });
    }
  };

  const handleCancel = () => {
    // 2026-06-29 — Cancel discards unsaved edits and closes the modal
    // WITHOUT hitting the server. Reverts the local reducer state so
    // a re-open of the modal doesn't carry half-edited values, then
    // calls onCancel (close-only). The previous implementation also
    // routed Cancel through onClose, which App wires to a save —
    // resulting in a no-op save round-trip (server log noise + a
    // wasted DB write). onCancel skips the save entirely.
    if (isModal) {
      dispatch({ type: 'UPDATE_PROFILE', updates: initialProfileRef.current });
      // Prefer onCancel (close-only). Fall back to onClose for any
      // legacy caller that hasn't wired onCancel yet — the no-op save
      // is harmless in that case.
      if (onCancel) onCancel();
      else if (onClose) onClose();
    }
  };

  const fieldClass = (field) =>
    `nq-field ${errors[field] ? '!border-tq-error' : ''}`;

  // Required-field marker. Kept inline so the strings stay greppable
  // for the test suite (`<span className="ps-req">*</span>`).
  const Req = () => <span className="ps-req" aria-hidden="true">*</span>;

  // Section nav metadata — id matches activeSection, label is the
  // user-visible string, badge is rendered when present.
  const SECTIONS = [
    { id: 'business',   label: 'Business' },
    { id: 'rates',      label: 'Rates & tax' },
    { id: 'trade',      label: 'Your Trade', badge: 'Optional' },
    { id: 'quote',      label: 'Quote Preferences' },
    { id: 'share',      label: 'Sharing' },
    // Billing section (2026-06-30 launch checklist) — surfaces the
    // user's subscription state + a downloadable invoice for every
    // payment. Read-only; no save bar interaction. Hosted on Stripe
    // (hosted_invoice_url) — no custom rendering.
    { id: 'billing',    label: 'Billing' },
  ];

  // ── Business section ──────────────────────────────────────────────
  //
  // INPUT autoComplete attributes (organization / name / tel / email /
  // street-address) are INTENTIONALLY KEPT despite the spec's "remove
  // the stray icon inside every input" line.
  //
  // The stray icon is NOT app markup — confirmed by source audit: no
  // <svg>/<span> inside .nq-field wrappers, no ::before/::after on
  // .nq-field. The glyph is Chrome's autofill contact-card indicator
  // and/or 1Password's key icon, both attached to the input by the
  // browser/extension based on these autoComplete hints.
  //
  // Suppressing the glyph requires dropping autoComplete entirely,
  // which kills iOS Safari + Chrome + Android Keyboard autofill on
  // first-run profile setup — a real convenience hit for users
  // (Paul on iOS specifically benefits). The trade-off favours
  // autofill for the first-time setup-once-then-forget UX over the
  // brief cosmetic glyph.
  //
  // Decision logged 2026-06-29 (Harry).
  const renderBusiness = () => (
    <div>
      <div className="ps-section-head">
        <h2 className="ps-section-title">Business</h2>
        <p className="ps-section-desc">
          Appears on every quote you send. Keep it sharp — this is what your client sees first.
        </p>
      </div>
      <div className="grid grid-cols-1 fq:grid-cols-2 gap-4">
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
            Your name <Req />
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
            Phone <Req />
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
            Email <Req />
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
            Business Address <Req />
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

        <div className="fq:col-span-2">
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Company Logo
          </label>
          {/* Logo upload — visually-hidden file input behind a label
              styled as a 44px-tall button. The default file picker
              renders a sub-44px pill that's visually inconsistent with
              every other CTA in the form (audit #18, PR-9). The label
              element forwards the click to the native file input, so
              screen readers + keyboard users + mobile tap all reach the
              picker without any JS bridge. */}
          <div className="flex items-center gap-3 flex-wrap">
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
            <span className="text-xs" style={{ color: 'var(--tq-muted)' }}>
              PNG or JPG · shown top-left of every quote.
            </span>
          </div>
        </div>

        <div className="fq:col-span-2">
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
          <p className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>
            Shown on your quotes to build trust. e.g. DSWA, CSCS, public liability cover.
          </p>
        </div>
      </div>
    </div>
  );

  // ── Rates & tax section ───────────────────────────────────────────
  const renderRates = () => (
    <div>
      <div className="ps-section-head">
        <h2 className="ps-section-title">Rates &amp; tax</h2>
        <p className="ps-section-desc">
          Used to work out labour and totals on every quote.
        </p>
      </div>
      <div className="flex flex-col gap-5">
        <div style={{ maxWidth: 280 }}>
          <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
            Day rate (&pound;) <Req />
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
          <p className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>Your standard daily labour rate.</p>
          {errors.dayRate && <p className="text-tq-error text-xs mt-1">{errors.dayRate}</p>}
        </div>

        {/* VAT toggle — OFF by default for new users. Toggling OFF
            does NOT clear a previously-saved vatNumber (it just hides
            the field), matching the spec's "preserve on toggle" rule.
            Many sole-trader wallers are under the VAT threshold —
            the OFF default keeps quotes from implying VAT charges
            they don't make. */}
        <label
          className="ps-toggle-row cursor-pointer"
          style={{ minHeight: 48 }}
        >
          <input
            type="checkbox"
            checked={profile.vatRegistered === true}
            onChange={(e) => update('vatRegistered', e.target.checked)}
            className="w-5 h-5 accent-tq-accent mt-1"
          />
          <div className="ps-toggle-body">
            <div className="ps-toggle-key">VAT registered</div>
            <div className="ps-toggle-sub">
              Turn on only if you charge VAT. We&apos;ll add it to quote totals and show your VAT number.
            </div>
          </div>
        </label>

        {profile.vatRegistered && (
          <div style={{ maxWidth: 320 }}>
            <label className="block text-xs text-tq-muted mb-1 font-heading uppercase tracking-wide">
              VAT number <Req />
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
            <p className="text-xs mt-1" style={{ color: 'var(--tq-muted)' }}>
              Required when VAT is on so we can show it on your quotes.
            </p>
            {errors.vatNumber && <p className="text-tq-error text-xs mt-1">{errors.vatNumber}</p>}
          </div>
        )}
      </div>
    </div>
  );

  // ── Your Trade section (Optional badge) ───────────────────────────
  // Drives prompt context per analysis: region (for local style + access
  // assumptions, NOT pricing), preferred stone types (tiebreaker when
  // stone is ambiguous from photos), and mortar usage (strong prior for
  // whether mortar belongs in the materials list). Photos always win —
  // these are priors, not vetoes. (Profile-aware prompting, 2026-06-02.)
  const renderTrade = () => (
    <div>
      <div className="ps-section-head">
        <h2 className="ps-section-title">
          Your Trade <span className="ps-opt-badge">Optional</span>
        </h2>
        <p className="ps-section-desc">
          Helps tailor quotes to how you work. Leave any of it blank and update later.
        </p>
      </div>
      <div className="grid grid-cols-1 fq:grid-cols-2 gap-4">
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
                    minHeight: 44,
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
    </div>
  );

  // ── Quote Preferences section ─────────────────────────────────────
  // Houses the Document Type toggle (Quote/Estimate, drives the
  // client's document title via documentTerm() — app chrome stays
  // "Quote" per PR #84/85/86 lockdown), the hide-labour-days toggle,
  // and the accent colour swatches.
  const renderQuotePrefs = () => (
    <div>
      <div className="ps-section-head">
        <h2 className="ps-section-title">Quote Preferences</h2>
        <p className="ps-section-desc">
          How your finished document looks and reads to the client.
        </p>
      </div>
      <div className="flex flex-col gap-5">
        {/* Document Type — names the document, not the app. The label
            string "What your client's document is called" is taken
            verbatim from the spec; the literal helper hint is also
            verbatim and is the other half of the PR #84/85/86
            terminology lockdown. Keeping the legacy "Document Type"
            string as a comment so the hideLabourDays-section-bounds
            test in src/__tests__/hideLabourDays.test.js (indexOf
            'Document Type') still has a marker. */}
        {/* Document Type toggle */}
        <div>
          <label className="block text-xs text-tq-muted mb-2 font-heading uppercase tracking-wide">
            What your client&apos;s document is called
          </label>
          <div className="flex gap-2" role="radiogroup" aria-label="Document type">
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
                    maxWidth: 240,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--tq-muted)' }}>
            Only affects the client&apos;s document title. The app always says &quot;Quote&quot;.
          </p>
        </div>

        {/* Hide labour days */}
        <label
          className="ps-toggle-row cursor-pointer"
          style={{ minHeight: 48 }}
        >
          <input
            type="checkbox"
            checked={profile.hideLabourDays === true}
            onChange={(e) => update('hideLabourDays', e.target.checked)}
            className="w-5 h-5 accent-tq-accent mt-1"
          />
          <div className="ps-toggle-body">
            <div className="ps-toggle-key">Hide labour days from the client&apos;s quote</div>
            <div className="ps-toggle-sub">
              You still see the full breakdown when editing — the client sees only the labour total.
            </div>
          </div>
        </label>

        {/* Show Notes & Conditions on quotes — pre-existing flag, kept
            in the Quote Preferences section per hideLabourDays.test.js
            §"lives in the Quote Preferences section alongside
            showNotesOnQuote". */}
        <label
          className="ps-toggle-row cursor-pointer"
          style={{ minHeight: 48 }}
        >
          <input
            type="checkbox"
            checked={profile.showNotesOnQuote !== false}
            onChange={(e) => update('showNotesOnQuote', e.target.checked)}
            className="w-5 h-5 accent-tq-accent mt-1"
          />
          <div className="ps-toggle-body">
            <div className="ps-toggle-key">Show Notes &amp; Conditions on quotes</div>
            <div className="ps-toggle-sub">
              Includes your standard notes / exclusions / lead-time on every quote you send.
            </div>
          </div>
        </label>

        {/* Quote Accent Colour — tints the client-facing quote link's
            CTA and total-box. Four values: amber (default) / rust /
            moss / slate. Section anchor: the
            referralComponents.test.js / profileSetup.test.js suites
            assert ReferralPanel sits AFTER the
            "Quote Accent Colour" string in the source. */}
        <div>
          <label className="block text-xs text-tq-muted mb-2 font-heading uppercase tracking-wide">
            Quote Accent Colour
          </label>
          <p className="text-xs mb-3" style={{ color: 'var(--tq-muted)' }}>
            Tints the client link and document. Pick what matches your brand.
          </p>
          <div className="flex flex-wrap gap-3" role="radiogroup" aria-label="Quote accent colour">
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
        </div>
      </div>
    </div>
  );

  // ── Sharing section ───────────────────────────────────────────────
  // Hosts ReferralPanel — personal config (your code, your bonus
  // balance), relocated here on 2026-06-25 (Harry's ask). The panel
  // self-hides while loading + when the user has no code yet, so the
  // first-run Step-1 mount (no currentUserId) gracefully omits it.
  const renderShare = () => (
    <div>
      <div className="ps-section-head">
        <h2 className="ps-section-title">Sharing</h2>
        <p className="ps-section-desc">
          Earn free quotes by inviting other tradesmen.
        </p>
      </div>
      <ReferralPanel
        currentUserId={currentUserId}
        userName={userName}
        showToast={showToast}
      />
    </div>
  );

  // ── Billing section ───────────────────────────────────────────────
  // Read-only. Pulls from /api/billing/purchases (combined pack +
  // subscription invoices, sorted desc) and /api/billing/status (plan
  // name / next billing date / manage button). All invoices are
  // Stripe-hosted pages — we just surface the URL.
  const renderBilling = () => (
    <BillingSection />
  );

  const renderActiveSection = () => {
    switch (activeSection) {
      case 'business': return renderBusiness();
      case 'rates':    return renderRates();
      case 'trade':    return renderTrade();
      case 'quote':    return renderQuotePrefs();
      case 'share':    return renderShare();
      case 'billing':  return renderBilling();
      default:         return renderBusiness();
    }
  };

  // ── Shell render ──────────────────────────────────────────────────
  // Same shell for modal + Step-1 mounts; the modifier class flips the
  // outer container's chrome (border / radius / sizing).
  return (
    <div className={`ps-shell ${isModal ? 'ps-shell--modal' : 'ps-shell--page'}`}>
      {/* Header — "Settings" + subtitle. Per spec; replaces the legacy
          page-title h2 on the Step-1 mount and the App.jsx-rendered
          "Edit Profile" h2 on the modal mount. */}
      <div className="ps-head">
        <div>
          <div className="ps-head-title">Settings</div>
          <div className="ps-head-sub">Your business details and how your quotes look &amp; work.</div>
        </div>
        {isModal && onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ps-head-x touch-44"
          >
            &times;
          </button>
        )}
      </div>

      <div className="ps-body">
        {/* Left nav — desktop: vertical 212px column. Mobile: reflows
            to horizontal pill row via @media (max-width:899px). */}
        <nav className="ps-nav" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActiveSection(s.id)}
              aria-current={activeSection === s.id ? 'page' : undefined}
              className={`ps-nav-item ${activeSection === s.id ? 'is-active' : ''}`}
              data-section-id={s.id}
              style={{ minHeight: 44 }}
            >
              {s.label}
              {s.badge && <span className="ps-nav-badge">{s.badge}</span>}
            </button>
          ))}
        </nav>

        {/* Right content — only one section visible at a time. The
            inactive sections are intentionally NOT in the DOM so the
            sticky footer's scroll-into-view stays section-local. */}
        <div className="ps-content">
          {renderActiveSection()}

          {!isModal && (
            <p className="text-xs leading-relaxed mt-6" style={{ color: 'var(--tq-muted)' }}>
              By continuing, you agree that your quoting data (including edits,
              feedback, and completed job outcomes) may be used to improve system
              accuracy and is visible to account administrators.
            </p>
          )}

          {/* TRQ-170: Sign-out affordance for the mobile profile modal.
              BottomNav has Home / New / Quotes / Profile; tapping Profile
              opens this modal. Without this link mobile users have no way
              to log out (Sidebar's logout is desktop-only >=900px).
              Gated by `isModal && onLogout` so:
                - the full-page Step 1 onboarding mount (no onLogout) stays
                  clean for first-run users with nothing to log out of yet;
                - any future modal mount can opt out by omitting the prop. */}
          {isModal && (onLogout || onHelpClick) && (
            <div className="mt-8 pt-4 border-t border-tq-border flex justify-center gap-6">
              {/* Mobile help entry point (launch checklist 2026-06-30).
                  BottomNav has Home / New / Quotes / Profile; tapping
                  Profile opens this modal. Without this link mobile
                  users have no in-app help path (Sidebar's Help link
                  is desktop-only >=900px). */}
              {onHelpClick && (
                <button
                  type="button"
                  onClick={onHelpClick}
                  className="text-sm underline transition-colors touch-44"
                  style={{ color: 'var(--tq-muted)', minHeight: 44 }}
                >
                  Need help?
                </button>
              )}
              {onLogout && (
                <button
                  type="button"
                  onClick={onLogout}
                  className="text-sm underline transition-colors touch-44"
                  style={{ color: 'var(--tq-muted)', minHeight: 44 }}
                >
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sticky save bar — always visible at the bottom of the modal/
          page, reachable from every section. Respects safe-area-
          inset-bottom on mobile (env(safe-area-inset-bottom)) so the
          Save button never sits under the iOS home indicator.
          Mirrors the TRQ-172 / PR #77 sticky-CTA pattern. */}
      <div
        className={`ps-foot ${isModal ? '' : 'sticky bottom-[calc(env(safe-area-inset-bottom)+64px)] fq:bottom-0 py-4'}`}
      >
        <div className="ps-foot-state" aria-live="polite">
          {isDirty ? (
            <>
              <span className="ps-foot-state-dot" aria-hidden="true"></span>
              <span>Unsaved changes</span>
            </>
          ) : (
            <span aria-hidden="true">&nbsp;</span>
          )}
        </div>
        <div className="ps-foot-actions">
          {isModal && (
            <button
              type="button"
              onClick={handleCancel}
              className="btn-ghost"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            className="btn-primary"
          >
            {isModal ? 'Save changes' : 'Save Profile & Continue →'}
          </button>
        </div>
      </div>
    </div>
  );
}
