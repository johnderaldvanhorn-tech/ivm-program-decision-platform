import { useMemo, useState } from 'react'
import { RotateCcw, Save, Sigma } from 'lucide-react'
import { Badge, Card, Field, inputClass } from '../components/ui'
import {
  calculateAccessibilityScore,
  calculateInventory,
  calculateMaximumLocationScore,
  calculateRiskScore,
  calculateSafetyStock,
  calculateStaffingFeasibility,
  temporalAccessScore,
} from '../lib/calculations'

const DEFAULTS = {
  accessWeights: { publicAccess: 0.35, physicalAccess: 0.25, temporalAccess: 0.2, visibility: 0.2 },
  accessInputs: { publicAccess: 1, physicalAccess: 1, hours: 168, visibility: 1 },
  riskWeights: { population: 0.3, crime: 0.5, climate: 0.2 },
  riskInputs: { population: 19076, crime: 88, zone: 7 },
  riskRanges: {
    populationMin: 0,
    populationMax: 100000,
    crimeMin: 0,
    crimeMax: 100,
    zoneMin: 1,
    zoneMax: 13,
    zoneMid: 7,
  },
  riskCoefficient: 1,
  inventory: {
    priorInventory: 20,
    replenished: 10,
    dispensed: 12,
    demand: 15,
    capacity: 36,
    supplierReliability: 1,
    maxOrderable: 36,
    costPerUnit: 25,
    holdingCost: 1,
    stockoutPenaltyMultiplier: 10,
  },
  safety: { capacity: 36, currentInventory: 12, demandRate: 2, leadTimeDays: 5, safetyStock: 6 },
  staffing: {
    qualified: true,
    locationSafe: true,
    clusterMatch: true,
    currentWorkload: 24,
    taskHours: 2,
    maxHours: 40,
    assignedTaskCount: 3,
    requiredFrequency: 3,
  },
}

type Model = typeof DEFAULTS

const numberInput = (value: number, onChange: (value: number) => void, step = '0.01') => (
  <input className={inputClass} type="number" step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
)

function percent(value: number) {
  return `${Math.round(value * 100)}%`
}

function scoreTone(value: number, inverse = false): 'green' | 'yellow' | 'red' {
  const normalized = Math.max(0, Math.min(1, value))
  if (inverse) return normalized <= 0.33 ? 'green' : normalized <= 0.66 ? 'yellow' : 'red'
  return normalized >= 0.67 ? 'green' : normalized >= 0.34 ? 'yellow' : 'red'
}

export default function Calculations() {
  const [model, setModel] = useState<Model>(() => {
    const saved = localStorage.getItem('ivm-calculation-settings')
    return saved ? { ...DEFAULTS, ...JSON.parse(saved) } : structuredClone(DEFAULTS)
  })
  const [saved, setSaved] = useState(false)

  const setSection = (section: Exclude<keyof Model, 'riskCoefficient'>, patch: Record<string, number | boolean>) => {
    setModel((current) => ({ ...current, [section]: { ...(current[section] as object), ...patch } } as Model))
    setSaved(false)
  }

  const accessibility = useMemo(
    () => calculateAccessibilityScore(model.accessInputs, model.accessWeights),
    [model.accessInputs, model.accessWeights],
  )
  const temporal = temporalAccessScore(model.accessInputs.hours)
  const risk = useMemo(
    () => calculateRiskScore(model.riskInputs, model.riskRanges, model.riskWeights),
    [model.riskInputs, model.riskRanges, model.riskWeights],
  )
  const maxLocation = calculateMaximumLocationScore(accessibility, risk.riskScore, model.riskCoefficient)
  const inventory = calculateInventory({
    ...model.inventory,
    stockoutPenalty: model.inventory.stockoutPenaltyMultiplier * model.inventory.costPerUnit,
  })
  const safety = calculateSafetyStock(model.safety)
  const staffing = calculateStaffingFeasibility(model.staffing)

  const save = () => {
    localStorage.setItem('ivm-calculation-settings', JSON.stringify(model))
    setSaved(true)
  }
  const reset = () => {
    setModel(structuredClone(DEFAULTS))
    localStorage.removeItem('ivm-calculation-settings')
    setSaved(false)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Sigma className="text-blue-600" size={24} />
            <h1 className="text-2xl font-bold text-slate-900">Calculation Factors</h1>
          </div>
          <p className="mt-1 text-sm text-slate-500">Adjust the decision-model factors, review live results, save them locally, or reset all values to the current defaults.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <RotateCcw size={17} /> Reset Defaults
          </button>
          <button onClick={save} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700">
            <Save size={17} /> Save Adjustments
          </button>
        </div>
      </div>

      {saved && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">Calculation settings saved in this browser.</div>}

      <Card className="p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Accessibility Score</p>
            <div className="mt-2 flex items-center justify-between"><strong className="text-2xl">{percent(accessibility)}</strong><Badge tone={scoreTone(accessibility)}>{scoreTone(accessibility) === 'green' ? 'High' : scoreTone(accessibility) === 'yellow' ? 'Moderate' : 'Low'}</Badge></div>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Risk Score</p>
            <div className="mt-2 flex items-center justify-between"><strong className="text-2xl">{percent(risk.riskScore)}</strong><Badge tone={scoreTone(risk.riskScore, true)}>{risk.riskScore <= .33 ? 'Low Risk' : risk.riskScore <= .66 ? 'Moderate Risk' : 'High Risk'}</Badge></div>
          </div>
          <div className="rounded-xl bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Maximum Location Score</p>
            <div className="mt-2 flex items-center justify-between"><strong className="text-2xl">{percent(Math.max(0, Math.min(1, maxLocation)))}</strong><span className="text-xs text-slate-500">Raw: {maxLocation.toFixed(3)}</span></div>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <h2 className="text-lg font-bold text-slate-900">1. Accessibility Calculation</h2>
          <p className="mt-1 text-sm text-slate-500">Accessibility = Public × w1 + Physical × w2 + Temporal × w3 + Visibility × w4</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Public Access Score">{numberInput(model.accessInputs.publicAccess, (v) => setSection('accessInputs', { publicAccess: v }))}</Field>
            <Field label="Public Access Weight">{numberInput(model.accessWeights.publicAccess, (v) => setSection('accessWeights', { publicAccess: v }))}</Field>
            <Field label="Physical Access Score">{numberInput(model.accessInputs.physicalAccess, (v) => setSection('accessInputs', { physicalAccess: v }))}</Field>
            <Field label="Physical Access Weight">{numberInput(model.accessWeights.physicalAccess, (v) => setSection('accessWeights', { physicalAccess: v }))}</Field>
            <Field label="Accessible Hours / Week">{numberInput(model.accessInputs.hours, (v) => setSection('accessInputs', { hours: v }), '1')}</Field>
            <Field label="Temporal Access Weight">{numberInput(model.accessWeights.temporalAccess, (v) => setSection('accessWeights', { temporalAccess: v }))}</Field>
            <Field label="Visibility Score">{numberInput(model.accessInputs.visibility, (v) => setSection('accessInputs', { visibility: v }))}</Field>
            <Field label="Visibility Weight">{numberInput(model.accessWeights.visibility, (v) => setSection('accessWeights', { visibility: v }))}</Field>
          </div>
          <div className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-800">Temporal score: <strong>{temporal.toFixed(3)}</strong> · Weight total: <strong>{Object.values(model.accessWeights).reduce((a, b) => a + b, 0).toFixed(2)}</strong></div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-slate-900">2. Risk Calculation</h2>
          <p className="mt-1 text-sm text-slate-500">Risk = normalized population × wP + normalized crime × wC + climate deviation × wT</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="ZIP Population">{numberInput(model.riskInputs.population, (v) => setSection('riskInputs', { population: v }), '1')}</Field>
            <Field label="Crime Rate">{numberInput(model.riskInputs.crime, (v) => setSection('riskInputs', { crime: v }))}</Field>
            <Field label="Hardiness Zone">{numberInput(model.riskInputs.zone, (v) => setSection('riskInputs', { zone: v }))}</Field>
            <Field label="Population Weight">{numberInput(model.riskWeights.population, (v) => setSection('riskWeights', { population: v }))}</Field>
            <Field label="Crime Weight">{numberInput(model.riskWeights.crime, (v) => setSection('riskWeights', { crime: v }))}</Field>
            <Field label="Climate Weight">{numberInput(model.riskWeights.climate, (v) => setSection('riskWeights', { climate: v }))}</Field>
          </div>
          <h3 className="mt-5 text-sm font-bold text-slate-800">Dataset normalization ranges</h3>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            {(['populationMin','populationMax','crimeMin','crimeMax','zoneMin','zoneMax','zoneMid'] as const).map((key) => <Field key={key} label={key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}>{numberInput(model.riskRanges[key], (v) => setSection('riskRanges', { [key]: v }))}</Field>)}
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
            <div className="rounded-lg bg-slate-50 p-2">Population normalized<br/><strong>{risk.normalizedPopulation.toFixed(3)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-2">Crime normalized<br/><strong>{risk.normalizedCrime.toFixed(3)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-2">Climate normalized<br/><strong>{risk.normalizedClimate.toFixed(3)}</strong></div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-slate-900">3. Maximum Location Score</h2>
          <p className="mt-1 text-sm text-slate-500">Maximum Location Score = Accessibility − (Risk Coefficient × Risk Score)</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <Field label="Accessibility Score"><input className={`${inputClass} bg-slate-50`} value={accessibility.toFixed(3)} readOnly /></Field>
            <Field label="Risk Score"><input className={`${inputClass} bg-slate-50`} value={risk.riskScore.toFixed(3)} readOnly /></Field>
            <Field label="Risk Coefficient">{numberInput(model.riskCoefficient, (v) => setModel((m) => ({ ...m, riskCoefficient: v })))}</Field>
          </div>
          <div className="mt-4 rounded-xl bg-slate-900 p-4 text-white"><span className="text-sm text-slate-300">Calculated result</span><div className="mt-1 text-3xl font-bold">{maxLocation.toFixed(3)}</div></div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-slate-900">4. Inventory Calculation</h2>
          <p className="mt-1 text-sm text-slate-500">Ending Inventory = Prior + Accepted Replenishment − Dispensed</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {(['priorInventory','replenished','dispensed','demand','capacity','supplierReliability','maxOrderable','costPerUnit','holdingCost','stockoutPenaltyMultiplier'] as const).map((key) => <Field key={key} label={key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}>{numberInput(model.inventory[key], (v) => setSection('inventory', { [key]: v }), key.includes('Inventory') || ['replenished','dispensed','demand','capacity','maxOrderable'].includes(key) ? '1' : '0.01')}</Field>)}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-4 text-sm">
            <div className="rounded-lg bg-slate-50 p-3">Ending<br/><strong>{inventory.endingInventory}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3">Unmet demand<br/><strong>{inventory.unmetDemand}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3">Total cost<br/><strong>${inventory.totalCost.toFixed(2)}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3">Status<br/><strong>{inventory.status}</strong></div>
          </div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-slate-900">5. Safety Stock Calculation</h2>
          <p className="mt-1 text-sm text-slate-500">Reorder Point = Demand Rate × Lead Time + Safety Stock</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {(['capacity','currentInventory','demandRate','leadTimeDays','safetyStock'] as const).map((key) => <Field key={key} label={key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}>{numberInput(model.safety[key], (v) => setSection('safety', { [key]: v }))}</Field>)}
          </div>
          <div className="mt-4 grid gap-2 sm:grid-cols-3 text-sm">
            <div className="rounded-lg bg-slate-50 p-3">Reorder point<br/><strong>{safety.reorderPoint}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3">Order quantity<br/><strong>{safety.orderQuantity}</strong></div>
            <div className="rounded-lg bg-slate-50 p-3">Trigger<br/><strong>{safety.restockTrigger}</strong></div>
          </div>
          <div className="mt-3"><Badge tone={safety.safetyStockFlag.startsWith('Review') ? 'yellow' : 'green'}>{safety.safetyStockFlag}</Badge></div>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-slate-900">6. Staffing Feasibility</h2>
          <p className="mt-1 text-sm text-slate-500">Feasible only when qualified, safe, and assigned to the machine cluster.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            {(['qualified','locationSafe','clusterMatch'] as const).map((key) => <label key={key} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3 text-sm font-medium"><input type="checkbox" checked={model.staffing[key]} onChange={(e) => setSection('staffing', { [key]: e.target.checked })}/>{key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}</label>)}
            {(['currentWorkload','taskHours','maxHours','assignedTaskCount','requiredFrequency'] as const).map((key) => <Field key={key} label={key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase())}>{numberInput(model.staffing[key], (v) => setSection('staffing', { [key]: v }))}</Field>)}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge tone={staffing.feasible ? 'green' : 'red'}>{staffing.feasibilityStatus}</Badge>
            <Badge tone={staffing.capacityStatus === 'Pass' ? 'green' : 'red'}>{staffing.capacityStatus}</Badge>
            <Badge tone={staffing.coverageStatus === 'Pass' ? 'green' : 'yellow'}>{staffing.coverageStatus}</Badge>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">Workload: {staffing.workload} hours</span>
          </div>
        </Card>
      </div>
    </div>
  )
}
