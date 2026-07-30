import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Database, Download, FileUp, Gauge, Loader2, RotateCcw, Save, Settings2, SlidersHorizontal, Users } from 'lucide-react'
import { Badge, Card, Field, inputClass } from '../components/ui'
import UserManagement from '../components/UserManagement'
import { supabase } from '../lib/supabase'
import {
  DEFAULT_LOCAL_PREFERENCES,
  LOCAL_PREFERENCES_KEY,
  PARAMETER_DEFINITIONS,
  SCORE_MAPPING_DEFAULTS,
  defaultParameterValues,
  loadLocalPreferences,
  saveLocalPreferences,
  type LocalPreferences,
} from '../lib/appSettings'

type MappingRow = {
  id?: string
  mapping_group: string
  category_key: string
  category_label: string
  score: number
  sort_order: number
}

type Tab = 'model' | 'mappings' | 'operations' | 'display' | 'users' | 'data'

const groupOrder = ['Accessibility', 'Risk', 'Risk Normalization', 'Score Thresholds', 'Inventory', 'Safety Stock', 'Staffing', 'Demand & Cost']

function percent(value: number) { return `${Math.round(value * 100)}%` }
function mappingLabel(group: string) {
  return ({ availability: 'Availability Tier', public_access: 'Public Access', physical_access: 'Physical Access', visibility: 'Visibility' } as Record<string, string>)[group] || group
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>('model')
  const [parameters, setParameters] = useState<Record<string, number>>(defaultParameterValues)
  const [mappings, setMappings] = useState<MappingRow[]>(SCORE_MAPPING_DEFAULTS.map((row) => ({ mapping_group: row.mappingGroup, category_key: row.categoryKey, category_label: row.categoryLabel, score: row.defaultScore, sort_order: row.sortOrder })))
  const [preferences, setPreferences] = useState<LocalPreferences>(loadLocalPreferences)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [connection, setConnection] = useState<'checking' | 'connected' | 'local' | 'error'>('checking')
  const importRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      if (!supabase) {
        setConnection('local')
        setLoading(false)
        return
      }
      const [parameterResult, mappingResult] = await Promise.all([
        supabase.from('program_parameters').select('parameter_name,parameter_value'),
        supabase.from('score_mappings').select('id,mapping_group,category_key,category_label,score,sort_order').order('mapping_group').order('sort_order'),
      ])
      if (parameterResult.error || mappingResult.error) {
        setConnection('error')
        setMessage(parameterResult.error?.message || mappingResult.error?.message || 'Settings could not be loaded.')
      } else {
        const loaded = { ...defaultParameterValues() }
        for (const row of parameterResult.data || []) loaded[row.parameter_name] = Number(row.parameter_value)
        setParameters(loaded)
        if (mappingResult.data?.length) setMappings(mappingResult.data.map((row) => ({ ...row, score: Number(row.score), sort_order: Number(row.sort_order) })))
        setConnection('connected')
      }
      setLoading(false)
    }
    void load()
  }, [])

  const accessTotal = ['accessibility_public_weight','accessibility_physical_weight','accessibility_temporal_weight','accessibility_visibility_weight'].reduce((sum, key) => sum + Number(parameters[key] || 0), 0)
  const riskTotal = ['risk_population_weight','risk_crime_weight','risk_climate_weight'].reduce((sum, key) => sum + Number(parameters[key] || 0), 0)

  const groupedDefinitions = useMemo(() => groupOrder.map((group) => ({ group, items: PARAMETER_DEFINITIONS.filter((item) => item.group === group) })), [])
  const groupedMappings = useMemo(() => Array.from(new Set(mappings.map((row) => row.mapping_group))).map((group) => ({ group, rows: mappings.filter((row) => row.mapping_group === group).sort((a,b) => a.sort_order - b.sort_order) })), [mappings])

  const saveAll = async () => {
    setSaving(true)
    setMessage('')
    saveLocalPreferences(preferences)
    localStorage.setItem('ivm-calculation-settings', JSON.stringify({
      accessWeights: { publicAccess: parameters.accessibility_public_weight, physicalAccess: parameters.accessibility_physical_weight, temporalAccess: parameters.accessibility_temporal_weight, visibility: parameters.accessibility_visibility_weight },
      riskWeights: { population: parameters.risk_population_weight, crime: parameters.risk_crime_weight, climate: parameters.risk_climate_weight },
      riskRanges: { populationMin: parameters.risk_population_min, populationMax: parameters.risk_population_max, crimeMin: parameters.risk_crime_min, crimeMax: parameters.risk_crime_max, zoneMin: parameters.risk_zone_min, zoneMax: parameters.risk_zone_max, zoneMid: parameters.risk_zone_mid },
      riskCoefficient: parameters.maximum_location_risk_coefficient,
    }))

    if (!supabase) {
      setMessage('Settings saved in this browser. Supabase is not configured, so shared settings were not updated.')
      setSaving(false)
      return
    }

    const parameterRows = PARAMETER_DEFINITIONS.map((definition) => ({
      parameter_name: definition.name,
      parameter_value: Number(parameters[definition.name]),
      parameter_group: definition.group.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      description: definition.description,
    }))
    const mappingRows = mappings.map((row) => ({ mapping_group: row.mapping_group, category_key: row.category_key, category_label: row.category_label, score: Number(row.score), sort_order: Number(row.sort_order) }))

    const [parameterResult, mappingResult] = await Promise.all([
      supabase.from('program_parameters').upsert(parameterRows, { onConflict: 'parameter_name' }),
      supabase.from('score_mappings').upsert(mappingRows, { onConflict: 'mapping_group,category_key' }),
    ])
    if (parameterResult.error || mappingResult.error) setMessage(parameterResult.error?.message || mappingResult.error?.message || 'Settings were not saved.')
    else setMessage('Settings saved. New calculations and forms will use the updated shared defaults.')
    setSaving(false)
  }

  const resetAll = () => {
    setParameters(defaultParameterValues())
    setMappings(SCORE_MAPPING_DEFAULTS.map((row) => ({ mapping_group: row.mappingGroup, category_key: row.categoryKey, category_label: row.categoryLabel, score: row.defaultScore, sort_order: row.sortOrder })))
    setPreferences({ ...DEFAULT_LOCAL_PREFERENCES })
    setMessage('Defaults restored in the editor. Select Save Settings to apply them.')
  }

  const exportSettings = () => {
    const payload = { version: 1, exportedAt: new Date().toISOString(), parameters, mappings, preferences }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `ivm-settings-${new Date().toISOString().slice(0,10)}.json`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const importSettings = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text())
      if (parsed.parameters) setParameters({ ...defaultParameterValues(), ...parsed.parameters })
      if (Array.isArray(parsed.mappings)) setMappings(parsed.mappings)
      if (parsed.preferences) setPreferences({ ...DEFAULT_LOCAL_PREFERENCES, ...parsed.preferences })
      setMessage('Settings file loaded. Review the values and select Save Settings.')
    } catch {
      setMessage('The selected file is not a valid IVM settings export.')
    } finally {
      event.target.value = ''
    }
  }

  const tabs: Array<{ key: Tab; label: string; icon: typeof Gauge }> = [
    { key: 'model', label: 'Model Weights', icon: Gauge },
    { key: 'mappings', label: 'Score Mappings', icon: SlidersHorizontal },
    { key: 'operations', label: 'Operational Defaults', icon: Settings2 },
    { key: 'display', label: 'Display & Workflow', icon: Settings2 },
    { key: 'users', label: 'Users & Access', icon: Users },
    { key: 'data', label: 'Data & Backup', icon: Database },
  ]

  const modelGroups = ['Accessibility','Risk','Risk Normalization','Score Thresholds']
  const operationGroups = ['Inventory','Safety Stock','Staffing','Demand & Cost']

  if (loading) return <div className="flex min-h-[320px] items-center justify-center text-slate-500"><Loader2 className="mr-2 animate-spin" /> Loading settings…</div>

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><div className="flex items-center gap-2"><Settings2 className="text-blue-600"/><h1 className="text-2xl font-bold text-slate-900">Settings</h1></div><p className="mt-1 text-sm text-slate-500">Manage shared model parameters, scoring lookups, operational assumptions, user access, and local workflow preferences.</p></div>
      <div className="flex flex-wrap gap-2">
        <button onClick={resetAll} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><RotateCcw size={16}/>Reset Defaults</button>
        <button onClick={exportSettings} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><Download size={16}/>Export</button>
        <button onClick={() => importRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"><FileUp size={16}/>Import</button>
        <input ref={importRef} className="hidden" type="file" accept="application/json,.json" onChange={importSettings}/>
        <button onClick={saveAll} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>}Save Settings</button>
      </div>
    </div>

    <Card className="p-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Badge tone={connection === 'connected' ? 'green' : connection === 'error' ? 'red' : 'yellow'}>{connection === 'connected' ? 'Supabase Connected' : connection === 'local' ? 'Local Only' : connection === 'error' ? 'Connection Error' : 'Checking'}</Badge><span className="text-xs text-slate-500">Shared parameters are stored in <code>program_parameters</code> and <code>score_mappings</code>.</span></div><div className="flex gap-2 text-xs"><Badge tone={Math.abs(accessTotal - 1) < .0001 ? 'green' : 'red'}>Access weights {percent(accessTotal)}</Badge><Badge tone={Math.abs(riskTotal - 1) < .0001 ? 'green' : 'red'}>Risk weights {percent(riskTotal)}</Badge></div></div></Card>

    {message && <div className={`rounded-xl border px-4 py-3 text-sm ${message.toLowerCase().includes('not') || message.toLowerCase().includes('error') ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>{message}</div>}

    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white p-1"><div className="flex min-w-max gap-1">{tabs.map(({key,label,icon:Icon}) => <button key={key} onClick={() => setTab(key)} className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold ${tab === key ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon size={16}/>{label}</button>)}</div></div>

    {(tab === 'model' || tab === 'operations') && <div className="grid gap-4 xl:grid-cols-2">{groupedDefinitions.filter(({group}) => (tab === 'model' ? modelGroups : operationGroups).includes(group)).map(({group,items}) => <Card key={group} className="p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-bold text-slate-900">{group}</h2>{group === 'Accessibility' && <Badge tone={Math.abs(accessTotal - 1) < .0001 ? 'green' : 'red'}>{percent(accessTotal)} total</Badge>}{group === 'Risk' && <Badge tone={Math.abs(riskTotal - 1) < .0001 ? 'green' : 'red'}>{percent(riskTotal)} total</Badge>}</div><div className="space-y-3">{items.map((definition) => <div key={definition.name} className="grid gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-[1fr_130px]"><div><p className="text-sm font-semibold text-slate-800">{definition.label}</p><p className="mt-0.5 text-xs text-slate-500">{definition.description}</p></div><input className={`${inputClass} h-10`} type="number" min={definition.min} max={definition.max} step={definition.step ?? .01} value={parameters[definition.name] ?? definition.defaultValue} onChange={(e) => setParameters((current) => ({ ...current, [definition.name]: Number(e.target.value) }))}/></div>)}</div></Card>)}</div>}

    {tab === 'mappings' && <div className="grid gap-4 xl:grid-cols-2">{groupedMappings.map(({group,rows}) => <Card key={group} className="p-4"><h2 className="font-bold text-slate-900">{mappingLabel(group)}</h2><p className="mt-1 text-xs text-slate-500">Edit labels and normalized scores used by location intake.</p><div className="mt-3 space-y-2">{rows.map((row) => { const index = mappings.findIndex((item) => item.mapping_group === row.mapping_group && item.category_key === row.category_key); return <div key={row.category_key} className="grid gap-2 rounded-xl border border-slate-100 p-3 sm:grid-cols-[1fr_100px]"><input className={inputClass} value={row.category_label} onChange={(e) => setMappings((current) => current.map((item,i) => i === index ? {...item,category_label:e.target.value} : item))}/><input className={inputClass} type="number" min="0" max="1" step="0.05" value={row.score} onChange={(e) => setMappings((current) => current.map((item,i) => i === index ? {...item,score:Number(e.target.value)} : item))}/></div>})}</div></Card>)}</div>}

    {tab === 'display' && <div className="grid gap-4 xl:grid-cols-2"><Card className="p-4"><h2 className="font-bold text-slate-900">Navigation & Display</h2><div className="mt-4 space-y-4"><Toggle label="Collapse agency groups by default" checked={preferences.agenciesCollapsedByDefault} onChange={(v) => setPreferences({...preferences,agenciesCollapsedByDefault:v})}/><Toggle label="Show demo rows when a table is empty" checked={preferences.showDemoDataWhenEmpty} onChange={(v) => setPreferences({...preferences,showDemoDataWhenEmpty:v})}/><Field label="Default Locations View"><select className={inputClass} value={preferences.defaultLocationView} onChange={(e) => setPreferences({...preferences,defaultLocationView:e.target.value as LocalPreferences['defaultLocationView']})}><option value="table">Table</option><option value="map">Map</option></select></Field><Field label="Default Map Metric"><select className={inputClass} value={preferences.defaultMapMetric} onChange={(e) => setPreferences({...preferences,defaultMapMetric:e.target.value as LocalPreferences['defaultMapMetric']})}><option value="maximum">Maximum Location Score</option><option value="accessibility">Accessibility</option><option value="risk">Risk</option></select></Field><Field label="Table Density"><select className={inputClass} value={preferences.tableDensity} onChange={(e) => setPreferences({...preferences,tableDensity:e.target.value as LocalPreferences['tableDensity']})}><option value="compact">Compact</option><option value="comfortable">Comfortable</option></select></Field></div></Card><Card className="p-4"><h2 className="font-bold text-slate-900">Workflow Defaults</h2><div className="mt-4 space-y-4"><Toggle label="Remember machine and technician import mappings" checked={preferences.rememberImportMappings} onChange={(v) => setPreferences({...preferences,rememberImportMappings:v})}/><Field label="Default Product Filter"><select className={inputClass} value={preferences.defaultProductFilter} onChange={(e) => setPreferences({...preferences,defaultProductFilter:e.target.value as LocalPreferences['defaultProductFilter']})}><option value="all">All Products</option><option value="narcan">Narcan</option></select></Field><Field label="Date Format"><select className={inputClass} value={preferences.dateFormat} onChange={(e) => setPreferences({...preferences,dateFormat:e.target.value as LocalPreferences['dateFormat']})}><option value="MM/DD/YYYY">MM/DD/YYYY</option><option value="YYYY-MM-DD">YYYY-MM-DD</option></select></Field><Field label="Default Table Page Size"><input className={inputClass} type="number" min="10" max="500" step="10" value={preferences.pageSize} onChange={(e) => setPreferences({...preferences,pageSize:Number(e.target.value)})}/></Field></div></Card></div>}

    {tab === 'users' && <UserManagement/>}

    {tab === 'data' && <div className="grid gap-4 xl:grid-cols-2"><Card className="p-4"><div className="flex items-start gap-3"><Database className="mt-0.5 text-blue-600"/><div><h2 className="font-bold text-slate-900">Settings Storage</h2><p className="mt-1 text-sm text-slate-500">Model parameters and score mappings are shared through Supabase. Display and workflow preferences are saved on this browser.</p></div></div><div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm text-slate-600"><p><strong>Shared:</strong> {PARAMETER_DEFINITIONS.length} program parameters and {mappings.length} score mappings.</p><p className="mt-2"><strong>Local key:</strong> <code>{LOCAL_PREFERENCES_KEY}</code></p></div></Card><Card className="p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 text-emerald-600"/><div><h2 className="font-bold text-slate-900">Backup & Restore</h2><p className="mt-1 text-sm text-slate-500">Export all settings before making major model changes. Imported settings are staged until you select Save Settings.</p></div></div><div className="mt-4 flex flex-wrap gap-2"><button onClick={exportSettings} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"><Download size={16}/>Export JSON</button><button onClick={() => importRef.current?.click()} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold"><FileUp size={16}/>Import JSON</button></div></Card></div>}
  </div>
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value:boolean) => void }) {
  return <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-slate-100 p-3"><span className="text-sm font-medium text-slate-700">{label}</span><button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-blue-600' : 'bg-slate-300'}`}><span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition ${checked ? 'left-6' : 'left-1'}`}/></button></label>
}
