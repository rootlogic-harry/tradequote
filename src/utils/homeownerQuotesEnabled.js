/**
 * Homeowner quotes / West Yorkshire lead pipe feature flag.
 *
 * Same fail-closed contract as CLIENTS_ENABLED:
 *   env === 'true' → enabled
 *   anything else  → disabled
 */

export function isHomeownerQuotesEnabled({ flag } = {}) {
  return flag === 'true';
}

export function isHomeownerQuotesEnabledFromProcessEnv() {
  return process.env.HOMEOWNER_QUOTES_ENABLED === 'true';
}
