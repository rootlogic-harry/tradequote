/**
 * Client Portal HTML renderer (TRQ-126).
 *
 * Builds the customer-facing page served by GET /q/:token. The portal is
 * the tradesman's product as far as the client is concerned — no
 * FastQuote branding on visible surfaces, no AI vocabulary, no internals.
 *
 * Security rules baked in here — do not relax them:
 *   1. Every interpolated string runs through escapeHtml. CSP is already
 *      in place at the route layer, but defence in depth keeps us honest
 *      if a header ever slips.
 *   2. data-accent is whitelisted to {amber, rust, moss, slate}. Unknown
 *      values fall back to amber so the attribute can't be used as an
 *      injection vector.
 *   3. The token is whitelisted to UUID v4 shape before it ever lands in
 *      rendered HTML (including the beacon URL). The route has already
 *      validated it via the SQL lookup, but the renderer refuses to echo
 *      anything weaker.
 *   4. The view beacon fires only after real interaction (3s dwell OR
 *      scroll past the cost breakdown, whichever first) and only once.
 *      Bots / email prefetchers never execute JS, so the beacon filters
 *      them out naturally.
 *   5. Confirmation states ("already accepted", "already declined")
 *      never emit the beacon or the response buttons — you can't
 *      accidentally resubmit.
 *
 * Rendering contract:
 *   - Read from `client_snapshot` + `client_snapshot_profile` ONLY.
 *     Never from the live `quote_snapshot` or `profiles.data`. That's
 *     what makes the portal's frozen-at-send-time promise real.
 */

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCENT_WHITELIST = new Set(['amber', 'rust', 'moss', 'slate']);

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeAccent(raw) {
  return ACCENT_WHITELIST.has(raw) ? raw : 'amber';
}

function safeToken(raw) {
  return UUID_V4.test(String(raw || '')) ? String(raw) : '';
}

function formatDate(input) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(input) {
  if (!input) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} at ${time}`;
}

function formatCurrency(n) {
  const v = Number(n || 0);
  return `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function daysUntil(date) {
  if (!date) return 0;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 0;
  return Math.ceil((d.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function ribbonForDays(days, expiresAt) {
  // Escalate by days remaining. 15+ = default, 8–14 = default + specific
  // copy, 4–7 = --warn, 1–3 = --danger. Expired is 410 at the route
  // layer, never reaches the renderer.
  const expiryDate = formatDate(expiresAt);
  if (days >= 15) {
    return {
      cls: 'cp-ribbon',
      copy: `Valid until <strong>${escapeHtml(expiryDate)}</strong> · 30 days from preparation`,
    };
  }
  if (days >= 8) {
    return {
      cls: 'cp-ribbon',
      copy: `Valid for <strong>${days}</strong> more days · Expires ${escapeHtml(expiryDate)}`,
    };
  }
  if (days >= 4) {
    return {
      cls: 'cp-ribbon cp-ribbon--warn',
      copy: `Expires in <strong>${days} days</strong> · ${escapeHtml(expiryDate)}`,
    };
  }
  return {
    cls: 'cp-ribbon cp-ribbon--danger',
    copy: `Expires in <strong>${days} day${days === 1 ? '' : 's'}</strong> · ${escapeHtml(expiryDate)}`,
  };
}

function totals(materials, labour, additionalCosts, vatRegistered) {
  let subtotal = 0;
  for (const m of materials || []) subtotal += Number(m.totalCost || 0);
  const labourTotal = Number(labour?.estimatedDays || 0) * Number(labour?.numberOfWorkers || 0) * Number(labour?.dayRate || 0);
  subtotal += labourTotal;
  for (const c of additionalCosts || []) subtotal += Number(c.amount || 0);
  const vatAmount = vatRegistered ? subtotal * 0.2 : 0;
  return { subtotal, labourTotal, vatAmount, total: subtotal + vatAmount };
}

function headerLogo(profile) {
  // A real logo arrives in client_snapshot_profile.logo (data URL or
  // server-hosted URL). If stripped (placeholder `[photo-stripped]`) or
  // missing, fall back to an initial. Never render a broken <img>.
  const logo = profile?.logo;
  if (typeof logo === 'string' && logo.length > 5 && logo !== '[photo-stripped]') {
    return `<div class="cp-logo"><img src="${escapeHtml(logo)}" alt=""/></div>`;
  }
  const name = profile?.companyName || profile?.fullName || '';
  const initial = name.trim().slice(0, 1).toUpperCase() || '·';
  return `<div class="cp-logo" aria-hidden="true">${escapeHtml(initial)}</div>`;
}

function prose(text) {
  if (!text) return '';
  // Preserve paragraph breaks but never trust the source as HTML.
  return String(text)
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

function scheduleItems(schedule) {
  if (!Array.isArray(schedule) || schedule.length === 0) return '';
  return schedule
    .map(
      (step) =>
        `<li><div class="cp-sched-title"><strong>${escapeHtml(step.title || '')}</strong></div>${
          step.description
            ? `<div class="cp-sched-desc">${escapeHtml(step.description)}</div>`
            : ''
        }</li>`
    )
    .join('');
}

function materialRows(materials) {
  return (materials || [])
    .filter((m) => Number(m.totalCost || 0) > 0 && String(m.description || '').trim())
    .map(
      (m) =>
        `<div class="cp-cost-row">
          <div class="cp-cost-label">${escapeHtml(m.description)}${
            m.quantity ? `<small>${escapeHtml(m.quantity)}${m.unit ? ` ${escapeHtml(m.unit)}` : ''}</small>` : ''
          }</div>
          <div class="cp-cost-value">${formatCurrency(m.totalCost)}</div>
        </div>`
    )
    .join('');
}

function noteList(notes) {
  if (!Array.isArray(notes) || notes.length === 0) return '';
  return `<ol class="cp-notes">${notes.map((n) => `<li>${escapeHtml(n)}</li>`).join('')}</ol>`;
}

function respondBlock(tokenSafe, profile) {
  const firstName = (profile?.fullName || profile?.companyName || '').split(/\s+/)[0] || 'your tradesman';
  return `
<div class="cp-respond">
  <p class="cp-respond-lead">Please review the quote above and let <strong>${escapeHtml(firstName)}</strong> know if you'd like to proceed.</p>
  <div class="cp-respond-stack">
    <button type="button" class="cp-btn cp-btn-primary" data-action="accept">✓ Accept this quote</button>
    <button type="button" class="cp-btn cp-btn-secondary" data-action="decline-open">Decline this quote</button>
    <div class="cp-decline-sheet" style="display:none">
      <div class="cp-decline-label">Decline this quote</div>
      <div class="cp-decline-hint">Optional — let ${escapeHtml(firstName)} know why (max 300 chars)</div>
      <textarea class="cp-decline-textarea" maxlength="300" data-ref="decline-reason"></textarea>
      <div class="cp-decline-count" data-ref="decline-count">0 / 300</div>
      <div class="cp-decline-actions">
        <button type="button" class="cp-btn cp-btn-secondary" data-action="decline-cancel">Cancel</button>
        <button type="button" class="cp-btn cp-btn-primary" data-action="decline-submit" style="background:var(--danger);box-shadow:none">Submit decline</button>
      </div>
    </div>
    <div class="cp-respond-divider"></div>
    <button type="button" class="cp-btn cp-btn-ghost" data-action="pdf">Save as PDF</button>
  </div>
</div>`;
}

function confirmationBlock(job) {
  const response = job.client_response;
  const when = formatDateTime(job.client_response_at);
  if (response === 'accepted') {
    return `
<div class="cp-confirm">
  <div class="cp-confirm-mark cp-confirm-mark--ok" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
  </div>
  <h2 class="cp-confirm-title">Thanks — your response has been recorded.</h2>
  <p class="cp-confirm-body">You accepted this quote on <strong>${escapeHtml(when)}</strong>. Your tradesman will be in touch to discuss next steps.</p>
</div>`;
  }
  if (response === 'declined') {
    return `
<div class="cp-confirm">
  <div class="cp-confirm-mark cp-confirm-mark--muted" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </div>
  <h2 class="cp-confirm-title">Thank you for letting us know.</h2>
  <p class="cp-confirm-body">Your response was recorded on <strong>${escapeHtml(when)}</strong>. If you change your mind or have any questions, please get in touch with your tradesman directly.</p>
</div>`;
  }
  return '';
}

function beaconScript(tokenSafe) {
  // Bot-safe: real browsers fire this after the user has either dwelled
  // for 3 seconds or scrolled past the cost breakdown. Email scanners
  // and prefetchers don't execute JS, so they never hit /q/:token/viewed.
  // A `once` flag prevents duplicate firing when both triggers occur.
  if (!tokenSafe) return '';
  return `
<script>
(function(){
  var once = false;
  function fire(){
    if (once) return;
    once = true;
    try {
      fetch('/q/${tokenSafe}/viewed', { method: 'POST', credentials: 'same-origin', keepalive: true });
    } catch (e) { /* silent */ }
  }
  setTimeout(fire, 3000);
  var costs = document.querySelector('[data-print-section="costs"], .cp-costs');
  function onScroll(){
    if (once) return;
    if (!costs) { fire(); return; }
    var r = costs.getBoundingClientRect();
    if (r.bottom < window.innerHeight) fire();
  }
  window.addEventListener('scroll', onScroll, { passive: true });
})();
</script>`;
}

function respondScript(tokenSafe) {
  // Single entry-point for Accept / Decline / Save-as-PDF. Works without
  // any inline event handlers on the buttons (cleanest under CSP).
  if (!tokenSafe) return '';
  return `
<script>
(function(){
  var root = document.querySelector('.cp');
  if (!root) return;
  var sheet = root.querySelector('.cp-decline-sheet');
  var textarea = root.querySelector('[data-ref="decline-reason"]');
  var count = root.querySelector('[data-ref="decline-count"]');
  if (textarea && count) {
    textarea.addEventListener('input', function(){
      count.textContent = textarea.value.length + ' / 300';
    });
  }
  async function submit(body){
    try {
      var r = await fetch('/q/${tokenSafe}/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (r.ok) { window.location.reload(); return; }
    } catch (e) { /* fall through */ }
    // Fall-through: server rejected (likely already responded / expired)
    // — a reload shows the confirmation or expired state authoritatively.
    window.location.reload();
  }
  root.addEventListener('click', function(e){
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var action = t.getAttribute('data-action');
    if (action === 'accept') {
      submit({ response: 'accepted' });
    } else if (action === 'decline-open') {
      if (sheet) sheet.style.display = 'block';
    } else if (action === 'decline-cancel') {
      if (sheet) sheet.style.display = 'none';
    } else if (action === 'decline-submit') {
      var reason = textarea ? (textarea.value || '').slice(0, 300) : null;
      submit({ response: 'declined', declineReason: reason });
    } else if (action === 'pdf') {
      window.print();
    }
  });
})();
</script>`;
}

function footerBlock(profile) {
  const company = profile?.companyName || profile?.fullName || '';
  const firstName = (profile?.fullName || profile?.companyName || '').split(/\s+/)[0] || '';
  const phone = profile?.phone || '';
  return `
<div class="cp-footer">
  <div class="cp-footer-line">Questions? Call ${escapeHtml(firstName || 'your tradesman')}</div>
  ${phone ? `<div class="cp-footer-phone"><a href="tel:${escapeHtml(phone.replace(/\s+/g, ''))}">${escapeHtml(phone)}</a></div>` : ''}
  <div class="cp-footer-disclaimer">Prepared by ${escapeHtml(company)} using FastQuote. Accepting indicates your intent to proceed${firstName ? ` — the full agreement will be confirmed directly with ${escapeHtml(firstName)}` : ''}.</div>
</div>`;
}

function baseHead(title) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="robots" content="noindex, nofollow"/>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/client-portal.css"/>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500&family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet"/>
</head>`;
}

export function renderClientPortal(job, token) {
  const snapshot = job?.client_snapshot || {};
  const profile = job?.client_snapshot_profile || {};
  const jobDetails = snapshot.jobDetails || {};
  const reviewData = snapshot.reviewData || {};
  const snapshotProfile = snapshot.profile || profile;
  const materials = reviewData.materials || [];
  const labour = reviewData.labourEstimate || {};
  const additionalCosts = reviewData.additionalCosts || [];
  const t = totals(materials, labour, additionalCosts, snapshotProfile.vatRegistered);

  const accent = safeAccent(profile.accent);
  const tokenSafe = safeToken(token);
  const days = daysUntil(job?.client_token_expires_at);
  const ribbon = ribbonForDays(days, job?.client_token_expires_at);
  const hasResponse = job?.client_response === 'accepted' || job?.client_response === 'declined';

  const title = escapeHtml(`Quote · ${snapshotProfile.companyName || snapshotProfile.fullName || 'Your quote'}`);

  return `${baseHead(title)}
<body>
<div class="cp" data-accent="${accent}">
  <div class="cp-page">
    <div class="${ribbon.cls}"><span class="cp-ribbon-dot"></span>${ribbon.copy}</div>

    <div class="cp-header">
      ${headerLogo(profile)}
      <div class="cp-header-text">
        <div class="cp-tradesman">${escapeHtml(profile.companyName || profile.fullName || '')}</div>
        ${profile.phone || profile.email ? `<div class="cp-phone">
          ${profile.phone ? `<a href="tel:${escapeHtml(String(profile.phone).replace(/\s+/g, ''))}">${escapeHtml(profile.phone)}</a>` : ''}
          ${profile.phone && profile.email ? `<span class="cp-sep">·</span>` : ''}
          ${profile.email ? `<a href="mailto:${escapeHtml(profile.email)}">${escapeHtml(profile.email)}</a>` : ''}
        </div>` : ''}
      </div>
    </div>

    <div class="cp-quote-head">
      <div class="cp-eyebrow">Quote</div>
      <h1 class="cp-ref">${escapeHtml(jobDetails.quoteReference || '')}</h1>
      <div class="cp-prepared">Prepared ${escapeHtml(formatDate(jobDetails.quoteDate))}</div>
      <dl class="cp-meta">
        <dt>For</dt><dd><strong>${escapeHtml(jobDetails.clientName || '')}</strong></dd>
        <dt>Site</dt><dd>${escapeHtml(jobDetails.siteAddress || '')}</dd>
      </dl>
    </div>

    <section class="cp-section">
      <h2 class="cp-section-title">Description of damage</h2>
      <div class="cp-prose">${prose(reviewData.damageDescription)}</div>
    </section>

    ${Array.isArray(reviewData.scheduleOfWorks) && reviewData.scheduleOfWorks.length > 0 ? `
    <section class="cp-section">
      <h2 class="cp-section-title">Schedule of works</h2>
      <ol class="cp-schedule">${scheduleItems(reviewData.scheduleOfWorks)}</ol>
    </section>` : ''}

    <section class="cp-section" data-print-section="costs">
      <h2 class="cp-section-title">Cost breakdown</h2>
      <div class="cp-costs">
        ${materialRows(materials)}
        <div class="cp-cost-row">
          <div class="cp-cost-label">Labour<small>${escapeHtml(String(labour.estimatedDays || 0))} day${Number(labour.estimatedDays) === 1 ? '' : 's'} × ${escapeHtml(String(labour.numberOfWorkers || 0))} worker${Number(labour.numberOfWorkers) === 1 ? '' : 's'}</small></div>
          <div class="cp-cost-value">${formatCurrency(t.labourTotal)}</div>
        </div>
        ${additionalCosts.map((c) => `
        <div class="cp-cost-row">
          <div class="cp-cost-label">${escapeHtml(c.label || '')}</div>
          <div class="cp-cost-value">${formatCurrency(c.amount)}</div>
        </div>`).join('')}
        <div class="cp-cost-row cp-cost-subtotal">
          <div class="cp-cost-label">Subtotal${snapshotProfile.vatRegistered ? ' (ex VAT)' : ''}</div>
          <div class="cp-cost-value">${formatCurrency(t.subtotal)}</div>
        </div>
        ${snapshotProfile.vatRegistered ? `
        <div class="cp-cost-row cp-cost-subtotal">
          <div class="cp-cost-label">VAT (20%)</div>
          <div class="cp-cost-value">${formatCurrency(t.vatAmount)}</div>
        </div>` : ''}
        <div class="cp-cost-total">
          <div class="cp-cost-total-label">Total</div>
          <div class="cp-cost-total-value">${formatCurrency(t.total)}</div>
        </div>
      </div>
    </section>

    ${Array.isArray(reviewData.notes) && reviewData.notes.length > 0 ? `
    <section class="cp-section">
      <h2 class="cp-section-title">Notes &amp; terms</h2>
      ${noteList(reviewData.notes)}
    </section>` : ''}

    ${hasResponse ? confirmationBlock(job) : respondBlock(tokenSafe, profile)}

    ${footerBlock(profile)}
  </div>
</div>
${hasResponse ? '' : beaconScript(tokenSafe)}
${hasResponse ? '' : respondScript(tokenSafe)}
</body>
</html>`;
}

export function renderTokenNotFound() {
  return `${baseHead('Quote not found')}
<body>
<div class="cp" data-accent="amber">
  <div class="cp-page">
    <div class="cp-confirm">
      <div class="cp-error-stamp">404 · Not found</div>
      <h1 class="cp-confirm-title">Quote not found</h1>
      <p class="cp-confirm-body">This link may be incorrect or the quote may have been removed. Please contact your tradesman directly.</p>
    </div>
  </div>
</div>
</body>
</html>`;
}

export function renderTokenExpired(job = {}) {
  const site = job.site_address ? ` for <strong>${escapeHtml(job.site_address)}</strong>` : '';
  return `${baseHead('Quote expired')}
<body>
<div class="cp" data-accent="amber">
  <div class="cp-page">
    <div class="cp-confirm">
      <div class="cp-error-stamp">410 · Expired</div>
      <h1 class="cp-confirm-title">This quote has expired.</h1>
      <p class="cp-confirm-body">The quote${site} is no longer available online. Please get in touch with your tradesman to discuss your options.</p>
    </div>
  </div>
</div>
</body>
</html>`;
}
