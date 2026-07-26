import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import * as XLSX from 'xlsx'
import type { ReportModel, ReportSection } from './reporting'

const safeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const scalar = (value: unknown) => value === null || value === undefined ? '' : String(value)

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function sectionCsv(section: ReportSection) {
  const escape = (value: unknown) => `"${scalar(value).replace(/"/g, '""')}"`
  const lines = [section.columns.map((column) => escape(column.label)).join(',')]
  section.rows.forEach((row) => lines.push(section.columns.map((column) => escape(row[column.key])).join(',')))
  return lines.join('\n')
}

export function exportReportCsv(report: ReportModel) {
  const content = report.sections.map((section) => `# ${section.title}\n${sectionCsv(section)}`).join('\n\n')
  download(new Blob([content], { type: 'text/csv;charset=utf-8' }), `${safeName(report.title)}.csv`)
}

export function exportReportExcel(report: ReportModel) {
  const workbook = XLSX.utils.book_new()
  const summary = [
    ['Report', report.title], ['Generated', new Date(report.generatedAt).toLocaleString()], [],
    ['KPI', 'Value', 'Note'], ...report.kpis.map((kpi) => [kpi.label, kpi.value, kpi.note || '']),
  ]
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(summary), 'Summary')
  report.sections.forEach((section, index) => {
    const rows = section.rows.map((row) => Object.fromEntries(section.columns.map((column) => [column.label, row[column.key] ?? ''])))
    const sheet = XLSX.utils.json_to_sheet(rows)
    XLSX.utils.book_append_sheet(workbook, sheet, `${index + 1}-${section.title}`.slice(0, 31))
  })
  XLSX.writeFile(workbook, `${safeName(report.title)}.xlsx`)
}

export function exportReportPdf(report: ReportModel) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'letter' })
  doc.setFontSize(18)
  doc.text(report.title, 36, 38)
  doc.setFontSize(9)
  doc.setTextColor(90)
  doc.text(report.subtitle, 36, 55)
  doc.text(`Generated ${new Date(report.generatedAt).toLocaleString()}`, 36, 69)
  let y = 88
  const kpiWidth = 120
  report.kpis.slice(0, 6).forEach((kpi, index) => {
    const x = 36 + (index % 6) * kpiWidth
    doc.setFillColor(244, 247, 251)
    doc.roundedRect(x, y, 108, 42, 5, 5, 'F')
    doc.setFontSize(7)
    doc.setTextColor(90)
    doc.text(kpi.label, x + 8, y + 13)
    doc.setFontSize(14)
    doc.setTextColor(23, 32, 51)
    doc.text(kpi.value, x + 8, y + 31)
  })
  y += 60
  report.sections.forEach((section, index) => {
    if (index > 0) {
      doc.addPage('letter', 'landscape')
      y = 40
    }
    doc.setFontSize(13)
    doc.setTextColor(23, 32, 51)
    doc.text(section.title, 36, y)
    autoTable(doc, {
      startY: y + 10,
      head: [section.columns.map((column) => column.label)],
      body: section.rows.map((row) => section.columns.map((column) => scalar(row[column.key]))),
      styles: { fontSize: 6.5, cellPadding: 3, overflow: 'linebreak' },
      headStyles: { fillColor: [23, 32, 51] },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 36, right: 36 },
    })
  })
  doc.save(`${safeName(report.title)}.pdf`)
}

export function printReport() {
  window.print()
}
