// Neutralizes CSV/spreadsheet formula injection. If a text cell starts with a character
// that Excel/Sheets/LibreOffice would interpret as the start of a formula (=, +, -, @, or
// a leading tab/CR), prefix it with a single quote so it's forced to render as plain text
// instead of being evaluated — this is the standard mitigation for CSV injection. Numeric
// cells are left completely untouched (never stringified/quoted), so totals still import
// as real numbers, not text.
export function sanitizeCell(v: string | number): string | number {
  if (typeof v === 'number') return v
  const s = String(v)
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => `"${String(sanitizeCell(c)).replace(/"/g, '""')}"`).join(',')).join('\n')
}
