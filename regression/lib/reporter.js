/**
 * Render the suite output as Markdown so it can be diffed across runs
 * and pasted into PRs / commit bodies.
 *
 * Inputs are pure data structures — no I/O, no Date.now() here. The
 * runner builds the input; this module turns it into markdown.
 *
 * Shape of fixtureReport (per fixture):
 *   {
 *     fixture: { id, name },
 *     summary: { totalRuns, passRate, fields: [...], perRun: [...] },
 *     deltas:  null | { overall, fields, promptVersionMismatch },
 *     error:   null | "..."
 *   }
 *
 * Top-level `promptVersion` (optional) is stamped into the header so
 * the reader can tell at a glance whether two reports compared the
 * same prompt.
 */

function fmt(n, digits = 0) {
  if (n == null || !Number.isFinite(n)) return '—';
  return Number(n).toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function fmtPercent(n, digits = 1) {
  if (n == null || !Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

function passRateOf(field) {
  if (!field || !field.totalRuns) return null;
  return field.passCount / field.totalRuns;
}

// Render a single numeric-field row. If `delta` is supplied, mean + passRate
// columns include a "was → now" arrow so regressions are obvious at a glance.
function numericFieldRow(field, delta) {
  const meanCell = delta && delta.wasMean != null
    ? `${fmt(delta.wasMean, 1)} → ${fmt(field.mean, 1)}`
    : fmt(field.mean, 1);
  const nowPass = passRateOf(field);
  const passRateCell = delta && delta.wasPassRate != null
    ? `${fmtPercent(delta.wasPassRate)} → ${fmtPercent(nowPass)}`
    : fmtPercent(nowPass);
  return [
    `\`${field.field}\``,
    meanCell,
    fmt(field.stdDev, 1),
    `${fmt(field.min, 1)} – ${fmt(field.max, 1)}`,
    `${field.passCount} / ${field.totalRuns}`,
    passRateCell,
  ];
}

function materialFieldRow(field, delta) {
  const verdict = field.forbidden
    ? field.passCount === field.totalRuns
      ? 'never present'
      : `present in ${field.totalRuns - field.passCount}/${field.totalRuns}`
    : field.passCount === field.totalRuns
      ? 'always present'
      : `missing in ${field.totalRuns - field.passCount}/${field.totalRuns}`;
  const nowPass = passRateOf(field);
  const passRateCell = delta && delta.wasPassRate != null
    ? `${fmtPercent(delta.wasPassRate)} → ${fmtPercent(nowPass)}`
    : fmtPercent(nowPass);
  return [
    `\`${field.field}\`${field.forbidden ? ' (forbidden)' : ''}`,
    verdict,
    `${field.passCount} / ${field.totalRuns}`,
    passRateCell,
  ];
}

function table(rows, header) {
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => String(r[i] || '').length))
  );
  const pad = (cells) =>
    `| ${cells.map((c, i) => String(c || '').padEnd(widths[i])).join(' | ')} |`;
  const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [pad(header), sep, ...rows.map(pad)].join('\n');
}

// ────── PII redaction for raw model output (item 3) ──────
//
// The analysis JSON we capture is typically just numbers + trade
// descriptions, but the briefNotes input the model echoes back can
// occasionally include free-text contact info. Apply the same two
// catch-all sweeps the staging dump sanitiser uses:
//   - email pattern → [redacted-email]
//   - UK mobile pattern → [redacted-phone]
//
// Operates on the JSON-stringified text so we don't have to walk the
// raw object shape (which varies). Other identifiers (full names,
// addresses) live in fixture inputs, not in analysis output — by the
// time the model is producing JSON it's emitting measurements and
// costs, not the tradesman's contact card. If a future schema change
// makes that no longer true, expand this list.
export function redactRaw(raw) {
  if (raw == null) return '';
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2);
  return text
    .replace(/(?<!\w)[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}(?!\w)/g, '[redacted-email]')
    .replace(/(?<!\d)(?:\+44\s?|0)7\d{3}\s?\d{6}(?!\d)/g, '[redacted-phone]');
}

// ────── main renderer ──────

export function renderReport({
  generatedAt,
  baseUrl,
  iterations,
  fixtureReports,
  promptVersion,
}) {
  const lines = [];
  lines.push(`# FastQuote regression run`);
  lines.push('');
  lines.push(`- **When**: ${generatedAt}`);
  lines.push(`- **Endpoint**: \`${baseUrl}\``);
  lines.push(`- **Iterations per fixture**: ${iterations}`);
  lines.push(`- **Fixtures**: ${fixtureReports.length}`);
  if (promptVersion) {
    lines.push(`- **Prompt version**: \`${promptVersion}\``);
  }
  lines.push('');

  const allPassed = fixtureReports.every(
    (r) => r.summary?.passRate === 1 && !r.error
  );
  lines.push(`**Overall**: ${allPassed ? 'all fixtures within tolerance' : 'at least one fixture out of tolerance'}`);
  lines.push('');

  for (const r of fixtureReports) {
    lines.push(`## ${r.fixture.name || r.fixture.id}`);
    lines.push('');
    if (r.error) {
      lines.push(`- **Status**: error — \`${r.error}\``);
      lines.push('');
      continue;
    }

    // Overall pass-rate, with delta if a baseline existed.
    const summary = r.summary || { passRate: 0, totalRuns: 0, fields: [] };
    const passDelta = r.deltas?.overall;
    const passPart = passDelta
      ? `**${fmtPercent(summary.passRate)}** (was ${fmtPercent(passDelta.was)} / now ${fmtPercent(passDelta.now)})`
      : `**${fmtPercent(summary.passRate)}**`;
    lines.push(`- Pass rate: ${passPart} (${Math.round(summary.passRate * summary.totalRuns)} / ${summary.totalRuns} runs in tolerance)`);

    if (r.deltas?.promptVersionMismatch) {
      const { baseline, current } = r.deltas.promptVersionMismatch;
      lines.push(`- **Warning**: baseline was prompt \`${baseline}\`, this run is prompt \`${current}\` — deltas may not be comparable.`);
    }
    lines.push('');

    const numericFields = (summary.fields || []).filter((f) => f.kind === 'numeric');
    if (numericFields.length > 0) {
      const rows = numericFields.map((f) =>
        numericFieldRow(f, r.deltas?.fields?.[f.field])
      );
      lines.push('### Numeric fields');
      lines.push('');
      lines.push(
        table(rows, ['Field', 'Mean', 'Std dev', 'Range', 'Pass / Runs', 'Pass rate'])
      );
      lines.push('');
    }

    const materialFields = (summary.fields || []).filter((f) => f.kind === 'material');
    if (materialFields.length > 0) {
      const rows = materialFields.map((f) =>
        materialFieldRow(f, r.deltas?.fields?.[f.field])
      );
      lines.push('### Material composition');
      lines.push('');
      lines.push(
        table(rows, ['Item', 'Verdict', 'Pass / Runs', 'Pass rate'])
      );
      lines.push('');
    }

    // Raw model output on failure (item 3). For each iteration that
    // failed at least one field, emit a collapsible <details> block
    // containing the redacted raw JSON the model produced. This is the
    // bit that turns "expected 4500, got 3200" into "and here's exactly
    // what the model said" — saves a manual re-run during debugging.
    const failedRuns = (summary.perRun || [])
      .map((run, idx) => ({ run, idx }))
      .filter(({ run }) => run && Array.isArray(run.fields) && run.fields.some((f) => !f.pass));
    if (failedRuns.length > 0) {
      lines.push('### Raw model output (failed iterations)');
      lines.push('');
      for (const { run, idx } of failedRuns) {
        if (run.raw == null) continue;
        lines.push(`<details>`);
        lines.push(`<summary>Iteration ${idx + 1} — raw model output</summary>`);
        lines.push('');
        lines.push('```json');
        lines.push(redactRaw(run.raw));
        lines.push('```');
        lines.push('');
        lines.push(`</details>`);
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('Compare this report to the previous run. A drop in pass rate, a widened std dev, or a mean shift away from the fixture\'s ground truth means a regression.');
  return lines.join('\n');
}
