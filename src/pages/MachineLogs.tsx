import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, ScrollText } from 'lucide-react'
import { Badge, Card, Field, inputClass } from '../components/ui'
import { parseCsv, type CsvRow } from '../lib/csv'
import { supabase } from '../lib/supabase'

type Machine = {
  id: string
  machine_id: string
  locations?: { agency: string | null; location_name: string | null; address: string | null; city: string | null; state: string | null } | null
}

type ParsedLog = {
  sourceMachine: string
  sourceLocation: string
  eventDatetime: string
  action: string
  selection: string
  product: string
  employee: string
  passcode: string
  quantity: number | null
  message: string
  status: string
  eventType: string
  scaleSerial: string
  scaleVariance: number | null
  employeeNumber: string
  errorType: string
  questionName: string
  questionNumber: string
  question: string
  dispenseType: string
  answer: string
  importKey: string
}

type MachineAlias = {
  source_machine_name: string
  machine_id: string | null
  ignored: boolean
}

type DashboardTotals = {
  total_events: number
  units_dispensed: number
  unauthorized_attempts: number
  out_of_stock_attempts: number
}

type MachineEventSummary = {
  machine_uuid: string
  machine_wtn_id: string
  source_name: string
  event_count: number
  units_dispensed: number
  failed_count: number
  stockout_count: number
  first_activity: string | null
  last_activity: string | null
}


const IGNORE_MAPPING = '__IGNORE__'

const normalize = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')

function similarity(left: string, right: string) {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.94
  const grams = (value: string) => {
    const result = new Set<string>()
    for (let i = 0; i < Math.max(1, value.length - 1); i += 1) result.add(value.slice(i, i + 2))
    return result
  }
  const leftGrams = grams(a)
  const rightGrams = grams(b)
  let overlap = 0
  leftGrams.forEach(gram => { if (rightGrams.has(gram)) overlap += 1 })
  return (2 * overlap) / Math.max(1, leftGrams.size + rightGrams.size)
}

function hashText(value: string) {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function parseLogDate(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!match) return null
  const [, month, day, year, hourText, minute, ampm] = match
  let hour = Number(hourText)
  if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12
  if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0
  const local = new Date(Number(year), Number(month) - 1, Number(day), hour, Number(minute), 0)
  return Number.isNaN(local.getTime()) ? null : local.toISOString()
}

function value(row: CsvRow, header: string) {
  return (row[header] || '').trim()
}

function parseMachineLogFile(text: string): { rows: ParsedLog[]; metadata: Record<string, string>; errors: string[] } {
  const normalizedText = text.replace(/^\uFEFF/, '')
  const headerIndex = normalizedText.search(/(?:^|\r?\n)Location,Machine,Date & Time,Action,/)
  if (headerIndex < 0) return { rows: [], metadata: {}, errors: ['The MachineLogs header row was not found.'] }

  const preamble = normalizedText.slice(0, headerIndex).trim()
  const metadata: Record<string, string> = {}
  for (const line of preamble.split(/\r?\n/)) {
    const comma = line.indexOf(',')
    if (comma > 0) metadata[line.slice(0, comma).trim()] = line.slice(comma + 1).trim()
  }

  const dataText = normalizedText.slice(headerIndex).replace(/^\r?\n/, '')
  const csvRows = parseCsv(dataText)
  const errors: string[] = []
  const rows: ParsedLog[] = []

  csvRows.forEach((row, index) => {
    const sourceMachine = value(row, 'Machine')
    const rawDate = value(row, 'Date & Time')
    const eventDatetime = parseLogDate(rawDate)
    if (!sourceMachine || !eventDatetime) {
      errors.push(`Row ${index + 2}: missing machine name or invalid Date & Time.`)
      return
    }
    const keySource = [sourceMachine, rawDate, value(row, 'Action'), value(row, 'Selection'), value(row, 'Employee'), value(row, 'Quantity'), value(row, 'Message'), value(row, 'Status'), value(row, 'Employee #')].join('|')
    rows.push({
      sourceMachine,
      sourceLocation: value(row, 'Location'),
      eventDatetime,
      action: value(row, 'Action'),
      selection: value(row, 'Selection'),
      product: value(row, 'Product'),
      employee: value(row, 'Employee'),
      passcode: value(row, 'Passcode'),
      quantity: value(row, 'Quantity') === '' ? null : Number(value(row, 'Quantity')),
      message: value(row, 'Message'),
      status: value(row, 'Status'),
      eventType: value(row, 'Type'),
      scaleSerial: value(row, 'Scale Serial'),
      scaleVariance: value(row, 'Scale Variance') === '' ? null : Number(value(row, 'Scale Variance')),
      employeeNumber: value(row, 'Employee #'),
      errorType: value(row, 'Error Type'),
      questionName: value(row, 'Question Name'),
      questionNumber: value(row, 'Question No'),
      question: value(row, 'Question'),
      dispenseType: value(row, 'Dispense Type'),
      answer: value(row, 'Answer'),
      importKey: `${hashText(keySource)}-${index + 1}`,
    })
  })
  return { rows, metadata, errors }
}

export default function MachineLogs() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [parsedRows, setParsedRows] = useState<ParsedLog[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [metadata, setMetadata] = useState<Record<string, string>>({})
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [dashboardTotals, setDashboardTotals] = useState<DashboardTotals>({ total_events: 0, units_dispensed: 0, unauthorized_attempts: 0, out_of_stock_attempts: 0 })
  const [eventSummaries, setEventSummaries] = useState<MachineEventSummary[]>([])
  const [filename, setFilename] = useState('')
  const [message, setMessage] = useState('')
  const [importing, setImporting] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [aliases, setAliases] = useState<MachineAlias[]>([])
  const [rememberMappings, setRememberMappings] = useState(true)
  const [collapsedAgencies, setCollapsedAgencies] = useState<Record<string, boolean>>({})

  async function loadData() {
    if (!supabase) return
    const [machineResult, totalsResult, summaryResult, aliasResult] = await Promise.all([
      supabase.from('machines').select('id,machine_id,locations(agency,location_name,address,city,state)').order('machine_id'),
      supabase.rpc('get_machine_log_totals'),
      supabase.rpc('get_machine_log_machine_summary'),
      supabase.from('machine_name_aliases').select('source_machine_name,machine_id,machine_uuid,machine_wtn_id,ignored'),
    ])

    const criticalError = machineResult.error || totalsResult.error || summaryResult.error
    if (criticalError) setMessage(criticalError.message || 'Unable to load machine logs.')
    else if (aliasResult.error && aliasResult.error.code !== '42P01') setMessage(`Machine logs loaded, but remembered mappings are unavailable: ${aliasResult.error.message}`)

    setMachines((machineResult.data || []) as unknown as Machine[])
    const totalsRow = Array.isArray(totalsResult.data) ? totalsResult.data[0] : totalsResult.data
    setDashboardTotals({
      total_events: Number(totalsRow?.total_events || 0),
      units_dispensed: Number(totalsRow?.units_dispensed || 0),
      unauthorized_attempts: Number(totalsRow?.unauthorized_attempts || 0),
      out_of_stock_attempts: Number(totalsRow?.out_of_stock_attempts || 0),
    })
    setEventSummaries(((summaryResult.data || []) as MachineEventSummary[]).map(row => ({
      ...row,
      event_count: Number(row.event_count || 0),
      units_dispensed: Number(row.units_dispensed || 0),
      failed_count: Number(row.failed_count || 0),
      stockout_count: Number(row.stockout_count || 0),
    })))
    setAliases((aliasResult.data || []) as MachineAlias[])
  }

  useEffect(() => { void loadData() }, [])


  function facilityName(location: Machine['locations']) {
    return location?.location_name?.trim() || 'Location not named'
  }

  function machineOptionLabel(machine: Machine) {
    const facility = facilityName(machine.locations)
    const place = [machine.locations?.city, machine.locations?.state].filter(Boolean).join(', ')
    return `${machine.machine_id} — ${facility}${place ? ` — ${place}` : ''}`
  }

  async function syncMachinesFromLocations() {
    if (!supabase) return setMessage('Supabase is not configured.')
    setSyncing(true)
    setMessage('Synchronizing WTN machine identities from Locations…')
    const { data, error } = await supabase.rpc('sync_machines_from_locations')
    setSyncing(false)
    if (error) return setMessage(error.message)
    const result = Array.isArray(data) ? data[0] : data
    setMessage(`Machine directory synchronized. ${Number(result?.inserted_count || 0)} created and ${Number(result?.updated_count || 0)} updated.`)
    await loadData()
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const parsed = parseMachineLogFile(await file.text())
    setFilename(file.name)
    setParsedRows(parsed.rows)
    setMetadata(parsed.metadata)
    setParseErrors(parsed.errors)
    setMessage(parsed.rows.length ? `${parsed.rows.length.toLocaleString()} log rows are ready to map and import.` : 'No valid log rows were found.')

    const sourceNames = [...new Set(parsed.rows.map(row => row.sourceMachine))]
    const nextMapping: Record<string, string> = {}
    for (const source of sourceNames) {
      const remembered = aliases.find(alias => normalize(alias.source_machine_name) === normalize(source))
      if (remembered?.ignored) {
        nextMapping[source] = IGNORE_MAPPING
        continue
      }
      if (remembered?.machine_id && machines.some(machine => machine.id === remembered.machine_id)) {
        nextMapping[source] = remembered.machine_id
        continue
      }

      const ranked = machines
        .map(machine => {
          const facility = facilityName(machine.locations)
          const candidates = [machine.machine_id, machine.locations?.agency || '', facility]
          return { machine, score: Math.max(...candidates.map(candidate => similarity(source, candidate))) }
        })
        .sort((a, b) => b.score - a.score)
      nextMapping[source] = ranked[0]?.score >= 0.72 ? ranked[0].machine.id : ''
    }
    setMapping(nextMapping)
  }

  const sourceMachines = useMemo(() => [...new Set(parsedRows.map(row => row.sourceMachine))].sort(), [parsedRows])
  const unmapped = sourceMachines.filter(name => !mapping[name])
  const ignored = sourceMachines.filter(name => mapping[name] === IGNORE_MAPPING)
  const mapped = sourceMachines.filter(name => mapping[name] && mapping[name] !== IGNORE_MAPPING)

  async function importLogs() {
    if (!supabase) return setMessage('Supabase is not configured.')
    if (!parsedRows.length) return setMessage('Choose a MachineLogs CSV first.')
    if (unmapped.length) return setMessage(`Map every source machine before importing: ${unmapped.join(', ')}`)
    setImporting(true)
    setMessage('Importing machine events…')

    const importableRows = parsedRows.filter(row => mapping[row.sourceMachine] !== IGNORE_MAPPING)
    if (!importableRows.length) return setMessage('Every source machine is ignored. There are no rows to import.')

    const machinesById = new Map(machines.map(machine => [machine.id, machine]))
    const payload = importableRows.map(row => {
      const machineUuid = mapping[row.sourceMachine]
      const machine = machinesById.get(machineUuid)
      if (!machine) throw new Error(`The mapped machine for ${row.sourceMachine} is no longer available.`)
      return ({
      machine_id: machineUuid,
      machine_uuid: machineUuid,
      machine_wtn_id: machine.machine_id,
      event_datetime: row.eventDatetime,
      source_location_name: row.sourceLocation,
      source_machine_name: row.sourceMachine,
      action: row.action,
      selection: row.selection || null,
      product: row.product || null,
      employee: row.employee || null,
      passcode: row.passcode || null,
      quantity: row.quantity,
      message: row.message || null,
      status: row.status || null,
      event_type: row.eventType || null,
      scale_serial: row.scaleSerial || null,
      scale_variance: Number.isFinite(row.scaleVariance) ? row.scaleVariance : null,
      employee_number: row.employeeNumber || null,
      error_type: row.errorType || null,
      question_name: row.questionName || null,
      question_number: row.questionNumber || null,
      question: row.question || null,
      dispense_type: row.dispenseType || null,
      answer: row.answer || null,
      source_file: filename,
      import_key: row.importKey,
    })})

    let imported = 0
    for (let start = 0; start < payload.length; start += 300) {
      const chunk = payload.slice(start, start + 300)
      const { error } = await supabase.from('machine_events').upsert(chunk, { onConflict: 'import_key', ignoreDuplicates: true })
      if (error) {
        setImporting(false)
        return setMessage(error.message)
      }
      imported += chunk.length
    }

    if (rememberMappings) {
      const aliasPayload = sourceMachines.map(source => ({
        source_machine_name: source,
        machine_id: mapping[source] === IGNORE_MAPPING ? null : mapping[source],
        machine_uuid: mapping[source] === IGNORE_MAPPING ? null : mapping[source],
        machine_wtn_id: mapping[source] === IGNORE_MAPPING ? null : machines.find((machine) => machine.id === mapping[source])?.machine_id || null,
        ignored: mapping[source] === IGNORE_MAPPING,
        updated_at: new Date().toISOString(),
      }))
      const { error: aliasError } = await supabase.from('machine_name_aliases').upsert(aliasPayload, { onConflict: 'source_machine_name' })
      if (aliasError) {
        setImporting(false)
        return setMessage(`Events imported, but mappings could not be remembered: ${aliasError.message}`)
      }
    }

    setImporting(false)
    setMessage(`Import complete. Processed ${imported.toLocaleString()} rows and ignored ${parsedRows.length - importableRows.length} row(s). Duplicate events were ignored.`)
    await loadData()
  }

  const stats = useMemo(() => ({
    total: dashboardTotals.total_events,
    successful: dashboardTotals.units_dispensed,
    unauthorized: dashboardTotals.unauthorized_attempts,
    stockouts: dashboardTotals.out_of_stock_attempts,
  }), [dashboardTotals])

  const machineStats = useMemo(() => {
    const byUuid = new Map(eventSummaries.map(row => [row.machine_uuid, row]))
    const byWtn = new Map(eventSummaries.map(row => [row.machine_wtn_id, row]))
    return machines.map(machine => {
      const summary = byUuid.get(machine.id) || byWtn.get(machine.machine_id)
      return {
        machine,
        records: summary?.event_count || 0,
        dispensed: summary?.units_dispensed || 0,
        failed: summary?.failed_count || 0,
        stockouts: summary?.stockout_count || 0,
        firstActivity: summary?.first_activity || null,
        lastActivity: summary?.last_activity || null,
      }
    })
  }, [machines, eventSummaries])

  const agencyGroups = useMemo(() => {
    const groups = new Map<string, typeof machineStats>()
    machineStats.forEach(row => {
      const agency = row.machine.locations?.agency?.trim() || 'Agency not assigned'
      const existing = groups.get(agency) || []
      existing.push(row)
      groups.set(agency, existing)
    })
    return [...groups.entries()]
      .map(([agency, rows]) => ({
        agency,
        rows: rows.sort((a, b) => (a.machine.locations?.location_name || '').localeCompare(b.machine.locations?.location_name || '')),
        events: rows.reduce((sum, row) => sum + row.records, 0),
        dispensed: rows.reduce((sum, row) => sum + row.dispensed, 0),
        failed: rows.reduce((sum, row) => sum + row.failed, 0),
        stockouts: rows.reduce((sum, row) => sum + row.stockouts, 0),
      }))
      .sort((a, b) => a.agency.localeCompare(b.agency))
  }, [machineStats])

  return <div className="space-y-6">
    <div><h1 className="text-2xl font-bold">Machine Logs</h1><p className="text-slate-500">Upload operational log CSV files, map each source machine, and retain the event history for analytics.</p></div>
    {message && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}

    <Card>
      <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-end">
        <Field label="Machine log CSV"><input className={inputClass} type="file" accept=".csv,text/csv" onChange={chooseFile} /></Field>
        <button onClick={importLogs} disabled={importing || !parsedRows.length || unmapped.length > 0} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">{importing ? 'Importing…' : 'Import Logs'}</button>
      </div>
      {Object.keys(metadata).length > 0 && <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">{Object.entries(metadata).map(([key, val]) => <span key={key} className="rounded-full bg-slate-100 px-3 py-1"><strong>{key}:</strong> {val}</span>)}</div>}
    </Card>

    {sourceMachines.length > 0 && <Card>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-bold">Match Source Machines</h2><p className="text-sm text-slate-500">Choose the WTN Machine ID and facility that belongs to each machine name found in the CSV.</p></div><button type="button" onClick={syncMachinesFromLocations} disabled={syncing} className="rounded-xl border border-blue-300 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50">{syncing ? 'Syncing…' : 'Sync Machines from Locations'}</button></div>
      {machines.length === 0 && <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">No Machine Data records are available. Select <strong>Sync Machines from Locations</strong> to create them from the WTN IDs already stored on the Locations page.</div>}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sourceMachines.map(source => {
        const selection = mapping[source] || ''
        const isIgnored = selection === IGNORE_MAPPING
        return <div key={source} className={`rounded-xl border p-3 ${isIgnored ? 'border-slate-300 bg-slate-50' : 'border-slate-200 bg-white'}`}>
          <Field label={source}>
            <select className={inputClass} value={selection} onChange={e => setMapping(current => ({ ...current, [source]: e.target.value }))}>
              <option value="">Select WTN Machine ID and Location</option>
              <option value={IGNORE_MAPPING}>Not applicable — Ignore this machine</option>
              {machines.map(machine => <option key={machine.id} value={machine.id}>{machineOptionLabel(machine)}</option>)}
            </select>
          </Field>
          <p className={`mt-2 text-xs font-semibold ${isIgnored ? 'text-slate-600' : selection ? 'text-emerald-700' : 'text-amber-700'}`}>{isIgnored ? 'Ignored during import' : selection ? 'Mapped and ready' : 'Action required'}</p>
        </div>
      })}</div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3 text-sm">
        <div className="flex flex-wrap gap-4">
          <span className="font-semibold text-emerald-700">{mapped.length} mapped</span>
          <span className="font-semibold text-slate-600">{ignored.length} ignored</span>
          <span className={unmapped.length ? 'font-semibold text-amber-700' : 'font-semibold text-emerald-700'}>{unmapped.length ? `${unmapped.length} require action` : 'Ready to import'}</span>
        </div>
        <label className="flex items-center gap-2 text-slate-700"><input type="checkbox" checked={rememberMappings} onChange={e => setRememberMappings(e.target.checked)} /> Remember these mappings</label>
      </div>
    </Card>}

    {parseErrors.length > 0 && <Card><h2 className="font-bold text-rose-700">Rows requiring review</h2><p className="mt-1 text-sm text-slate-500">{parseErrors.length} row(s) were skipped.</p><div className="mt-3 max-h-40 overflow-auto text-sm text-rose-700">{parseErrors.slice(0, 50).map(error => <div key={error}>{error}</div>)}</div></Card>}

    <div className="grid gap-4 md:grid-cols-4">
      <Card><p className="text-xs font-semibold uppercase text-slate-500">Imported Events</p><p className="mt-2 text-3xl font-bold">{stats.total.toLocaleString()}</p></Card>
      <Card><p className="text-xs font-semibold uppercase text-slate-500">Units Dispensed</p><p className="mt-2 text-3xl font-bold">{stats.successful.toLocaleString()}</p></Card>
      <Card><p className="text-xs font-semibold uppercase text-slate-500">Unauthorized Attempts</p><p className="mt-2 text-3xl font-bold">{stats.unauthorized.toLocaleString()}</p></Card>
      <Card><p className="text-xs font-semibold uppercase text-slate-500">Out-of-Stock Attempts</p><p className="mt-2 text-3xl font-bold">{stats.stockouts.toLocaleString()}</p></Card>
    </div>

    <div className="space-y-4">
      {agencyGroups.map(group => {
        const isCollapsed = !!collapsedAgencies[group.agency]
        return <Card key={group.agency} className="overflow-hidden p-0">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left hover:bg-slate-50"
            onClick={() => setCollapsedAgencies(current => ({ ...current, [group.agency]: !isCollapsed }))}
          >
            <div className="flex min-w-0 items-center gap-3">
              <ScrollText size={19} className="shrink-0 text-blue-600" />
              <div className="min-w-0">
                <h2 className="truncate font-bold text-slate-900">{group.agency}</h2>
                <p className="text-xs text-slate-500">{group.rows.length} machines • {group.events.toLocaleString()} events</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Badge tone="green">{group.dispensed.toLocaleString()} dispensed</Badge>
              <Badge tone="slate">{group.failed.toLocaleString()} failed</Badge>
              <Badge tone={group.stockouts > 0 ? 'yellow' : 'slate'}>{group.stockouts.toLocaleString()} stockouts</Badge>
              {isCollapsed ? <ChevronRight size={18} /> : <ChevronDown size={18} />}
            </div>
          </button>
          {!isCollapsed && <div className="overflow-x-auto border-t border-slate-200">
            <table className="w-full min-w-[1050px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Machine ID','Source Name','City / State','Events','Dispensed','Failed','Stockouts','First Activity','Last Activity'].map(label => <th key={label} className="px-5 py-3">{label}</th>)}</tr></thead>
              <tbody>{group.rows.map(row => <tr key={row.machine.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-5 py-4 font-semibold">{row.machine.machine_id}</td>
                <td className="px-5 py-4">{row.machine.locations?.location_name || '—'}</td>
                <td className="px-5 py-4">{[row.machine.locations?.city, row.machine.locations?.state].filter(Boolean).join(', ') || '—'}</td>
                <td className="px-5 py-4">{row.records.toLocaleString()}</td>
                <td className="px-5 py-4"><Badge tone="green">{row.dispensed.toLocaleString()}</Badge></td>
                <td className="px-5 py-4">{row.failed.toLocaleString()}</td>
                <td className="px-5 py-4">{row.stockouts.toLocaleString()}</td>
                <td className="px-5 py-4">{row.firstActivity ? new Date(row.firstActivity).toLocaleString() : '—'}</td>
                <td className="px-5 py-4">{row.lastActivity ? new Date(row.lastActivity).toLocaleString() : '—'}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        </Card>
      })}
    </div>
  </div>
}
