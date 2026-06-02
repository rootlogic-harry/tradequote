/**
 * Build the TRADESMAN PROFILE preamble that's prepended to the analysis
 * user message above JOB CONTEXT.
 *
 * Three signals — region (context only), preferred stone types
 * (tiebreaker), mortar usage (prior). Each line is omitted when its
 * field is empty/null so legacy profiles produce an empty string and
 * fall straight through to JOB CONTEXT as before — backward compat
 * is preserved.
 *
 * Critical: this block describes PRIORS, not VETOES. The mortar
 * conditionality rules already in systemPrompt enforce "visible
 * mortar joints → mortar required" regardless of what the tradesman
 * usually does. The "photos always win" wording on the mortarUsage
 * line is what makes that explicit to the model.
 *
 * @param {object|null|undefined} profile
 * @returns {string} the block text, or '' if no field is populated
 */
const MORTAR_LINES = {
  rarely:
    "Mortar usage: rarely — default to dry-laid construction. Only include lime mortar / NHL / sand-and-cement when the photos show clear mortar triggers per the MORTAR section (visible mortar joints in the existing wall, mortared cope stones, render finish on a structural wall). Photos always win over this preference.",
  sometimes:
    "Mortar usage: sometimes — apply the MORTAR section's trigger rules as written. No additional prior either way.",
  often:
    "Mortar usage: often — mortared specifications are common in this tradesman's work, but the MORTAR section's trigger rules still apply. Photos always win — do not add mortar to a clearly dry-laid wall just because this tradesman often uses it.",
};

export function buildTradesmanProfileBlock(profile) {
  if (!profile || typeof profile !== 'object') return '';

  const region = typeof profile.region === 'string' ? profile.region.trim() : '';
  const stones = Array.isArray(profile.preferredStoneTypes)
    ? profile.preferredStoneTypes.filter((s) => typeof s === 'string' && s.trim())
    : [];
  const mortar = MORTAR_LINES[profile.mortarUsage] || null;

  if (!region && stones.length === 0 && !mortar) return '';

  const lines = ['TRADESMAN PROFILE'];
  if (region) lines.push(`Region: ${region} (context only — not for pricing).`);
  if (stones.length > 0) {
    lines.push(
      `Typical stone types: ${stones.join(', ')}. Use as a tiebreaker when stone type is ambiguous from the photos; defer to the photos if they clearly show a different stone.`
    );
  }
  if (mortar) lines.push(mortar);

  // Trailing newline so the block composes cleanly with JOB CONTEXT.
  return lines.join('\n') + '\n';
}
