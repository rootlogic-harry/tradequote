/**
 * Thin transactional send. Resend when RESEND_API_KEY is set;
 * otherwise logs to stdout so local/dev can exercise the flow.
 *
 * Never logs the full body if it may contain a phone number — callers
 * pass a short `logLabel` instead.
 */

/**
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.text
 * @param {string} [opts.from]
 * @param {string} [opts.logLabel]
 * @param {object} [opts.env]
 * @param {typeof fetch} [opts.fetchImpl]
 * @returns {Promise<{ ok: boolean, mode: 'resend'|'console', id?: string, error?: string }>}
 */
export async function sendTransactionalEmail({
  to,
  subject,
  text,
  from,
  logLabel = 'transactional',
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!to || !subject || !text) {
    return { ok: false, mode: 'console', error: 'missing to/subject/text' };
  }

  const apiKey = env.RESEND_API_KEY;
  const fromAddress = from
    || env.RESEND_FROM
    || 'FastQuote <onboarding@resend.dev>';

  if (!apiKey) {
    console.log(`[email:console] ${logLabel} → ${to} · ${subject}`);
    return { ok: true, mode: 'console' };
  }

  try {
    const res = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [to],
        subject,
        text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      console.warn(`[email:resend] ${logLabel} failed status=${res.status} ${detail.slice(0, 200)}`);
      return { ok: false, mode: 'resend', error: `status ${res.status}` };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: true, mode: 'resend', id: data.id };
  } catch (err) {
    console.warn(`[email:resend] ${logLabel} error: ${err?.message || err}`);
    return { ok: false, mode: 'resend', error: err?.message || 'send failed' };
  }
}

export function buildWallerEnquiryEmail({
  wallerName,
  area,
  lengthM,
  heightLabel,
  bandText,
  quoteUrl,
  homeownerFirstName,
}) {
  const first = String(homeownerFirstName || 'A homeowner').split(/\s+/)[0];
  const subject = `New enquiry in ${area} — ${lengthM}m, ${bandText}`;
  const text = [
    `Hi ${wallerName || 'there'},`,
    '',
    `${first} in ${area} has asked for a quote on a ${lengthM} metre wall (${heightLabel}).`,
    '',
    `Guide price they saw: ${bandText}. Before VAT. A site visit is required. This is not your quote.`,
    '',
    'Open the private link for their phone number and photos:',
    quoteUrl,
    '',
    '— FastQuote',
  ].join('\n');
  return { subject, text };
}
