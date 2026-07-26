import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Database,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  MapPin,
  PackageSearch,
  RefreshCw,
  Route,
  ShieldCheck,
  Upload,
  Users,
  XCircle,
} from 'lucide-react'
import { Badge, Card } from '../components/ui'
import { supabase } from '../lib/supabase'

type ModuleKey = 'locations' | 'machines' | 'planograms' | 'machine_logs' | 'restocks' | 'staffing' | 'products' | 'gis'
type ImportStatus = 'complete' | 'needs_update' | 'missing'

type ModuleSummary = {
  key: ModuleKey
  title: string
  description: string
  count: number
  unit: string
  status: ImportStatus
  required: boolean
  dependency: string
  to: string
  actionLabel: string
  icon: typeof Upload
  detail?: string
}

type DataQualityItem = {
  label: string
  count: number
  severity: 'good' | 'warning' | 'error'
  to: string
}

type ImportHistoryRow = {
  id: string
  imported_at: string
  module_name: string
  source_file: string | null
  records_received: number
  records_inserted: number
  records_updated: number
  records_skipped: number
  records_rejected: number
  status: string
}

type SummaryPayload = {
  locations: number
  machines: number
  planogram_machines: number
  planogram_selections: number
  machine_events: number
  restock_events: number
  technicians: number
  products: number
  locations_missing_coordinates: number
  machines_without_planograms: number
  planograms_without_machine: number
  events_without_machine: number
  restocks_without_machine: number
  restocks_without_technician: number
}

const emptySummary: SummaryPayload = {
  locations: 0,
  machines: 0,
  planogram_machines: 0,
  planogram_selections: 0,
  machine_events: 0,
  restock_events: 0,
  technicians: 0,
  products: 0,
  locations_missing_coordinates: 0,
  machines_without_planograms: 0,
  planograms_without_machine: 0,
  events_without_machine: 0,
  restocks_without_machine: 0,
  restocks_without_technician: 0,
}

function statusTone(status: ImportStatus) {
  if (status === 'complete') return 'green' as const
  if (status === 'needs_update') return 'yellow' as const
  return 'red' as const
}

function statusLabel(status: ImportStatus) {
  if (status === 'complete') return 'Complete'
  if (status === 'needs_update') return 'Needs Update'
  return 'Missing'
}

function qualityIcon(severity: DataQualityItem['severity']) {
  if (severity === 'good') return <CheckCircle2 className="text-emerald-600" size={18} />
  if (severity === 'warning') return <AlertTriangle className="text-amber-600" size={18} />
  return <XCircle className="text-rose-600" size={18} />
}

async function fallbackCount(table: string, filter?: (query: any) => any) {
  if (!supabase) return 0
  let query: any = supabase.from(table).select('*', { count: 'exact', head: true })
  if (filter) query = filter(query)
  const { count, error } = await query
  if (error) return 0
  return count ?? 0
}

export default function DataManagement() {
  const [summary, setSummary] = useState<SummaryPayload>(emptySummary)
  const [history, setHistory] = useState<ImportHistoryRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    if (!supabase) {
      setError('Supabase is not configured. Add the project URL and publishable key to .env.local.')
      setLoading(false)
      return
    }

    const { data: rpcData, error: rpcError } = await supabase.rpc('get_data_management_summary')
    if (!rpcError && rpcData) {
      const payload = Array.isArray(rpcData) ? rpcData[0] : rpcData
      setSummary({ ...emptySummary, ...payload })
    } else {
      const [locations, machines, planogramSelections, machineEvents, restockEvents, technicians] = await Promise.all([
        fallbackCount('locations'),
        fallbackCount('machines'),
        fallbackCount('machine_planogram_items'),
        fallbackCount('machine_events'),
        fallbackCount('restock_events'),
        fallbackCount('technicians'),
      ])
      setSummary((current) => ({
        ...current,
        locations,
        machines,
        planogram_selections: planogramSelections,
        machine_events: machineEvents,
        restock_events: restockEvents,
        technicians,
      }))
      if (rpcError) setError('The detailed readiness function is not installed yet. Basic table counts are shown.')
    }

    const { data: historyData } = await supabase
      .from('data_import_history')
      .select('id,imported_at,module_name,source_file,records_received,records_inserted,records_updated,records_skipped,records_rejected,status')
      .order('imported_at', { ascending: false })
      .limit(20)
    setHistory((historyData as ImportHistoryRow[] | null) ?? [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const modules = useMemo<ModuleSummary[]>(() => {
    const planogramStatus: ImportStatus = summary.planogram_machines === 0 ? 'missing' : summary.machines_without_planograms > 0 ? 'needs_update' : 'complete'
    const machineStatus: ImportStatus = summary.machines === 0 ? 'missing' : summary.machines < summary.locations ? 'needs_update' : 'complete'
    const locationStatus: ImportStatus = summary.locations > 0 ? 'complete' : 'missing'
    return [
      {
        key: 'locations',
        title: 'Locations',
        description: 'Agency, location name, WTN identifier, address, status, and coordinates.',
        count: summary.locations,
        unit: 'locations',
        status: locationStatus,
        required: true,
        dependency: 'None',
        to: '/locations',
        actionLabel: 'Open Location Import',
        icon: MapPin,
      },
      {
        key: 'machines',
        title: 'Machines',
        description: 'Synchronize the internal machine directory from location WTN identifiers.',
        count: summary.machines,
        unit: 'machines',
        status: machineStatus,
        required: true,
        dependency: 'Locations',
        to: '/machines',
        actionLabel: 'Open Machine Directory',
        icon: Boxes,
      },
      {
        key: 'planograms',
        title: 'Planograms',
        description: 'Import PDF or CSV selection layouts, products, PAR, critical, low, and maximum levels.',
        count: summary.planogram_machines,
        unit: 'machines covered',
        status: planogramStatus,
        required: true,
        dependency: 'Machines',
        to: '/machines',
        actionLabel: 'Choose Machine to Import',
        icon: FileText,
        detail: `${summary.planogram_selections.toLocaleString()} selection records`,
      },
      {
        key: 'machine_logs',
        title: 'Machine Logs',
        description: 'Import telemetry, dispensing, error, stockout, and interaction history with machine matching.',
        count: summary.machine_events,
        unit: 'events',
        status: summary.machine_events > 0 ? 'complete' : 'missing',
        required: false,
        dependency: 'Machines',
        to: '/machine-logs',
        actionLabel: 'Open Machine Log Import',
        icon: Upload,
      },
      {
        key: 'restocks',
        title: 'Restock History',
        description: 'Import restock dates, quantities, selections, products, and anonymous technician resources.',
        count: summary.restock_events,
        unit: 'restock rows',
        status: summary.restock_events > 0 ? 'complete' : 'needs_update',
        required: false,
        dependency: 'Machines',
        to: '/staffing',
        actionLabel: 'Open Restock Import',
        icon: PackageSearch,
      },
      {
        key: 'staffing',
        title: 'Staffing Resources',
        description: 'Anonymous technician-resource counts and service capacity derived from restock history.',
        count: summary.technicians,
        unit: 'technician resources',
        status: summary.technicians > 0 ? 'complete' : 'needs_update',
        required: false,
        dependency: 'Restock History',
        to: '/staffing',
        actionLabel: 'Open Staffing',
        icon: Users,
      },
      {
        key: 'products',
        title: 'Products',
        description: 'Product names and item identifiers currently derived from imported planograms.',
        count: summary.products,
        unit: 'distinct products',
        status: summary.products > 0 ? 'complete' : 'needs_update',
        required: false,
        dependency: 'Planograms',
        to: '/machines',
        actionLabel: 'Review Products',
        icon: FileSpreadsheet,
      },
      {
        key: 'gis',
        title: 'GIS & Coordinates',
        description: 'Latitude and longitude used for maps, coverage, equity, and route analysis.',
        count: Math.max(0, summary.locations - summary.locations_missing_coordinates),
        unit: 'geocoded locations',
        status: summary.locations === 0 ? 'missing' : summary.locations_missing_coordinates > 0 ? 'needs_update' : 'complete',
        required: false,
        dependency: 'Locations',
        to: '/locations',
        actionLabel: 'Review Location Coordinates',
        icon: Route,
      },
    ]
  }, [summary])

  const readiness = useMemo(() => {
    const weights: Record<ModuleKey, number> = {
      locations: 20,
      machines: 15,
      planograms: 20,
      machine_logs: 15,
      restocks: 10,
      staffing: 5,
      products: 5,
      gis: 10,
    }
    return Math.round(modules.reduce((total, module) => {
      const factor = module.status === 'complete' ? 1 : module.status === 'needs_update' ? 0.5 : 0
      return total + weights[module.key] * factor
    }, 0))
  }, [modules])

  const qualityItems = useMemo<DataQualityItem[]>(() => [
    { label: 'Locations missing coordinates', count: summary.locations_missing_coordinates, severity: summary.locations_missing_coordinates ? 'warning' : 'good', to: '/locations' },
    { label: 'Machines without planograms', count: summary.machines_without_planograms, severity: summary.machines_without_planograms ? 'warning' : 'good', to: '/machines' },
    { label: 'Planogram records without a matched machine', count: summary.planograms_without_machine, severity: summary.planograms_without_machine ? 'error' : 'good', to: '/machines' },
    { label: 'Machine events without a matched machine', count: summary.events_without_machine, severity: summary.events_without_machine ? 'error' : 'good', to: '/machine-logs' },
    { label: 'Restock rows without a matched machine', count: summary.restocks_without_machine, severity: summary.restocks_without_machine ? 'error' : 'good', to: '/staffing' },
    { label: 'Restock rows without a technician resource', count: summary.restocks_without_technician, severity: summary.restocks_without_technician ? 'warning' : 'good', to: '/staffing' },
  ], [summary])

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Phase 1 — Data Management</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-950">Imports & Data Readiness</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">Reference page for every dataset that feeds operations and Phase 2 decision support. Import in dependency order, review matching, and resolve data-quality exceptions before running optimization models.</p>
      </div>
      <button onClick={() => void load()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>Refresh Status</button>
    </div>

    {error ? <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</div> : null}

    <Card className="overflow-hidden p-0">
      <div className="grid gap-5 bg-slate-950 p-6 text-white lg:grid-cols-[220px_1fr]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.18em] text-blue-300">System Readiness</p>
          <div className="mt-2 flex items-end gap-2"><span className="text-5xl font-bold">{readiness}%</span><span className="pb-1 text-sm text-slate-400">ready for analysis</span></div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${readiness}%` }}/></div>
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Locations', summary.locations],
            ['Machines', summary.machines],
            ['Planogram Selections', summary.planogram_selections],
            ['Machine Events', summary.machine_events],
            ['Restock Rows', summary.restock_events],
            ['Technician Resources', summary.technicians],
            ['Products', summary.products],
            ['Geocoded', Math.max(0, summary.locations - summary.locations_missing_coordinates)],
          ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3"><p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-xl font-bold">{Number(value).toLocaleString()}</p></div>)}
        </div>
      </div>
    </Card>

    <section>
      <div className="mb-3 flex items-end justify-between"><div><h2 className="text-xl font-bold text-slate-950">Import Sources</h2><p className="text-sm text-slate-500">Open the existing module that owns each import workflow.</p></div></div>
      <div className="grid gap-4 xl:grid-cols-2">
        {modules.map((module, index) => {
          const Icon = module.icon
          return <Card key={module.key} className="p-0 overflow-hidden">
            <div className="flex items-start gap-4 p-5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-700"><Icon size={21}/></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-bold text-slate-400">STEP {index + 1}</span><h3 className="text-lg font-bold text-slate-900">{module.title}</h3><Badge tone={statusTone(module.status)}>{statusLabel(module.status)}</Badge>{module.required ? <Badge tone="blue">Required</Badge> : <Badge>Supporting</Badge>}</div>
                <p className="mt-2 text-sm leading-6 text-slate-600">{module.description}</p>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-500"><span><b className="text-slate-700">Records:</b> {module.count.toLocaleString()} {module.unit}</span><span><b className="text-slate-700">Depends on:</b> {module.dependency}</span>{module.detail ? <span>{module.detail}</span> : null}</div>
              </div>
            </div>
            <Link to={module.to} className="flex items-center justify-between border-t border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-blue-700 hover:bg-blue-50"><span>{module.actionLabel}</span><ChevronRight size={17}/></Link>
          </Card>
        })}
      </div>
    </section>

    <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
      <Card>
        <div className="flex items-center gap-3"><ShieldCheck className="text-blue-700"/><div><h2 className="text-xl font-bold text-slate-950">Data Quality</h2><p className="text-sm text-slate-500">Exceptions that can weaken reporting, forecasting, or optimization.</p></div></div>
        <div className="mt-4 divide-y divide-slate-200">
          {qualityItems.map(item => <Link key={item.label} to={item.to} className="flex items-center gap-3 py-3 hover:bg-slate-50"><div>{qualityIcon(item.severity)}</div><span className="flex-1 text-sm font-medium text-slate-700">{item.label}</span><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${item.count === 0 ? 'bg-emerald-100 text-emerald-700' : item.severity === 'error' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'}`}>{item.count.toLocaleString()}</span><ChevronRight size={16} className="text-slate-400"/></Link>)}
        </div>
      </Card>

      <Card>
        <div className="flex items-center gap-3"><Database className="text-blue-700"/><div><h2 className="text-xl font-bold text-slate-950">Data Dependencies</h2><p className="text-sm text-slate-500">Recommended load order for a clean system.</p></div></div>
        <div className="mt-5 space-y-2">
          {[
            ['Locations', 'Machines'],
            ['Machines', 'Planograms'],
            ['Machines', 'Machine Logs'],
            ['Machines', 'Restock History'],
            ['Restock History', 'Staffing Capacity'],
            ['Locations', 'GIS & Equity'],
            ['All Phase 1 Data', 'Phase 2 Optimization'],
          ].map(([from, to]) => <div key={`${from}-${to}`} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-2.5"><CircleDot size={14} className="text-blue-600"/><span className="flex-1 text-sm font-semibold text-slate-700">{from}</span><ChevronRight size={15} className="text-slate-400"/><span className="flex-1 text-sm text-slate-600">{to}</span></div>)}
        </div>
      </Card>
    </div>

    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-3"><History className="text-blue-700"/><div><h2 className="text-xl font-bold text-slate-950">Import History</h2><p className="text-sm text-slate-500">Audit trail for imports that register a history record.</p></div></div><a href="/sample-imports/RestockSummaryReport-sample.csv" download className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={15}/>Sample Restock CSV</a></div>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead><tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500"><th className="py-3 pr-4">Date</th><th className="py-3 pr-4">Module</th><th className="py-3 pr-4">File</th><th className="py-3 pr-4 text-right">Received</th><th className="py-3 pr-4 text-right">Inserted</th><th className="py-3 pr-4 text-right">Updated</th><th className="py-3 pr-4 text-right">Skipped</th><th className="py-3 pr-4 text-right">Rejected</th><th className="py-3">Status</th></tr></thead>
          <tbody>{history.length ? history.map(row => <tr key={row.id} className="border-b border-slate-100"><td className="py-3 pr-4 whitespace-nowrap">{new Date(row.imported_at).toLocaleString()}</td><td className="py-3 pr-4 font-semibold">{row.module_name}</td><td className="max-w-[220px] truncate py-3 pr-4">{row.source_file || '—'}</td><td className="py-3 pr-4 text-right">{row.records_received}</td><td className="py-3 pr-4 text-right">{row.records_inserted}</td><td className="py-3 pr-4 text-right">{row.records_updated}</td><td className="py-3 pr-4 text-right">{row.records_skipped}</td><td className="py-3 pr-4 text-right">{row.records_rejected}</td><td className="py-3"><Badge tone={row.status === 'completed' ? 'green' : row.status === 'failed' ? 'red' : 'yellow'}>{row.status}</Badge></td></tr>) : <tr><td colSpan={9} className="py-10 text-center text-slate-500">No import-history entries have been recorded yet. Existing imported data remains available in its source tables.</td></tr>}</tbody>
        </table>
      </div>
    </Card>
  </div>
}
