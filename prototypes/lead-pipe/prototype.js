import {
  HEIGHTS,
  DAILY_LINK_CAP,
  MAX_LENGTH_M,
  classifyPostcode,
  consentCopy,
  formatBand,
  formatGbp,
  guideBand,
} from './estimate.js';

const SAMPLE = {
  id: 'demo',
  name: 'Jordan Hale',
  email: 'jordan.hale@example.com',
  phone: '07700 900123',
  postcode: 'LS6 2AB',
  outward: 'LS6',
  area: 'Leeds',
  inWestYorkshire: true,
  length: 14,
  height: 1.2,
  photos: [],
  createdAt: 'Earlier today',
};

const OLDER = [
  {
    id: 'sample-hx',
    name: 'Sam Reed',
    email: 'sam.reed@example.com',
    phone: '07700 900456',
    postcode: 'HX1 1DG',
    outward: 'HX1',
    area: 'Halifax',
    length: 8,
    height: 1.0,
    createdAt: 'Yesterday',
    outcome: 'contacted',
  },
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
  copied: false,
  enquiry: null,
  asksToday: 0,
  outcomes: { 'sample-hx': 'contacted' },
  forceCap: false,
};

const app = document.querySelector('#app');

function route() {
  const hash = location.hash.replace(/^#/, '') || '/';
  if (hash === '/cap') return 'cap';
  if (hash === '/quote') return 'quote';
  if (hash === '/sent') return 'sent';
  if (hash === '/e' || hash.startsWith('/e/')) return 'link';
  if (hash === '/email') return 'email';
  if (hash === '/leads') return 'leads';
  if (hash === '/waller') return 'waller';
  return 'landing';
}

function heightMeta(metres) {
  return HEIGHTS.find((h) => h.metres === metres) || HEIGHTS[1];
}

function currentBand() {
  return guideBand(state.length, state.height);
}

function currentPlace() {
  return classifyPostcode(state.postcode);
}

function quoteUrl(id) {
  return `https://fastquote.uk/e/${id}`;
}

function linkEnquiry() {
  const hash = location.hash.replace(/^#/, '');
  const id = hash.startsWith('/e/') ? hash.slice(3) : '';
  if (id && state.enquiry?.id === id) return state.enquiry;
  const older = OLDER.find((row) => row.id === id);
  if (older) return older;
  if (id === 'demo') return SAMPLE;
  return state.enquiry || SAMPLE;
}

function capHit() {
  return state.forceCap || state.asksToday >= DAILY_LINK_CAP;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render() {
  const name = route();
  if (name === 'cap' && !state.postcode) {
    state.postcode = 'LS6 2AB';
    state.length = state.length || '14';
  }
  document.body.dataset.view = name;
  if (name === 'landing') app.innerHTML = landingHtml();
      else if (name === 'quote' || name === 'cap') app.innerHTML = quoteHtml();
  else if (name === 'sent') app.innerHTML = sentHtml();
  else if (name === 'link') app.innerHTML = linkHtml();
  else if (name === 'email') app.innerHTML = emailHtml();
  else if (name === 'leads') app.innerHTML = leadsHtml();
  else app.innerHTML = wallerHtml();
  bind();
  const heading = app.querySelector('h1');
  if (heading) heading.setAttribute('tabindex', '-1');
}

function landingHtml() {
  return `
    <section class="hero proto-hero">
      <div class="hero-bg" aria-hidden="true"></div>
      <div class="hero-grain" aria-hidden="true"></div>
      <div class="hero-inner">
        <div class="hero-copy">
          <span class="eyebrow">Quotes for customers · Quotes for wallers</span>
          <h1 class="hero-title">A guide price.<span class="hero-title-amber">Then a real quote.</span></h1>
          <p class="hero-sub">Customers get a free guide for a dry stone wall and can ask a West Yorkshire waller to quote the job. Wallers sign in to send their own quotes.</p>
          <div class="hero-cta-row">
            <a href="#/quote" class="btn btn-lg btn-primary">Get a quote</a>
            <a href="#/waller" class="btn btn-lg btn-ghost">Waller sign in</a>
          </div>
          <ul class="hero-facts">
            <li>Free for homeowners. No account.</li>
            <li>Waller matching is West Yorkshire only.</li>
            <li>Wallers keep the quoting app they already pay for.</li>
          </ul>
        </div>
        <div class="path-card" aria-hidden="true">
          <p class="doc-kicker">Guide price · Leeds · 14m</p>
          <p class="band-figure">£2,240–£3,080</p>
          <p>Indicative, before VAT. A site visit is required.</p>
        </div>
      </div>
    </section>
    <div class="view">
      <div class="split">
        <article class="path-card">
          <p class="doc-kicker">Quotes for customers</p>
          <h2>Get a quote</h2>
          <p>Enter a postcode and a length. See a guide price straight away, then ask a local waller to quote the job. You get a private link. The waller gets the same link.</p>
          <p class="price-note">Free</p>
          <div class="path-actions"><a href="#/quote" class="btn btn-primary">Get a quote</a></div>
        </article>
        <article class="path-card" id="for-wallers">
          <p class="doc-kicker">Quotes for wallers</p>
          <h2>Waller sign in</h2>
          <p>The quoting app is unchanged. Photos in, a professional quote out, your own price and your own branding.</p>
          <p class="price-figure">£19.99 <span>/ month, for wallers</span></p>
          <div class="path-actions"><a href="#/waller" class="btn btn-ghost">Waller sign in</a></div>
        </article>
      </div>
      <section class="waller-strip" aria-labelledby="waller-how">
        <p class="doc-kicker">For wallers</p>
        <h2 id="waller-how">How wallers quote today</h2>
        <p class="lede">This is the product Mark and Paul already use. It is not the customer page.</p>
        <ol class="steps">
          <li><strong>01 · Photos</strong><p>A few photos of the wall, taken on site.</p></li>
          <li><strong>02 · Check</strong><p>Measurements, stone and labour, edited before anything is sent.</p></li>
          <li><strong>03 · Send</strong><p>A branded quote the customer can open on their phone.</p></li>
        </ol>
      </section>
    </div>`;
}

function quoteLimited() {
  return route() === 'cap' || capHit();
}

function resultInner() {
  const place = currentPlace();
  const band = place.valid ? currentBand() : null;
  const limited = quoteLimited();
  const lengthTooBig = Number(state.length) > MAX_LENGTH_M;
  if (!place.valid) return '';
  if (!band) {
    return `<p class="hint">${lengthTooBig ? `Enter a length up to ${MAX_LENGTH_M} metres.` : 'Enter a length in metres to see a guide price.'}</p>`;
  }
  const capBlock = limited
    ? `<p class="out-note">That’s the limit for today. Your latest estimate is still here.${state.enquiry ? ` <a href="#/e">Open your link</a>.` : ''}</p>`
    : '';
  return `
    <div class="band">
      <p class="band-figure">${formatBand(band)}</p>
      <p>${formatGbp(band.perLow)}–${formatGbp(band.perHigh)} per metre · ${escapeHtml(place.area)} · before VAT</p>
      <p>Indicative guide. A site visit is required. This is not a quote from a named waller.</p>
      ${band.longWall ? '<p class="hint">This is a long wall, so the band is a rough guide.</p>' : ''}
      ${place.inWestYorkshire ? '' : '<p class="out-note">We’re not matching wallers in your area yet.</p>'}
      ${capBlock}
    </div>`;
}

function showAskNow() {
  const place = currentPlace();
  const band = place.valid ? currentBand() : null;
  return Boolean(place.valid && place.inWestYorkshire && band && !quoteLimited());
}

function askFormHtml() {
  return `
    <form class="ask" id="ask-form" novalidate>
      <h2 class="field-label">Ask a waller to quote this</h2>
      ${textField('name', 'Your name', state.name, 'text')}
      ${textField('email', 'Email', state.email, 'email')}
      ${textField('phone', 'Phone', state.phone, 'tel')}
      <div class="field">
        <span class="field-label">Photos, optional</span>
        <label class="file-btn">Add photos
          <input id="photos" type="file" accept="image/*" multiple />
        </label>
        <div class="photos">${photoThumbs()}</div>
        <p class="hint">Up to three. They help the waller see the job.</p>
      </div>
      <label class="check">
        <input id="consent" type="checkbox" ${state.consent ? 'checked' : ''} />
        <span>${escapeHtml(consentCopy())}</span>
      </label>
      ${state.errors.consent ? `<p class="hint warn">${escapeHtml(state.errors.consent)}</p>` : ''}
      <label class="check">
        <input id="marketing" type="checkbox" ${state.marketing ? 'checked' : ''} />
        <span>Send me the occasional note from FastQuote. Optional, and not required to ask for a quote.</span>
      </label>
      <button class="btn btn-lg btn-primary" type="submit">Ask a waller to quote this</button>
    </form>`;
}

function quoteHtml() {
  const place = currentPlace();
  return `
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
            <input id="postcode" name="postcode" type="text" inputmode="text" autocomplete="postal-code" placeholder="LS6 2AB" value="${escapeHtml(state.postcode)}" />
            <p class="hint" id="postcode-hint">${state.postcode && !place.valid ? escapeHtml(place.hint) : 'Try LS6 2AB for Leeds, or BD23 1EL for Skipton.'}</p>
          </label>
          <label class="field">
            <span class="field-label">Length in metres</span>
            <input id="length" name="length" type="text" inputmode="decimal" placeholder="14" value="${escapeHtml(state.length)}" />
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
        <div id="result-slot">${resultInner()}</div>
      </form>
      <div id="ask-slot">${askSlotHtml()}</div>
    </div>`;
}

function askSlotHtml() {
  if (!showAskNow()) return '';
  if (state.askOpen) return askFormHtml();
  return '<p style="margin-top:16px"><button type="button" class="btn btn-lg btn-primary" id="open-ask">Ask a waller to quote this</button></p>';
}

function textField(id, label, value, type) {
  const err = state.errors[id];
  return `
    <label class="field">
      <span class="field-label">${label}</span>
      <input id="${id}" name="${id}" type="${type}" value="${escapeHtml(value)}" />
      ${err ? `<p class="hint warn">${escapeHtml(err)}</p>` : ''}
    </label>`;
}

function photoThumbs() {
  if (!state.photos.length) return '';
  return state.photos.map((p) => `<img src="${p.url}" alt="" />`).join('');
}

function sentHtml() {
  const job = state.enquiry;
  if (!job) {
    return `<div class="view"><h1>No quote link yet</h1><p class="lede">Ask a waller to quote from the customer page. Playing with the guide price does not create a link.</p><a class="btn btn-primary" href="#/quote">Get a quote</a></div>`;
  }
  const url = quoteUrl(job.id);
  return `
    <div class="view">
      <p class="doc-kicker">Quotes for customers</p>
      <h1>A local waller has been sent this link.</h1>
      <p class="lede">The link is private. It includes your name and phone, so the waller can contact you. Don’t post it publicly.</p>
      <div class="panel">
        <div class="link-row">
          <code id="quote-url">${escapeHtml(url)}</code>
          <button type="button" class="btn btn-primary" id="copy-link">${state.copied ? 'Copied' : 'Copy link'}</button>
        </div>
        <a class="btn btn-ghost" href="#/e">Open the quote link</a>
      </div>
    </div>`;
}

function linkHtml() {
  const job = linkEnquiry();
  const band = guideBand(job.length, job.height);
  const height = heightMeta(job.height);
  const photos = job.photos || [];
  return `
    <div class="view">
      <article class="doc">
        <div class="doc-top">
          <p class="doc-kicker">Guide price</p>
          <p class="hint">Private link</p>
        </div>
        <h1>${escapeHtml(job.area)}</h1>
        <p class="band-figure">${formatBand(band)}</p>
        <p>${formatGbp(band.perLow)}–${formatGbp(band.perHigh)} per metre · before VAT</p>
        <p>Indicative guide. A site visit is required. This is not a quote from a named waller.</p>
        <ul class="facts">
          <li><span>Postcode</span><strong>${escapeHtml(job.outward)}</strong></li>
          <li><span>Length</span><strong>${escapeHtml(job.length)} metres</strong></li>
          <li><span>Height</span><strong>${escapeHtml(height.label)}</strong></li>
        </ul>
        <h2 class="field-label">Photos</h2>
        ${photos.length
          ? `<div class="photo-row">${photos.map((p) => `<img src="${p.url}" alt="Wall photo" />`).join('')}</div>`
          : '<p class="hint">No photos added.</p>'}
        <h2 class="field-label">Contact</h2>
        <div class="contact-block">
          <p><strong>${escapeHtml(job.name)}</strong></p>
          <p><a href="tel:${escapeHtml(job.phone)}">${escapeHtml(job.phone)}</a></p>
          <p><a href="mailto:${escapeHtml(job.email)}">${escapeHtml(job.email)}</a></p>
        </div>
        <p class="hint">Shared with a local waller so they can get in touch about quoting this job.</p>
      </article>
    </div>`;
}

function emailHtml() {
  const job = linkEnquiry();
  const band = guideBand(job.length, job.height);
  const url = quoteUrl(job.id);
  const summary = `${escapeHtml(job.area)} · ${escapeHtml(job.length)}m · ${formatBand(band)}`;
  const card = (who) => `
    <article class="mail">
      <header><span>To ${escapeHtml(who)} · FastQuote account email</span><span>Just now</span></header>
      <h2>New enquiry in ${escapeHtml(job.area)} — ${escapeHtml(job.length)}m, ${formatBand(band)}</h2>
      <p>${escapeHtml(job.name)} in ${escapeHtml(job.area)} has asked for a quote on a ${escapeHtml(job.length)} metre wall, ${escapeHtml(heightMeta(job.height).label.toLowerCase())}.</p>
      <p>Guide price they saw: ${formatBand(band)}. Before VAT. A site visit is required. This is not your quote.</p>
      <p>${summary}</p>
      <p><a class="mail-link" href="#/e">${escapeHtml(url)}</a></p>
    </article>`;
  return `
    <div class="view mail-wrap">
      <p class="doc-kicker">What Mark and Paul receive</p>
      <h1>The same link, twice.</h1>
      <p class="lede">Both emails go out together, to the addresses already on their FastQuote accounts. Nothing is sent until the customer asks.</p>
      <div class="mail-list">${card('Mark')}${card('Paul')}</div>
    </div>`;
}

function leadsHtml() {
  const rows = [];
  if (state.enquiry) rows.push({ ...state.enquiry, createdAt: 'Just now' });
  rows.push(SAMPLE, ...OLDER);
  const seen = new Set();
  const unique = rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  return `
    <div class="view board">
      <p class="doc-kicker">Enquiries</p>
      <h1>West Yorkshire</h1>
      <p class="lede">A tracker for quotes customers asked for. Mark and Paul work from the email. This screen is for seeing what happened next.</p>
      <div class="board-list">
        ${unique.map((row) => enquiryCard(row)).join('')}
      </div>
    </div>`;
}

function enquiryCard(row) {
  const band = guideBand(row.length, row.height);
  const outcome = state.outcomes[row.id] || '';
  const buttons = [
    ['contacted', 'Contacted'],
    ['visit', 'Visit booked'],
    ['won', 'Won'],
    ['lost', 'Lost'],
  ].map(([id, label]) => `
    <button type="button" data-outcome="${id}" data-id="${escapeHtml(row.id)}" aria-pressed="${outcome === id ? 'true' : 'false'}">${label}</button>`).join('');
  return `
    <article class="enquiry">
      <header>
        <h2>${escapeHtml(row.area)} · ${escapeHtml(row.outward)}</h2>
        <span class="pill">${outcome ? outcome.replace('visit', 'visit booked') : 'Notified'}</span>
      </header>
      <p>${escapeHtml(row.length)} metres · ${escapeHtml(heightMeta(row.height).label)} · ${formatBand(band)}</p>
      <p>${escapeHtml(row.name)} · ${escapeHtml(row.phone)}</p>
      <p class="hint">${escapeHtml(row.createdAt)} · <a href="#/e/${escapeHtml(row.id)}">Quote link</a></p>
      <div class="outcomes">${buttons}</div>
    </article>`;
}

function wallerHtml() {
  return `
    <div class="view">
      <div class="panel dead">
        <p class="doc-kicker">Quotes for wallers</p>
        <h1>Waller sign in</h1>
        <p class="lede">This is the existing FastQuote app. Sign-in is not part of this prototype.</p>
        <a class="btn btn-primary" href="#/">Back to the landing</a>
      </div>
    </div>`;
}

function refreshQuoteSlots() {
  const result = document.querySelector('#result-slot');
  const ask = document.querySelector('#ask-slot');
  if (!result || !ask) return;
  readAskFields();
  result.innerHTML = resultInner();
  if (!showAskNow()) {
    ask.innerHTML = '';
    return;
  }
  if (state.askOpen) {
    if (!ask.querySelector('#ask-form')) {
      ask.innerHTML = askFormHtml();
      bindAskForm();
    }
    return;
  }
  if (!ask.querySelector('#open-ask')) {
    ask.innerHTML = askSlotHtml();
    bindOpenAsk();
  }
}

function bindOpenAsk() {
  document.querySelector('#open-ask')?.addEventListener('click', () => {
    readAskFields();
    state.askOpen = true;
    const ask = document.querySelector('#ask-slot');
    if (!ask) return;
    ask.innerHTML = askFormHtml();
    bindAskForm();
    document.querySelector('#name')?.focus();
  });
}

function bindAskForm() {
  const photos = document.querySelector('#photos');
  if (photos && !photos.dataset.bound) {
    photos.dataset.bound = '1';
    photos.addEventListener('change', () => {
      const files = Array.from(photos.files || []).slice(0, 3);
      state.photos.forEach((photo) => URL.revokeObjectURL(photo.url));
      state.photos = files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) }));
      const box = document.querySelector('#ask-form .photos');
      if (box) box.innerHTML = photoThumbs();
    });
  }
  const form = document.querySelector('#ask-form');
  if (form && !form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      readAskFields();
      const errors = validateAsk();
      state.errors = errors;
      if (Object.keys(errors).length) {
        const ask = document.querySelector('#ask-slot');
        if (ask) {
          ask.innerHTML = askFormHtml();
          bindAskForm();
        }
        return;
      }
      if (capHit()) {
        state.forceCap = true;
        location.hash = '#/cap';
        return;
      }
      const place = currentPlace();
      state.enquiry = {
        id: crypto.randomUUID().slice(0, 8),
        name: state.name.trim(),
        email: state.email.trim(),
        phone: state.phone.trim(),
        postcode: state.postcode.trim(),
        outward: place.outward,
        area: place.area,
        inWestYorkshire: true,
        length: Number(state.length),
        height: state.height,
        photos: state.photos.slice(0, 3),
      };
      state.asksToday += 1;
      state.copied = false;
      state.askOpen = false;
      location.hash = '#/sent';
    });
  }
}

function bind() {
  const postcode = document.querySelector('#postcode');
  const length = document.querySelector('#length');
  if (postcode) {
    postcode.addEventListener('input', () => {
      state.postcode = postcode.value;
      state.errors = {};
      const hint = document.querySelector('#postcode-hint');
      const place = currentPlace();
      if (hint) {
        hint.textContent = state.postcode && !place.valid
          ? place.hint
          : 'Try LS6 2AB for Leeds, or BD23 1EL for Skipton.';
        hint.classList.toggle('warn', Boolean(state.postcode && !place.valid));
      }
      refreshQuoteSlots();
    });
  }
  if (length) {
    length.addEventListener('input', () => {
      state.length = length.value;
      refreshQuoteSlots();
    });
  }
  document.querySelectorAll('[data-height]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.height = Number(btn.dataset.height);
      document.querySelectorAll('[data-height]').forEach((other) => {
        other.setAttribute('aria-pressed', other === btn ? 'true' : 'false');
      });
      refreshQuoteSlots();
    });
  });
  const measure = document.querySelector('#measure-form');
  if (measure) measure.addEventListener('submit', (event) => event.preventDefault());
  bindOpenAsk();
  bindAskForm();
  const copy = document.querySelector('#copy-link');
  if (copy && state.enquiry) {
    copy.addEventListener('click', async () => {
      const url = quoteUrl(state.enquiry.id);
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        const node = document.querySelector('#quote-url');
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      }
      state.copied = true;
      render();
    });
  }
  document.querySelectorAll('[data-outcome]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.outcomes[btn.dataset.id] = btn.dataset.outcome;
      render();
    });
  });
}

function readAskFields() {
  const name = document.querySelector('#name');
  const email = document.querySelector('#email');
  const phone = document.querySelector('#phone');
  const consent = document.querySelector('#consent');
  const marketing = document.querySelector('#marketing');
  if (name) state.name = name.value;
  if (email) state.email = email.value;
  if (phone) state.phone = phone.value;
  if (consent) state.consent = consent.checked;
  if (marketing) state.marketing = marketing.checked;
}

function validateAsk() {
  const errors = {};
  if (!state.name.trim()) errors.name = 'Enter your name.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email.trim())) errors.email = 'Enter a valid email.';
  const digits = state.phone.replace(/\D/g, '');
  if (digits.length < 10) errors.phone = 'Enter a phone number.';
  if (!state.consent) errors.consent = 'Tick this box so a waller can contact you. It is not ticked for you.';
  return errors;
}

window.addEventListener('hashchange', () => {
  state.forceCap = route() === 'cap';
  if (route() !== 'quote' && route() !== 'cap') state.askOpen = false;
  render();
});

state.forceCap = route() === 'cap';
render();
