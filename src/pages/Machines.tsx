import { useEffect, useMemo, useState } from 'react'
import { Boxes, Check, ChevronDown, ChevronUp, Search, X } from 'lucide-react'
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
  product_name: string | null
  selection_number: string | null
}

type EventRow = {
  machine_id?: string | null
  machine_uuid: string | null
  machine_wtn_id?: string | null
  event_datetime: string | null
  selection: string | null
  product: string | null
  quantity: number | null
  action: string | null
  event_type: string | null
  status: string | null
  source_machine_name?: string | null
}


type MachineAlias = {
  source_machine_name: string
  machine_id: string | null
  machine_uuid: string | null
  machine_wtn_id: string | null
  ignored: boolean | null
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
  products: string[]
  planogramItems: PlanogramRow[]
  events: EventRow[]
  unitsDispensed?: number
  averageDispensedPerDay?: number
  summaryUnitsDispensed?: number
  summaryAverageDispensedPerDay?: number
}


function normalizeProduct(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/naloxone\s*hcl/g, 'naloxone')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function productFamily(value: string | null | undefined) {
  const normalized = normalizeProduct(value)
  if (normalized.includes('narcan') || normalized.includes('naloxone')) return 'naloxone'
  return normalized
}

function normalizeSelection(value: string | null | undefined) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''

  // Machine Logs commonly store one selected motor number, such as 104,
  // while planograms may store a tied selection range, such as 104-105.
  // This helper remains useful for individual event selections.
  const numericMatch = raw.match(/(?:selection\s*[:#-]?\s*)?(\d+(?:\.0+)?)/i)
  if (numericMatch) return String(Number(numericMatch[1]))

  return raw.replace(/^selection\s*[:#-]?\s*/i, '').trim()
}

function parseSelectionRange(value: string | null | undefined) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null

  // Accept formats such as 104-105, 104 - 105, 104–105, 104—105,
  // Selection 104-105, and single selections such as 110 or 110.0.
  const numbers = [...raw.matchAll(/\d+(?:\.0+)?/g)]
    .map((match) => Number(match[0]))
    .filter(Number.isFinite)
    .map((number) => Math.trunc(number))

  if (!numbers.length) return null
  const start = numbers[0]
  const end = numbers.length > 1 ? numbers[1] : start
  return { start: Math.min(start, end), end: Math.max(start, end) }
}

function planogramSelectionContains(
  planogramSelection: string | null | undefined,
  eventSelection: string | null | undefined,
) {
  const range = parseSelectionRange(planogramSelection)
  const eventKey = normalizeSelection(eventSelection)
  const eventNumber = Number(eventKey)
  if (!range || !eventKey || !Number.isFinite(eventNumber)) return false
  return eventNumber >= range.start && eventNumber <= range.end
}

function isDispenseEvent(event: EventRow) {
  const status = String(event.status || '').trim().toLowerCase()
  const action = String(event.action || '').trim().toLowerCase()
  const eventType = String(event.event_type || '').trim().toLowerCase()
  const explicitlyFailed = status.includes('fail')
    || status.includes('declin')
    || status.includes('cancel')
    || status.includes('error')

  // Keep this aligned with the Machine Logs summary while allowing common
  // vending terminology found in imported log files.
  const isDispense = action.includes('dispens')
    || action.includes('vend')
    || action.includes('transaction')
    || eventType.includes('dispens')
    || eventType.includes('vend')
    || eventType.includes('transaction')

  return isDispense && !explicitlyFailed
}

function locationNames(location: Pick<LocationRow, 'agency' | 'location_name'>) {
  return {
    agency: location.agency?.trim() || 'Unassigned Agency',
    facility: location.location_name?.trim() || 'Unspecified Location',
  }
}

function normalizeMachineName(value: string | null | undefined) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(?:bccs|site|location|machine|vending)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
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
  const [selectedProducts, setSelectedProducts] = useState<string[]>([])
  const [productQuery, setProductQuery] = useState('')
  const [productMenuOpen, setProductMenuOpen] = useState(false)

  async function load() {
    if (!supabase) return
    const client = supabase
    setLoading(true)
    setMessage('')

    const { error: syncError } = await client.rpc('sync_machines_from_locations')
    if (syncError) {
      setMessage(syncError.message)
      setLoading(false)
      return
    }

    const [{ data: locations, error: locationError }, { data: machineRows, error: machineError }, { data: planogramRows, error: planogramError }, { data: summaryRows, error: summaryError }, { data: aliasRows, error: aliasError }] = await Promise.all([
      client.from('locations').select('id,machine_id,agency,location_name,address,city,state,zip,location_access_scores(machine_accessibility_score),location_demographics(risk_score,maximum_location_score)').not('machine_id', 'is', null).order('agency'),
      client.from('machines').select('id,location_id,machine_id,capacity,current_inventory,active').order('machine_id'),
      client.from('machine_planogram_items').select('machine_uuid,machine_wtn_id,current_quantity,par_level,max_level,critical_level,product_name,selection_number'),
      client.rpc('get_machine_log_machine_summary'),
      client.from('machine_name_aliases').select('source_machine_name,machine_id,machine_uuid,machine_wtn_id,ignored'),
    ])

    const baseError = locationError || machineError || (planogramError?.code === '42P01' ? null : planogramError) || summaryError || (aliasError?.code === '42P01' ? null : aliasError)
    if (baseError) {
      setMessage(baseError.message)
      setLoading(false)
      return
    }

    const locationList = (locations || []) as LocationRow[]
    const machineList = (machineRows || []) as MachineRow[]
    const planogramList = (planogramRows || []) as PlanogramRow[]
    const aliasList = (aliasRows || []) as MachineAlias[]
    const summarySourceNames = [...new Set(((summaryRows || []) as Array<{ source_name?: string | null }>).map((row) => row.source_name || '').filter(Boolean))]

    async function loadEventsForMachines() {
      const selectColumns = 'machine_id,machine_uuid,machine_wtn_id,source_machine_name,event_datetime,selection,product,quantity,action,event_type,status'
      const machineIds = [...new Set(machineList.map((machine) => machine.id).filter(Boolean))]
      const wtnIds = [...new Set(machineList.map((machine) => machine.machine_id).filter(Boolean))]
      const facilityNames = [...new Set([...locationList.map((location) => location.location_name || ''), ...summarySourceNames].filter(Boolean))]
      const collected: EventRow[] = []
      const seen = new Set<string>()

      async function fetchBy(column: 'machine_id' | 'machine_uuid' | 'machine_wtn_id' | 'source_machine_name', values: string[]) {
        for (let offset = 0; offset < values.length; offset += 100) {
          const batch = values.slice(offset, offset + 100)
          if (!batch.length) continue
          const { data, error } = await client
            .from('machine_events')
            .select(selectColumns)
            .in(column, batch)
            .order('event_datetime', { ascending: true })
            .limit(10000)
          if (error) {
            if (error.code === '42P01' || error.code === '42703') continue
            return error
          }
          for (const row of (data || []) as EventRow[]) {
            const key = [row.machine_id, row.machine_uuid, row.machine_wtn_id, row.source_machine_name, row.event_datetime, row.selection, row.action, row.event_type, row.quantity].join('|')
            if (!seen.has(key)) {
              seen.add(key)
              collected.push(row)
            }
          }
        }
        return null
      }

      for (const [column, values] of [
        ['machine_id', machineIds],
        ['machine_uuid', machineIds],
        ['machine_wtn_id', wtnIds],
        ['source_machine_name', facilityNames],
      ] as const) {
        const error = await fetchBy(column, [...values])
        if (error) return { data: collected, error }
      }

      // Some exports use a decorated source name (for example, "Milford BCCS")
      // while the location record is simply "Milford". Retrieve those rows with a
      // contained-name fallback; UUID and WTN matching remain authoritative.
      for (const facility of facilityNames) {
        const token = normalizeMachineName(facility)
        if (!token || token.length < 3) continue
        const { data, error } = await client
          .from('machine_events')
          .select(selectColumns)
          .ilike('source_machine_name', `%${token}%`)
          .order('event_datetime', { ascending: true })
          .limit(10000)
        if (error) {
          if (error.code === '42P01' || error.code === '42703') continue
          return { data: collected, error }
        }
        for (const row of (data || []) as EventRow[]) {
          const key = [row.machine_id, row.machine_uuid, row.machine_wtn_id, row.source_machine_name, row.event_datetime, row.selection, row.action, row.event_type, row.quantity].join('|')
          if (!seen.has(key)) {
            seen.add(key)
            collected.push(row)
          }
        }
      }

      return { data: collected, error: null }
    }

    const eventResult = await loadEventsForMachines()
    const eventRows = eventResult.data
    const eventError = eventResult.error
    if (eventError) {
      setMessage(eventError.message)
      setLoading(false)
      return
    }

    const eventList = (eventRows || []) as EventRow[]
    const summaryList = (summaryRows || []) as Array<{ machine_uuid: string | null; machine_wtn_id: string | null; source_name: string | null; units_dispensed: number | null; first_activity: string | null; last_activity: string | null }>
    const machineByLocation = new Map(machineList.map((machine) => [machine.location_id, machine]))

    const normalizeKey = (value: string | null | undefined) => String(value || '').trim().toLowerCase()
    const itemsByMachine = new Map<string, PlanogramRow[]>()
    for (const item of planogramList) {
      const keys = [item.machine_uuid, item.machine_wtn_id].map(normalizeKey).filter(Boolean)
      for (const key of new Set(keys)) {
        const current = itemsByMachine.get(key) || []
        current.push(item)
        itemsByMachine.set(key, current)
      }
    }

    const aliasBySource = new Map(aliasList.map((alias) => [normalizeMachineName(alias.source_machine_name), alias]))

    const eventsByMachine = new Map<string, EventRow[]>()
    for (const event of eventList) {
      const rememberedAlias = aliasBySource.get(normalizeMachineName(event.source_machine_name))
      if (rememberedAlias?.ignored) continue
      const keys = [
        event.machine_id,
        event.machine_uuid,
        event.machine_wtn_id,
        event.source_machine_name,
        normalizeMachineName(event.source_machine_name),
        rememberedAlias?.machine_id,
        rememberedAlias?.machine_uuid,
        rememberedAlias?.machine_wtn_id,
      ].map(normalizeKey).filter(Boolean)
      for (const key of new Set(keys)) {
        const current = eventsByMachine.get(key) || []
        current.push(event)
        eventsByMachine.set(key, current)
      }
    }

    const summariesByMachine = new Map<string, typeof summaryList[number]>()
    for (const summary of summaryList) {
      const rememberedAlias = aliasBySource.get(normalizeMachineName(summary.source_name))
      if (rememberedAlias?.ignored) continue
      for (const key of [summary.machine_uuid, summary.machine_wtn_id, summary.source_name, normalizeMachineName(summary.source_name), rememberedAlias?.machine_id, rememberedAlias?.machine_uuid, rememberedAlias?.machine_wtn_id].map(normalizeKey).filter(Boolean)) {
        summariesByMachine.set(key, summary)
      }
    }

    const views = locationList.flatMap((location) => {
      const machine = machineByLocation.get(location.id)
      if (!machine) return []
      const items = [...new Set([...(itemsByMachine.get(normalizeKey(machine.id)) || []), ...(itemsByMachine.get(normalizeKey(machine.machine_id)) || [])])]
      const names = locationNames(location)
      const eventKeys = [machine.id, machine.machine_id, names.facility, normalizeMachineName(names.facility)].map(normalizeKey).filter(Boolean)
      const machineEvents = [...new Set(eventKeys.flatMap((key) => eventsByMachine.get(key) || []))]
      const summary = eventKeys.map((key) => summariesByMachine.get(key)).find(Boolean)
      const summaryDates = [summary?.first_activity, summary?.last_activity]
        .map((value) => value ? new Date(value) : null)
        .filter((value): value is Date => Boolean(value) && !Number.isNaN(value!.getTime()))
      const summaryDays = summaryDates.length === 2
        ? Math.max(1, Math.floor((summaryDates[1].getTime() - summaryDates[0].getTime()) / 86400000) + 1)
        : 1
      const summaryUnitsDispensed = Number(summary?.units_dispensed || 0)
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
        products: [...new Set(items.map((item) => String(item.product_name || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
        planogramItems: items,
        events: machineEvents,
        summaryUnitsDispensed,
        summaryAverageDispensedPerDay: summaryUnitsDispensed / summaryDays,
      }]
    })

    setMachines(views)
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  const products = useMemo(() => [...new Set(machines.flatMap((machine) => machine.products))].sort((a, b) => a.localeCompare(b)), [machines])

  const matchingProducts = useMemo(() => {
    const search = productQuery.trim().toLowerCase()
    return search ? products.filter((product) => product.toLowerCase().includes(search)) : products
  }, [products, productQuery])

  function toggleProduct(product: string) {
    setSelectedProducts((current) => current.includes(product) ? current.filter((value) => value !== product) : [...current, product])
  }

  function selectAllMatchingProducts() {
    setSelectedProducts((current) => [...new Set([...current, ...matchingProducts])])
  }

  const displayMachines = useMemo(() => machines.map((machine) => {
    const selected = new Set(selectedProducts)
    const selectedFamilies = new Set(selectedProducts.map(productFamily).filter(Boolean))
    const matchingItems = selected.size === 0
      ? machine.planogramItems
      : machine.planogramItems.filter((item) => {
          const exactProduct = String(item.product_name || '').trim()
          return selected.has(exactProduct) || selectedFamilies.has(productFamily(exactProduct))
        })
    // Keep each tied planogram range as one product location for Selection and PAR
    // calculations. Event matching uses range containment rather than literal equality.
    const allPlanogramSelectionsMatch = selected.size > 0
      && machine.planogramItems.length > 0
      && matchingItems.length === machine.planogramItems.length

    // Product filtering follows the planogram first. If the selected product covers
    // every selection in the machine, the filtered dispense total must equal the
    // machine-level Machine Logs total even when imported logs omit selection values.
    // For mixed-product machines, match by normalized selection and use product text
    // only as a fallback when the event has no usable selection value.
    const matchingEvents = machine.events.filter((event) => {
      if (selected.size === 0 || allPlanogramSelectionsMatch) return true
      const eventSelection = normalizeSelection(event.selection)
      if (eventSelection && matchingItems.some((item) => planogramSelectionContains(item.selection_number, event.selection))) return true
      if (eventSelection) return false
      const eventProduct = String(event.product || '').trim()
      return selected.has(eventProduct) || selectedFamilies.has(productFamily(eventProduct))
    })
    const successfulEvents = matchingEvents.filter(isDispenseEvent)
    const eventDates = successfulEvents
      .map((event) => event.event_datetime ? new Date(event.event_datetime) : null)
      .filter((date): date is Date => Boolean(date) && !Number.isNaN(date!.getTime()))
      .sort((a, b) => a.getTime() - b.getTime())
    const evaluationDays = eventDates.length > 1
      ? Math.max(1, Math.floor((eventDates[eventDates.length - 1].getTime() - eventDates[0].getTime()) / 86400000) + 1)
      : 1
    const calculatedUnitsDispensed = successfulEvents.reduce((sum, event) => sum + Math.max(Number(event.quantity || 1), 1), 0)
    const useMachineLogSummary = selected.size === 0 || allPlanogramSelectionsMatch
    const unitsDispensed = useMachineLogSummary
      ? Number(machine.summaryUnitsDispensed || calculatedUnitsDispensed)
      : calculatedUnitsDispensed
    const averageDispensedPerDay = useMachineLogSummary
      ? Number(machine.summaryAverageDispensedPerDay || 0)
      : unitsDispensed / evaluationDays
    return {
      ...machine,
      selectionCount: matchingItems.length,
      parUnits: matchingItems.reduce((sum, item) => sum + Number(item.par_level || 0), 0),
      currentUnits: matchingItems.reduce((sum, item) => sum + Number(item.current_quantity || 0), 0),
      maxUnits: matchingItems.reduce((sum, item) => sum + Number(item.max_level || 0), 0),
      criticalSelections: matchingItems.filter((item) => Number(item.current_quantity) <= Number(item.critical_level)).length,
      belowParSelections: matchingItems.filter((item) => Number(item.current_quantity) < Number(item.par_level)).length,
      unitsDispensed,
      averageDispensedPerDay,
    }
  }), [machines, selectedProducts])

  const groups = useMemo(() => {
    const search = query.trim().toLowerCase()
    const filtered = displayMachines.filter((machine) => {
      const names = locationNames(machine.location)
      const matchesText = `${machine.machine_id} ${names.agency} ${names.facility} ${machine.location.city || ''} ${machine.location.state || ''}`.toLowerCase().includes(search)
      const matchesProducts = selectedProducts.length === 0 || machine.selectionCount > 0
      return matchesText && matchesProducts
    })
    const grouped = new Map<string, Array<MachineView & { unitsDispensed: number; averageDispensedPerDay: number }>>()
    for (const machine of filtered) {
      const { agency } = locationNames(machine.location)
      const rows = grouped.get(agency) || []
      rows.push(machine)
      grouped.set(agency, rows)
    }
    return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [displayMachines, query, selectedProducts])

  return <div className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold">Machines & Inventory</h1>
        <p className="text-slate-500">Select a machine by agency to open its planogram, selection inventory, PAR levels, and inventory history.</p>
      </div>
      <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-end">
        <div className="relative w-full sm:w-[385px]"><Search className="absolute left-3 top-3 text-slate-400" size={17}/><input className={`${inputClass} pl-10`} placeholder="Search agency, facility, or WTN..." value={query} onChange={(event) => setQuery(event.target.value)}/></div>
        <div className="relative w-full sm:w-[315px]">
          <button type="button" onClick={() => setProductMenuOpen((open) => !open)} className={`${inputClass} flex h-[42px] items-center justify-between bg-white text-left`}>
            <span className="truncate">{selectedProducts.length ? `${selectedProducts.length} product${selectedProducts.length === 1 ? '' : 's'} selected` : 'All products'}</span>
            <ChevronDown size={17} className={`shrink-0 text-slate-500 transition ${productMenuOpen ? 'rotate-180' : ''}`}/>
          </button>
          {productMenuOpen && <div className="absolute right-0 z-40 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
            <div className="border-b border-slate-100 p-3">
              <div className="relative"><Search className="absolute left-3 top-2.5 text-slate-400" size={16}/><input autoFocus className={`${inputClass} h-9 pl-9`} placeholder="Search products, e.g. Narcan" value={productQuery} onChange={(event) => setProductQuery(event.target.value)}/></div>
              <div className="mt-2 flex items-center justify-between gap-2 text-xs font-semibold">
                <button type="button" onClick={selectAllMatchingProducts} disabled={!matchingProducts.length} className="text-blue-700 disabled:text-slate-300">Select all matching ({matchingProducts.length})</button>
                <button type="button" onClick={() => setSelectedProducts([])} className="text-slate-500 hover:text-slate-800">Clear</button>
              </div>
            </div>
            <div className="max-h-72 overflow-y-auto p-2">
              {matchingProducts.length === 0 ? <p className="px-3 py-6 text-center text-sm text-slate-500">No products match this search.</p> : matchingProducts.map((product) => {
                const checked = selectedProducts.includes(product)
                return <button key={product} type="button" onClick={() => toggleProduct(product)} className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 bg-white'}`}>{checked && <Check size={12}/>}</span>
                  <span className="leading-5 text-slate-800">{product}</span>
                </button>
              })}
            </div>
          </div>}
        </div>
      </div>
    </div>

    {selectedProducts.length > 0 && <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Product filters:</span>
      {selectedProducts.map((product) => <button key={product} type="button" onClick={() => toggleProduct(product)} className="inline-flex max-w-xs items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-800"><span className="truncate">{product}</span><X size={13}/></button>)}
      <button type="button" onClick={() => setSelectedProducts([])} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Clear all</button>
    </div>}

    {message && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{message}</div>}

    {loading ? <Card><p className="py-12 text-center text-slate-500">Loading machines…</p></Card> : groups.length === 0 ? <Card><p className="py-12 text-center text-slate-500">No machines were found. Add WTN Machine IDs on the Locations page first.</p></Card> : groups.map(([agency, rows]) => {
      const isCollapsed = collapsed[agency] ?? true
      const averageSelections = average(rows.map((row) => row.selectionCount))
      const averagePar = average(rows.map((row) => row.parUnits))
      const averageDispensed = average(rows.map((row) => row.unitsDispensed || 0))
      const averageDispensedPerDay = average(rows.map((row) => row.averageDispensedPerDay || 0))
      const avgAccessibility = average(rows.map((row) => row.accessibilityScore))
      const avgRisk = average(rows.map((row) => row.riskScore))
      const avgMaximum = average(rows.map((row) => row.maximumLocationScore))
      const metrics = [
        { label: 'Avg Accessibility', value: avgAccessibility, inverted: false },
        { label: 'Avg Risk', value: avgRisk, inverted: true },
        { label: 'Avg Max Score', value: avgMaximum, inverted: false },
      ]
      return <Card key={agency} className="overflow-hidden p-0">
        <button type="button" onClick={() => setCollapsed((value) => ({ ...value, [agency]: !(value[agency] ?? true) }))} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-3 text-left hover:bg-slate-50">
          <div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-blue-50 p-2 text-blue-600"><Boxes size={19}/></div><div className="min-w-0"><h2 className="truncate text-base font-bold">{agency}</h2><p className="text-xs text-slate-500">{rows.length} machine{rows.length === 1 ? '' : 's'} · {rows.filter((row) => row.active).length} active</p></div></div>
          <div className="hidden min-w-0 items-center gap-2 overflow-hidden xl:flex">
            {[
              ['Avg Selections', averageSelections.toFixed(1)],
              ['Avg PAR', averagePar.toFixed(1)],
              ['Avg Dispensed', averageDispensed.toFixed(1)],
              ['Avg Dispensed/Day', averageDispensedPerDay.toFixed(2)],
            ].map(([label, value], index) => <div key={label} className="flex shrink-0 items-baseline gap-1 whitespace-nowrap"><span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span><span className="text-sm font-extrabold text-slate-800">{value}</span>{index < 3 && <span className="ml-1 text-slate-300">•</span>}</div>)}
          </div>
          <div className="hidden items-center gap-2 lg:flex">{metrics.map((metric) => <div key={metric.label} className={`min-w-[118px] rounded-lg border px-3 py-2 ${scoreTone(metric.value, metric.inverted)}`}><p className="text-[10px] font-bold uppercase tracking-wide opacity-75">{metric.label}</p><p className="text-lg font-extrabold leading-5">{Math.round(metric.value * 100)}%</p></div>)}</div>
          <div className="rounded-full border border-slate-200 p-2 text-slate-500">{isCollapsed ? <ChevronDown size={17}/> : <ChevronUp size={17}/>}</div>
        </button>
        {!isCollapsed && <div className="overflow-x-auto border-t border-slate-200"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Machine ID','Location / Facility','City / State','Selections','PAR','Units Dispensed','Avg Dispensed / Day','Inventory Status','Action'].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead><tbody>{rows.map((machine) => {
          const names = locationNames(machine.location)
          const status = statusFor(machine)
          return <tr key={machine.id} className="border-t border-slate-100"><td className="px-4 py-3"><p className="font-bold text-slate-900">{machine.machine_id}</p><p className="mt-1 text-xs text-slate-500">{names.facility}</p></td><td className="px-4 py-3 font-medium">{names.facility}</td><td className="px-4 py-3">{[machine.location.city, machine.location.state].filter(Boolean).join(', ') || '—'}</td><td className="px-4 py-3 font-semibold">{machine.selectionCount}</td><td className="px-4 py-3">{machine.parUnits}</td><td className="px-4 py-3 font-semibold">{machine.unitsDispensed}</td><td className="px-4 py-3">{machine.averageDispensedPerDay.toFixed(2)}</td><td className="px-4 py-3"><Badge tone={status.tone}>{status.label}</Badge></td><td className="px-4 py-3"><Link to={`/machines/${machine.id}`} className="inline-flex rounded-xl border border-blue-200 px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50">Open Machine</Link></td></tr>
        })}</tbody></table></div>}
      </Card>
    })}
  </div>
}
