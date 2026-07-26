import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Boxes, FileUp, Plus, RefreshCw, X, Calculator } from 'lucide-react'
import { Badge, Card, Field, inputClass } from '../components/ui'
import { Link, useParams } from 'react-router-dom'
import { parseCsv } from '../lib/csv'
import { supabase } from '../lib/supabase'

type LocationRow = {
  id: string
  machine_id: string
  agency: string | null
  location_name: string | null
  address: string | null
  city: string | null
  state: string | null
}

type MachineRow = {
  id: string
  location_id: string
  machine_id: string
  capacity: number
  current_inventory: number
  supplier_reliability: number
  max_orderable_quantity: number
  active: boolean
  locations?: LocationRow | null
}

type PlanogramRow = {
  id?: string
  machine_id: string
  machine_uuid?: string
  machine_wtn_id?: string
  selection_number: string
  product_name: string
  item_number: string
  validation_mode: string
  critical_level: number
  low_level: number
  par_level: number
  max_level: number
  current_quantity: number
  price: number
  source_location_name?: string | null
  source_machine_name?: string | null
  imported_at?: string
}

type InventoryPeriod = {
  id: string
  machine_id: string
  period_date: string
  demand: number
  units_replenished: number
  units_dispensed: number
  ending_inventory: number
  unmet_demand: number
  inventory_status: string
  total_period_cost: number
}

type DemandSummary = {
  capacity: number
  selection_count: number
  successful_transactions: number
  dispensed_units: number
  requested_from_logs: number
  restocked_from_logs: number
  stockout_events: number
  evaluation_days: number
  first_activity: string | null
  last_activity: string | null
}

type DemandParameters = {
  requested_quantity_override: number | null
  restocked_quantity_override: number | null
}

type ParsedPlanogram = {
  locationName: string
  machineName: string
  rows: Omit<PlanogramRow, 'machine_id' | 'machine_uuid' | 'machine_wtn_id'>[]
}

const numberValue = (value: unknown) => {
  const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function facilityName(location?: { location_name?: string | null; agency?: string | null } | null) {
  return location?.location_name?.trim() || 'Location'
}
function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function matchMachine(parsed: ParsedPlanogram, machines: MachineRow[]) {
  const source = normalize(`${parsed.locationName} ${parsed.machineName}`)
  return machines.find((machine) => {
    const target = normalize(`${machine.machine_id} ${machine.locations?.agency || ''} ${facilityName(machine.locations)}`)
    const sourceTokens = source.split(' ').filter((token) => token.length > 3)
    return sourceTokens.some((token) => target.includes(token))
  })
}

async function parsePlanogramPdf(file: File): Promise<ParsedPlanogram> {
  const pdfjs = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const bytes = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data: bytes }).promise
  const allRows: ParsedPlanogram['rows'] = []
  let locationName = ''
  let machineName = ''

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const items = content.items
      .filter((item): item is typeof item & { str: string; transform: number[] } => 'str' in item && 'transform' in item)
      .map((item) => ({ text: item.str.trim().replace(/\s+/g, ''), x: item.transform[4], y: item.transform[5] }))
      .filter((item) => item.text)

    if (pageNumber === 1) {
      const metaItems = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x))
      const metaText = metaItems.map((item) => item.text).join(' ')
      const metaMatch = metaText.match(/LOCATION\s+(.+?)\s+MACHINE\s+(.+?)\s+SELECTIO/i)
      if (metaMatch) {
        locationName = metaMatch[1].trim()
        machineName = metaMatch[2].trim()
      }
    }

    const starts = items
      .filter((item) => item.x < 70 && /^\d{2,4}$/.test(item.text))
      .sort((a, b) => b.y - a.y)

    for (let index = 0; index < starts.length; index += 1) {
      const start = starts[index]
      const nextY = starts[index + 1]?.y ?? -Infinity
      const rowItems = items.filter((item) => item.y <= start.y + 2 && item.y > nextY + 2)
      const columnText = (minX: number, maxX: number) => rowItems
        .filter((item) => item.x >= minX && item.x < maxX)
        .sort((a, b) => (b.y - a.y) || (a.x - b.x))
        .map((item) => item.text)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()

      allRows.push({
        selection_number: start.text,
        product_name: columnText(70, 125),
        item_number: columnText(125, 175),
        validation_mode: columnText(175, 225),
        critical_level: numberValue(columnText(225, 275)),
        low_level: numberValue(columnText(275, 325)),
        par_level: numberValue(columnText(325, 374)),
        max_level: numberValue(columnText(374, 423)),
        current_quantity: numberValue(columnText(423, 473)),
        price: numberValue(columnText(473, 530)),
        source_location_name: locationName,
        source_machine_name: machineName,
      })
    }
  }

  if (!allRows.length) throw new Error('No selection rows were found in this PDF.')
  return { locationName, machineName, rows: allRows }
}

function firstValue(row: Record<string, string>, aliases: string[]) {
  const key = Object.keys(row).find((candidate) => aliases.includes(candidate.toLowerCase().replace(/[^a-z0-9]/g, '')))
  return key ? row[key] : ''
}

async function parsePlanogramCsv(file: File): Promise<ParsedPlanogram> {
  const rows = parseCsv(await file.text())
  if (!rows.length) throw new Error('The CSV does not contain planogram rows.')
  const parsedRows = rows.map((row) => ({
    selection_number: firstValue(row, ['selection', 'selectionnumber', 'selectionno']),
    product_name: firstValue(row, ['product', 'productname']),
    item_number: firstValue(row, ['item', 'itemnumber', 'itemno']),
    validation_mode: firstValue(row, ['validation', 'validationmode']),
    critical_level: numberValue(firstValue(row, ['critical', 'criticallevel'])),
    low_level: numberValue(firstValue(row, ['low', 'lowlevel'])),
    par_level: numberValue(firstValue(row, ['par', 'parlevel'])),
    max_level: numberValue(firstValue(row, ['max', 'maxlevel'])),
    current_quantity: numberValue(firstValue(row, ['current', 'currentquantity', 'quantity'])),
    price: numberValue(firstValue(row, ['price', 'currentprice'])),
    source_location_name: firstValue(row, ['location', 'locationname']),
    source_machine_name: firstValue(row, ['machine', 'machinename']),
  })).filter((row) => row.selection_number)
  if (!parsedRows.length) throw new Error('The CSV is missing a Selection column.')
  return {
    locationName: parsedRows[0].source_location_name || '',
    machineName: parsedRows[0].source_machine_name || '',
    rows: parsedRows,
  }
}

function inventoryTone(current: number, critical: number, par: number): 'green' | 'yellow' | 'red' | 'slate' {
  if (current <= critical) return 'red'
  if (current < par) return 'yellow'
  return 'green'
}

export default function MachineData() {
  const [machines, setMachines] = useState<MachineRow[]>([])
  const [planogram, setPlanogram] = useState<PlanogramRow[]>([])
  const [periods, setPeriods] = useState<InventoryPeriod[]>([])
  const [demandSummary, setDemandSummary] = useState<DemandSummary | null>(null)
  const [demandParameters, setDemandParameters] = useState<DemandParameters | null>(null)
  const [selectedMachineId, setSelectedMachineId] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [preview, setPreview] = useState<ParsedPlanogram | null>(null)
  const [targetMachineId, setTargetMachineId] = useState('')
  const [showManual, setShowManual] = useState(false)
  const [manual, setManual] = useState({ selection_number: '', product_name: '', item_number: '', validation_mode: 'Offline Dispensing', critical_level: 1, low_level: 0, par_level: 0, max_level: 0, current_quantity: 0, price: 0 })
  const fileRef = useRef<HTMLInputElement>(null)
  const { machineId } = useParams()

  async function loadMachines() {
    if (!supabase) return
    setLoading(true)
    setMessage('')

    const { error: syncError } = await supabase.rpc('sync_machines_from_locations')
    if (syncError) {
      setLoading(false)
      setMessage(syncError.message)
      return
    }

    const { data, error } = await supabase
      .from('machines')
      .select('id,location_id,machine_id,capacity,current_inventory,supplier_reliability,max_orderable_quantity,active,locations(agency,location_name,address,city,state)')
      .order('machine_id')

    setLoading(false)
    if (error) return setMessage(error.message)
    setMachines((data || []) as unknown as MachineRow[])
  }

  async function loadMachineDetails(machineId: string) {
    if (!supabase || !machineId) return
    const [
      { data: items, error: itemError },
      { data: history, error: historyError },
      { data: demandData, error: demandError },
      { data: parameterData, error: parameterError },
    ] = await Promise.all([
      supabase.from('machine_planogram_items').select('*').eq('machine_uuid', machineId).order('selection_number'),
      supabase.from('inventory_periods').select('*').eq('machine_uuid', machineId).order('period_date', { ascending: false }).limit(12),
      supabase.rpc('get_demand_evaluation_summary', {
        p_machine_uuid: machineId,
        p_product_filter: 'All Products',
        p_start_date: null,
        p_end_date: null,
      }),
      supabase
        .from('demand_evaluation_parameters')
        .select('requested_quantity_override,restocked_quantity_override')
        .eq('machine_uuid', machineId)
        .eq('product_filter', 'All Products')
        .maybeSingle(),
    ])
    if (itemError && itemError.code !== '42P01') setMessage(itemError.message)
    if (historyError) setMessage(historyError.message)
    if (demandError && demandError.code !== '42883' && demandError.code !== 'PGRST202') setMessage(demandError.message)
    if (parameterError && parameterError.code !== '42P01') setMessage(parameterError.message)
    setPlanogram((items || []) as PlanogramRow[])
    setPeriods((history || []) as InventoryPeriod[])
    setDemandSummary(((demandData || [])[0] || null) as DemandSummary | null)
    setDemandParameters((parameterData || null) as DemandParameters | null)
  }

  useEffect(() => { void loadMachines() }, [machineId])

  useEffect(() => {
    if (!machineId || !machines.length) return

    // Routes may contain either the internal UUID or the WTN business ID.
    // Always resolve the route to the canonical machine UUID before loading details.
    const routeValue = decodeURIComponent(machineId).trim().toLowerCase()
    const matchedMachine = machines.find((machine) =>
      machine.id.toLowerCase() === routeValue ||
      machine.machine_id.trim().toLowerCase() === routeValue
    )

    if (matchedMachine && matchedMachine.id !== selectedMachineId) {
      setSelectedMachineId(matchedMachine.id)
    }
  }, [machineId, machines, selectedMachineId])

  useEffect(() => {
    if (selectedMachineId) void loadMachineDetails(selectedMachineId)
  }, [selectedMachineId])

  const selectedMachine = machines.find((machine) => machine.id === selectedMachineId)
  const totals = useMemo(() => planogram.reduce((acc, row) => ({
    current: acc.current + Number(row.current_quantity || 0),
    par: acc.par + Number(row.par_level || 0),
    max: acc.max + Number(row.max_level || 0),
    critical: acc.critical + Number(row.critical_level || 0),
  }), { current: 0, par: 0, max: 0, critical: 0 }), [planogram])
  const fillPercent = totals.max ? Math.round((totals.current / totals.max) * 100) : 0
  const belowPar = planogram.filter((row) => row.current_quantity < row.par_level).length
  const critical = planogram.filter((row) => row.current_quantity <= row.critical_level).length
  const requestedUnits = demandParameters?.requested_quantity_override ?? Number(demandSummary?.requested_from_logs || 0)
  const restockedUnits = demandParameters?.restocked_quantity_override ?? Number(demandSummary?.restocked_from_logs || 0)
  const supplierFillRate = requestedUnits > 0 ? (restockedUnits / requestedUnits) * 100 : 0
  const averageTransactionsPerDay = Number(demandSummary?.successful_transactions || 0) / Math.max(1, Number(demandSummary?.evaluation_days || 1))
  const formatActivityDate = (value: string | null | undefined) => value
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
    : 'No activity'

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImporting(true)
    setMessage('')
    try {
      const result = file.name.toLowerCase().endsWith('.pdf') ? await parsePlanogramPdf(file) : await parsePlanogramCsv(file)
      setPreview(result)
      const match = matchMachine(result, machines)
      setTargetMachineId(match?.id || selectedMachineId || '')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The planogram could not be read.')
    } finally {
      setImporting(false)
    }
  }

  async function saveImport() {
    if (!supabase || !preview || !targetMachineId) return setMessage('Select the WTN Machine ID for this planogram.')
    setImporting(true)
    const targetMachine = machines.find((machine) => machine.id === targetMachineId)
    const payload = preview.rows.map((row) => ({ ...row, machine_id: targetMachineId, machine_uuid: targetMachineId, machine_wtn_id: targetMachine?.machine_id || null, imported_at: new Date().toISOString() }))
    const { error } = await supabase.from('machine_planogram_items').upsert(payload, { onConflict: 'machine_uuid,selection_number' })
    if (error) {
      setMessage(error.message)
      setImporting(false)
      return
    }
    const capacity = payload.reduce((sum, row) => sum + row.max_level, 0)
    const current = payload.reduce((sum, row) => sum + row.current_quantity, 0)
    const par = payload.reduce((sum, row) => sum + row.par_level, 0)
    const { error: machineError } = await supabase.from('machines').update({ capacity, current_inventory: current, max_orderable_quantity: Math.max(0, par - current), updated_at: new Date().toISOString() }).eq('id', targetMachineId)
    if (machineError) setMessage(machineError.message)
    else setMessage(`Imported ${payload.length} selections and updated machine inventory.`)
    setSelectedMachineId(targetMachineId)
    setPreview(null)
    setImporting(false)
    await loadMachines()
    await loadMachineDetails(targetMachineId)
  }

  async function addManualSelection() {
    if (!supabase || !selectedMachineId || !manual.selection_number.trim()) return setMessage('Machine and selection number are required.')
    const { error } = await supabase.from('machine_planogram_items').upsert({ ...manual, machine_id: selectedMachineId, machine_uuid: selectedMachineId, machine_wtn_id: selectedMachine?.machine_id || null, selection_number: manual.selection_number.trim(), imported_at: new Date().toISOString() }, { onConflict: 'machine_uuid,selection_number' })
    if (error) return setMessage(error.message)
    setShowManual(false)
    setManual({ selection_number: '', product_name: '', item_number: '', validation_mode: 'Offline Dispensing', critical_level: 1, low_level: 0, par_level: 0, max_level: 0, current_quantity: 0, price: 0 })
    await loadMachineDetails(selectedMachineId)
  }

  async function updateCurrent(row: PlanogramRow, value: number) {
    if (!supabase || !row.id) return
    const { error } = await supabase.from('machine_planogram_items').update({ current_quantity: Math.max(0, value), updated_at: new Date().toISOString() }).eq('id', row.id)
    if (error) return setMessage(error.message)
    setPlanogram((current) => current.map((item) => item.id === row.id ? { ...item, current_quantity: Math.max(0, value) } : item))
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Link to="/machines" className="mb-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-700"><ArrowLeft size={16}/>Back to Machines</Link>
        <h1 className="text-2xl font-bold">Machine Inventory Detail</h1>
        <p className="text-slate-500">View the selected machine’s planogram configuration, including critical, low, PAR, and maximum levels.</p>
      </div>
      <div className="flex flex-wrap gap-3">
        {selectedMachineId && <Link to={`/machines/${selectedMachineId}/demand-evaluation`} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700"><Calculator size={17}/>Demand Evaluation</Link>}
        <button onClick={() => fileRef.current?.click()} disabled={importing} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><FileUp size={17}/>{importing ? 'Reading…' : 'Upload Planogram'}</button>
        <input ref={fileRef} type="file" accept=".pdf,.csv,text/csv,application/pdf" className="hidden" onChange={handleUpload}/>
        <button onClick={() => setShowManual(true)} disabled={!selectedMachineId} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-700"><Plus size={17}/>Add Selection</button>
      </div>
    </div>

    {message && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}

    <div className="space-y-6">
      {selectedMachine ? <>

          <Card>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div><div className="flex items-center gap-3"><div className="rounded-xl bg-blue-50 p-2 text-blue-600"><Boxes size={22}/></div><div><h2 className="text-xl font-bold">{selectedMachine.machine_id}</h2><p className="text-sm text-slate-500">{facilityName(selectedMachine.locations)} · {[selectedMachine.locations?.city, selectedMachine.locations?.state].filter(Boolean).join(', ')}</p></div></div></div>
              <button onClick={() => void loadMachineDetails(selectedMachine.id)} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-600"><RefreshCw size={15}/>Refresh</button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {[
                ['Capacity', Number(demandSummary?.capacity || totals.max)],
                ['Avg Transactions / Day', averageTransactionsPerDay.toFixed(3)],
                ['Units Dispensed', Number(demandSummary?.dispensed_units || 0).toLocaleString()],
                ['Total Requested', requestedUnits.toLocaleString()],
                ['Actually Restocked', restockedUnits.toLocaleString()],
                ['Supplier Fill Rate', requestedUnits > 0 ? `${supplierFillRate.toFixed(1)}%` : '—'],
              ].map(([label, value]) => <div key={label} className="rounded-xl bg-slate-50 p-4"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>)}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge tone={Number(demandSummary?.stockout_events || 0) > 0 ? 'red' : 'green'}>{Number(demandSummary?.stockout_events || 0).toLocaleString()} stockout events</Badge>
              <Badge tone="slate">First activity: {formatActivityDate(demandSummary?.first_activity)}</Badge>
              <Badge tone="slate">Last activity: {formatActivityDate(demandSummary?.last_activity)}</Badge>
              <Link to={`/machines/${selectedMachine.id}/demand-evaluation`} className="ml-auto text-sm font-semibold text-blue-700 hover:text-blue-800">Open full demand evaluation →</Link>
            </div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-slate-200 px-5 py-4"><h3 className="font-bold">Planogram Configuration</h3><p className="text-sm text-slate-500">Reference view showing selection, product, item number, critical level, low level, PAR level, and maximum level. Current quantity, fill requirements, price, and status remain stored but are hidden here.</p></div>
            <div className="overflow-x-auto"><table className="min-w-[820px] w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Selection','Product','Item #','Critical','Low','PAR','Maximum'].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead><tbody>
              {!planogram.length ? <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">No planogram has been loaded for this machine. Upload the PDF or CSV downloaded from IQ Technology.</td></tr> : planogram.map((row) => <tr key={row.id || row.selection_number} className="border-t border-slate-100 align-top"><td className="px-4 py-3 font-bold">{row.selection_number}</td><td className="max-w-72 px-4 py-3">{row.product_name || '—'}</td><td className="px-4 py-3">{row.item_number || '—'}</td><td className="px-4 py-3 font-semibold">{row.critical_level}</td><td className="px-4 py-3 font-semibold">{row.low_level}</td><td className="px-4 py-3 font-semibold">{row.par_level}</td><td className="px-4 py-3 font-semibold">{row.max_level}</td></tr>)}
            </tbody></table></div>
          </Card>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-slate-200 px-5 py-4"><h3 className="font-bold">Inventory Period History</h3><p className="text-sm text-slate-500">Historical replenishment and dispensing records remain available under the selected machine.</p></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Period','Demand','Replenished','Dispensed','Ending','Unmet','Status','Cost'].map((heading) => <th key={heading} className="px-5 py-3">{heading}</th>)}</tr></thead><tbody>{periods.length ? periods.map((period) => <tr key={period.id} className="border-t border-slate-100"><td className="px-5 py-3">{period.period_date}</td><td className="px-5 py-3">{period.demand}</td><td className="px-5 py-3">{period.units_replenished}</td><td className="px-5 py-3">{period.units_dispensed}</td><td className="px-5 py-3">{period.ending_inventory}</td><td className="px-5 py-3">{period.unmet_demand}</td><td className="px-5 py-3"><Badge tone={period.inventory_status === 'Healthy' ? 'green' : period.inventory_status === 'Watch' ? 'yellow' : 'red'}>{period.inventory_status}</Badge></td><td className="px-5 py-3">${Number(period.total_period_cost).toFixed(2)}</td></tr>) : <tr><td colSpan={8} className="px-5 py-8 text-center text-slate-500">No inventory period history is available.</td></tr>}</tbody></table></div>
          </Card>
      </> : <Card><p className="py-12 text-center text-slate-500">The requested machine could not be found.</p></Card>}
    </div>

    {preview && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6"><Card className="max-h-[90vh] w-full max-w-5xl overflow-auto">
      <div className="flex items-start justify-between gap-4"><div><h2 className="text-xl font-bold">Import Planogram</h2><p className="text-sm text-slate-500">Detected {preview.rows.length} selections from {preview.machineName || 'the uploaded file'} at {preview.locationName || 'the reported location'}.</p></div><button onClick={() => setPreview(null)}><X size={22}/></button></div>
      <div className="mt-5 grid gap-4 md:grid-cols-2"><Field label="Location WTN Machine ID"><select className={inputClass} value={targetMachineId} onChange={(event) => setTargetMachineId(event.target.value)}><option value="">Select WTN Machine ID and location</option>{machines.map((machine) => <option key={machine.id} value={machine.id}>{machine.machine_id} — {facilityName(machine.locations)} — {[machine.locations?.city, machine.locations?.state].filter(Boolean).join(', ')}</option>)}</select></Field><div className="rounded-xl bg-slate-50 p-4 text-sm"><p><strong>Report location:</strong> {preview.locationName || 'Not detected'}</p><p className="mt-1"><strong>Report machine:</strong> {preview.machineName || 'Not detected'}</p></div></div>
      <div className="mt-5 overflow-x-auto rounded-xl border border-slate-200"><table className="min-w-[850px] w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase text-slate-500"><tr>{['Selection','Product','Item #','Critical','Low','PAR','Maximum'].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead><tbody>{preview.rows.slice(0, 12).map((row) => <tr key={row.selection_number} className="border-t border-slate-100"><td className="px-4 py-3 font-bold">{row.selection_number}</td><td className="px-4 py-3">{row.product_name}</td><td className="px-4 py-3">{row.item_number}</td><td className="px-4 py-3">{row.critical_level}</td><td className="px-4 py-3">{row.low_level}</td><td className="px-4 py-3">{row.par_level}</td><td className="px-4 py-3">{row.max_level}</td></tr>)}</tbody></table></div>
      {preview.rows.length > 12 && <p className="mt-2 text-sm text-slate-500">Showing the first 12 of {preview.rows.length} selections.</p>}
      <div className="mt-6 flex justify-end gap-3"><button onClick={() => setPreview(null)} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold">Cancel</button><button onClick={() => void saveImport()} disabled={!targetMachineId || importing} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{importing ? 'Importing…' : 'Import & Update Inventory'}</button></div>
    </Card></div>}

    {showManual && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-6"><Card className="w-full max-w-4xl"><div className="flex items-center justify-between"><h2 className="text-xl font-bold">Add Planogram Selection</h2><button onClick={() => setShowManual(false)}><X size={22}/></button></div><div className="mt-5 grid gap-4 md:grid-cols-4"><Field label="Selection"><input className={inputClass} value={manual.selection_number} onChange={(event) => setManual((value) => ({ ...value, selection_number: event.target.value }))}/></Field><Field label="Product"><input className={inputClass} value={manual.product_name} onChange={(event) => setManual((value) => ({ ...value, product_name: event.target.value }))}/></Field><Field label="Item #"><input className={inputClass} value={manual.item_number} onChange={(event) => setManual((value) => ({ ...value, item_number: event.target.value }))}/></Field>{(['critical_level','low_level','par_level','max_level'] as const).map((key) => <Field key={key} label={key.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())}><input type="number" min="0" className={inputClass} value={manual[key]} onChange={(event) => setManual((value) => ({ ...value, [key]: Number(event.target.value) }))}/></Field>)}</div><div className="mt-6 flex justify-end"><button onClick={() => void addManualSelection()} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white">Save Selection</button></div></Card></div>}
  </div>
}
