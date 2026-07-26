import { FormEvent, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Loader2, MapPin, Save } from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Badge, Card, Field, inputClass } from '../components/ui'
import {
  calculateAccessibilityScore,
  calculateMaximumLocationScore,
  calculateRiskScore,
  classifyUrbanRural,
  temporalAccessScore,
} from '../lib/calculations'
import { supabase } from '../lib/supabase'
import type { LocationFormData } from '../types/domain'

const initial: LocationFormData = {
  machineId: '', agency: '', locationName: '', address: '', city: '', state: '', zip: '', latitude: '', longitude: '',
  contactName: '', contactPhone: '', contactEmail: '', machineStatus: 'Planned', clusterId: '', populationServed: 0,
  availabilityTier: 'High', publicAccessScore: 1, physicalAccessScore: 1, accessibleHoursPerWeek: 168,
  visibilityScore: 1, housingUnitDensity: 0, populationDensity: 0, contiguousHousingUnits: 0,
  contiguousPopulation: 0, zipPopulation: 0, zipCrimeRate: 0, usdaHardinessZone: 5,
}

const numberKeys = new Set<keyof LocationFormData>([
  'accessibleHoursPerWeek', 'housingUnitDensity', 'populationDensity', 'contiguousHousingUnits',
  'contiguousPopulation', 'zipPopulation', 'zipCrimeRate', 'usdaHardinessZone', 'populationServed',
])

const accessWeights = { publicAccess: .35, physicalAccess: .25, temporalAccess: .2, visibility: .2 }
const riskWeights = { population: .3, crime: .5, climate: .2 }
const riskRanges = { populationMin: 0, populationMax: 100000, crimeMin: 0, crimeMax: 100, zoneMin: 1, zoneMax: 13, zoneMid: 7 }

const publicAccessOptions: [number, string][] = [[1, 'Fully public'], [.8, 'Time-limited public'], [.5, 'Semi-public'], [.2, 'Private/gated'], [0, 'Highly restricted']]
const physicalAccessOptions: [number, string][] = [[1, 'Indoor, step-free'], [.8, 'Outdoor, step-free'], [.5, 'Minor barriers'], [.2, 'Significant barriers'], [0, 'Inaccessible']]
const visibilityOptions: [number, string][] = [[1, 'High'], [.6, 'Moderate'], [.3, 'Low'], [0, 'Hidden']]

function optionLabel(options: [number, string][], score: number) {
  return options.find(([value]) => value === score)?.[1] ?? ''
}

function nullable(value: string) {
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

export default function LocationForm() {
  const { locationId } = useParams()
  const navigate = useNavigate()
  const editing = Boolean(locationId)
  const [form, setForm] = useState<LocationFormData>(initial)
  const [loading, setLoading] = useState(editing)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [geocoding, setGeocoding] = useState(false)
  const [geocodeMessage, setGeocodeMessage] = useState('')

  const set = (key: keyof LocationFormData, value: string | number) => {
    setForm((current) => ({ ...current, [key]: numberKeys.has(key) ? Number(value) : value }))
  }

  useEffect(() => {
    if (!locationId || !supabase) return
    const client = supabase

    const load = async () => {
      setLoading(true)
      setMessage('')
      const [locationResult, accessResult, demographicsResult] = await Promise.all([
        client.from('locations').select('*').eq('id', locationId).single(),
        client.from('location_access_scores').select('*').eq('location_id', locationId).maybeSingle(),
        client.from('location_demographics').select('*').eq('location_id', locationId).maybeSingle(),
      ])

      if (locationResult.error) {
        setMessage(locationResult.error.message)
        setLoading(false)
        return
      }

      const location = locationResult.data
      const access = accessResult.data
      const demographics = demographicsResult.data

      setForm({
        machineId: location.machine_id ?? '',
        agency: location.agency ?? '',
        locationName: location.location_name ?? '',
        address: location.address ?? '',
        city: location.city ?? '',
        state: location.state ?? '',
        zip: location.zip ?? '',
        latitude: location.latitude ?? '',
        longitude: location.longitude ?? '',
        contactName: location.contact_name ?? '',
        contactPhone: location.contact_phone ?? '',
        contactEmail: location.contact_email ?? '',
        machineStatus: location.machine_status ?? 'Planned',
        clusterId: location.cluster_id ?? '',
        populationServed: location.population_served ?? 0,
        availabilityTier: access?.availability_tier ?? 'High',
        publicAccessScore: Number(access?.public_access_score ?? 1),
        physicalAccessScore: Number(access?.physical_access_score ?? 1),
        accessibleHoursPerWeek: Number(access?.accessible_hours_per_week ?? 168),
        visibilityScore: Number(access?.visibility_score ?? 1),
        housingUnitDensity: Number(demographics?.housing_unit_density ?? 0),
        populationDensity: Number(demographics?.population_density ?? 0),
        contiguousHousingUnits: Number(demographics?.contiguous_housing_units ?? 0),
        contiguousPopulation: Number(demographics?.contiguous_population ?? 0),
        zipPopulation: Number(demographics?.zip_population ?? 0),
        zipCrimeRate: Number(demographics?.zip_crime_rate ?? 0),
        usdaHardinessZone: Number(demographics?.usda_hardiness_zone ?? 5),
      })

      if (accessResult.error) setMessage(accessResult.error.message)
      if (demographicsResult.error) setMessage(demographicsResult.error.message)
      setLoading(false)
    }

    void load()
  }, [locationId])

  const derived = useMemo(() => {
    const access = calculateAccessibilityScore({
      publicAccess: form.publicAccessScore,
      physicalAccess: form.physicalAccessScore,
      hours: form.accessibleHoursPerWeek,
      visibility: form.visibilityScore,
    }, accessWeights)
    const riskResult = calculateRiskScore({
      population: form.zipPopulation,
      crime: form.zipCrimeRate,
      zone: form.usdaHardinessZone,
    }, riskRanges, riskWeights)
    return {
      access,
      risk: riskResult.riskScore,
      normalizedPopulation: riskResult.normalizedPopulation,
      normalizedCrime: riskResult.normalizedCrime,
      normalizedClimate: riskResult.normalizedClimate,
      max: calculateMaximumLocationScore(access, riskResult.riskScore),
      urbanRural: classifyUrbanRural(form),
    }
  }, [form])

  const scoreTone = derived.access >= .8 ? 'green' : derived.access >= .5 ? 'yellow' : 'red'

  const findCoordinates = async () => {
    const lookupAddress = [form.address, form.city, form.state, form.zip].filter(Boolean).join(', ')
    if (!form.address.trim() || !form.city.trim() || !form.state.trim()) {
      setGeocodeMessage('Enter the address, city, and state before finding coordinates.')
      return
    }

    setGeocoding(true)
    setGeocodeMessage('Finding coordinates…')

    try {
      const params = new URLSearchParams({ address: lookupAddress })
      const response = await fetch(`/api/geocode?${params.toString()}`, {
        headers: { Accept: 'application/json' },
      })

      const contentType = response.headers.get('content-type') || ''
      if (!contentType.includes('application/json')) {
        throw new Error('The local geocoding service is not active. Restart Vite after installing the updated project.')
      }

      const data = await response.json() as {
        latitude?: number
        longitude?: number
        matchedAddress?: string
        provider?: string
        error?: string
      }

      if (!response.ok) {
        throw new Error(data.error || `Geocoder returned ${response.status}.`)
      }

      if (data.latitude == null || data.longitude == null) {
        throw new Error('No coordinate match was found. Check the street address, city, state, and ZIP.')
      }

      setForm((current) => ({
        ...current,
        latitude: data.latitude as number,
        longitude: data.longitude as number,
      }))
      const provider = data.provider ? ` using ${data.provider}` : ''
      setGeocodeMessage(`Coordinates found${provider}${data.matchedAddress ? ` for ${data.matchedAddress}` : ''}.`)
    } catch (error) {
      setGeocodeMessage(error instanceof Error ? error.message : 'Coordinates could not be found.')
    } finally {
      setGeocoding(false)
    }
  }

  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) {
      setMessage('Supabase is not configured.')
      return
    }

    setSaving(true)
    setMessage('')

    try {
      const locationPayload = {
        machine_id: form.machineId.trim(),
        agency: form.agency.trim(),
        location_name: form.locationName.trim(),
        address: nullable(form.address),
        city: nullable(form.city),
        state: nullable(form.state),
        zip: nullable(form.zip),
        latitude: form.latitude === '' ? null : Number(form.latitude),
        longitude: form.longitude === '' ? null : Number(form.longitude),
        contact_name: nullable(form.contactName),
        contact_phone: nullable(form.contactPhone),
        contact_email: nullable(form.contactEmail),
        machine_status: form.machineStatus,
        cluster_id: nullable(form.clusterId),
        population_served: form.populationServed,
      }

      let savedLocationId = locationId
      if (editing && locationId) {
        const { error } = await supabase.from('locations').update(locationPayload).eq('id', locationId)
        if (error) throw error
      } else {
        const { data, error } = await supabase.from('locations').insert(locationPayload).select('id').single()
        if (error) throw error
        savedLocationId = data.id
      }

      if (!savedLocationId) throw new Error('The location ID was not returned after saving.')

      const accessPayload = {
        location_id: savedLocationId,
        availability_tier: form.availabilityTier,
        public_access_category: optionLabel(publicAccessOptions, form.publicAccessScore),
        public_access_score: form.publicAccessScore,
        physical_access_category: optionLabel(physicalAccessOptions, form.physicalAccessScore),
        physical_access_score: form.physicalAccessScore,
        accessible_hours_per_week: form.accessibleHoursPerWeek,
        temporal_access_score: temporalAccessScore(form.accessibleHoursPerWeek),
        visibility_category: optionLabel(visibilityOptions, form.visibilityScore),
        visibility_score: form.visibilityScore,
        machine_accessibility_score: derived.access,
      }

      const demographicsPayload = {
        location_id: savedLocationId,
        housing_unit_density: form.housingUnitDensity,
        population_density: form.populationDensity,
        contiguous_housing_units: form.contiguousHousingUnits,
        contiguous_population: form.contiguousPopulation,
        urban_rural_flag: derived.urbanRural,
        zip_population: form.zipPopulation,
        zip_crime_rate: form.zipCrimeRate,
        usda_hardiness_zone: form.usdaHardinessZone,
        normalized_population_score: derived.normalizedPopulation,
        normalized_crime_score: derived.normalizedCrime,
        normalized_climate_risk_score: derived.normalizedClimate,
        risk_score: derived.risk,
        maximum_location_score: derived.max,
      }

      const [accessSave, demographicsSave] = await Promise.all([
        supabase.from('location_access_scores').upsert(accessPayload, { onConflict: 'location_id' }),
        supabase.from('location_demographics').upsert(demographicsPayload, { onConflict: 'location_id' }),
      ])
      if (accessSave.error) throw accessSave.error
      if (demographicsSave.error) throw demographicsSave.error

      setMessage('Location assessment saved successfully.')
      if (!editing) navigate(`/locations/${savedLocationId}`, { replace: true })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The location could not be saved.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Card><p className="text-sm text-slate-500">Loading location assessment…</p></Card>

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Link to="/locations" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-600"><ArrowLeft size={16}/>Back to Locations</Link>
        <h1 className="text-2xl font-bold">{editing ? `Location: ${form.machineId}` : 'Add Location'}</h1>
        <p className="text-slate-500">{editing ? 'Update location identity, access scoring, classification, and risk inputs.' : 'Capture a single machine location and calculate its decision scores.'}</p>
      </div>
    </div>

    {message && <div className={`rounded-xl border px-4 py-3 text-sm ${message.toLowerCase().includes('success') ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700'}`}>{message}</div>}

    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <Card><p className="text-xs text-slate-500">Accessibility</p><p className="text-2xl font-bold">{derived.access.toFixed(3)}</p><Badge tone={scoreTone}>{scoreTone === 'green' ? 'Ready' : 'Review'}</Badge></Card>
      <Card><p className="text-xs text-slate-500">Risk Score</p><p className="text-2xl font-bold">{derived.risk.toFixed(3)}</p></Card>
      <Card><p className="text-xs text-slate-500">Maximum Location Score</p><p className="text-2xl font-bold">{derived.max.toFixed(3)}</p></Card>
      <Card><p className="text-xs text-slate-500">Classification</p><p className="mt-2"><Badge tone="blue">{derived.urbanRural}</Badge></p></Card>
    </div>

    <form className="space-y-6" onSubmit={save}>
      <Card>
        <h2 className="mb-4 text-lg font-semibold">A. Location Identity</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(['machineId', 'agency', 'locationName', 'address', 'city', 'state', 'zip'] as const).map((key) => <Field key={key} label={key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())}><input className={inputClass} value={String(form[key])} onChange={(event) => set(key, event.target.value)} required={key === 'machineId' || key === 'agency' || key === 'locationName'}/></Field>)}
          <Field label="Machine Status"><select className={inputClass} value={form.machineStatus} onChange={(event) => set('machineStatus', event.target.value)}>{['Planned', 'Active', 'Inactive', 'Removed'].map((status) => <option key={status}>{status}</option>)}</select></Field>
          <Field label="Latitude"><input type="number" step="any" className={inputClass} value={form.latitude} onChange={(event) => set('latitude', event.target.value)}/></Field>
          <Field label="Longitude"><input type="number" step="any" className={inputClass} value={form.longitude} onChange={(event) => set('longitude', event.target.value)}/></Field>
          <div className="md:col-span-2 xl:col-span-3">
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => void findCoordinates()} disabled={geocoding} className="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                {geocoding ? <Loader2 size={17} className="animate-spin"/> : <MapPin size={17}/>}
                {geocoding ? 'Finding Coordinates…' : 'Find Latitude & Longitude'}
              </button>
              {geocodeMessage && <p className="text-sm text-slate-500">{geocodeMessage}</p>}
            </div>
            <p className="mt-2 text-xs text-slate-400">Uses the local application server with OpenStreetMap and U.S. Census fallback. No Ollama service is required.</p>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">B–G. Access Scoring</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ScoreSelect label="Public Access" value={form.publicAccessScore} onChange={(value) => setForm((current) => ({ ...current, publicAccessScore: value }))} options={publicAccessOptions}/>
          <ScoreSelect label="Physical Access" value={form.physicalAccessScore} onChange={(value) => setForm((current) => ({ ...current, physicalAccessScore: value }))} options={physicalAccessOptions}/>
          <Field label="Accessible Hours / Week"><input type="number" min="0" max="168" className={inputClass} value={form.accessibleHoursPerWeek} onChange={(event) => set('accessibleHoursPerWeek', event.target.value)}/></Field>
          <ScoreSelect label="Visibility" value={form.visibilityScore} onChange={(value) => setForm((current) => ({ ...current, visibilityScore: value }))} options={visibilityOptions}/>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 text-lg font-semibold">Population and Risk Inputs</h2>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {(['zipPopulation', 'populationDensity', 'zipCrimeRate', 'usdaHardinessZone'] as const).map((key) => <Field key={key} label={key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase())}><input type="number" step="any" className={inputClass} value={form[key]} onChange={(event) => set(key, event.target.value)}/></Field>)}
        </div>
      </Card>

      <div className="flex justify-end">
        <button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white hover:bg-blue-700 disabled:opacity-50"><Save size={18}/>{saving ? 'Saving…' : editing ? 'Update Location Assessment' : 'Save Location Assessment'}</button>
      </div>
    </form>
  </div>
}

function ScoreSelect({ label, value, onChange, options }: { label: string; value: number; onChange: (value: number) => void; options: [number, string][] }) {
  return <Field label={label}><select className={inputClass} value={value} onChange={(event) => onChange(Number(event.target.value))}>{options.map(([score, text]) => <option value={score} key={score}>{text} — {score.toFixed(1)}</option>)}</select></Field>
}
