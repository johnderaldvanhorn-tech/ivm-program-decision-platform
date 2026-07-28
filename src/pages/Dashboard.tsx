import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  Bot,
  Boxes,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Gauge,
  MapPinned,
  PackageCheck,
  RefreshCw,
  Route,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  TrendingUp,
  Truck,
  WifiOff,
  Wrench,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Card } from '../components/ui'
import { loadReportingData, type ReportingData } from '../lib/reporting'
import { supabase } from '../lib/supabase'

type SafetyRow = {
  machine_uuid?: string
  machine_wtn_id?: string
  machine_id?: string
  agency?: string
  location_name?: string
  product_name?: string
  current_inventory?: number | string
  stockout_events?: number | string
  reorder_point?: number | string
  average_daily_demand?: number | string
  avg_daily_demand?: number | string
  daily_demand?: number | string
}

type Scenario = { inventoryIncrease: number; serviceCapacity: number; addedMachines: number }

const num = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
const fmt = (value: number, digits = 0) => new Intl.NumberFormat('en-US', { maximumFractionDigits: digits }).format(value)
const pct = (value: number) => `${Math.round(value)}%`
const average = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
const clamp = (value: number, min = 0, max = 100) => Math.max(min, Math.min(max, value))

function relatedRecord(value: unknown) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}

function normalizedScore(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0
}

function locationScore(location: any, key: 'access' | 'risk' | 'maximum') {
  if (key === 'access') return normalizedScore(relatedRecord(location.location_access_scores)?.machine_accessibility_score)
  const row = relatedRecord(location.location_demographics)
  return key === 'risk' ? normalizedScore(row?.risk_score) : normalizedScore(row?.maximum_location_score)
}

function machineSummaryFor(data: ReportingData, machine: any) {
  return data.machineSummary.find((row) =>
    row.machine_uuid === machine.id ||
    row.machine_id === machine.machine_id ||
    row.machine_wtn_id === machine.machine_id,
  ) || {}
}

function tone(score: number) {
  if (score >= 80) return 'green' as const
  if (score >= 65) return 'yellow' as const
  return 'red' as const
}

function MetricBar({ label, value }: { label: string; value: number }) {
  return <div><div className="mb-1 flex items-center justify-between text-xs"><span className="font-semibold text-slate-600">{label}</span><span className="font-bold text-slate-900">{pct(value)}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-200"><div className="h-full rounded-full bg-slate-900" style={{ width: `${clamp(value)}%` }} /></div></div>
}

export default function Dashboard() {
  const [data, setData] = useState<ReportingData | null>(null)
  const [safetyRows, setSafetyRows] = useState<SafetyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [question, setQuestion] = useState('')
  const [copilotAnswer, setCopilotAnswer] = useState('Select a suggested question or ask about inventory, machines, agencies, accessibility, or service priorities.')
  const [searchText, setSearchText] = useState('')
  const [scenario, setScenario] = useState<Scenario>({ inventoryIncrease: 10, serviceCapacity: 0, addedMachines: 0 })

  const load = useCallback(async () => {
    setLoading(true)
    setMessage('')
    try {
      const reporting = await loadReportingData()
      let safety: SafetyRow[] = []
      const client = supabase
      if (client) {
        const end = new Date().toISOString().slice(0, 10)
        const start = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)
        const { data: safetyData, error } = await client.rpc('get_safety_stock_analysis', {
          p_start_date: start,
          p_end_date: end,
          p_product_filter: 'All Products',
        })
        if (!error) safety = (safetyData || []) as SafetyRow[]
        else console.warn('Dashboard safety stock query unavailable:', error.message)
      }
      setData(reporting)
      setSafetyRows(safety)
      setLastRefreshed(new Date())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Command Center data could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const view = useMemo(() => {
    if (!data) return null
    const now = Date.now()
    const machineRows = data.machines.map((machine) => {
      const summary = machineSummaryFor(data, machine)
      const location = data.locations.find((row) => row.id === machine.location_id || row.machine_id === machine.machine_id)
      const lastActivity = summary.last_activity || summary.last_event_at || machine.updated_at
      const inactiveHours = lastActivity ? (now - new Date(lastActivity).getTime()) / 3600000 : Number.POSITIVE_INFINITY
      return {
        machine,
        location,
        dispensed: num(summary.units_dispensed ?? summary.dispensed),
        stockouts: num(summary.stockout_count ?? summary.stockouts),
        events: num(summary.event_count ?? summary.events),
        inactiveHours,
      }
    })

    const accessValues = data.locations.map((row) => locationScore(row, 'access')).filter((value) => value > 0)
    const accessibility = average(accessValues) * 100
    const activeMachines = machineRows.filter((row) => row.machine.active).length
    const offline = machineRows.length - activeMachines
    const stale = machineRows.filter((row) => row.machine.active && row.inactiveHours > 72).length
    const totalDispensed = machineRows.reduce((sum, row) => sum + row.dispensed, 0)
    const totalStockouts = machineRows.reduce((sum, row) => sum + row.stockouts, 0)
    const warnings = safetyRows.filter((row) => num(row.current_inventory) <= num(row.reorder_point) || num(row.stockout_events) > 0)
    const inventoryHealth = safetyRows.length ? clamp(100 - warnings.length / safetyRows.length * 100) : 100
    const machineHealth = machineRows.length ? activeMachines / machineRows.length * 100 : 0
    const reportingHealth = machineRows.length ? machineRows.filter((row) => row.inactiveHours <= 72).length / machineRows.length * 100 : 0
    const serviceReadiness = clamp(100 - stale * 8 - offline * 12)
    const dataQuality = clamp(average([
      data.locations.length ? accessValues.length / data.locations.length * 100 : 0,
      machineRows.length ? machineRows.filter((row) => row.events > 0).length / machineRows.length * 100 : 0,
      safetyRows.length ? 100 : 50,
    ]))
    const fleetHealth = Math.round(accessibility * .25 + inventoryHealth * .25 + machineHealth * .2 + serviceReadiness * .15 + dataQuality * .15)

    const agencyMap = new Map<string, any[]>()
    data.locations.forEach((location) => {
      const agency = String(location.agency || 'Unassigned')
      agencyMap.set(agency, [...(agencyMap.get(agency) || []), location])
    })
    const agencies = [...agencyMap.entries()].map(([agency, locations]) => {
      const machines = machineRows.filter((row) => locations.some((location) => location.id === row.machine.location_id || location.machine_id === row.machine.machine_id))
      const access = average(locations.map((row) => locationScore(row, 'access')).filter((value) => value > 0)) * 100
      const agencySafety = safetyRows.filter((row) => row.agency === agency)
      const agencyWarnings = agencySafety.filter((row) => num(row.current_inventory) <= num(row.reorder_point) || num(row.stockout_events) > 0).length
      const inventory = agencySafety.length ? clamp(100 - agencyWarnings / agencySafety.length * 100) : 100
      const active = machines.length ? machines.filter((row) => row.machine.active).length / machines.length * 100 : 0
      const recent = machines.length ? machines.filter((row) => row.inactiveHours <= 72).length / machines.length * 100 : 0
      const health = Math.round(access * .35 + inventory * .3 + active * .2 + recent * .15)
      return { agency, health, access, inventory, machines: machines.length, alerts: agencyWarnings + machines.filter((row) => !row.machine.active || row.inactiveHours > 72).length }
    }).sort((a, b) => a.health - b.health)

    const productMap = new Map<string, { product: string; current: number; reorder: number; stockouts: number; dailyDemand: number; machines: number }>()
    safetyRows.forEach((row) => {
      const product = String(row.product_name || 'Unspecified product')
      const current = productMap.get(product) || { product, current: 0, reorder: 0, stockouts: 0, dailyDemand: 0, machines: 0 }
      current.current += num(row.current_inventory)
      current.reorder += num(row.reorder_point)
      current.stockouts += num(row.stockout_events)
      current.dailyDemand += num(row.average_daily_demand ?? row.avg_daily_demand ?? row.daily_demand)
      current.machines += 1
      productMap.set(product, current)
    })
    const predictiveInventory = [...productMap.values()].map((row) => {
      const fallbackDemand = Math.max(.1, row.stockouts / 30)
      const dailyDemand = row.dailyDemand > 0 ? row.dailyDemand : fallbackDemand
      const daysRemaining = row.current > 0 ? row.current / dailyDemand : 0
      const reorderQty = Math.max(0, Math.ceil(dailyDemand * 30 + row.reorder - row.current))
      const confidence = row.dailyDemand > 0 ? 84 : row.stockouts > 0 ? 62 : 45
      const risk = clamp((row.reorder > 0 ? (1 - row.current / row.reorder) * 65 : 0) + Math.min(35, row.stockouts * 3))
      return { ...row, dailyDemand, daysRemaining, reorderQty, confidence, risk }
    }).sort((a, b) => b.risk - a.risk).slice(0, 6)

    const machineForecasts = machineRows.map((row) => {
      const communicationPenalty = row.inactiveHours > 168 ? 45 : row.inactiveHours > 72 ? 25 : row.inactiveHours > 24 ? 8 : 0
      const statusPenalty = row.machine.active ? 0 : 50
      const stockoutPenalty = Math.min(30, row.stockouts * 3)
      const health = Math.round(clamp(100 - communicationPenalty - statusPenalty - stockoutPenalty))
      const maintenanceDays = health < 40 ? 1 : health < 65 ? 7 : health < 80 ? 21 : 45
      return { ...row, health, maintenanceDays, confidence: row.events > 20 ? 86 : row.events > 0 ? 68 : 42 }
    }).sort((a, b) => a.health - b.health)

    const recommendations = [
      ...predictiveInventory.filter((row) => row.risk >= 40).slice(0, 3).map((row) => ({
        title: `Replenish ${row.product}`,
        detail: `${fmt(row.current)} units remain against a ${fmt(row.reorder)}-unit reorder target. Suggested 30-day replenishment: ${fmt(row.reorderQty)} units.`,
        impact: row.risk >= 70 ? 'High' : 'Medium', confidence: row.confidence, link: '/safety-stock', effort: row.reorderQty > 100 ? 'High' : 'Low',
      })),
      ...machineForecasts.filter((row) => row.health < 70).slice(0, 3).map((row) => ({
        title: `Review ${row.location?.location_name || row.machine.machine_id}`,
        detail: `${row.health}% modeled machine health; service review recommended within ${row.maintenanceDays} day${row.maintenanceDays === 1 ? '' : 's'}.`,
        impact: row.health < 40 ? 'High' : 'Medium', confidence: row.confidence, link: '/machines', effort: 'Medium',
      })),
    ].slice(0, 5)

    const routeStops = machineForecasts.filter((row) => row.health < 75).slice(0, 12)
    const projectedHours = Math.max(0, routeStops.length * .55)

    const trendData = Array.from({ length: 14 }, (_, index) => {
      const date = new Date(Date.now() - (13 - index) * 86400000)
      const day = date.toISOString().slice(0, 10)
      const restocked = data.restockEvents.filter((row) => String(row.restock_datetime || row.created_at || '').slice(0, 10) === day).reduce((sum, row) => sum + num(row.quantity_restocked ?? row.quantity ?? row.units), 0)
      return { label: date.toLocaleDateString([], { month: 'short', day: 'numeric' }), restocked, risk: Math.round(clamp(warnings.length * 3 - index * .5)) }
    })

    const searchable = [
      ...agencies.map((row) => ({ type: 'Agency', title: row.agency, detail: `${row.health}% health · ${row.alerts} alerts`, link: `/operations-analyzer?agency=${encodeURIComponent(row.agency)}` })),
      ...machineRows.map((row) => ({ type: 'Machine', title: row.location?.location_name || row.machine.machine_id, detail: `${row.machine.machine_id} · ${row.stockouts} stockouts`, link: `/machines/${row.machine.id}` })),
      ...predictiveInventory.map((row) => ({ type: 'Product', title: row.product, detail: `${fmt(row.current)} current · ${Math.round(row.daysRemaining)} modeled days`, link: '/safety-stock' })),
    ]

    const dailyBrief = `Fleet health is ${fleetHealth}/100. ${offline ? `${offline} machine${offline === 1 ? ' is' : 's are'} inactive. ` : 'All configured machines are active. '}${warnings.length ? `${warnings.length} safety-stock conditions require review. ` : 'No safety-stock exceptions are currently detected. '}${stale ? `${stale} machine${stale === 1 ? ' has' : 's have'} not reported activity within 72 hours.` : 'Reporting activity is current across the active fleet.'}`

    return { machineRows, accessibility, inventoryHealth, machineHealth, reportingHealth, serviceReadiness, dataQuality, fleetHealth, activeMachines, offline, stale, totalDispensed, totalStockouts, warnings, agencies, predictiveInventory, machineForecasts, recommendations, routeStops, projectedHours, trendData, searchable, dailyBrief }
  }, [data, safetyRows])

  const searchResults = useMemo(() => {
    if (!view || !searchText.trim()) return []
    const query = searchText.toLowerCase().trim()
    return view.searchable.filter((row) => `${row.type} ${row.title} ${row.detail}`.toLowerCase().includes(query)).slice(0, 8)
  }, [searchText, view])

  const scenarioView = useMemo(() => {
    if (!view) return null
    const inventoryGain = scenario.inventoryIncrease * .22
    const capacityGain = scenario.serviceCapacity * .6
    const expansionPenalty = scenario.addedMachines * .15
    return {
      fleetHealth: Math.round(clamp(view.fleetHealth + inventoryGain + capacityGain - expansionPenalty)),
      inventoryHealth: Math.round(clamp(view.inventoryHealth + scenario.inventoryIncrease * .55)),
      serviceReadiness: Math.round(clamp(view.serviceReadiness + scenario.serviceCapacity * .8 - scenario.addedMachines * .6)),
      estimatedWarnings: Math.max(0, Math.round(view.warnings.length * (1 - scenario.inventoryIncrease / 100))),
    }
  }, [scenario, view])

  function answerQuestion(raw: string) {
    if (!view) return
    const q = raw.toLowerCase()
    let answer = view.dailyBrief
    if (q.includes('inventory') || q.includes('stockout') || q.includes('narcan')) {
      const top = view.predictiveInventory[0]
      answer = top ? `${top.product} currently carries the highest modeled inventory risk at ${Math.round(top.risk)}%. It has ${fmt(top.current)} units against a ${fmt(top.reorder)}-unit reorder target, with a suggested replenishment of ${fmt(top.reorderQty)} units.` : 'No product-level safety-stock data is available for an inventory recommendation.'
    } else if (q.includes('machine') || q.includes('service') || q.includes('technician')) {
      const top = view.machineForecasts[0]
      answer = top ? `${top.location?.location_name || top.machine.machine_id} is the highest-priority machine, with a modeled health score of ${top.health}%. Review is recommended within ${top.maintenanceDays} day${top.maintenanceDays === 1 ? '' : 's'}.` : 'No machine-level reporting data is available.'
    } else if (q.includes('agency') || q.includes('access')) {
      const top = view.agencies[0]
      answer = top ? `${top.agency} is the lowest-ranked agency at ${top.health}% health, including ${Math.round(top.access)}% accessibility and ${top.alerts} current alert conditions.` : 'No agency-level location data is available.'
    } else if (q.includes('tomorrow') || q.includes('route')) {
      answer = `${view.routeStops.length} machine stops are currently prioritized for the next route, representing approximately ${view.projectedHours.toFixed(1)} on-site hours before travel time.`
    }
    setCopilotAnswer(answer)
    setQuestion('')
  }

  if (loading) return <div className="flex min-h-[55vh] items-center justify-center"><div className="text-center"><RefreshCw className="mx-auto animate-spin text-blue-600" /><p className="mt-3 text-sm text-slate-500">Building the intelligent operations view…</p></div></div>
  if (!view) return <Card><p className="text-sm text-rose-700">{message || 'No reporting data is available.'}</p></Card>

  return <div className="space-y-6 pb-10">
    <section className="overflow-hidden rounded-3xl bg-slate-950 p-6 text-white shadow-xl lg:p-8">
      <div className="flex flex-wrap items-start justify-between gap-5"><div><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-200"><BrainCircuit size={14} /> Intelligent Operations Center</div><h1 className="text-3xl font-bold tracking-tight lg:text-4xl">Fleet digital twin</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">A modeled view of fleet health, inventory exposure, machine risk, and operational capacity using the platform’s current reporting data.</p></div><button onClick={() => void load()} className="inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-slate-950"><RefreshCw size={16} /> Refresh intelligence</button></div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[.8fr_1.2fr]"><div><div className="flex items-end gap-3"><span className="text-6xl font-black">{view.fleetHealth}</span><span className="pb-2 text-xl text-slate-400">/100</span></div><div className="mt-3 flex items-center gap-2"><Badge tone={tone(view.fleetHealth)}>{view.fleetHealth >= 80 ? 'Stable' : view.fleetHealth >= 65 ? 'Watch' : 'Intervention required'}</Badge><span className="text-xs text-slate-400">Updated {lastRefreshed?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div></div><div className="grid gap-4 sm:grid-cols-2"><MetricBar label="Accessibility" value={view.accessibility} /><MetricBar label="Inventory health" value={view.inventoryHealth} /><MetricBar label="Machine health" value={view.machineHealth} /><MetricBar label="Service readiness" value={view.serviceReadiness} /><MetricBar label="Reporting health" value={view.reportingHealth} /><MetricBar label="Data quality" value={view.dataQuality} /></div></div>
    </section>

    <div className="grid gap-6 xl:grid-cols-[1.25fr_.75fr]">
      <Card><div className="flex items-start justify-between gap-4"><div><h2 className="flex items-center gap-2 font-bold text-slate-950"><Bot className="text-blue-600" size={22} /> Operations Copilot</h2><p className="mt-1 text-sm text-slate-500">Rule-based answers grounded in the current reporting dataset. No external AI service is required.</p></div><Badge tone="blue">Data grounded</Badge></div><div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm leading-6 text-slate-700">{copilotAnswer}</div><div className="mt-4 flex gap-2"><input value={question} onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && question.trim()) answerQuestion(question) }} placeholder="Ask: Which machine should we service first?" className="min-w-0 flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-blue-500" /><button onClick={() => question.trim() && answerQuestion(question)} className="rounded-xl bg-blue-600 px-4 text-white"><Send size={18} /></button></div><div className="mt-3 flex flex-wrap gap-2">{['Highest inventory risk', 'Which agency needs attention?', 'Tomorrow’s service route'].map((prompt) => <button key={prompt} onClick={() => answerQuestion(prompt)} className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">{prompt}</button>)}</div></Card>
      <Card><div className="flex items-start justify-between"><div><h2 className="font-bold text-slate-950">Executive daily briefing</h2><p className="mt-1 text-sm text-slate-500">Current operational state in one paragraph.</p></div><Sparkles className="text-amber-500" size={22} /></div><p className="mt-5 text-sm leading-7 text-slate-700">{view.dailyBrief}</p><div className="mt-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs font-bold uppercase text-emerald-700">Dispensed</p><p className="mt-1 text-2xl font-bold">{fmt(view.totalDispensed)}</p></div><div className="rounded-xl bg-rose-50 p-3"><p className="text-xs font-bold uppercase text-rose-700">Stockouts</p><p className="mt-1 text-2xl font-bold">{fmt(view.totalStockouts)}</p></div></div><Link to="/reports" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-700">Open reporting center <ArrowRight size={15} /></Link></Card>
    </div>

    <Card><div className="flex items-start justify-between"><div><h2 className="font-bold text-slate-950">Prioritized recommendations</h2><p className="mt-1 text-sm text-slate-500">Recommendations are heuristic decision support based on reported inventory, activity, and machine status.</p></div><Gauge className="text-blue-600" size={22} /></div><div className="mt-5 grid gap-3 lg:grid-cols-2">{view.recommendations.length ? view.recommendations.map((row, index) => <Link key={`${row.title}-${index}`} to={row.link} className="rounded-2xl border border-slate-200 p-4 hover:border-blue-300 hover:bg-blue-50/30"><div className="flex items-start justify-between gap-4"><div><p className="font-bold text-slate-950">{row.title}</p><p className="mt-1 text-sm leading-6 text-slate-600">{row.detail}</p></div><Badge tone={row.impact === 'High' ? 'red' : 'yellow'}>{row.impact}</Badge></div><div className="mt-3 flex gap-4 text-xs text-slate-500"><span>Confidence {row.confidence}%</span><span>Effort {row.effort}</span></div></Link>) : <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">No recommendation thresholds are currently triggered.</div>}</div></Card>

    <div className="grid gap-6 xl:grid-cols-2">
      <Card><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-950">Predictive inventory</h2><p className="mt-1 text-sm text-slate-500">Modeled days remaining and 30-day replenishment quantities.</p></div><Boxes className="text-blue-600" size={22} /></div><div className="mt-5 space-y-3">{view.predictiveInventory.map((row) => <div key={row.product} className="rounded-xl border border-slate-200 p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-semibold text-slate-950">{row.product}</p><p className="mt-1 text-xs text-slate-500">{row.daysRemaining > 365 ? '365+' : Math.round(row.daysRemaining)} modeled days · {row.confidence}% confidence</p></div><Badge tone={row.risk >= 70 ? 'red' : row.risk >= 40 ? 'yellow' : 'green'}>{Math.round(row.risk)}% risk</Badge></div><div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs"><div className="rounded-lg bg-slate-50 p-2"><strong className="block text-base text-slate-900">{fmt(row.current)}</strong>Current</div><div className="rounded-lg bg-slate-50 p-2"><strong className="block text-base text-slate-900">{fmt(row.reorder)}</strong>Reorder</div><div className="rounded-lg bg-blue-50 p-2 text-blue-700"><strong className="block text-base">{fmt(row.reorderQty)}</strong>Suggested</div></div></div>)}</div><Link to="/safety-stock" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-700">Open Safety Stock <ArrowRight size={15} /></Link></Card>
      <Card><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-950">Predictive maintenance</h2><p className="mt-1 text-sm text-slate-500">Machine risk from status, communication recency, and stockout history.</p></div><Wrench className="text-blue-600" size={22} /></div><div className="mt-5 space-y-3">{view.machineForecasts.slice(0, 6).map((row) => <Link key={row.machine.id} to={`/machines/${row.machine.id}`} className="flex items-center gap-4 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><div className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-black ${row.health >= 80 ? 'bg-emerald-100 text-emerald-700' : row.health >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{row.health}</div><div className="min-w-0 flex-1"><p className="truncate font-semibold text-slate-950">{row.location?.location_name || row.machine.machine_id}</p><p className="text-xs text-slate-500">Review within {row.maintenanceDays} day{row.maintenanceDays === 1 ? '' : 's'} · {row.confidence}% confidence</p></div><ArrowRight size={16} className="text-slate-400" /></Link>)}</div></Card>
    </div>

    <div className="grid gap-6 xl:grid-cols-[.8fr_1.2fr]">
      <Card><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-950">Tomorrow’s service route</h2><p className="mt-1 text-sm text-slate-500">Prioritized queue; travel sequencing requires coordinates and a routing service.</p></div><Route className="text-blue-600" size={22} /></div><div className="mt-5 grid grid-cols-3 gap-3"><div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-2xl font-bold">{view.routeStops.length}</p><p className="text-xs text-slate-500">Stops</p></div><div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-2xl font-bold">{view.projectedHours.toFixed(1)}</p><p className="text-xs text-slate-500">On-site hours</p></div><div className="rounded-xl bg-slate-50 p-3 text-center"><p className="text-2xl font-bold">{view.routeStops.filter((row) => row.health < 40).length}</p><p className="text-xs text-slate-500">Critical</p></div></div><div className="mt-4 space-y-2">{view.routeStops.slice(0, 5).map((row, index) => <div key={row.machine.id} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{row.location?.location_name || row.machine.machine_id}</p><p className="text-xs text-slate-500">{row.location?.agency || 'Unassigned'} · Health {row.health}</p></div><Truck size={17} className="text-slate-400" /></div>)}</div><Link to="/staffing" className="mt-4 inline-flex items-center gap-2 text-sm font-bold text-blue-700">Open Staffing <ArrowRight size={15} /></Link></Card>
      <Card><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-950">Scenario planner</h2><p className="mt-1 text-sm text-slate-500">Test directional operational changes before implementation.</p></div><BrainCircuit className="text-blue-600" size={22} /></div><div className="mt-5 grid gap-4 md:grid-cols-3"><label className="text-sm font-semibold text-slate-700">Inventory increase<input type="range" min="0" max="50" value={scenario.inventoryIncrease} onChange={(e) => setScenario({ ...scenario, inventoryIncrease: Number(e.target.value) })} className="mt-3 w-full" /><span className="mt-1 block text-xs font-normal text-slate-500">+{scenario.inventoryIncrease}%</span></label><label className="text-sm font-semibold text-slate-700">Service capacity<input type="range" min="-20" max="30" value={scenario.serviceCapacity} onChange={(e) => setScenario({ ...scenario, serviceCapacity: Number(e.target.value) })} className="mt-3 w-full" /><span className="mt-1 block text-xs font-normal text-slate-500">{scenario.serviceCapacity > 0 ? '+' : ''}{scenario.serviceCapacity}%</span></label><label className="text-sm font-semibold text-slate-700">Added machines<input type="range" min="0" max="20" value={scenario.addedMachines} onChange={(e) => setScenario({ ...scenario, addedMachines: Number(e.target.value) })} className="mt-3 w-full" /><span className="mt-1 block text-xs font-normal text-slate-500">+{scenario.addedMachines}</span></label></div>{scenarioView && <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4"><div className="rounded-xl bg-blue-50 p-3"><p className="text-xs font-bold text-blue-700">Fleet health</p><p className="mt-1 text-2xl font-bold">{scenarioView.fleetHealth}</p></div><div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs font-bold text-emerald-700">Inventory health</p><p className="mt-1 text-2xl font-bold">{scenarioView.inventoryHealth}%</p></div><div className="rounded-xl bg-amber-50 p-3"><p className="text-xs font-bold text-amber-700">Service readiness</p><p className="mt-1 text-2xl font-bold">{scenarioView.serviceReadiness}%</p></div><div className="rounded-xl bg-rose-50 p-3"><p className="text-xs font-bold text-rose-700">Warnings</p><p className="mt-1 text-2xl font-bold">{scenarioView.estimatedWarnings}</p></div></div>}<p className="mt-4 text-xs leading-5 text-slate-500">Scenario results are directional heuristics, not forecasts. They are intended for planning comparisons until validated predictive models are connected.</p></Card>
    </div>

    <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
      <Card><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-950">14-day operating signal</h2><p className="mt-1 text-sm text-slate-500">Recent replenishment activity and modeled risk trajectory.</p></div><TrendingUp className="text-blue-600" size={22} /></div><div className="mt-5 h-64"><ResponsiveContainer width="100%" height="100%"><AreaChart data={view.trendData}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Area type="monotone" dataKey="restocked" name="Units restocked" stroke="#2563eb" fill="#dbeafe" strokeWidth={2} /><Area type="monotone" dataKey="risk" name="Modeled risk" stroke="#e11d48" fillOpacity={0} strokeWidth={2} /></AreaChart></ResponsiveContainer></div></Card>
      <Card><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-950">Intelligent search</h2><p className="mt-1 text-sm text-slate-500">Find agencies, machines, and products from one field.</p></div><Search className="text-blue-600" size={22} /></div><div className="relative mt-5"><Search className="absolute left-3 top-3.5 text-slate-400" size={17} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="Search Narcan, BCCS, machine ID…" className="w-full rounded-xl border border-slate-300 py-3 pl-10 pr-4 text-sm outline-none focus:border-blue-500" /></div><div className="mt-3 space-y-2">{searchText && !searchResults.length ? <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-500">No matching operational records.</p> : searchResults.map((row) => <Link key={`${row.type}-${row.title}`} to={row.link} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><Badge tone="blue">{row.type}</Badge><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900">{row.title}</p><p className="truncate text-xs text-slate-500">{row.detail}</p></div><ArrowRight size={15} className="text-slate-400" /></Link>)}</div></Card>
    </div>

    <div className="grid gap-6 xl:grid-cols-2">
      <Card><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-950">Agency risk ranking</h2><p className="mt-1 text-sm text-slate-500">Lowest-health agencies appear first.</p></div><MapPinned className="text-blue-600" size={22} /></div><div className="mt-5 space-y-2">{view.agencies.slice(0, 8).map((row) => <Link key={row.agency} to={`/operations-analyzer?agency=${encodeURIComponent(row.agency)}`} className="flex items-center gap-4 rounded-xl border border-slate-200 p-3 hover:bg-slate-50"><div className={`flex h-11 w-11 items-center justify-center rounded-full font-black ${row.health >= 80 ? 'bg-emerald-100 text-emerald-700' : row.health >= 65 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{row.health}</div><div className="min-w-0 flex-1"><p className="truncate font-semibold">{row.agency}</p><p className="text-xs text-slate-500">Accessibility {Math.round(row.access)}% · Inventory {Math.round(row.inventory)}%</p></div><Badge tone={row.alerts ? 'red' : 'green'}>{row.alerts} alerts</Badge></Link>)}</div></Card>
      <Card><div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-950">Control status</h2><p className="mt-1 text-sm text-slate-500">Conditions requiring human approval or follow-up.</p></div><ShieldAlert className="text-rose-600" size={22} /></div><div className="mt-5 space-y-3"><Link to="/machines" className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><WifiOff className={view.offline ? 'text-rose-600' : 'text-emerald-600'} size={19} /><div className="flex-1"><p className="font-semibold">Inactive machines</p><p className="text-xs text-slate-500">Configured fleet state</p></div><Badge tone={view.offline ? 'red' : 'green'}>{view.offline}</Badge></Link><Link to="/machine-logs" className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><Clock3 className={view.stale ? 'text-amber-600' : 'text-emerald-600'} size={19} /><div className="flex-1"><p className="font-semibold">No activity in 72 hours</p><p className="text-xs text-slate-500">Communication or utilization issue</p></div><Badge tone={view.stale ? 'yellow' : 'green'}>{view.stale}</Badge></Link><Link to="/safety-stock" className="flex items-center gap-3 rounded-xl border border-slate-200 p-3"><PackageCheck className={view.warnings.length ? 'text-rose-600' : 'text-emerald-600'} size={19} /><div className="flex-1"><p className="font-semibold">Safety-stock conditions</p><p className="text-xs text-slate-500">At/below reorder or stockout observed</p></div><Badge tone={view.warnings.length ? 'red' : 'green'}>{view.warnings.length}</Badge></Link><div className="rounded-xl bg-blue-50 p-4"><div className="flex gap-3"><CheckCircle2 className="mt-0.5 text-blue-700" size={19} /><p className="text-sm leading-6 text-slate-700">Recommendations remain advisory. The Phase 3 build does not automatically change inventory, machine configuration, staffing, or routes.</p></div></div></div></Card>
    </div>
  </div>
}
