import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Boxes,
  Download,
  FileText,
  MapPinned,
  PackageCheck,
  Route,
  ShieldCheck,
  Upload,
  Users,
} from 'lucide-react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Badge, Card } from '../components/ui'
import { loadReportingData, type ReportingData } from '../lib/reporting'
import { supabase } from '../lib/supabase'

type SafetyRow = {
  machine_uuid?: string
  machine_wtn_id?: string
  agency?: string
  location_name?: string
  capacity?: number | string
  current_inventory?: number | string
  average_daily_demand?: number | string
  stockout_events?: number | string
  safety_stock_units?: number | string
  reorder_point?: number | string
  order_quantity?: number | string
  restock_trigger?: string
}

type AgencyRow = {
  agency: string
  machines: number
  accessibility: number
  risk: number
  maximum: number
  events: number
  dispensed: number
  stockouts: number
  technicians: number
  orderNow: number
}

const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const asArray = (value: unknown): any[] => Array.isArray(value) ? value : value ? [value] : []
const pct = (value: number) => `${Math.round((value <= 1 ? value * 100 : value))}%`
const fmt = (value: number, digits = 0) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
const date = (value: unknown) => value ? new Date(String(value)).toLocaleDateString() : '—'

function locationScore(location: any, key: 'access' | 'risk' | 'maximum') {
  if (key === 'access') return num(asArray(location.location_access_scores)[0]?.machine_accessibility_score)
  const row = asArray(location.location_demographics)[0]
  return key === 'risk' ? num(row?.risk_score) : num(row?.maximum_location_score)
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function machineSummaryFor(data: ReportingData, machine: any) {
  return data.machineSummary.find((row) =>
    row.machine_uuid === machine.id ||
    row.machine_id === machine.machine_id ||
    row.machine_wtn_id === machine.machine_id,
  ) || {}
}

function serviceSummaryFor(data: ReportingData, machine: any) {
  return data.serviceDemand.find((row) =>
    row.machine_uuid === machine.id ||
    row.machine_id === machine.machine_id ||
    row.machine_wtn_id === machine.machine_id,
  ) || {}
}

function MetricCard({ label, value, note, tone = 'slate' }: { label: string; value: string; note: string; tone?: 'slate' | 'blue' | 'green' | 'yellow' | 'red' }) {
  const tones = {
    slate: 'border-slate-200 bg-white',
    blue: 'border-blue-200 bg-blue-50/60',
    green: 'border-emerald-200 bg-emerald-50/60',
    yellow: 'border-amber-200 bg-amber-50/60',
    red: 'border-rose-200 bg-rose-50/60',
  }
  return (
    <Card className={`border p-4 ${tones[tone]}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1.5 text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-xs text-slate-500">{note}</p>
    </Card>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<ReportingData | null>(null)
  const [safetyRows, setSafetyRows] = useState<SafetyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

  useEffect(() => {
    let mounted = true
    async function load() {
      setLoading(true)
      setMessage('')
      try {
        const reporting = await loadReportingData()
        let safety: SafetyRow[] = []
        if (supabase) {
          const end = new Date().toISOString().slice(0, 10)
          const start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
          const { data: safetyData, error } = await supabase.rpc('get_safety_stock_analysis', {
            p_start_date: start,
            p_end_date: end,
            p_product_filter: 'All Products',
          })
          if (!error) safety = (safetyData || []) as SafetyRow[]
          else console.warn('Dashboard safety stock query unavailable:', error.message)
        }
        if (mounted) {
          setData(reporting)
          setSafetyRows(safety)
        }
      } catch (error) {
        if (mounted) setMessage(error instanceof Error ? error.message : 'Dashboard data could not be loaded.')
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void load()
    return () => { mounted = false }
  }, [])

  const metrics = useMemo(() => {
    if (!data) return null
    const agencySet = new Set(data.locations.map((row) => row.agency || 'Unassigned'))
    const accessValues = data.locations.map((row) => locationScore(row, 'access'))
    const riskValues = data.locations.map((row) => locationScore(row, 'risk'))
    const maximumValues = data.locations.map((row) => locationScore(row, 'maximum'))
    const machineRows = data.machines.map((machine) => {
      const summary = machineSummaryFor(data, machine)
      const service = serviceSummaryFor(data, machine)
      const location = data.locations.find((row) => row.id === machine.location_id || row.machine_id === machine.machine_id)
      return {
        machine,
        location,
        events: num(summary.events),
        dispensed: num(summary.dispensed),
        failed: num(summary.failed),
        stockouts: num(summary.stockouts),
        firstActivity: summary.first_activity,
        lastActivity: summary.last_activity,
        visits: num(service.visits || service.restock_visits),
        technicians: num(service.technician_count),
      }
    })
    const safetyByMachine = new Map(safetyRows.map((row) => [row.machine_uuid || row.machine_wtn_id || '', row]))
    const orderNow = safetyRows.filter((row) => String(row.restock_trigger || '').toLowerCase().includes('place')).length
    const safetyWarnings = safetyRows.filter((row) => {
      const current = num(row.current_inventory)
      const reorder = num(row.reorder_point)
      return current <= reorder || num(row.stockout_events) > 0
    }).length
    const capacity = data.planogram.reduce((sum, row) => sum + num(row.max_level), 0)
    const par = data.planogram.reduce((sum, row) => sum + num(row.par_level), 0)
    const current = data.machines.reduce((sum, row) => sum + num(row.current_inventory), 0)
    const totalEvents = machineRows.reduce((sum, row) => sum + row.events, 0)
    const totalDispensed = machineRows.reduce((sum, row) => sum + row.dispensed, 0)
    const totalStockouts = machineRows.reduce((sum, row) => sum + row.stockouts, 0)
    const totalVisits = machineRows.reduce((sum, row) => sum + row.visits, 0)
    const technicianCount = data.technicianSummary.length || Math.max(0, ...machineRows.map((row) => row.technicians))
    const fillRate = capacity > 0 ? current / capacity : 0
    const agencyMap = new Map<string, AgencyRow>()
    for (const location of data.locations) {
      const agency = location.agency || 'Unassigned'
      const machine = data.machines.find((row) => row.location_id === location.id || row.machine_id === location.machine_id)
      const summary = machine ? machineSummaryFor(data, machine) : {}
      const service = machine ? serviceSummaryFor(data, machine) : {}
      const safety = machine ? (safetyByMachine.get(machine.id) || safetyByMachine.get(machine.machine_id)) : undefined
      const existing = agencyMap.get(agency) || { agency, machines: 0, accessibility: 0, risk: 0, maximum: 0, events: 0, dispensed: 0, stockouts: 0, technicians: 0, orderNow: 0 }
      existing.machines += machine ? 1 : 0
      existing.accessibility += locationScore(location, 'access')
      existing.risk += locationScore(location, 'risk')
      existing.maximum += locationScore(location, 'maximum')
      existing.events += num(summary.events)
      existing.dispensed += num(summary.dispensed)
      existing.stockouts += num(summary.stockouts)
      existing.technicians += num(service.technician_count)
      existing.orderNow += String(safety?.restock_trigger || '').toLowerCase().includes('place') ? 1 : 0
      agencyMap.set(agency, existing)
    }
    const agencyRows = [...agencyMap.values()].map((row) => ({
      ...row,
      accessibility: row.machines ? row.accessibility / row.machines : 0,
      risk: row.machines ? row.risk / row.machines : 0,
      maximum: row.machines ? row.maximum / row.machines : 0,
    })).sort((a, b) => b.dispensed - a.dispensed)
    const topMachines = [...machineRows].sort((a, b) => b.dispensed - a.dispensed).slice(0, 8)
    return {
      agencies: agencySet.size,
      locations: data.locations.length,
      machines: data.machines.length,
      activeMachines: data.machines.filter((row) => row.active).length,
      avgAccessibility: average(accessValues),
      avgRisk: average(riskValues),
      avgMaximum: average(maximumValues),
      capacity,
      par,
      current,
      fillRate,
      totalEvents,
      totalDispensed,
      totalStockouts,
      totalVisits,
      technicianCount,
      orderNow,
      safetyWarnings,
      agencyRows,
      topMachines,
    }
  }, [data, safetyRows])

  if (loading) return <Card className="p-8 text-sm text-slate-500">Loading program dashboard…</Card>
  if (!data || !metrics) return <Card className="p-8 text-sm text-rose-700">{message || 'No dashboard data is available.'}</Card>

  const attentionCount = metrics.orderNow + metrics.safetyWarnings + metrics.totalStockouts

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Live decision support</p>
          <h1 className="mt-1 text-3xl font-bold text-slate-900">Program Decision Dashboard</h1>
          <p className="mt-2 max-w-3xl text-slate-500">Current placement, demand, inventory availability, safety stock, and service-capacity performance from the operational database.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link to="/machine-logs" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Upload size={16}/>Import Logs</Link>
          <Link to="/staffing" className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Users size={16}/>Restock Data</Link>
          <Link to="/reports" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-blue-700"><FileText size={16}/>Reports</Link>
        </div>
      </div>

      {message && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{message}</div>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-6">
        <MetricCard label="Agencies" value={fmt(metrics.agencies)} note={`${fmt(metrics.locations)} locations`} tone="blue" />
        <MetricCard label="Machines" value={fmt(metrics.machines)} note={`${fmt(metrics.activeMachines)} active`} tone="blue" />
        <MetricCard label="Accessibility" value={pct(metrics.avgAccessibility)} note="Average network score" tone="green" />
        <MetricCard label="Risk" value={pct(metrics.avgRisk)} note="Average environmental risk" tone="yellow" />
        <MetricCard label="Maximum Score" value={pct(metrics.avgMaximum)} note="Risk-adjusted placement" tone={metrics.avgMaximum >= .5 ? 'green' : 'yellow'} />
        <MetricCard label="Needs Attention" value={fmt(attentionCount)} note="Orders, warnings, stockouts" tone={attentionCount ? 'red' : 'green'} />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <Card className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div><h2 className="font-bold text-slate-900">Availability and Demand</h2><p className="mt-1 text-sm text-slate-500">Live performance from machine events and planogram capacity.</p></div>
            <Link to="/machines" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700">Open machines <ArrowRight size={15}/></Link>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Imported Events</p><p className="mt-1 text-xl font-bold">{fmt(metrics.totalEvents)}</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Units Dispensed</p><p className="mt-1 text-xl font-bold">{fmt(metrics.totalDispensed)}</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Network Capacity</p><p className="mt-1 text-xl font-bold">{fmt(metrics.capacity)}</p></div>
            <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">Observed Fill Level</p><p className="mt-1 text-xl font-bold">{pct(metrics.fillRate)}</p></div>
          </div>
          <div className="mt-5 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.agencyRows.slice(0, 10)} margin={{ top: 10, right: 10, left: 0, bottom: 35 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false}/>
                <XAxis dataKey="agency" tick={{ fontSize: 11 }} angle={-20} textAnchor="end" interval={0}/>
                <YAxis tick={{ fontSize: 11 }}/>
                <Tooltip/>
                <Bar dataKey="dispensed" name="Units Dispensed" fill="#2563eb" radius={[5,5,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card className="p-5">
          <div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-900">Priority Actions</h2><p className="mt-1 text-sm text-slate-500">Items requiring operational review.</p></div><AlertTriangle size={20} className="text-amber-500"/></div>
          <div className="mt-5 space-y-3">
            {[
              { label: 'Machines requiring an order', value: metrics.orderNow, to: '/safety-stock', tone: metrics.orderNow ? 'red' : 'green' },
              { label: 'Safety-stock warnings', value: metrics.safetyWarnings, to: '/safety-stock', tone: metrics.safetyWarnings ? 'yellow' : 'green' },
              { label: 'Observed stockout events', value: metrics.totalStockouts, to: '/machine-logs', tone: metrics.totalStockouts ? 'red' : 'green' },
              { label: 'Restock visits recorded', value: metrics.totalVisits, to: '/staffing', tone: 'blue' },
            ].map((item) => (
              <Link key={item.label} to={item.to} className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-3 hover:bg-slate-50">
                <span className="text-sm font-medium text-slate-700">{item.label}</span>
                <Badge tone={item.tone as 'red'|'yellow'|'green'|'blue'}>{fmt(item.value)}</Badge>
              </Link>
            ))}
          </div>
          <div className="mt-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-blue-700">Service capacity</p>
            <div className="mt-2 flex items-end justify-between"><div><p className="text-2xl font-bold text-slate-900">{fmt(metrics.technicianCount)}</p><p className="text-xs text-slate-500">Anonymous technician resources</p></div><Users className="text-blue-600" size={24}/></div>
          </div>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="p-5">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-blue-100 p-2.5 text-blue-700"><MapPinned size={21}/></div><div><h3 className="font-bold text-slate-900">Placement & Access</h3><p className="text-xs text-slate-500">Strategic network design</p></div></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold">{pct(metrics.avgAccessibility)}</p><p className="text-[11px] text-slate-500">Access</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold">{pct(metrics.avgRisk)}</p><p className="text-[11px] text-slate-500">Risk</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold">{pct(metrics.avgMaximum)}</p><p className="text-[11px] text-slate-500">Maximum</p></div></div>
          <Link to="/locations" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-blue-700">Open locations <ArrowRight size={15}/></Link>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-100 p-2.5 text-emerald-700"><PackageCheck size={21}/></div><div><h3 className="font-bold text-slate-900">Inventory Availability</h3><p className="text-xs text-slate-500">Operational control</p></div></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold">{fmt(metrics.current)}</p><p className="text-[11px] text-slate-500">Current</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold">{fmt(metrics.par)}</p><p className="text-[11px] text-slate-500">PAR</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold">{fmt(metrics.orderNow)}</p><p className="text-[11px] text-slate-500">Orders</p></div></div>
          <Link to="/safety-stock" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-emerald-700">Open safety stock <ArrowRight size={15}/></Link>
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-3"><div className="rounded-xl bg-amber-100 p-2.5 text-amber-700"><Route size={21}/></div><div><h3 className="font-bold text-slate-900">Service Capacity</h3><p className="text-xs text-slate-500">Restocking and staffing</p></div></div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center"><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold">{fmt(metrics.technicianCount)}</p><p className="text-[11px] text-slate-500">Technicians</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold">{fmt(metrics.totalVisits)}</p><p className="text-[11px] text-slate-500">Visits</p></div><div className="rounded-lg bg-slate-50 p-3"><p className="text-lg font-bold">{metrics.technicianCount ? fmt(metrics.machines / metrics.technicianCount, 1) : '—'}</p><p className="text-[11px] text-slate-500">Machines/Tech</p></div></div>
          <Link to="/staffing" className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-amber-700">Open staffing <ArrowRight size={15}/></Link>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <Card className="overflow-hidden p-0">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-bold text-slate-900">Agency Performance</h2><p className="mt-1 text-sm text-slate-500">Placement and operational outcomes by agency.</p></div><Link to="/reports" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700">Full report <ArrowRight size={15}/></Link></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-3 text-left">Agency</th><th className="px-3 py-3 text-right">Machines</th><th className="px-3 py-3 text-right">Access</th><th className="px-3 py-3 text-right">Risk</th><th className="px-3 py-3 text-right">Dispensed</th><th className="px-3 py-3 text-right">Stockouts</th><th className="px-3 py-3 text-right">Orders</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{metrics.agencyRows.slice(0, 12).map((row) => <tr key={row.agency} className="hover:bg-slate-50"><td className="px-4 py-3 font-semibold text-slate-800">{row.agency}</td><td className="px-3 py-3 text-right">{fmt(row.machines)}</td><td className="px-3 py-3 text-right">{pct(row.accessibility)}</td><td className="px-3 py-3 text-right">{pct(row.risk)}</td><td className="px-3 py-3 text-right">{fmt(row.dispensed)}</td><td className="px-3 py-3 text-right">{fmt(row.stockouts)}</td><td className="px-3 py-3 text-right">{fmt(row.orderNow)}</td></tr>)}</tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold text-slate-900">Top Machine Activity</h2><p className="mt-1 text-sm text-slate-500">Highest observed units dispensed.</p></div>
          <div className="divide-y divide-slate-100">{metrics.topMachines.map((row) => <Link key={row.machine.id} to={`/machines/${row.machine.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{row.location?.location_name || row.machine.machine_id}</p><p className="truncate text-xs text-slate-500">{row.machine.machine_id} · Last {date(row.lastActivity)}</p></div><div className="shrink-0 text-right"><p className="font-bold text-slate-900">{fmt(row.dispensed)}</p><p className="text-[11px] text-slate-500">dispensed</p></div></Link>)}</div>
        </Card>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h2 className="font-bold text-slate-900">Quick Actions</h2><p className="mt-1 text-sm text-slate-500">Move directly into the source modules and outputs.</p></div>
          <div className="flex flex-wrap gap-2">
            <Link to="/locations" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><MapPinned size={15}/>Locations</Link>
            <Link to="/machines" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Boxes size={15}/>Machines</Link>
            <Link to="/safety-stock" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><ShieldCheck size={15}/>Safety Stock</Link>
            <Link to="/reports" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><BarChart3 size={15}/>Analytics</Link>
            <button onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={15}/>Print Dashboard</button>
          </div>
        </div>
      </Card>
    </div>
  )
}
