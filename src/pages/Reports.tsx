import { useEffect, useMemo, useState } from 'react'
import {
  BarChart3,
  Download,
  FileDown,
  FileSpreadsheet,
  Filter,
  Loader2,
  Printer,
  RefreshCw,
} from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Card, inputClass } from '../components/ui'
import {
  buildReport,
  loadReportingData,
  reportDefinitions,
  type ReportFilters,
  type ReportKey,
  type ReportingData,
} from '../lib/reporting'
import { exportReportCsv, exportReportExcel, exportReportPdf, printReport } from '../lib/reportExport'

const defaultFilters: ReportFilters = {
  agency: '',
  locationId: '',
  machineUuid: '',
  product: '',
  narcanOnly: false,
  startDate: '',
  endDate: '',
}

function valueTone(value: string) {
  const number = Number(value.replace(/[^0-9.-]/g, ''))
  if (!Number.isFinite(number)) return 'slate' as const
  if (value.includes('%')) {
    if (number >= 80) return 'green' as const
    if (number >= 50) return 'yellow' as const
    return 'red' as const
  }
  return 'blue' as const
}

export default function Reports() {
  const [data, setData] = useState<ReportingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reportKey, setReportKey] = useState<ReportKey>('executive')
  const [filters, setFilters] = useState<ReportFilters>(defaultFilters)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      setData(await loadReportingData())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The reporting data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const agencies = useMemo(() => [...new Set((data?.locations ?? []).map((l) => l.agency).filter(Boolean))].sort(), [data])
  const locations = useMemo(() => (data?.locations ?? []).filter((l) => !filters.agency || l.agency === filters.agency), [data, filters.agency])
  const machines = useMemo(() => {
    const allowedLocationIds = new Set(locations.map((l) => l.id))
    return (data?.machines ?? []).filter((m) => !filters.locationId ? allowedLocationIds.has(m.location_id) : m.location_id === filters.locationId)
  }, [data, locations, filters.locationId])
  const products = useMemo(() => [...new Set((data?.planogram ?? []).map((p) => p.product_name).filter(Boolean))].sort(), [data])
  const report = useMemo(() => data ? buildReport(reportKey, data, filters) : null, [data, reportKey, filters])

  const groupedDefinitions = useMemo(() => {
    const groups = new Map<string, typeof reportDefinitions>()
    reportDefinitions.forEach((definition) => groups.set(definition.group, [...(groups.get(definition.group) ?? []), definition]))
    return [...groups.entries()]
  }, [])

  return (
    <div className="space-y-5 report-root">
      <div className="flex items-start justify-between gap-6 print:hidden">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Reporting & Analytics</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">Decision Reports</h1>
          <p className="mt-2 max-w-3xl text-slate-500">Live, filterable reports aligned to placement and access, inventory availability, service capacity, and dissertation analysis.</p>
        </div>
        <button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50">
          <RefreshCw size={16} /> Reload Data
        </button>
      </div>

      <div className="grid grid-cols-[250px_minmax(0,1fr)] gap-5 print:block">
        <Card className="h-fit p-3 print:hidden">
          {groupedDefinitions.map(([group, definitions]) => (
            <div key={group} className="mb-4 last:mb-0">
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-[.14em] text-slate-400">{group}</p>
              <div className="space-y-1">
                {definitions.map((definition) => (
                  <button
                    key={definition.key}
                    onClick={() => setReportKey(definition.key)}
                    className={`w-full rounded-xl px-3 py-2.5 text-left transition ${reportKey === definition.key ? 'bg-blue-600 text-white' : 'hover:bg-slate-100'}`}
                  >
                    <p className="text-sm font-semibold">{definition.label}</p>
                    <p className={`mt-0.5 text-[11px] leading-4 ${reportKey === definition.key ? 'text-blue-100' : 'text-slate-500'}`}>{definition.description}</p>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>

        <div className="min-w-0 space-y-5">
          <Card className="p-4 print:hidden">
            <div className="flex items-center gap-2 text-sm font-bold text-slate-800"><Filter size={16} /> Report Filters</div>
            <div className="mt-3 grid grid-cols-4 gap-3">
              <select className={inputClass} value={filters.agency} onChange={(e) => setFilters({ ...filters, agency: e.target.value, locationId: '', machineUuid: '' })}>
                <option value="">All agencies</option>{agencies.map((agency) => <option key={agency}>{agency}</option>)}
              </select>
              <select className={inputClass} value={filters.locationId} onChange={(e) => setFilters({ ...filters, locationId: e.target.value, machineUuid: '' })}>
                <option value="">All locations</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.location_name || location.machine_id}</option>)}
              </select>
              <select className={inputClass} value={filters.machineUuid} onChange={(e) => setFilters({ ...filters, machineUuid: e.target.value })}>
                <option value="">All machines</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.machine_id}</option>)}
              </select>
              <select className={inputClass} value={filters.product} disabled={filters.narcanOnly} onChange={(e) => setFilters({ ...filters, product: e.target.value })}>
                <option value="">All products</option>{products.map((product) => <option key={product}>{product}</option>)}
              </select>
              <input className={inputClass} type="date" value={filters.startDate} onChange={(e) => setFilters({ ...filters, startDate: e.target.value })} />
              <input className={inputClass} type="date" value={filters.endDate} onChange={(e) => setFilters({ ...filters, endDate: e.target.value })} />
              <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-medium text-slate-700">
                <input type="checkbox" checked={filters.narcanOnly} onChange={(e) => setFilters({ ...filters, narcanOnly: e.target.checked, product: '' })} /> Narcan only
              </label>
              <button onClick={() => setFilters(defaultFilters)} className="rounded-xl border border-slate-300 px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">Reset Filters</button>
            </div>
          </Card>

          {loading ? (
            <Card className="flex min-h-80 items-center justify-center"><Loader2 className="animate-spin text-blue-600" size={28} /></Card>
          ) : error ? (
            <Card><p className="font-semibold text-rose-700">{error}</p></Card>
          ) : report ? (
            <>
              <Card className="p-5 report-header">
                <div className="flex items-start justify-between gap-5">
                  <div>
                    <div className="flex items-center gap-2"><BarChart3 size={20} className="text-blue-600" /><Badge tone="blue">Live report</Badge></div>
                    <h2 className="mt-2 text-2xl font-bold text-slate-900">{report.title}</h2>
                    <p className="mt-1 text-sm text-slate-500">{report.subtitle}</p>
                    <p className="mt-2 text-xs text-slate-400">Generated {new Date(report.generatedAt).toLocaleString()}</p>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 print:hidden">
                    <button onClick={() => exportReportPdf(report)} className="inline-flex items-center gap-2 rounded-xl bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-rose-700"><FileDown size={16} /> PDF</button>
                    <button onClick={() => exportReportExcel(report)} className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><FileSpreadsheet size={16} /> Excel</button>
                    <button onClick={() => exportReportCsv(report)} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700"><Download size={16} /> CSV</button>
                    <button onClick={printReport} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Printer size={16} /> Print</button>
                  </div>
                </div>
                <div className="mt-5 grid grid-cols-4 gap-3 report-kpis">
                  {report.kpis.map((kpi) => (
                    <div key={kpi.label} className="rounded-xl bg-slate-50 p-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{kpi.label}</p>
                      <p className="mt-1 text-xl font-bold text-slate-900">{kpi.value}</p>
                      {kpi.note ? <p className="mt-1 text-xs text-slate-500">{kpi.note}</p> : null}
                    </div>
                  ))}
                </div>
              </Card>

              {report.chartData?.length ? (
                <Card className="h-80 print:hidden">
                  <div className="mb-3 flex items-center justify-between"><h3 className="font-bold text-slate-900">Comparative View</h3><Badge tone={valueTone(`${report.chartData[0]?.value ?? 0}%`)}>Primary / secondary measures</Badge></div>
                  <ResponsiveContainer width="100%" height="88%">
                    <BarChart data={report.chartData.slice(0, 20)} margin={{ left: 0, right: 12, top: 8, bottom: 40 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" angle={-25} textAnchor="end" interval={0} height={65} tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip /><Legend />
                      <Bar dataKey="value" name="Primary" fill="#2563eb" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="secondary" name="Secondary" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </Card>
              ) : null}

              {report.sections.map((section) => (
                <Card key={section.title} className="overflow-hidden p-0 report-section">
                  <div className="border-b border-slate-200 px-5 py-4">
                    <h3 className="font-bold text-slate-900">{section.title}</h3>
                    {section.description ? <p className="mt-1 text-sm text-slate-500">{section.description}</p> : null}
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
                        <tr>{section.columns.map((column) => <th key={column.key} className="whitespace-nowrap px-3 py-2.5 font-bold">{column.label}</th>)}</tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {section.rows.length ? section.rows.map((row, index) => (
                          <tr key={index} className="align-top hover:bg-slate-50">
                            {section.columns.map((column) => <td key={column.key} className="max-w-xs px-3 py-2.5 text-slate-700">{String(row[column.key] ?? '—')}</td>)}
                          </tr>
                        )) : <tr><td colSpan={section.columns.length} className="px-4 py-10 text-center text-slate-500">No records match the selected filters.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ))}

              {report.notes?.length ? <Card className="bg-amber-50"><h3 className="font-bold text-amber-900">Method Notes</h3><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-800">{report.notes.map((note) => <li key={note}>{note}</li>)}</ul></Card> : null}
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
