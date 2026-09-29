const HEIGHTS = [
  { metres: 1.0, label: 'About 1.0m', hint: 'Garden' },
  { metres: 1.2, label: 'About 1.2m', hint: 'Field' },
  { metres: 1.5, label: 'About 1.5m', hint: 'Tall' },
];

const state = {
  postcode: '',
  length: '',
  height: 1.2,
  askOpen: false,
  name: '',
  email: '',
  phone: '',
  photos: [],
  consent: false,
  marketing: false,
  errors: {},
  preview: null,
  consentCopy: 'FastQuote may share my details with a local dry stone waller so they can contact me about this job.',
  result: null,
  quote: null,
  busy: false,
  copied: false,
};

const app = document.querySelector('#app');

function pathParts() {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/e/')) return { view: 'link', id: path.slice(3) };
  if (path === '/sent') return { view: 'sent' };
  if (path === '/dry-stone-wall-cost-west-yorkshire') return { view: 'quote', seo: true };
  return { view: 'quote', seo: false };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadMeta() {
  try {
    const res = await fetch('/api/homeowner/meta');
    if (!res.ok) throw new Error('flag off');
    const data = await res.json();
    if (data.consentCopy) state.consentCopy = data.consentCopy;
  } catch {
    app.innerHTML = `<div class="view"><h1>Not available</h1><p class="lede">Homeowner quotes are not enabled on this server.</p><a class="btn btn-primary" href="/">Back</a></div>`;
    throw new Error('disabled');
  }
}

async function refreshPreview() {
  if (!state.postcode.trim() || !state.length) {
    state.preview = null;
    paintResult();
    return;
  }
  try {
    const res = await fetch('/api/homeowner/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        postcode: state.postcode,
        lengthM: Number(state.length),
        heightM: state.height,
      }),
    });
    state.preview = await res.json();
  } catch {
    state.preview = null;
  }
  paintResult();
  paintAskSlot();
}

function paintResult() {
  const slot = document.querySelector('#result-slot');
  if (!slot) return;
  const place = state.preview?.place;
  const band = state.preview?.band;
  if (!place?.valid) {
    slot.innerHTML = state.postcode && place && !place.valid
      ? `<p class="hint warn">${escapeHtml(place.hint)}</p>`
      : '';
    return;
  }
  if (!band) {
    slot.innerHTML = '<p class="hint">Enter a length in metres to see a guide price.</p>';
    return;
  }
  slot.innerHTML = `
    <div class="band">
      <p class="band-figure">${escapeHtml(state.preview.bandText)}</p>
      <p>£${band.perLow}–£${band.perHigh} per metre · ${escapeHtml(place.area)} · before VAT</p>
      <p>Indicative guide. A site visit is required. This is not a quote from a named waller.</p>
      ${band.longWall ? '<p class="hint">This is a long wall, so the band is a rough guide.</p>' : ''}
      ${place.inWestYorkshire ? '' : '<p class="out-note">We’re not matching wallers in your area yet.</p>'}
    </div>`;
}

function showAsk() {
  const place = state.preview?.place;
  const band = state.preview?.band;
  return Boolean(place?.valid && place.inWestYorkshire && band);
}

function paintAskSlot() {
  const slot = document.querySelector('#ask-slot');
  if (!slot) return;
  if (!showAsk()) {
    slot.innerHTML = '';
    return;
  }
  if (!state.askOpen) {
    slot.innerHTML = '<p style="margin-top:16px"><button type="button" class="btn btn-lg btn-primary" id="open-ask">Ask a waller to quote this</button></p>';
    document.querySelector('#open-ask')?.addEventListener('click', () => {
      state.askOpen = true;
      paintAskSlot();
      document.querySelector('#name')?.focus();
    });
    return;
  }
  slot.innerHTML = askFormHtml();
  bindAskForm();
}

function askFormHtml() {
  return `
    <form class="ask" id="ask-form" novalidate>
      <h2 class="field-label">Ask a waller to quote this</h2>
      ${field('name', 'Your name', state.name, 'text')}
      ${field('email', 'Email', state.email, 'email')}
      ${field('phone', 'Phone', state.phone, 'tel')}
      <div class="field">
        <span class="field-label">Photos, optional</span>
        <label class="file-btn">Add photos
          <input id="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple />
        </label>
        <div class="photos">${state.photos.map((p) => `<img src="${p.dataUrl}" alt="" />`).join('')}</div>
        <p class="hint">Up to three. They help the waller see the job.</p>
        ${state.errors.photos ? `<p class="hint warn">${escapeHtml(state.errors.photos)}</p>` : ''}
      </div>
      <label class="check">
        <input id="consent" type="checkbox" ${state.consent ? 'checked' : ''} />
        <span>${escapeHtml(state.consentCopy)}</span>
      </label>
      ${state.errors.consentShare || state.errors.consent ? `<p class="hint warn">${escapeHtml(state.errors.consentShare || state.errors.consent)}</p>` : ''}
      <label class="check">
        <input id="marketing" type="checkbox" ${state.marketing ? 'checked' : ''} />
        <span>Send me the occasional note from FastQuote. Optional.</span>
      </label>
      <button class="btn btn-lg btn-primary" type="submit" ${state.busy ? 'disabled' : ''}>Ask a waller to quote this</button>
      ${state.errors.form ? `<p class="hint warn">${escapeHtml(state.errors.form)}</p>` : ''}
    </form>`;
}

function field(id, label, value, type) {
  const err = state.errors[id];
  return `
    <label class="field">
      <span class="field-label">${label}</span>
      <input id="${id}" name="${id}" type="${type}" value="${escapeHtml(value)}" />
      ${err ? `<p class="hint warn">${escapeHtml(err)}</p>` : ''}
    </label>`;
}

function readAsk() {
  state.name = document.querySelector('#name')?.value || state.name;
  state.email = document.querySelector('#email')?.value || state.email;
  state.phone = document.querySelector('#phone')?.value || state.phone;
  state.consent = Boolean(document.querySelector('#consent')?.checked);
  state.marketing = Boolean(document.querySelector('#marketing')?.checked);
}

function bindAskForm() {
  document.querySelector('#photos')?.addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || []).slice(0, 3);
    const photos = [];
    for (const file of files) {
      const dataUrl = await readFile(file);
      photos.push({ dataUrl });
    }
    state.photos = photos;
    paintAskSlot();
  });
  document.querySelector('#ask-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    readAsk();
    state.busy = true;
    state.errors = {};
    paintAskSlot();
    try {
      const res = await fetch('/api/homeowner/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postcode: state.postcode,
          lengthM: Number(state.length),
          heightM: state.height,
          name: state.name,
          email: state.email,
          phone: state.phone,
          consentShare: state.consent,
          consentMarketing: state.marketing,
          photos: state.photos.map((p) => p.dataUrl),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        state.errors.form = data.error || 'That’s the limit for today.';
        state.busy = false;
        paintAskSlot();
        return;
      }
      if (!res.ok) {
        state.errors = data.errors || { form: data.error || 'Something went wrong.' };
        state.busy = false;
        paintAskSlot();
        return;
      }
      state.result = data;
      history.pushState({}, '', `/e/${data.id}?sent=1`);
      await showLink(data.id, true);
    } catch {
      state.errors.form = 'Something went wrong.';
      state.busy = false;
      paintAskSlot();
    }
  });
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function quoteFormHtml(seo) {
  return `
    ${seo ? `<section class="seo-intro">
      <p class="doc-kicker">West Yorkshire</p>
      <h1>Dry stone wall cost</h1>
      <p>A free guide price for homeowners in Bradford, Calderdale, Kirklees, Leeds and Wakefield. Indicative only — a site visit is required.</p>
    </section>` : ''}
    <div class="view">
      <div class="tool-head">
        <p class="doc-kicker">Quotes for customers</p>
        <h1>Get a quote</h1>
        <p class="lede">A guide price for a dry stone wall. If you are in West Yorkshire, you can ask a local waller to quote the job. No account.</p>
      </div>
      <form class="panel" id="measure-form">
        <div class="fields">
          <label class="field">
            <span class="field-label">Postcode</span>
            <input id="postcode" type="text" autocomplete="postal-code" placeholder="LS6 2AB" value="${escapeHtml(state.postcode)}" />
            <p class="hint" id="postcode-hint">Try LS6 2AB for Leeds, or BD23 1EL for Skipton.</p>
          </label>
          <label class="field">
            <span class="field-label">Length in metres</span>
            <input id="length" type="text" inputmode="decimal" placeholder="14" value="${escapeHtml(state.length)}" />
          </label>
          <div class="field">
            <span class="field-label">Height</span>
            <div class="heights" role="group" aria-label="Height">
              ${HEIGHTS.map((h) => `
                <button type="button" data-height="${h.metres}" aria-pressed="${state.height === h.metres ? 'true' : 'false'}">
                  <strong>${h.label}</strong><span>${h.hint}</span>
                </button>`).join('')}
            </div>
          </div>
        </div>
        <div id="result-slot"></div>
      </form>
      <div id="ask-slot"></div>
    </div>`;
}

function bindQuoteForm() {
  document.querySelector('#measure-form')?.addEventListener('submit', (e) => e.preventDefault());
  document.querySelector('#postcode')?.addEventListener('input', (e) => {
    state.postcode = e.target.value;
    refreshPreview();
  });
  document.querySelector('#length')?.addEventListener('input', (e) => {
    state.length = e.target.value;
    refreshPreview();
  });
  document.querySelectorAll('[data-height]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.height = Number(btn.dataset.height);
      document.querySelectorAll('[data-height]').forEach((other) => {
        other.setAttribute('aria-pressed', other === btn ? 'true' : 'false');
      });
      refreshPreview();
    });
  });
  paintResult();
  paintAskSlot();
}

async function showLink(id, justSent = false) {
  const robots = document.querySelector('#robots-meta');
  if (robots) robots.setAttribute('content', 'noindex, nofollow');
  app.innerHTML = `<div class="view"><p class="lede">Loading…</p></div>`;
  const res = await fetch(`/api/homeowner/quotes/${encodeURIComponent(id)}`);
  if (!res.ok) {
    app.innerHTML = `<div class="view"><h1>Link not found</h1><p class="lede">This private link is unknown or has expired.</p><a class="btn btn-primary" href="/quote">Get a quote</a></div>`;
    return;
  }
  const quote = await res.json();
  state.quote = quote;
  const url = `${location.origin}/e/${quote.id}`;
  app.innerHTML = `
    ${justSent || new URLSearchParams(location.search).get('sent') === '1' ? `
      <div class="view" style="padding-bottom:0">
        <p class="doc-kicker">Quotes for customers</p>
        <h1>A local waller has been sent this link.</h1>
        <p class="lede">The link is private. It includes your name and phone, so the waller can contact you. Don’t post it publicly.</p>
        <div class="panel">
          <div class="link-row">
            <code id="quote-url">${escapeHtml(url)}</code>
            <button type="button" class="btn btn-primary" id="copy-link">${state.copied ? 'Copied' : 'Copy link'}</button>
          </div>
        </div>
      </div>` : ''}
    <div class="view">
      <article class="doc">
        <div class="doc-top">
          <p class="doc-kicker">Guide price</p>
          <p class="hint">Private link</p>
        </div>
        <h1>${escapeHtml(quote.area)}</h1>
        <p class="band-figure">${escapeHtml(quote.bandText)}</p>
        <p>${escapeHtml(quote.disclaimer)}</p>
        <ul class="facts">
          <li><span>Postcode</span><strong>${escapeHtml(quote.outward)}</strong></li>
          <li><span>Length</span><strong>${escapeHtml(quote.lengthM)} metres</strong></li>
          <li><span>Height</span><strong>${escapeHtml(quote.heightLabel)}</strong></li>
        </ul>
        <h2 class="field-label">Photos</h2>
        ${quote.photos?.length
          ? `<div class="photo-row">${quote.photos.map((p) => `<img src="${p.dataUrl}" alt="Wall photo" />`).join('')}</div>`
          : '<p class="hint">No photos added.</p>'}
        <h2 class="field-label">Contact</h2>
        <div class="contact-block">
          <p><strong>${escapeHtml(quote.name)}</strong></p>
          <p><a href="tel:${escapeHtml(quote.phone)}">${escapeHtml(quote.phone)}</a></p>
          <p><a href="mailto:${escapeHtml(quote.email)}">${escapeHtml(quote.email)}</a></p>
        </div>
        <p class="hint">Shared with a local waller so they can get in touch about quoting this job.</p>
      </article>
    </div>`;
  document.querySelector('#copy-link')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      state.copied = true;
      document.querySelector('#copy-link').textContent = 'Copied';
    } catch {
      /* ignore */
    }
  });
}

async function boot() {
  const route = pathParts();
  if (route.view === 'link') {
    await loadMeta().catch(() => null);
    await showLink(route.id, false);
    return;
  }
  await loadMeta();
  if (route.seo) {
    document.title = 'Dry stone wall cost West Yorkshire — FastQuote';
    const robots = document.querySelector('#robots-meta');
    if (robots) robots.setAttribute('content', 'index,follow');
  }
  app.innerHTML = quoteFormHtml(route.seo);
  bindQuoteForm();
}

window.addEventListener('popstate', () => boot());
boot();
