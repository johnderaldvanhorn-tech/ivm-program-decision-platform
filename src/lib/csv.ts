export type CsvRow = Record<string, string>

function escapeCsvValue(value: unknown): string {
  const text = value == null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv<T extends Record<string, unknown>>(rows: T[], headers: string[]): string {
  const lines = [headers.map(escapeCsvValue).join(',')]
  for (const row of rows) lines.push(headers.map((header) => escapeCsvValue(row[header])).join(','))
  return lines.join('\r\n')
}

export function downloadTextFile(filename: string, content: string, type = 'text/csv;charset=utf-8;') {
  const blob = new Blob(['\uFEFF', content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

export function parseCsv(text: string): CsvRow[] {
  const matrix: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]

    if (char === '"') {
      if (quoted && next === '"') {
        field += '"'
        i += 1
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') i += 1
      row.push(field)
      if (row.some((value) => value.trim() !== '')) matrix.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }

  row.push(field)
  if (row.some((value) => value.trim() !== '')) matrix.push(row)
  if (matrix.length < 2) return []

  const headers = matrix[0].map((header) => header.trim().replace(/^\uFEFF/, ''))
  return matrix.slice(1).map((values) =>
    Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? '').trim()])),
  )
}
