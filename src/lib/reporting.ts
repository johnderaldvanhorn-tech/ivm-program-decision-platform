import { supabase } from './supabase'

export type ReportKey =
  | 'executive'
  | 'location'
  | 'machine'
  | 'inventory'
  | 'staffing'
  | 'demand'
  | 'accessibility'
  | 'risk'
  | 'cost'
  | 'recommendations'
  | 'simulation'
  | 'dissertation'

export type ReportFilters = {
  agency: string
  locationId: string
  machineUuid: string
  product: string
  narcanOnly: boolean
  startDate: string
  endDate: string
}

export type ReportRow = Record<string, string | number | boolean | null | undefined>

export type ReportSection = {
  title: string
  description?: string
  columns: { key: string; label: string }[]
  rows: ReportRow[]
}

export type ReportModel = {
  title: string
  subtitle: string
  generatedAt: string
  kpis: { label: string; value: string; note?: string }[]
  sections: ReportSection[]
  chartData?: { name: string; value: number; secondary?: number }[]
  notes?: string[]
}

export type ReportingData = {
  locations: any[]
  machines: any[]
  planogram: any[]
  machineSummary: any[]
  logTotals: any | null
  technicianSummary: any[]
  serviceDemand: any[]
  restockEvents: any[]
  demandParameters: any[]
}

const asArray = (value: any) => Array.isArray(value) ? value : value ? [value] : []
const num = (value: any) => Number.isFinite(Number(value)) ? Number(value) : 0
const pct = (value: any) => `${Math.round(num(value) * (num(value) <= 1 ? 100 : 1))}%`
const money = (value: any) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(num(value))
const date = (value: any) => value ? new Date(value).toLocaleDateString() : '—'
const daysBetween = (a: string, b: string) => Math.max(1, Math.ceil((new Date(b).getTime() - new Date(a).getTime()) / 86400000) + 1)

async function safeSelect(table: string, query = '*', limit = 10000) {
  if (!supabase) return []
  const { data, error } = await supabase.from(table).select(query).limit(limit)
  if (error) {
    console.warn(`Reporting query failed for ${table}:`, error.message)
    return []
  }
  return data ?? []
}

async function safeRpc(name: string, args: Record<string, unknown> = {}) {
  if (!supabase) return null
  const { data, error } = await supabase.rpc(name, args)
  if (error) {
    console.warn(`Reporting RPC failed for ${name}:`, error.message)
    return null
  }
  return data
}

export async function loadReportingData(): Promise<ReportingData> {
  const [locations, machines, planogram, machineSummary, logTotals, technicianSummary, serviceDemand, restockEvents, demandParameters] = await Promise.all([
    safeSelect('locations', '*,location_access_scores(*),location_demographics(*)'),
    safeSelect('machines', '*'),
    safeSelect('machine_planogram_items', '*'),
    safeRpc('get_machine_log_machine_summary'),
    safeRpc('get_machine_log_totals'),
    safeRpc('get_staffing_technician_summary'),
    Promise.resolve([]),
    safeSelect('restock_events', '*', 20000),
    safeSelect('demand_evaluation_parameters', '*'),
  ])
  return {
    locations,
    machines,
    planogram,
    machineSummary: asArray(machineSummary),
    logTotals: Array.isArray(logTotals) ? logTotals[0] ?? null : logTotals,
    technicianSummary: asArray(technicianSummary),
    serviceDemand: asArray(serviceDemand),
    restockEvents,
    demandParameters,
  }
}

function relatedRecord(value: any) {
  return Array.isArray(value) ? value[0] ?? null : value ?? null
}
function normalizedScore(value: any) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0
}
function accessScore(location: any) {
  const row = relatedRecord(location.location_access_scores)
  return normalizedScore(row?.machine_accessibility_score)
}
function riskScore(location: any) {
  const row = relatedRecord(location.location_demographics)
  return normalizedScore(row?.risk_score)
}
function maxLocationScore(location: any) {
  const row = relatedRecord(location.location_demographics)
  return normalizedScore(row?.maximum_location_score)
}
function urbanRural(location: any) {
  const row = asArray(location.location_demographics)[0]
  return row?.urban_rural_flag || 'Unknown'
}
function machineForLocation(data: ReportingData, location: any) {
  return data.machines.find((m) => m.location_id === location.id || m.machine_id === location.machine_id)
}
function locationForMachine(data: ReportingData, machine: any) {
  return data.locations.find((l) => l.id === machine.location_id || l.machine_id === machine.machine_id)
}
function summaryForMachine(data: ReportingData, machine: any) {
  return data.machineSummary.find((s) =>
    s.machine_uuid === machine.id || s.machine_id === machine.machine_id || s.machine_wtn_id === machine.machine_id)
}
function serviceForMachine(data: ReportingData, machine: any) {
  return data.serviceDemand.find((s) =>
    s.machine_uuid === machine.id || s.machine_id === machine.machine_id || s.machine_wtn_id === machine.machine_id)
}

function filtered(data: ReportingData, filters: ReportFilters): ReportingData {
  const locations = data.locations.filter((l) => {
    if (filters.agency && l.agency !== filters.agency) return false
    if (filters.locationId && l.id !== filters.locationId) return false
    return true
  })
  const locationIds = new Set(locations.map((l) => l.id))
  const machines = data.machines.filter((m) => {
    if (filters.machineUuid && m.id !== filters.machineUuid) return false
    if ((filters.agency || filters.locationId) && !locationIds.has(m.location_id)) return false
    return true
  })
  const machineIds = new Set(machines.map((m) => m.id))
  let planogram = data.planogram.filter((p) => machineIds.has(p.machine_uuid || p.machine_id))
  if (filters.narcanOnly) planogram = planogram.filter((p) => String(p.product_name || '').toLowerCase().includes('narcan'))
  if (filters.product) planogram = planogram.filter((p) => p.product_name === filters.product)
  const machineSummary = data.machineSummary.filter((s) => !filters.machineUuid || s.machine_uuid === filters.machineUuid || s.machine_id === machines[0]?.machine_id || s.machine_wtn_id === machines[0]?.machine_id)
  const serviceDemand = data.serviceDemand.filter((s) => !filters.machineUuid || s.machine_uuid === filters.machineUuid || s.machine_id === machines[0]?.machine_id || s.machine_wtn_id === machines[0]?.machine_id)
  const restockEvents = data.restockEvents.filter((r) => {
    if (!machineIds.has(r.machine_uuid || r.machine_id)) return false
    if (filters.startDate && r.restock_datetime && r.restock_datetime < filters.startDate) return false
    if (filters.endDate && r.restock_datetime && r.restock_datetime > `${filters.endDate}T23:59:59`) return false
    if (filters.narcanOnly && !String(r.product_name || '').toLowerCase().includes('narcan')) return false
    if (filters.product && r.product_name !== filters.product) return false
    return true
  })
  return { ...data, locations, machines, planogram, machineSummary, serviceDemand, restockEvents }
}

function average(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0
}

function baseMachineRows(data: ReportingData) {
  return data.machines.map((m) => {
    const l = locationForMachine(data, m)
    const s = summaryForMachine(data, m) || {}
    const service = serviceForMachine(data, m) || {}
    const items = data.planogram.filter((p) => (p.machine_uuid || p.machine_id) === m.id)
    return {
      machineUuid: m.id,
      machineId: m.machine_id,
      agency: l?.agency || m.agency || 'Unassigned',
      location: l?.location_name || s.source_name || 'Unknown',
      city: l?.city || '',
      status: m.active ? 'Active' : 'Inactive',
      capacity: items.reduce((sum, p) => sum + num(p.max_level), 0) || num(m.capacity),
      par: items.reduce((sum, p) => sum + num(p.par_level), 0),
      selections: items.length,
      events: num(s.event_count ?? s.events),
      dispensed: num(s.units_dispensed ?? s.dispensed),
      failed: num(s.failed_count ?? s.failed),
      stockouts: num(s.stockout_count ?? s.stockouts),
      firstActivity: s.first_activity,
      lastActivity: s.last_activity,
      restockVisits: num(service.visits || service.restock_visits),
      restockedUnits: num(service.units_replenished || service.units_restocked),
      technicianCount: num(service.technician_count),
    }
  })
}

function buildExecutive(data: ReportingData): ReportModel {
  const machineRows = baseMachineRows(data)
  const access = data.locations.map(accessScore)
  const risk = data.locations.map(riskScore)
  const maxScores = data.locations.map(maxLocationScore)
  const totalEvents = machineRows.reduce((s, r) => s + r.events, 0)
  const totalDispensed = machineRows.reduce((s, r) => s + r.dispensed, 0)
  return {
    title: 'Executive Program Summary',
    subtitle: 'Availability-first overview of placement, inventory availability, demand, and service capacity.',
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Agencies', value: String(new Set(data.locations.map((l) => l.agency)).size) },
      { label: 'Locations', value: String(data.locations.length) },
      { label: 'Machines', value: String(data.machines.length) },
      { label: 'Active Machines', value: String(data.machines.filter((m) => m.active).length) },
      { label: 'Avg Accessibility', value: pct(average(access)) },
      { label: 'Avg Risk', value: pct(average(risk)) },
      { label: 'Avg Maximum Score', value: pct(average(maxScores)) },
      { label: 'Events', value: totalEvents.toLocaleString() },
      { label: 'Units Dispensed', value: totalDispensed.toLocaleString() },
      { label: 'Restock Visits', value: machineRows.reduce((s, r) => s + r.restockVisits, 0).toLocaleString() },
      { label: 'Technician Resources', value: String(data.technicianSummary.length) },
      { label: 'Stockout Events', value: machineRows.reduce((s, r) => s + r.stockouts, 0).toLocaleString() },
    ],
    chartData: data.locations.map((l) => ({ name: l.location_name || l.machine_id, value: Math.round(maxLocationScore(l) * 100), secondary: Math.round(riskScore(l) * 100) })),
    sections: [{
      title: 'Network Performance by Machine',
      columns: [
        { key: 'agency', label: 'Agency' }, { key: 'location', label: 'Location' }, { key: 'machineId', label: 'WTN' },
        { key: 'events', label: 'Events' }, { key: 'dispensed', label: 'Dispensed' }, { key: 'stockouts', label: 'Stockouts' },
        { key: 'restockVisits', label: 'Restock Visits' }, { key: 'technicianCount', label: 'Technicians' },
      ],
      rows: machineRows,
    }],
  }
}

function buildLocation(data: ReportingData): ReportModel {
  const rows = data.locations.map((l) => {
    const m = machineForLocation(data, l)
    const s = m ? summaryForMachine(data, m) || {} : {}
    const access = asArray(l.location_access_scores)[0] || {}
    return {
      agency: l.agency,
      location: l.location_name,
      machineId: l.machine_id,
      address: [l.address, l.city, l.state, l.zip].filter(Boolean).join(', '),
      urbanRural: urbanRural(l),
      accessibility: pct(accessScore(l)),
      risk: pct(riskScore(l)),
      maximumScore: pct(maxLocationScore(l)),
      publicAccess: pct(access.public_access_score),
      physicalAccess: pct(access.physical_access_score),
      temporalAccess: pct(access.temporal_access_score),
      visibility: pct(access.visibility_score),
      dispensed: num(s.dispensed),
      stockouts: num(s.stockouts),
      recommendation: maxLocationScore(l) >= .67 ? 'Maintain / prioritize' : maxLocationScore(l) >= .34 ? 'Review access and risk' : 'Corrective action / relocation review',
    }
  })
  return {
    title: 'Location Evaluation Report',
    subtitle: 'Location-level accessibility, risk, coverage, demand, and placement recommendations.',
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Locations Evaluated', value: String(rows.length) },
      { label: 'Urban', value: String(rows.filter((r) => r.urbanRural === 'Urban').length) },
      { label: 'Rural', value: String(rows.filter((r) => r.urbanRural === 'Rural').length) },
      { label: 'Avg Accessibility', value: pct(average(data.locations.map(accessScore))) },
      { label: 'Avg Risk', value: pct(average(data.locations.map(riskScore))) },
      { label: 'Avg Maximum Score', value: pct(average(data.locations.map(maxLocationScore))) },
    ],
    chartData: data.locations.map((l) => ({ name: l.location_name || l.machine_id, value: Math.round(accessScore(l) * 100), secondary: Math.round(riskScore(l) * 100) })),
    sections: [{ title: 'Location Scorecards', columns: [
      { key: 'agency', label: 'Agency' }, { key: 'location', label: 'Location' }, { key: 'machineId', label: 'WTN' },
      { key: 'urbanRural', label: 'Class' }, { key: 'accessibility', label: 'Accessibility' }, { key: 'risk', label: 'Risk' },
      { key: 'maximumScore', label: 'Maximum Score' }, { key: 'dispensed', label: 'Dispensed' }, { key: 'stockouts', label: 'Stockouts' },
      { key: 'recommendation', label: 'Recommendation' },
    ], rows }],
  }
}

function buildMachine(data: ReportingData): ReportModel {
  const rows = baseMachineRows(data).map((r) => ({
    ...r,
    firstActivity: date(r.firstActivity),
    lastActivity: date(r.lastActivity),
    failureRate: r.events ? pct(r.failed / r.events) : '0%',
    stockoutRate: r.events ? pct(r.stockouts / r.events) : '0%',
  }))
  return {
    title: 'Machine Performance Report',
    subtitle: 'Machine utilization, demand activity, service history, and operational reliability.',
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Machines', value: String(rows.length) },
      { label: 'Total Events', value: rows.reduce((s, r) => s + r.events, 0).toLocaleString() },
      { label: 'Units Dispensed', value: rows.reduce((s, r) => s + r.dispensed, 0).toLocaleString() },
      { label: 'Failures', value: rows.reduce((s, r) => s + r.failed, 0).toLocaleString() },
      { label: 'Stockouts', value: rows.reduce((s, r) => s + r.stockouts, 0).toLocaleString() },
      { label: 'Restock Visits', value: rows.reduce((s, r) => s + r.restockVisits, 0).toLocaleString() },
    ],
    chartData: rows.map((r) => ({ name: r.location, value: r.dispensed, secondary: r.stockouts })),
    sections: [{ title: 'Machine Performance', columns: [
      { key: 'agency', label: 'Agency' }, { key: 'location', label: 'Location' }, { key: 'machineId', label: 'WTN' },
      { key: 'selections', label: 'Selections' }, { key: 'capacity', label: 'Capacity' }, { key: 'events', label: 'Events' },
      { key: 'dispensed', label: 'Dispensed' }, { key: 'failed', label: 'Failed' }, { key: 'stockouts', label: 'Stockouts' },
      { key: 'firstActivity', label: 'First Activity' }, { key: 'lastActivity', label: 'Last Activity' },
    ], rows }],
  }
}

function buildInventory(data: ReportingData): ReportModel {
  const machineRows = baseMachineRows(data)
  const rows = data.planogram.map((p) => {
    const m = data.machines.find((machine) => machine.id === (p.machine_uuid || p.machine_id))
    const l = m ? locationForMachine(data, m) : null
    const current = num(p.current_quantity)
    const par = num(p.par_level)
    const max = num(p.max_level)
    const status = current <= num(p.critical_level) ? 'Critical' : current <= num(p.low_level) ? 'Low' : current < par ? 'Below PAR' : 'Healthy'
    return {
      agency: l?.agency || '', location: l?.location_name || '', machineId: m?.machine_id || p.machine_wtn_id || '',
      selection: p.selection_number, product: p.product_name, itemNumber: p.item_number,
      critical: num(p.critical_level), low: num(p.low_level), par, maximum: max, current,
      fillRate: max ? pct(current / max) : '0%', toPar: Math.max(0, par - current), status,
    }
  })
  return {
    title: 'Inventory Optimization Report',
    subtitle: 'Planogram capacity, PAR policy, threshold configuration, and replenishment requirements.',
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Selections', value: String(rows.length) },
      { label: 'Configured Capacity', value: rows.reduce((s, r) => s + r.maximum, 0).toLocaleString() },
      { label: 'PAR Units', value: rows.reduce((s, r) => s + r.par, 0).toLocaleString() },
      { label: 'Current Units', value: rows.reduce((s, r) => s + r.current, 0).toLocaleString() },
      { label: 'Units to PAR', value: rows.reduce((s, r) => s + r.toPar, 0).toLocaleString() },
      { label: 'Machines', value: String(machineRows.length) },
    ],
    chartData: machineRows.map((r) => ({ name: r.location, value: r.capacity, secondary: r.par })),
    sections: [{ title: 'Selection-Level Inventory Policy', columns: [
      { key: 'agency', label: 'Agency' }, { key: 'location', label: 'Location' }, { key: 'machineId', label: 'WTN' },
      { key: 'selection', label: 'Selection' }, { key: 'product', label: 'Product' }, { key: 'critical', label: 'Critical' },
      { key: 'low', label: 'Low' }, { key: 'par', label: 'PAR' }, { key: 'maximum', label: 'Maximum' },
      { key: 'current', label: 'Current' }, { key: 'toPar', label: 'To PAR' }, { key: 'status', label: 'Status' },
    ], rows }],
  }
}

function buildStaffing(data: ReportingData): ReportModel {
  const techRows = data.technicianSummary.map((t) => ({
    technician: t.technician_code || t.technician_name || 'Anonymous',
    visits: num(t.visits || t.restock_visits), machines: num(t.machines_serviced), selections: num(t.selections_serviced),
    units: num(t.units_replenished || t.units_restocked), estimatedHours: num(t.estimated_workload_hours || t.estimated_hours).toFixed(1),
    availableHours: num(t.available_hours || t.max_hours).toFixed(1), utilization: pct(t.utilization || 0),
    firstActivity: date(t.first_activity), lastActivity: date(t.last_activity),
  }))
  const machineRows = baseMachineRows(data).map((r) => ({
    agency: r.agency, location: r.location, machineId: r.machineId, visits: r.restockVisits,
    units: r.restockedUnits, technicianCount: r.technicianCount,
    avgUnitsPerVisit: r.restockVisits ? Math.round(r.restockedUnits / r.restockVisits) : 0,
  }))
  return {
    title: 'Staffing Analysis Report',
    subtitle: 'Technician resource count, restock workload, machine service demand, and capacity utilization.',
    generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Technician Resources', value: String(techRows.length) },
      { label: 'Restock Visits', value: machineRows.reduce((s, r) => s + r.visits, 0).toLocaleString() },
      { label: 'Units Replenished', value: machineRows.reduce((s, r) => s + r.units, 0).toLocaleString() },
      { label: 'Machines Serviced', value: String(machineRows.filter((r) => r.visits > 0).length) },
      { label: 'Avg Technicians / Machine', value: average(machineRows.map((r) => r.technicianCount)).toFixed(1) },
      { label: 'Estimated Labor Hours', value: techRows.reduce((s, r) => s + num(r.estimatedHours), 0).toFixed(1) },
    ],
    chartData: machineRows.map((r) => ({ name: r.location, value: r.visits, secondary: r.technicianCount })),
    sections: [
      { title: 'Technician Capacity', columns: [
        { key: 'technician', label: 'Technician Code' }, { key: 'visits', label: 'Visits' }, { key: 'machines', label: 'Machines' },
        { key: 'units', label: 'Units' }, { key: 'estimatedHours', label: 'Est. Hours' }, { key: 'availableHours', label: 'Available Hours' },
        { key: 'utilization', label: 'Utilization' }, { key: 'firstActivity', label: 'First Activity' }, { key: 'lastActivity', label: 'Last Activity' },
      ], rows: techRows },
      { title: 'Machine Service Demand', columns: [
        { key: 'agency', label: 'Agency' }, { key: 'location', label: 'Location' }, { key: 'machineId', label: 'WTN' },
        { key: 'visits', label: 'Visits' }, { key: 'units', label: 'Units' }, { key: 'technicianCount', label: 'Technician Count' },
        { key: 'avgUnitsPerVisit', label: 'Avg Units / Visit' },
      ], rows: machineRows },
    ],
  }
}

function buildDemand(data: ReportingData, filters: ReportFilters): ReportModel {
  const rows = baseMachineRows(data).map((r) => {
    const first = r.firstActivity || filters.startDate
    const last = r.lastActivity || filters.endDate
    const days = first && last ? daysBetween(first, last) : 365
    return {
      agency: r.agency, location: r.location, machineId: r.machineId,
      events: r.events, unitsDispensed: r.dispensed, averagePerDay: (r.dispensed / days).toFixed(3),
      failures: r.failed, stockouts: r.stockouts, firstActivity: date(r.firstActivity), lastActivity: date(r.lastActivity),
      demandClass: r.dispensed / days >= 1 ? 'High' : r.dispensed / days >= .25 ? 'Moderate' : 'Low',
    }
  })
  return {
    title: 'Demand Analysis Report', subtitle: 'Observed demand, average daily utilization, exceptions, and demand classification.', generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Units Dispensed', value: rows.reduce((s, r) => s + r.unitsDispensed, 0).toLocaleString() },
      { label: 'Average / Machine / Day', value: average(rows.map((r) => num(r.averagePerDay))).toFixed(3) },
      { label: 'High-Demand Machines', value: String(rows.filter((r) => r.demandClass === 'High').length) },
      { label: 'Stockouts', value: rows.reduce((s, r) => s + r.stockouts, 0).toLocaleString() },
    ],
    chartData: rows.map((r) => ({ name: r.location, value: Number(r.averagePerDay), secondary: r.stockouts })),
    sections: [{ title: 'Demand by Machine', columns: [
      { key: 'agency', label: 'Agency' }, { key: 'location', label: 'Location' }, { key: 'machineId', label: 'WTN' },
      { key: 'unitsDispensed', label: 'Units Dispensed' }, { key: 'averagePerDay', label: 'Average / Day' },
      { key: 'failures', label: 'Failures' }, { key: 'stockouts', label: 'Stockouts' }, { key: 'demandClass', label: 'Demand Class' },
      { key: 'firstActivity', label: 'First Activity' }, { key: 'lastActivity', label: 'Last Activity' },
    ], rows }],
  }
}

function buildAccessibility(data: ReportingData): ReportModel {
  const rows = data.locations.map((l) => {
    const a = asArray(l.location_access_scores)[0] || {}
    return {
      agency: l.agency, location: l.location_name, machineId: l.machine_id,
      publicAccess: pct(a.public_access_score), physicalAccess: pct(a.physical_access_score),
      temporalAccess: pct(a.temporal_access_score), visibility: pct(a.visibility_score),
      total: pct(accessScore(l)), hours: num(a.accessible_hours_per_week), class: urbanRural(l),
      weakness: [
        ['Public', num(a.public_access_score)], ['Physical', num(a.physical_access_score)],
        ['Temporal', num(a.temporal_access_score)], ['Visibility', num(a.visibility_score)],
      ].sort((x, y) => Number(x[1]) - Number(y[1]))[0]?.[0] || 'Unknown',
    }
  })
  return {
    title: 'Accessibility Analysis Report', subtitle: 'Public, physical, temporal, and visibility access performance by location.', generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Avg Accessibility', value: pct(average(data.locations.map(accessScore))) },
      { label: 'High Access', value: String(data.locations.filter((l) => accessScore(l) >= .8).length) },
      { label: 'Review', value: String(data.locations.filter((l) => accessScore(l) >= .5 && accessScore(l) < .8).length) },
      { label: 'Low Access', value: String(data.locations.filter((l) => accessScore(l) < .5).length) },
    ],
    chartData: data.locations.map((l) => ({ name: l.location_name, value: Math.round(accessScore(l) * 100) })),
    sections: [{ title: 'Accessibility Components', columns: [
      { key: 'agency', label: 'Agency' }, { key: 'location', label: 'Location' }, { key: 'machineId', label: 'WTN' },
      { key: 'publicAccess', label: 'Public' }, { key: 'physicalAccess', label: 'Physical' }, { key: 'temporalAccess', label: 'Temporal' },
      { key: 'visibility', label: 'Visibility' }, { key: 'total', label: 'Total' }, { key: 'weakness', label: 'Primary Weakness' },
    ], rows }],
  }
}

function buildRisk(data: ReportingData): ReportModel {
  const rows = data.locations.map((l) => {
    const d = asArray(l.location_demographics)[0] || {}
    return {
      agency: l.agency, location: l.location_name, machineId: l.machine_id,
      zipPopulation: num(d.zip_population), crimeRate: num(d.zip_crime_rate), hardinessZone: num(d.usda_hardiness_zone),
      populationRisk: pct(d.normalized_population_score), crimeRisk: pct(d.normalized_crime_score), climateRisk: pct(d.normalized_climate_risk_score),
      riskScore: pct(riskScore(l)), maximumScore: pct(maxLocationScore(l)), priority: riskScore(l) >= .67 ? 'High Risk' : riskScore(l) >= .34 ? 'Moderate Risk' : 'Low Risk',
    }
  })
  return {
    title: 'Risk Assessment Report', subtitle: 'Population, crime, and climate-normalized environmental risk by location.', generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Avg Risk', value: pct(average(data.locations.map(riskScore))) },
      { label: 'High Risk', value: String(data.locations.filter((l) => riskScore(l) >= .67).length) },
      { label: 'Moderate Risk', value: String(data.locations.filter((l) => riskScore(l) >= .34 && riskScore(l) < .67).length) },
      { label: 'Low Risk', value: String(data.locations.filter((l) => riskScore(l) < .34).length) },
    ],
    chartData: data.locations.map((l) => ({ name: l.location_name, value: Math.round(riskScore(l) * 100), secondary: Math.round(maxLocationScore(l) * 100) })),
    sections: [{ title: 'Risk Factors', columns: [
      { key: 'agency', label: 'Agency' }, { key: 'location', label: 'Location' }, { key: 'machineId', label: 'WTN' },
      { key: 'zipPopulation', label: 'ZIP Population' }, { key: 'crimeRate', label: 'Crime Rate' }, { key: 'hardinessZone', label: 'Zone' },
      { key: 'populationRisk', label: 'Population Risk' }, { key: 'crimeRisk', label: 'Crime Risk' }, { key: 'climateRisk', label: 'Climate Risk' },
      { key: 'riskScore', label: 'Risk Score' }, { key: 'priority', label: 'Priority' },
    ], rows }],
  }
}

function buildCost(data: ReportingData): ReportModel {
  const machineRows = baseMachineRows(data)
  const defaultProductCost = 45
  const deliveryCost = 5
  const unitCost = defaultProductCost + deliveryCost
  const annualHoldingRate = .2
  const rows = machineRows.map((r) => {
    const requested = r.restockedUnits || r.dispensed
    const actual = r.restockedUnits
    const plannedCost = requested * unitCost
    const actualCost = actual * unitCost
    const averageInventory = r.capacity / 2
    const holdingCost = averageInventory * defaultProductCost * annualHoldingRate
    const serviceCost = r.restockVisits * 25
    return {
      agency: r.agency, location: r.location, machineId: r.machineId,
      requested, restocked: actual, plannedReplenishment: money(plannedCost), actualReplenishment: money(actualCost),
      annualHolding: money(holdingCost), serviceCost: money(serviceCost), totalCost: money(actualCost + holdingCost + serviceCost),
      costPerDispense: r.dispensed ? money((actualCost + holdingCost + serviceCost) / r.dispensed) : money(0),
    }
  })
  return {
    title: 'Cost Analysis Report', subtitle: 'Estimated replenishment, holding, service, and unit-delivery cost by machine.', generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Product Cost Assumption', value: money(defaultProductCost) },
      { label: 'Delivery Cost Assumption', value: money(deliveryCost) },
      { label: 'Unit Replenishment Cost', value: money(unitCost) },
      { label: 'Annual Holding Rate', value: pct(annualHoldingRate) },
    ],
    chartData: machineRows.map((r) => ({ name: r.location, value: r.restockedUnits * unitCost, secondary: r.restockVisits * 25 })),
    sections: [{ title: 'Estimated Cost by Machine', columns: [
      { key: 'agency', label: 'Agency' }, { key: 'location', label: 'Location' }, { key: 'machineId', label: 'WTN' },
      { key: 'requested', label: 'Requested' }, { key: 'restocked', label: 'Restocked' }, { key: 'plannedReplenishment', label: 'Planned Replenishment' },
      { key: 'actualReplenishment', label: 'Actual Replenishment' }, { key: 'annualHolding', label: 'Holding' },
      { key: 'serviceCost', label: 'Service' }, { key: 'totalCost', label: 'Total' }, { key: 'costPerDispense', label: 'Cost / Dispense' },
    ], rows }],
    notes: ['Cost estimates use adjustable default assumptions and should be replaced with validated program accounting inputs.'],
  }
}

function buildRecommendations(data: ReportingData): ReportModel {
  const rows = baseMachineRows(data).map((r) => {
    const l = data.locations.find((loc) => loc.machine_id === r.machineId)
    const access = l ? accessScore(l) : 0
    const risk = l ? riskScore(l) : 0
    const maxScore = l ? maxLocationScore(l) : 0
    const daily = r.firstActivity && r.lastActivity ? r.dispensed / daysBetween(r.firstActivity, r.lastActivity) : 0
    const actions: string[] = []
    if (access < .5) actions.push('Improve access or consider relocation')
    if (risk >= .67) actions.push('Add risk controls / service safeguards')
    if (r.stockouts > 0) actions.push('Increase safety stock or visit frequency')
    if (daily > 1 && r.capacity > 0) actions.push('Review capacity and PAR increase')
    if (daily < .1 && maxScore < .34) actions.push('Evaluate consolidation or relocation')
    if (!actions.length) actions.push('Maintain current configuration')
    return {
      agency: r.agency, location: r.location, machineId: r.machineId,
      accessibility: pct(access), risk: pct(risk), maximumScore: pct(maxScore), averagePerDay: daily.toFixed(3),
      stockouts: r.stockouts, restockVisits: r.restockVisits, recommendation: actions.join('; '), priority: actions.length > 1 ? 'High' : actions[0].startsWith('Maintain') ? 'Low' : 'Moderate',
    }
  })
  return {
    title: 'Optimization Recommendations', subtitle: 'Rule-based actions combining placement, demand, inventory, and service evidence.', generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'High Priority', value: String(rows.filter((r) => r.priority === 'High').length) },
      { label: 'Moderate Priority', value: String(rows.filter((r) => r.priority === 'Moderate').length) },
      { label: 'Maintain', value: String(rows.filter((r) => r.priority === 'Low').length) },
    ],
    sections: [{ title: 'Recommended Actions', columns: [
      { key: 'agency', label: 'Agency' }, { key: 'location', label: 'Location' }, { key: 'machineId', label: 'WTN' },
      { key: 'accessibility', label: 'Accessibility' }, { key: 'risk', label: 'Risk' }, { key: 'maximumScore', label: 'Maximum Score' },
      { key: 'averagePerDay', label: 'Avg / Day' }, { key: 'stockouts', label: 'Stockouts' }, { key: 'priority', label: 'Priority' },
      { key: 'recommendation', label: 'Recommendation' },
    ], rows }],
    notes: ['Recommendations are decision-support rules, not causal conclusions. Validate with field context before implementation.'],
  }
}

function buildSimulation(data: ReportingData): ReportModel {
  const base = buildExecutive(data)
  const currentMachines = data.machines.length
  const currentDispensed = baseMachineRows(data).reduce((s, r) => s + r.dispensed, 0)
  const currentStockouts = baseMachineRows(data).reduce((s, r) => s + r.stockouts, 0)
  const rows = [
    { scenario: 'Current Network', machines: currentMachines, capacityChange: '0%', staffingChange: '0%', projectedDemandMet: '100%', projectedStockouts: currentStockouts, projectedCostIndex: '100' },
    { scenario: '+5 Machines', machines: currentMachines + 5, capacityChange: '+4%', staffingChange: '+8%', projectedDemandMet: '108%', projectedStockouts: Math.max(0, Math.round(currentStockouts * .8)), projectedCostIndex: '112' },
    { scenario: '+10% PAR', machines: currentMachines, capacityChange: '+10%', staffingChange: '+5%', projectedDemandMet: '103%', projectedStockouts: Math.max(0, Math.round(currentStockouts * .7)), projectedCostIndex: '106' },
    { scenario: '+1 Technician Resource', machines: currentMachines, capacityChange: '0%', staffingChange: '+1 resource', projectedDemandMet: '101%', projectedStockouts: Math.max(0, Math.round(currentStockouts * .85)), projectedCostIndex: '104' },
    { scenario: 'Risk-Adjusted Relocation', machines: currentMachines, capacityChange: '0%', staffingChange: '0%', projectedDemandMet: '105%', projectedStockouts: Math.max(0, Math.round(currentStockouts * .9)), projectedCostIndex: '102' },
  ]
  return {
    title: 'Scenario Simulation Report', subtitle: 'Illustrative what-if comparisons for network, inventory, and service decisions.', generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Baseline Machines', value: String(currentMachines) }, { label: 'Baseline Dispensed', value: currentDispensed.toLocaleString() },
      { label: 'Baseline Stockouts', value: currentStockouts.toLocaleString() }, { label: 'Scenarios', value: String(rows.length) },
    ],
    chartData: rows.map((r) => ({ name: r.scenario, value: num(r.projectedDemandMet), secondary: num(r.projectedCostIndex) })),
    sections: [{ title: 'Scenario Comparison', columns: [
      { key: 'scenario', label: 'Scenario' }, { key: 'machines', label: 'Machines' }, { key: 'capacityChange', label: 'Capacity Change' },
      { key: 'staffingChange', label: 'Staffing Change' }, { key: 'projectedDemandMet', label: 'Demand Met Index' },
      { key: 'projectedStockouts', label: 'Projected Stockouts' }, { key: 'projectedCostIndex', label: 'Cost Index' },
    ], rows }],
    notes: ['Scenario outputs are transparent planning estimates. Replace coefficients with calibrated model results as the dissertation optimization model is finalized.'],
  }
}

function buildDissertation(data: ReportingData): ReportModel {
  const machineRows = baseMachineRows(data)
  const rows = data.locations.map((l) => {
    const m = machineForLocation(data, l)
    const base = machineRows.find((r) => r.machineId === l.machine_id)
    const a = asArray(l.location_access_scores)[0] || {}
    const d = asArray(l.location_demographics)[0] || {}
    return {
      location_uuid: l.id, machine_uuid: m?.id || '', machine_wtn_id: l.machine_id, agency: l.agency, location_name: l.location_name,
      urban_rural: urbanRural(l), latitude: l.latitude, longitude: l.longitude,
      public_access_score: num(a.public_access_score), physical_access_score: num(a.physical_access_score), temporal_access_score: num(a.temporal_access_score),
      visibility_score: num(a.visibility_score), accessibility_score: accessScore(l), zip_population: num(d.zip_population), crime_rate: num(d.zip_crime_rate),
      hardiness_zone: num(d.usda_hardiness_zone), risk_score: riskScore(l), maximum_location_score: maxLocationScore(l),
      machine_capacity: base?.capacity || 0, planogram_selections: base?.selections || 0, total_events: base?.events || 0,
      units_dispensed: base?.dispensed || 0, failed_events: base?.failed || 0, stockout_events: base?.stockouts || 0,
      restock_visits: base?.restockVisits || 0, units_restocked: base?.restockedUnits || 0, technician_count: base?.technicianCount || 0,
      first_activity: base?.firstActivity || '', last_activity: base?.lastActivity || '',
    }
  })
  return {
    title: 'Dissertation Dataset & Codebook', subtitle: 'Analysis-ready location-machine panel containing placement, demand, inventory, and service variables.', generatedAt: new Date().toISOString(),
    kpis: [
      { label: 'Observations', value: String(rows.length) }, { label: 'Variables', value: String(Object.keys(rows[0] || {}).length) },
      { label: 'Machines with Events', value: String(rows.filter((r) => r.total_events > 0).length) }, { label: 'Machines with Restocks', value: String(rows.filter((r) => r.restock_visits > 0).length) },
    ],
    sections: [
      { title: 'Research Dataset', columns: Object.keys(rows[0] || {}).map((key) => ({ key, label: key })), rows },
      { title: 'Variable Dictionary', columns: [{ key: 'variable', label: 'Variable' }, { key: 'domain', label: 'Domain' }, { key: 'definition', label: 'Definition' }], rows: [
        { variable: 'accessibility_score', domain: 'Placement & Access', definition: 'Weighted public, physical, temporal, and visibility access score.' },
        { variable: 'risk_score', domain: 'Placement & Access', definition: 'Weighted normalized population, crime, and climate risk.' },
        { variable: 'maximum_location_score', domain: 'Placement & Access', definition: 'Accessibility score less the risk-adjustment coefficient.' },
        { variable: 'units_dispensed', domain: 'Inventory Availability', definition: 'Successful units dispensed from machine event logs.' },
        { variable: 'stockout_events', domain: 'Inventory Availability', definition: 'Observed out-of-stock or stockout-related machine events.' },
        { variable: 'restock_visits', domain: 'Service Capacity', definition: 'Distinct observed restocking service visits.' },
        { variable: 'technician_count', domain: 'Service Capacity', definition: 'Distinct anonymous technician resources servicing the machine.' },
      ] },
    ],
  }
}

export function buildReport(key: ReportKey, rawData: ReportingData, filters: ReportFilters): ReportModel {
  const data = filtered(rawData, filters)
  switch (key) {
    case 'executive': return buildExecutive(data)
    case 'location': return buildLocation(data)
    case 'machine': return buildMachine(data)
    case 'inventory': return buildInventory(data)
    case 'staffing': return buildStaffing(data)
    case 'demand': return buildDemand(data, filters)
    case 'accessibility': return buildAccessibility(data)
    case 'risk': return buildRisk(data)
    case 'cost': return buildCost(data)
    case 'recommendations': return buildRecommendations(data)
    case 'simulation': return buildSimulation(data)
    case 'dissertation': return buildDissertation(data)
  }
}

export const reportDefinitions: { key: ReportKey; label: string; group: string; description: string }[] = [
  { key: 'executive', label: 'Executive Summary', group: 'Program', description: 'Network-wide program performance.' },
  { key: 'location', label: 'Location Evaluation', group: 'Placement & Access', description: 'Location scorecards and recommendations.' },
  { key: 'accessibility', label: 'Accessibility Analysis', group: 'Placement & Access', description: 'Access components and gaps.' },
  { key: 'risk', label: 'Risk Assessment', group: 'Placement & Access', description: 'Environmental risk factors and ranking.' },
  { key: 'machine', label: 'Machine Performance', group: 'Inventory Availability', description: 'Utilization, failures, and stockouts.' },
  { key: 'inventory', label: 'Inventory Optimization', group: 'Inventory Availability', description: 'Planogram, PAR, and capacity policy.' },
  { key: 'demand', label: 'Demand Analysis', group: 'Inventory Availability', description: 'Observed demand and daily utilization.' },
  { key: 'staffing', label: 'Staffing Analysis', group: 'Service Capacity', description: 'Workload, resource count, and visits.' },
  { key: 'cost', label: 'Cost Analysis', group: 'Model & Evaluation', description: 'Replenishment, holding, and service costs.' },
  { key: 'recommendations', label: 'Optimization Recommendations', group: 'Model & Evaluation', description: 'Cross-domain decision actions.' },
  { key: 'simulation', label: 'Scenario Simulation', group: 'Model & Evaluation', description: 'What-if network comparisons.' },
  { key: 'dissertation', label: 'Dissertation Export', group: 'Research', description: 'Analysis-ready dataset and codebook.' },
]
