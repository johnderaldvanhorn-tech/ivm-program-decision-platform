import { useEffect, useMemo, useState } from 'react'
import { Boxes, ChevronDown, ChevronUp, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Card, inputClass } from '../components/ui'
import { supabase } from '../lib/supabase'

type LocationRow = {
  id: string
  machine_id: string
  agency: string | null
  location_name: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  location_access_scores?: Array<{ machine_accessibility_score: number | null }> | { machine_accessibility_score: number | null } | null
  location_demographics?: Array<{ risk_score: number | null; maximum_location_score: number | null }> | { risk_score: number | null; maximum_location_score: number | null } | null
}

type MachineRow = {
  id: string
  location_id: string
  machine_id: string
  capacity: number
  current_inventory: number
  active: boolean
}

type PlanogramRow = {
  machine_uuid: string
  machine_wtn_id?: string | null
  current_quantity: number
  par_level: number
  max_level: number
  critical_level: number
}

type MachineView = MachineRow & {
  location: LocationRow
  accessibilityScore: number
  riskScore: number
  maximumLocationScore: number
  selectionCount: number
  parUnits: number
  maxUnits: number
  currentUnits: number
  criticalSelections: number
  belowParSelections: number
}

function locationNames(location: Pick<LocationRow, 'agency' | 'location_name'>) {
  return {
    agency: location.agency?.trim() || 'Unassigned Agency',
    facility: location.location_name?.trim() || 'Unspecified Location',
  }
}


function relatedRecord<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] || null
  return value || null
}

function clampScore(value: number | null | undefined) {
  const number = Number(value ?? 0)
  return Math.max(0, Math.min(1, Number.isFinite(number) ? number : 0))
}

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function scoreTone(score: number, inverted = false) {
  const adjusted = inverted ? 1 - score : score
  if (adjusted >= 0.67) return 'text-emerald-700 bg-emerald-50 border-emerald-200'
  if (adjusted >= 0.34) return 'text-amber-700 bg-amber-50 border-amber-200'
  return 'text-red-700 bg-red-50 border-red-200'
}

function statusFor(machine: MachineView) {
  if (!machine.selectionCount) return { label: 'No Planogram', tone: 'slate' as const }
  if (machine.criticalSelections > 0) return { label: 'Critical', tone: 'red' as const }
  if (machine.belowParSelections > 0) return { label: 'Below PAR', tone: 'yellow' as const }
  return { label: 'Ready', tone: 'green' as const }
}

export default function Machines() {
  const [machines, setMachines] = useState<MachineView[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})

  async function load() {
    if (!supabase) return
    setLoading(true)
    setMessage('')

    const { error: syncError } = await supabase.rpc('sync_machines_from_locations')
    if (syncError) {
      setMessage(syncError.message)
      setLoading(false)
      return
    }

    const [{ data: locations, error: locationError }, { data: machineRows, error: machineError }, { data: planogramRows, error: planogramError }] = await Promise.all([
      supabase.from('locations').select('id,machine_id,agency,location_name,address,city,state,zip,location_access_scores(machine_accessibility_score),location_demographics(risk_score,maximum_location_score)').not('machine_id', 'is', null).order('agency'),
      supabase.from('machines').select('id,location_id,machine_id,capacity,current_inventory,active').order('machine_id'),
      supabase.from('machine_planogram_items').select('machine_uuid,machine_wtn_id,current_quantity,par_level,max_level,critical_level'),
    ])

    const error = locationError || machineError || (planogramError?.code === '42P01' ? null : planogramError)
    if (error) {
      setMessage(error.message)
      setLoading(false)
      return
    }

    const locationList = (locations || []) as LocationRow[]
    const machineList = (machineRows || []) as MachineRow[]
    const planogramList = (planogramRows || []) as PlanogramRow[]
    const machineByLocation = new Map(machineList.map((machine) => [machine.location_id, machine]))

    const itemsByMachine = new Map<string, PlanogramRow[]>()
    for (const item of planogramList) {
      const current = itemsByMachine.get(item.machine_uuid) || []
      current.push(item)
      itemsByMachine.set(item.machine_uuid, current)
    }

    const views = locationList.flatMap((location) => {
      const machine = machineByLocation.get(location.id)
      if (!machine) return []
      const items = itemsByMachine.get(machine.id) || []
      return [{
        ...machine,
        location,
        accessibilityScore: clampScore(relatedRecord(location.location_access_scores)?.machine_accessibility_score),
        riskScore: clampScore(relatedRecord(location.location_demographics)?.risk_score),
        maximumLocationScore: clampScore(relatedRecord(location.location_demographics)?.maximum_location_score),
        selectionCount: items.length,
        currentUnits: items.reduce((sum, item) => sum + Number(item.current_quantity || 0), 0),
        parUnits: items.reduce((sum, item) => sum + Number(item.par_level || 0), 0),
        maxUnits: items.reduce((sum, item) => sum + Number(item.max_level || 0), 0),
        criticalSelections: items.filter((item) => Number(item.current_quantity) <= Number(item.critical_level)).length,
        belowParSelections: items.filter((item) => Number(item.current_quantity) < Number(item.par_level)).length,
      }]
    })

    setMachines(views)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const groups = useMemo(() => {
    const search = query.trim().toLowerCase()
    const filtered = machines.filter((machine) => {
      const names = locationNames(machine.location)
      return `${machine.machine_id} ${names.agency} ${names.facility} ${machine.location.city || ''} ${machine.location.state || ''}`.toLowerCase().includes(search)
    })
    const grouped = new Map<string, MachineView[]>()
    for (const machine of filtered) {
      const { agency } = locationNames(machine.location)
      const rows = grouped.get(agency) || []
      rows.push(machine)
      grouped.set(agency, rows)
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [machines, query])

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Machines & Inventory</h1>
        <p className="text-slate-500">Select a machine by agency to open its planogram, selection inventory, PAR levels, and inventory history.</p>
      </div>
      <div className="relative w-full max-w-sm"><Search className="absolute left-3 top-3 text-slate-400" size={17}/><input className={`${inputClass} pl-10`} placeholder="Search agency, facility, or WTN..." value={query} onChange={(event) => setQuery(event.target.value)}/></div>
    </div>

    {message && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</div>}

    {loading ? <Card><p className="py-12 text-center text-slate-500">Loading machines…</p></Card> : groups.length === 0 ? <Card><p className="py-12 text-center text-slate-500">No machines were found. Add WTN Machine IDs on the Locations page first.</p></Card> : groups.map(([agency, rows]) => {
      const isCollapsed = collapsed[agency] ?? true
      const totalCurrent = rows.reduce((sum, row) => sum + row.currentUnits, 0)
      const totalMax = rows.reduce((sum, row) => sum + row.maxUnits, 0)
      const avgAccessibility = average(rows.map((row) => row.accessibilityScore))
      const avgRisk = average(rows.map((row) => row.riskScore))
      const avgMaximum = average(rows.map((row) => row.maximumLocationScore))
      const metrics = [
        { label: 'Avg Accessibility', value: avgAccessibility, inverted: false },
        { label: 'Avg Risk', value: avgRisk, inverted: true },
        { label: 'Avg Max Score', value: avgMaximum, inverted: false },
      ]
      return <Card key={agency} className="overflow-hidden p-0">
        <button type="button" onClick={() => setCollapsed((value) => ({ ...value, [agency]: !(value[agency] ?? true) }))} className="grid w-full grid-cols-[minmax(260px,1fr)_auto_auto] items-center gap-4 px-5 py-3 text-left hover:bg-slate-50">
          <div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-blue-50 p-2 text-blue-600"><Boxes size={19}/></div><div className="min-w-0"><h2 className="truncate text-base font-bold">{agency}</h2><p className="text-xs text-slate-500">{rows.length} machine{rows.length === 1 ? '' : 's'} · {rows.filter((row) => row.active).length} active · {totalCurrent}/{totalMax} units</p></div></div>
          <div className="hidden items-center gap-2 lg:flex">{metrics.map((metric) => <div key={metric.label} className={`min-w-[118px] rounded-lg border px-3 py-2 ${scoreTone(metric.value, metric.inverted)}`}><p className="text-[10px] font-bold uppercase tracking-wide opacity-75">{metric.label}</p><p className="text-lg font-extrabold leading-5">{Math.round(metric.value * 100)}%</p></div>)}</div>
          <div className="rounded-full border border-slate-200 p-2 text-slate-500">{isCollapsed ? <ChevronDown size={17}/> : <ChevronUp size={17}/>}</div>
        </button>
        {!isCollapsed && <div className="overflow-x-auto border-t border-slate-200"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Machine ID','Location / Facility','City / State','Selections','Current','PAR','Maximum','Inventory Status','Action'].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead><tbody>{rows.map((machine) => {
          const names = locationNames(machine.location)
          const status = statusFor(machine)
          return <tr key={machine.id} className="border-t border-slate-100"><td className="px-4 py-3"><p className="font-bold text-slate-900">{machine.machine_id}</p><p className="mt-1 text-xs text-slate-500">{names.facility}</p></td><td className="px-4 py-3 font-medium">{names.facility}</td><td className="px-4 py-3">{[machine.location.city, machine.location.state].filter(Boolean).join(', ') || '—'}</td><td className="px-4 py-3">{machine.selectionCount}</td><td className="px-4 py-3 font-semibold">{machine.currentUnits}</td><td className="px-4 py-3">{machine.parUnits}</td><td className="px-4 py-3">{machine.maxUnits}</td><td className="px-4 py-3"><Badge tone={status.tone}>{status.label}</Badge></td><td className="px-4 py-3"><Link to={`/machines/${machine.id}`} className="inline-flex rounded-xl border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">Open Machine</Link></td></tr>
        })}</tbody></table></div>}
      </Card>
    })}
  </div>
}
