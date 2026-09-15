/**
 * CSV writer that neutralises spreadsheet formula injection.
 *
 * A cell beginning with = + - @ (or tab/CR, which Excel strips) is executed as
 * a formula by Excel/Sheets/LibreOffice. We prefix such *text* cells with a
 * single quote so they are shown literally. Numeric cells are written
 * unquoted and unmodified so they stay numeric in the spreadsheet.
 */
const RISKY = /^[=+\-@\t\r]/

export function escapeCsvCell(value: string | number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  let s = String(value ?? '')
  if (RISKY.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map(escapeCsvCell).join(',')).join('\r\n')
}
