/**
 * QuickBooks Online UK — invoice CSV exporter.
 *
 * Produces a CSV that imports cleanly via Settings → Import data →
 * Invoices on a UK QBO account. Every rule below is from the verified
 * QBO UK import spec or community-reported failure modes:
 *
 *   - No commas in numeric fields (1234.56, not 1,234.56)
 *   - No currency symbols
 *   - No zero-value or negative lines (QBO rejects them)
 *   - No commas in customer names (replace with " - ")
 *   - No # % & in item names OR descriptions (QBO reportedly fails on these)
 *   - DD/MM/YYYY dates, consistent throughout the file
 *   - No VAT line (QBO computes from ItemTaxCode + Exclusive toggle)
 *   - ItemDescription capped at 500 chars (QBO hard limit is 4000; 500
 *     keeps invoices readable)
 *   - CRLF line endings (RFC 4180; some QBO imports reportedly fail on LF)
 *
 * The exporter reads from job.quote_snapshot.reviewData.* which matches
 * the real SAVE_ALLOWLIST shape (see src/utils/quickbooksExport.notes.md
 * for Phase 0 source-verification findings).
 */

// ─── Public helpers (testable) ────────────────────────────────────────

export function sanitiseItemName(name) {
  if (!name) return '';
  return String(name)
    .replace(/[#%&]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
}

export function sanitiseCustomerName(name) {
  if (!name) return 'Unknown Customer';
  const trimmed = String(name)
    .replace(/,/g, ' -')
    .replace(/\s+/g, ' ')
    .trim();
  if (trimmed === '') return 'Unknown Customer';
  return trimmed.slice(0, 100);
}

export function formatMoney(n) {
  if (n === null || n === undefined) return '0.00';
  const num = Number(n);
  if (Number.isNaN(num)) return '0.00';
  return num.toFixed(2);
}

export function formatQuantity(n) {
  if (n === null || n === undefined) return '1';
  const num = Number(n);
  if (Number.isNaN(num)) return '1';
  // 3-decimal cap. Number() drops trailing zeros so 4.500 → 4.5, 5 → 5.
  return Number(num.toFixed(3)).toString();
}

export function parseUKDate(input) {
  if (input === null || input === undefined || input === '') return null;
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  if (typeof input !== 'string') return null;

  // DD/MM/YYYY or D/M/YYYY (UK trader-facing form).
  const uk = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (uk) {
    const d = new Date(Number(uk[3]), Number(uk[2]) - 1, Number(uk[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // ISO fallback (how FastQuote actually stores jobDetails.quoteDate).
  // Guard against accidentally accepting non-ISO-shaped strings via the
  // permissive Date constructor.
  if (/^\d{4}-\d{2}-\d{2}([T ]|$)/.test(input)) {
    const iso = new Date(input);
    if (!Number.isNaN(iso.getTime())) return iso;
  }
  return null;
}

export function formatDate(input) {
  const d = parseUKDate(input);
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
}

export function addDays(input, days) {
  const d = parseUKDate(input);
  if (!d) return '';
  const copy = new Date(d.getTime());
  copy.setDate(copy.getDate() + days);
  return formatDate(copy);
}

export function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // RFC 4180 — any field containing comma / quote / CR / LF must be
  // quoted; internal quotes are doubled.
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Collapse a line to qty=1 when the upstream qty × rate doesn't equal
// the saved total (within one penny). QBO recomputes amount as
// qty × rate on import, so keeping mismatched triples would drift the
// invoice total. Keeping it exact beats showing the "real" unit rate.
export function reconcileLineMath(qty, rate, amount) {
  const q = Number(qty);
  const r = Number(rate);
  const a = Number(amount);
  if (!Number.isFinite(q) || !Number.isFinite(r) || !Number.isFinite(a)) {
    return { qty: 1, rate: a, amount: a };
  }
  const computed = q * r;
  if (Math.abs(computed - a) < 0.005) {
    // Within half a penny — safe to keep the original triple so the
    // invoice preserves the unit detail (e.g. 4.5 t × £185 = £832.50).
    return { qty: q, rate: r, amount: a };
  }
  return { qty: 1, rate: a, amount: a };
}

// ─── Main exporter ────────────────────────────────────────────────────

const CSV_HEADERS = [
  'InvoiceNo',
  'Customer',
  'InvoiceDate',
  'DueDate',
  'Item(Product/Service)',
  'ItemDescription',
  'ItemQuantity',
  'ItemRate',
  'ItemAmount',
  'ItemTaxCode',
];

const DUE_DAYS_DEFAULT = 30;
const ITEM_DESCRIPTION_CAP = 500;

function csvRow(values) {
  return values.map(csvEscape).join(',');
}

/** Strip QBO-breaking chars from any text field (not just item names). */
function sanitiseText(s) {
  if (!s) return '';
  return String(s)
    .replace(/[#%&]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildQuickbooksCSV(job, profile) {
  const snapshot = job?.quote_snapshot || {};
  const reviewData = snapshot.reviewData;
  const jobDetails = snapshot.jobDetails || {};

  // No reviewData means no line-item data at all. Refuse to produce a
  // header-only CSV that QBO would silently reject.
  if (!reviewData) {
    throw new Error('Cannot export: quote snapshot is empty');
  }

  const invoiceNo = String(
    job?.quote_reference || jobDetails.quoteReference || 'DRAFT'
  ).replace(/[^A-Za-z0-9_-]/g, '-');

  const customer = sanitiseCustomerName(
    job?.client_name || jobDetails.clientName
  );

  // Prefer quoteDate from jobDetails (what the trader set) over
  // saved_at (when the row hit the DB). Fall back to saved_at if the
  // trader never entered a date.
  const dateInput =
    jobDetails.quoteDate || job?.quote_date || job?.saved_at;
  const invoiceDate = formatDate(dateInput);
  const dueDate = addDays(dateInput, DUE_DAYS_DEFAULT);

  const vatRegistered = profile?.vatRegistered === true;
  const taxCode = vatRegistered ? '20.0% S' : 'No VAT';

  const rawSiteAddress = job?.site_address || jobDetails.siteAddress || '';
  const siteAddress = sanitiseText(rawSiteAddress);
  const jobContext = siteAddress ? `Works at ${siteAddress}. ` : '';

  const materials = Array.isArray(reviewData.materials) ? reviewData.materials : [];
  const additionalCosts = Array.isArray(reviewData.additionalCosts) ? reviewData.additionalCosts : [];
  const labour = reviewData.labourEstimate || {};

  const lines = [];

  // Materials
  for (const m of materials) {
    const rawQty = Number(m.quantity ?? 1);
    const rawRate = Number(m.unitCost ?? 0);
    const amount = Number(m.totalCost ?? rawQty * rawRate);
    if (!Number.isFinite(amount) || amount <= 0) continue;  // QBO drops zero/negative
    const name = sanitiseItemName(m.description);
    const desc = sanitiseText(m.description || 'Material supply').slice(0, ITEM_DESCRIPTION_CAP);
    // If qty × rate doesn't equal the saved total (happens when upstream
    // rounding nudged totalCost — e.g. 2.5 × 185 = 462.50 but the saved
    // total is 463.00), collapse to qty=1 so QBO's own computation of
    // qty × rate produces exactly the saved total. No rounding.
    const { qty, rate } = reconcileLineMath(rawQty, rawRate, amount);
    lines.push({ name, desc, qty, rate, amount });
  }

  // Additional costs (one line each — QBO has no "other" bucket)
  for (const c of additionalCosts) {
    const amount = Number(c.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const name = sanitiseItemName(c.label);
    const desc = sanitiseText(c.label || 'Additional cost').slice(0, ITEM_DESCRIPTION_CAP);
    lines.push({ name, desc, qty: 1, rate: amount, amount });
  }

  // Labour (single rolled-up line — days × workers × rate).
  const days = Number(labour.estimatedDays ?? 0);
  const workers = Number(labour.numberOfWorkers ?? 1);
  const dayRate = Number(labour.dayRate ?? profile?.dayRate ?? 0);
  const labourAmount = days * workers * dayRate;
  if (Number.isFinite(labourAmount) && labourAmount > 0) {
    lines.push({
      name: 'Labour',
      desc: sanitiseText(`Skilled labour (${days} days \u00d7 ${workers} workers)`)
        .slice(0, ITEM_DESCRIPTION_CAP),
      qty: days * workers,
      rate: dayRate,
      amount: labourAmount,
    });
  }

  if (lines.length === 0) {
    throw new Error('Cannot export: quote has no line items');
  }

  // Prepend job context to the first line's description only. Customers
  // scanning their QBO invoice see "Works at {site}" once, up top.
  if (jobContext && lines.length > 0) {
    lines[0].desc = (jobContext + lines[0].desc).slice(0, ITEM_DESCRIPTION_CAP);
  }

  const rows = [CSV_HEADERS.join(',')];
  lines.forEach((line, idx) => {
    const first = idx === 0;
    rows.push(csvRow([
      invoiceNo,
      first ? customer : '',
      first ? invoiceDate : '',
      first ? dueDate : '',
      line.name,
      line.desc,
      formatQuantity(line.qty),
      formatMoney(line.rate),
      formatMoney(line.amount),
      taxCode,
    ]));
  });

  return rows.join('\r\n') + '\r\n';
}
