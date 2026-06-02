/**
 * Render the suite output as Markdown so it can be diffed across runs
 * and pasted into PRs / commit bodies.
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

function fieldRow(field) {
  if (field.kind === 'numeric') {
    return [
      `\`${field.field}\``,
      fmt(field.mean, 1),
      fmt(field.stdDev, 1),
      `${fmt(field.min, 1)} – ${fmt(field.max, 1)}`,
      `${field.passCount} / ${field.totalRuns}`,
    ];
  }
  // material — pass count only
  const verdict = field.forbidden
    ? field.passCount === field.totalRuns
      ? 'never present ✓'
      : `present in ${field.totalRuns - field.passCount}/${field.totalRuns}`
    : field.passCount === field.totalRuns
      ? 'always present ✓'
      : `missing in ${field.totalRuns - field.passCount}/${field.totalRuns}`;
  return [`\`${field.field}\` ${field.forbidden ? '(forbidden)' : ''}`, verdict, '', '', `${field.passCount} / ${field.totalRuns}`];
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

export function renderReport({ generatedAt, baseUrl, iterations, fixtureReports }) {
  const lines = [];
  lines.push(`# FastQuote regression run`);
  lines.push('');
  lines.push(`- **When**: ${generatedAt}`);
  lines.push(`- **Endpoint**: \`${baseUrl}\``);
  lines.push(`- **Iterations per fixture**: ${iterations}`);
  lines.push(`- **Fixtures**: ${fixtureReports.length}`);
  lines.push('');

  const allPassed = fixtureReports.every(
    (r) => r.summary.passRate === 1 && !r.error
  );
  lines.push(`**Overall**: ${allPassed ? '✓ all fixtures within tolerance' : '⚠ at least one fixture out of tolerance'}`);
  lines.push('');

  for (const r of fixtureReports) {
    lines.push(`## ${r.fixture.name || r.fixture.id}`);
    lines.push('');
    if (r.error) {
      lines.push(`- **Status**: error — \`${r.error}\``);
      lines.push('');
      continue;
    }
    lines.push(`- Pass rate: **${fmtPercent(r.summary.passRate)}** (${Math.round(r.summary.passRate * r.summary.totalRuns)} / ${r.summary.totalRuns} runs in tolerance)`);
    lines.push('');
    const numericRows = r.summary.fields
      .filter((f) => f.kind === 'numeric')
      .map(fieldRow);
    if (numericRows.length > 0) {
      lines.push('### Numeric fields');
      lines.push('');
      lines.push(
        table(numericRows, ['Field', 'Mean', 'Std dev', 'Range', 'Pass / Runs'])
      );
      lines.push('');
    }
    const materialRows = r.summary.fields
      .filter((f) => f.kind === 'material')
      .map(fieldRow);
    if (materialRows.length > 0) {
      lines.push('### Material composition');
      lines.push('');
      lines.push(table(materialRows, ['Item', 'Verdict', '', '', 'Pass / Runs']));
      lines.push('');
    }
  }

  lines.push('---');
  lines.push('');
  lines.push('Compare this report to the previous run. A drop in pass rate, a widened std dev, or a mean shift away from the fixture\'s ground truth means a regression.');
  return lines.join('\n');
}
