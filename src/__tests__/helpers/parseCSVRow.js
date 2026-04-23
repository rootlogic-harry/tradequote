/**
 * RFC 4180-aware CSV row parser for test assertions.
 *
 * Why not row.split(','): rows containing quoted fields with embedded
 * commas (e.g. description "Works at Brink Farm Pott, SK10 5RU...")
 * get split into too many fields, silently shifting indices and
 * checking the wrong column. Tests look green, production ships broken
 * CSVs. Use this helper everywhere.
 */
export function parseCSVRow(row) {
  const fields = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  while (i < row.length) {
    const c = row[i];
    if (inQuotes) {
      if (c === '"') {
        if (row[i + 1] === '"') {
          current += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        current += c;
        i++;
      }
    } else {
      if (c === '"') { inQuotes = true; i++; }
      else if (c === ',') { fields.push(current); current = ''; i++; }
      else { current += c; i++; }
    }
  }
  fields.push(current);
  return fields;
}
