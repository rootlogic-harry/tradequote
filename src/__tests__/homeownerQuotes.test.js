/**
 * West Yorkshire homeowner quotes — helpers + source-level wiring.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classifyPostcode,
  consentCopy,
  formatBand,
  guideBand,
  parseNotifyUserIds,
  validateAskPayload,
} from '../utils/homeownerEstimate.js';
import { isHomeownerQuotesEnabled } from '../utils/homeownerQuotesEnabled.js';
import {
  buildWallerEnquiryEmail,
  sendTransactionalEmail,
} from '../utils/sendTransactionalEmail.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const serverSrc = readFileSync(join(root, 'server.js'), 'utf8');
const routesSrc = readFileSync(join(root, 'homeownerQuotesRoutes.js'), 'utf8');
const appSrc = readFileSync(join(root, 'src/App.jsx'), 'utf8');
const sidebarSrc = readFileSync(join(root, 'src/components/Sidebar.jsx'), 'utf8');

describe('homeownerEstimate', () => {
  test('coverage: Leeds in, Skipton out', () => {
    expect(classifyPostcode('LS6 2AB').inWestYorkshire).toBe(true);
    expect(classifyPostcode('BD23 1EL').inWestYorkshire).toBe(false);
    expect(classifyPostcode('LS24').inWestYorkshire).toBe(false);
  });

  test('guide band for 14m at 1.2m', () => {
    expect(formatBand(guideBand(14, 1.2))).toBe('£2,240–£3,080');
  });

  test('notify defaults to Mark only', () => {
    expect(parseNotifyUserIds(undefined)).toEqual(['mark']);
    expect(parseNotifyUserIds('')).toEqual(['mark']);
    expect(parseNotifyUserIds('mark,paul')).toEqual(['mark', 'paul']);
  });

  test('ask payload requires consent and West Yorkshire', () => {
    const bad = validateAskPayload({
      postcode: 'BD23 1EL',
      lengthM: 14,
      heightM: 1.2,
      name: 'Jordan',
      email: 'j@example.com',
      phone: '07700900123',
      consentShare: true,
    });
    expect(bad.ok).toBe(false);
    expect(bad.errors.postcode).toMatch(/not matching/);

    const good = validateAskPayload({
      postcode: 'LS6 2AB',
      lengthM: 14,
      heightM: 1.2,
      name: 'Jordan Hale',
      email: 'jordan.hale@example.com',
      phone: '07700 900123',
      consentShare: true,
      consentMarketing: false,
      photos: [],
    });
    expect(good.ok).toBe(true);
    expect(good.band.low).toBe(2240);
  });

  test('consent copy is locked', () => {
    expect(consentCopy()).toMatch(/share my details with a local dry stone waller/);
  });
});

describe('feature flag', () => {
  test('fail-closed unless exactly true', () => {
    expect(isHomeownerQuotesEnabled({ flag: 'true' })).toBe(true);
    expect(isHomeownerQuotesEnabled({ flag: '1' })).toBe(false);
    expect(isHomeownerQuotesEnabled({})).toBe(false);
  });
});

describe('transactional email', () => {
  test('console mode when no Resend key', async () => {
    const result = await sendTransactionalEmail({
      to: 'mark@localhost.dev',
      subject: 'Test',
      text: 'Hello',
      env: {},
      logLabel: 'test',
    });
    expect(result).toEqual({ ok: true, mode: 'console' });
  });

  test('waller email carries the shared link', () => {
    const mail = buildWallerEnquiryEmail({
      wallerName: 'Mark',
      area: 'Leeds',
      lengthM: 14,
      heightLabel: 'About 1.2m',
      bandText: '£2,240–£3,080',
      quoteUrl: 'https://fastquote.uk/e/demo',
      homeownerFirstName: 'Jordan Hale',
    });
    expect(mail.subject).toMatch(/Leeds/);
    expect(mail.text).toContain('https://fastquote.uk/e/demo');
    expect(mail.text).toContain('£2,240–£3,080');
    expect(mail.text).not.toMatch(/07700/);
  });
});

describe('server wiring', () => {
  test('schema creates homeowner_quotes', () => {
    expect(serverSrc).toMatch(/CREATE TABLE IF NOT EXISTS homeowner_quotes/);
    expect(serverSrc).toMatch(/homeownerQuotesEnabled/);
    expect(serverSrc).toMatch(/registerHomeownerQuoteRoutes/);
    expect(serverSrc).toMatch(/homeowner_quote_requested/);
  });

  test('routes cover public ask, private link, admin list + outcome', () => {
    expect(routesSrc).toMatch(/app\.post\(\s*['"]\/api\/homeowner\/request['"]/);
    expect(routesSrc).toMatch(/app\.get\(\s*['"]\/api\/homeowner\/quotes\/:id['"]/);
    expect(routesSrc).toMatch(/app\.get\(\s*['"]\/api\/admin\/enquiries['"]/);
    expect(routesSrc).toMatch(/app\.patch\(\s*['"]\/api\/admin\/enquiries\/:id\/outcome['"]/);
    expect(routesSrc).toMatch(/requireAdminPlan/);
    expect(routesSrc).toMatch(/HOMEOWNER_NOTIFY_USER_IDS/);
    expect(routesSrc).toMatch(/parseNotifyUserIds/);
  });

  test('admin SPA has Enquiries panel', () => {
    expect(appSrc).toMatch(/Enquiries/);
    expect(appSrc).toMatch(/homeownerQuotesEnabled/);
    expect(appSrc).toMatch(/currentView === 'enquiries'/);
    expect(sidebarSrc).toMatch(/Enquiries/);
    expect(sidebarSrc).toMatch(/onGoToEnquiries/);
  });

  test('landing offers Get a quote and Waller sign in', () => {
    expect(serverSrc).toMatch(/Get a quote/);
    expect(serverSrc).toMatch(/Waller sign in/);
    expect(serverSrc).toMatch(/Quotes for customers/);
  });
});
