import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { Building2, ChevronDown, ChevronRight, ChevronUp, Download, FileDown, List, Map as MapIcon, Plus, Upload } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Badge, Card, inputClass } from '../components/ui'
import { downloadTextFile, parseCsv, toCsv, type CsvRow } from '../lib/csv'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import LocationMap from '../components/LocationMap'

type MachineStatus = 'Planned' | 'Active' | 'Inactive' | 'Removed'

type LocationDemographicRecord = {
  risk_score: number | null
  maximum_location_score?: number | null
  urban_rural_flag?: string | null
}

type LocationAccessRecord = {
  machine_accessibility_score: number | null
}

type LocationRecord = {
  id?: string
  machine_id: string
  agency: string
  location_name: string
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  latitude: number | null
  longitude: number | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  machine_status: MachineStatus
  cluster_id: string | null
  population_served: number
  location_demographics?: LocationDemographicRecord[] | LocationDemographicRecord | null
  location_access_scores?: LocationAccessRecord[] | LocationAccessRecord | null
  created_at?: string
  updated_at?: string
}

type ImportIssue = { row: number; machineId: string; message: string }
type ImportSummary = { total: number; accepted: number; rejected: number; issues: ImportIssue[] }
type AgencyGroup = { agency: string; rows: LocationRecord[] }

const headers = [
  'machine_id', 'agency', 'location_name', 'address', 'city', 'state', 'zip', 'latitude', 'longitude',
  'contact_name', 'contact_phone', 'contact_email', 'machine_status', 'cluster_id', 'population_served',
]

const statuses: MachineStatus[] = ['Planned', 'Active', 'Inactive', 'Removed']

const demoRows: LocationRecord[] = [
  { id: 'demo-1', machine_id: 'IVM-001', agency: 'County Health Department', location_name: 'Possibility Shop', address: '100 Main St', city: 'Des Moines', state: 'IA', zip: '50309', latitude: 41.5868, longitude: -93.625, contact_name: null, contact_phone: null, contact_email: null, machine_status: 'Active', cluster_id: null, population_served: 214133, location_demographics: [{ risk_score: 0.18, maximum_location_score: 0.72 }], location_access_scores: [{ machine_accessibility_score: 0.90 }] },
  { id: 'demo-2', machine_id: 'IVM-002', agency: 'County Health Department', location_name: 'Community Center', address: '210 Nile Kinnick Dr', city: 'Adel', state: 'IA', zip: '50003', latitude: 41.6144, longitude: -94.0174, contact_name: null, contact_phone: null, contact_email: null, machine_status: 'Active', cluster_id: null, population_served: 6153, location_demographics: [{ risk_score: 0.42, maximum_location_score: 0.40 }], location_access_scores: [{ machine_accessibility_score: 0.82 }] },
]

function nullable(value: string): string | null { return value === '' ? null : value }
function parseOptionalNumber(value: string): number | null {
  if (value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function splitAgency(value: string): { agency: string; facility: string } {
  const trimmed = value.trim()
  const match = trimmed.match(/^(.*?)\s*\((.+)\)\s*$/)
  if (!match) return { agency: trimmed || 'Unassigned Agency', facility: trimmed || 'Unspecified Location' }
  return { agency: match[1].trim() || 'Unassigned Agency', facility: match[2].trim() || 'Unspecified Location' }
}

function relatedRecord<T>(value: T[] | T | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null)
}

function clampScore(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null
}

function riskValue(row: LocationRecord): number | null {
  return clampScore(relatedRecord(row.location_demographics)?.risk_score)
}

function accessibilityValue(row: LocationRecord): number | null {
  return clampScore(relatedRecord(row.location_access_scores)?.machine_accessibility_score)
}

function maximumLocationValue(row: LocationRecord): number | null {
  return clampScore(relatedRecord(row.location_demographics)?.maximum_location_score)
}

type DialKind = 'positive' | 'risk'

function ScoreDial({ value, kind = 'positive' }: { value: number | null; kind?: DialKind }) {
  const percent = value == null ? null : Math.round(value * 100)
  const isRisk = kind === 'risk'
  const good = percent != null && (isRisk ? percent <= 30 : percent >= 67)
  const moderate = percent != null && (isRisk ? percent <= 60 : percent >= 34) && !good
  const label = percent == null
    ? 'Not scored'
    : isRisk
      ? good ? 'Low Risk' : moderate ? 'Moderate Risk' : 'High Risk'
      : good ? 'High' : moderate ? 'Moderate' : 'Low'
  const stroke = percent == null ? '#94a3b8' : good ? '#10b981' : moderate ? '#f59e0b' : '#ef4444'
  const labelClass = percent == null ? 'text-slate-400' : good ? 'text-emerald-600' : moderate ? 'text-amber-500' : 'text-rose-500'
  const circumference = Math.PI * 42
  const filled = percent == null ? 0 : (circumference * percent) / 100

  return <div className="flex min-w-[112px] flex-col items-center">
    <div className="relative h-[58px] w-[100px] overflow-hidden">
      <svg viewBox="0 0 100 56" className="h-full w-full" aria-label={`${percent ?? 0}% ${label}`}>
        <path d="M 8 50 A 42 42 0 0 1 92 50" fill="none" stroke="#e2e8f0" strokeWidth="8" strokeLinecap="round"/>
        <path d="M 8 50 A 42 42 0 0 1 92 50" fill="none" stroke={stroke} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${filled} ${circumference}`}/>
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center text-lg font-bold text-slate-900">{percent == null ? '—' : `${percent}%`}</div>
    </div>
    <span className={`mt-1 text-xs font-semibold ${labelClass}`}>{label}</span>
  </div>
}

function validateAndMap(row: CsvRow, rowNumber: number): { record?: LocationRecord; issue?: ImportIssue } {
  const machineId = row.machine_id?.trim() ?? ''
  let agency = row.agency?.trim() ?? ''
  let locationName = row.location_name?.trim() ?? ''
  if (!locationName) {
    const legacy = splitAgency(agency)
    agency = legacy.agency
    locationName = legacy.facility
  }
  const status = (row.machine_status?.trim() || 'Planned') as MachineStatus
  const latitude = parseOptionalNumber(row.latitude ?? '')
  const longitude = parseOptionalNumber(row.longitude ?? '')
  const population = row.population_served === '' || row.population_served == null ? 0 : Number(row.population_served)

  if (!machineId) return { issue: { row: rowNumber, machineId: '', message: 'machine_id is required.' } }
  if (!agency) return { issue: { row: rowNumber, machineId, message: 'agency is required.' } }
  if (!locationName) return { issue: { row: rowNumber, machineId, message: 'location_name is required.' } }
  if (!statuses.includes(status)) return { issue: { row: rowNumber, machineId, message: `machine_status must be one of: ${statuses.join(', ')}.` } }
  if (row.latitude && latitude == null) return { issue: { row: rowNumber, machineId, message: 'latitude must be numeric.' } }
  if (row.longitude && longitude == null) return { issue: { row: rowNumber, machineId, message: 'longitude must be numeric.' } }
  if (!Number.isInteger(population) || population < 0) return { issue: { row: rowNumber, machineId, message: 'population_served must be a whole number at or above 0.' } }

  return { record: {
    machine_id: machineId, agency, location_name: locationName, address: nullable(row.address ?? ''), city: nullable(row.city ?? ''), state: nullable(row.state ?? ''), zip: nullable(row.zip ?? ''),
    latitude, longitude, contact_name: nullable(row.contact_name ?? ''), contact_phone: nullable(row.contact_phone ?? ''), contact_email: nullable(row.contact_email ?? ''),
    machine_status: status, cluster_id: nullable(row.cluster_id ?? ''), population_served: population,
  } }
}

export default function Locations() {
  const [rows, setRows] = useState<LocationRecord[]>([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [summary, setSummary] = useState<ImportSummary | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [view, setView] = useState<'table' | 'map'>('table')
  const [mapMetric, setMapMetric] = useState<'accessibility' | 'risk' | 'maximum'>('maximum')
  const fileRef = useRef<HTMLInputElement>(null)

  const loadLocations = async () => {
    setLoading(true)
    setMessage('')
    if (!supabase) {
      setRows(demoRows)
      setMessage('Supabase is not configured, so demonstration locations are displayed.')
      setLoading(false)
      return
    }

    const { data, error } = await supabase
      .from('locations')
      .select('*, location_access_scores(machine_accessibility_score), location_demographics(risk_score, maximum_location_score, urban_rural_flag)')
      .order('agency', { ascending: true })
      .order('machine_id', { ascending: true })

    if (error) setMessage(error.message)
    else setRows((data ?? []) as LocationRecord[])
    setLoading(false)
  }

  useEffect(() => { void loadLocations() }, [])

  const filtered = useMemo(() => {
    const term = query.toLowerCase().trim()
    if (!term) return rows
    return rows.filter((row) => Object.values(row).join(' ').toLowerCase().includes(term))
  }, [query, rows])

  const agencyGroups = useMemo<AgencyGroup[]>(() => {
    const groups = new Map<string, LocationRecord[]>()
    filtered.forEach((row) => {
      const agency = row.agency?.trim() || 'Unassigned Agency'
      const current = groups.get(agency) ?? []
      current.push(row)
      groups.set(agency, current)
    })
    return [...groups.entries()]
      .map(([agency, groupRows]) => ({ agency, rows: groupRows.sort((a, b) => a.machine_id.localeCompare(b.machine_id)) }))
      .sort((a, b) => a.agency.localeCompare(b.agency))
  }, [filtered])

  const exportLocations = () => downloadTextFile(`ivm-locations-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(filtered as unknown as Record<string, unknown>[], headers))
  const downloadTemplate = () => downloadTextFile('ivm-location-import-template.csv', toCsv([{
    machine_id: 'IVM-100', agency: 'Example Agency', location_name: 'Example Facility', address: '123 Main St', city: 'Des Moines', state: 'IA', zip: '50309', latitude: '41.5868', longitude: '-93.6250', contact_name: '', contact_phone: '', contact_email: '', machine_status: 'Planned', cluster_id: '', population_served: '10000',
  }], headers))

  const importLocations = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setLoading(true); setMessage(''); setSummary(null)
    try {
      const parsed = parseCsv(await file.text())
      const missingHeaders = ['machine_id', 'agency', 'location_name'].filter((header) => !Object.prototype.hasOwnProperty.call(parsed[0] ?? {}, header))
      if (missingHeaders.length) throw new Error(`Missing required CSV column(s): ${missingHeaders.join(', ')}`)
      const records: LocationRecord[] = []; const issues: ImportIssue[] = []
      parsed.forEach((row, index) => { const result = validateAndMap(row, index + 2); if (result.record) records.push(result.record); if (result.issue) issues.push(result.issue) })
      if (!supabase) {
        setRows((current) => { const byMachine = new Map(current.map((row) => [row.machine_id, row])); records.forEach((record) => byMachine.set(record.machine_id, record)); return [...byMachine.values()].sort((a, b) => a.machine_id.localeCompare(b.machine_id)) })
        setMessage('Preview completed locally. Configure Supabase and sign in as an Admin or Program Manager to save imported records.')
      } else if (records.length) {
        const { error } = await supabase.from('locations').upsert(records, { onConflict: 'machine_id' })
        if (error) throw error
        setMessage(`${records.length} location record${records.length === 1 ? '' : 's'} inserted or updated.`)
        await loadLocations()
      }
      setSummary({ total: parsed.length, accepted: records.length, rejected: issues.length, issues })
    } catch (error) { setMessage(error instanceof Error ? error.message : 'The CSV could not be imported.') }
    finally { setLoading(false) }
  }

  return <div className="space-y-4">
    <div>
      <h1 className="text-2xl font-bold text-slate-900">Locations</h1>
      <p className="text-slate-500">Agencies and deployed machines with location risk assessment.</p>
    </div>

    <Card className="p-3">
      <div className="flex flex-wrap items-center gap-2 xl:flex-nowrap">
        <input
          className={`${inputClass} min-w-[280px] flex-1 py-2`}
          placeholder="Search agencies, facilities, machine IDs, cities, or ZIP..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="flex shrink-0 rounded-lg bg-slate-100 p-1">
          <button onClick={() => setView('table')} className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold ${view === 'table' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><List size={15}/>Table</button>
          <button onClick={() => setView('map')} className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold ${view === 'map' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}><MapIcon size={15}/>Map</button>
        </div>
        <Link to="/locations/new" className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"><Plus size={17}/>Add Location</Link>
        <button onClick={() => fileRef.current?.click()} disabled={loading} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-blue-200 bg-white px-4 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-50 disabled:opacity-50"><Upload size={17}/>Import / Update CSV</button>
        <button onClick={exportLocations} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={17}/>Export CSV</button>
        <button onClick={downloadTemplate} className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><FileDown size={17}/>CSV Template</button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={importLocations}/>
      </div>
      {view === 'map' && <div className="mt-2 flex justify-end"><select className={`${inputClass} max-w-xs py-2`} value={mapMetric} onChange={(event) => setMapMetric(event.target.value as 'accessibility' | 'risk' | 'maximum')}><option value="maximum">Maximum Location Score</option><option value="accessibility">Accessibility Score</option><option value="risk">Risk Score</option></select></div>}
      {!isSupabaseConfigured && <p className="mt-2 text-xs font-medium text-amber-700">Supabase connection is not configured in this browser session.</p>}
    </Card>

    {message && <div className={`rounded-xl border px-4 py-3 text-sm ${message.toLowerCase().includes('error') || message.toLowerCase().includes('missing') ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-blue-200 bg-blue-50 text-blue-700'}`}>{message}</div>}

    {summary && <Card><h2 className="font-semibold text-slate-900">Import Summary</h2><div className="mt-3 flex gap-3 text-sm"><Badge tone="blue">{summary.total} rows</Badge><Badge tone="green">{summary.accepted} accepted</Badge><Badge tone={summary.rejected ? 'red' : 'slate'}>{summary.rejected} rejected</Badge></div>{summary.issues.length > 0 && <div className="mt-4 max-h-48 overflow-auto rounded-xl border border-rose-200"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-rose-50 text-rose-700"><tr><th className="px-3 py-2">CSV Row</th><th className="px-3 py-2">Machine ID</th><th className="px-3 py-2">Issue</th></tr></thead><tbody>{summary.issues.map((issue) => <tr key={`${issue.row}-${issue.machineId}`} className="border-t border-rose-100"><td className="px-3 py-2">{issue.row}</td><td className="px-3 py-2">{issue.machineId || '—'}</td><td className="px-3 py-2">{issue.message}</td></tr>)}</tbody></table></div>}</Card>}

    {view === 'map' ? <LocationMap rows={filtered} metric={mapMetric}/> : <div className="space-y-3">
      {agencyGroups.map((group) => {
        const isCollapsed = collapsed[group.agency] ?? true
        const activeCount = group.rows.filter((row) => row.machine_status === 'Active').length
        const average = (values: Array<number | null>) => {
          const present = values.filter((value): value is number => value != null)
          return present.length ? present.reduce((sum, value) => sum + value, 0) / present.length : null
        }
        const avgAccessibility = average(group.rows.map(accessibilityValue))
        const avgRisk = average(group.rows.map(riskValue))
        const avgMaximum = average(group.rows.map(maximumLocationValue))
        const CompactScore = ({ label, value, kind = 'positive' }: { label: string; value: number | null; kind?: DialKind }) => {
          const percent = value == null ? null : Math.round(value * 100)
          const good = percent != null && (kind === 'risk' ? percent <= 30 : percent >= 67)
          const moderate = percent != null && !good && (kind === 'risk' ? percent <= 60 : percent >= 34)
          const tone = percent == null ? 'border-slate-200 bg-slate-50 text-slate-500' : good ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : moderate ? 'border-amber-200 bg-amber-50 text-amber-700' : 'border-rose-200 bg-rose-50 text-rose-700'
          return <div className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 ${tone}`}><span className="text-[9px] font-bold uppercase tracking-wide opacity-80">{label}</span><span className="text-sm font-extrabold leading-none">{percent == null ? '—' : `${percent}%`}</span></div>
        }
        return <Card key={group.agency} className="overflow-hidden p-0">
          <button type="button" onClick={() => setCollapsed((current) => ({ ...current, [group.agency]: !isCollapsed }))} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-slate-50">
            <div className="rounded-md bg-blue-50 p-1.5 text-blue-600"><Building2 size={16}/></div>
            <div className="min-w-0 flex-1"><div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"><h2 className="truncate text-sm font-bold text-slate-900">{group.agency}</h2><span className="text-[11px] text-slate-500">{group.rows.length} machine{group.rows.length === 1 ? '' : 's'} · {activeCount} active</span></div></div>
            <div className="ml-auto hidden items-center gap-1.5 md:flex"><CompactScore label="Access" value={avgAccessibility}/><CompactScore label="Risk" value={avgRisk} kind="risk"/><CompactScore label="Maximum" value={avgMaximum}/></div>
            <span className="rounded-full border border-slate-200 p-1 text-slate-500">{isCollapsed ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}</span>
          </button>

          {!isCollapsed && <><div className="flex flex-wrap gap-1.5 border-t border-slate-100 bg-slate-50 px-3 py-1.5 md:hidden"><CompactScore label="Access" value={avgAccessibility}/><CompactScore label="Risk" value={avgRisk} kind="risk"/><CompactScore label="Maximum" value={avgMaximum}/></div><div className="overflow-x-auto border-t border-slate-100"><table className="w-full min-w-[1240px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500"><tr>{['Machine ID','Location / Facility','Address','City','State','ZIP','Accessibility','Risk Score','Maximum Location Score',''].map((heading) => <th key={heading} className="px-4 py-3">{heading}</th>)}</tr></thead><tbody>{group.rows.map((row) => { const facility = row.location_name || 'Unspecified Location'; return <tr key={row.machine_id} className="border-t border-slate-100 hover:bg-slate-50/70">
              <td colSpan={10} className="p-0">
                {row.id ? <Link to={`/locations/${row.id}`} className="grid min-w-[1240px] grid-cols-[220px_165px_280px_110px_95px_75px_145px_145px_175px_42px] items-center text-slate-700 transition hover:text-slate-900">
                  <div className="px-4 py-3"><div className="font-bold text-slate-900">{row.machine_id}</div><div className="mt-0.5 text-xs text-slate-500">{facility}</div></div>
                  <div className="px-4 py-3 font-medium">{facility}</div>
                  <div className="px-4 py-3 whitespace-pre-line">{row.address || '—'}</div>
                  <div className="px-4 py-3">{row.city || '—'}</div>
                  <div className="px-4 py-3">{row.state || '—'}</div>
                  <div className="px-4 py-3">{row.zip || '—'}</div>
                  <div className="px-4 py-2"><ScoreDial value={accessibilityValue(row)}/></div>
                  <div className="px-4 py-2"><ScoreDial value={riskValue(row)} kind="risk"/></div>
                  <div className="px-4 py-2"><ScoreDial value={maximumLocationValue(row)}/></div>
                  <div className="flex justify-center px-2 py-3 text-slate-500"><ChevronRight size={20}/></div>
                </Link> : <div className="grid min-w-[1240px] grid-cols-[220px_165px_280px_110px_95px_75px_145px_145px_175px_42px] items-center opacity-70">
                  <div className="px-4 py-3"><div className="font-bold text-slate-900">{row.machine_id}</div><div className="mt-0.5 text-xs text-slate-500">{facility}</div></div>
                  <div className="px-4 py-3">{facility}</div><div className="px-4 py-3">{row.address || '—'}</div><div className="px-4 py-3">{row.city || '—'}</div><div className="px-4 py-3">{row.state || '—'}</div><div className="px-4 py-3">{row.zip || '—'}</div><div className="px-4 py-2"><ScoreDial value={accessibilityValue(row)}/></div><div className="px-4 py-2"><ScoreDial value={riskValue(row)} kind="risk"/></div><div className="px-4 py-2"><ScoreDial value={maximumLocationValue(row)}/></div><div/>
                </div>}
              </td>
            </tr> })}</tbody></table></div></>}
        </Card>
      })}
      {!loading && agencyGroups.length === 0 && <Card><p className="p-4 text-center text-sm text-slate-500">No locations found.</p></Card>}
    </div>}

    <Card><div className="grid gap-4 md:grid-cols-3"><div><p className="text-xs font-bold uppercase tracking-wide text-emerald-600">High Score · 67–100%</p><p className="mt-1 text-sm text-slate-600">Strong accessibility or maximum location potential. For risk, lower is better.</p></div><div><p className="text-xs font-bold uppercase tracking-wide text-amber-600">Moderate · 34–66%</p><p className="mt-1 text-sm text-slate-600">Review the underlying access and risk inputs.</p></div><div><p className="text-xs font-bold uppercase tracking-wide text-rose-600">Low Score · 0–33%</p><p className="mt-1 text-sm text-slate-600">Weak accessibility or location potential. A high risk percentage is also shown in red.</p></div></div></Card>
  </div>
}
