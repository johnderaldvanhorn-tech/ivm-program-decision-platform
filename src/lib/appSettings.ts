export type ParameterDefinition = {
  name: string
  label: string
  group: string
  description: string
  defaultValue: number
  min?: number
  max?: number
  step?: number
  format?: 'number' | 'percent' | 'currency' | 'hours' | 'days'
}

export type ScoreMappingDefinition = {
  mappingGroup: string
  categoryKey: string
  categoryLabel: string
  defaultScore: number
  sortOrder: number
}

export type LocalPreferences = {
  agenciesCollapsedByDefault: boolean
  defaultLocationView: 'table' | 'map'
  defaultMapMetric: 'maximum' | 'accessibility' | 'risk'
  defaultProductFilter: 'all' | 'narcan'
  dateFormat: 'MM/DD/YYYY' | 'YYYY-MM-DD'
  tableDensity: 'compact' | 'comfortable'
  pageSize: number
  rememberImportMappings: boolean
  showDemoDataWhenEmpty: boolean
}

export const PARAMETER_DEFINITIONS: ParameterDefinition[] = [
  { name: 'accessibility_public_weight', label: 'Public Access Weight', group: 'Accessibility', description: 'Contribution of public access to the Machine Accessibility Score.', defaultValue: 0.35, min: 0, max: 1, step: 0.01, format: 'percent' },
  { name: 'accessibility_physical_weight', label: 'Physical Access Weight', group: 'Accessibility', description: 'Contribution of physical access to the Machine Accessibility Score.', defaultValue: 0.25, min: 0, max: 1, step: 0.01, format: 'percent' },
  { name: 'accessibility_temporal_weight', label: 'Temporal Access Weight', group: 'Accessibility', description: 'Contribution of accessible hours to the Machine Accessibility Score.', defaultValue: 0.20, min: 0, max: 1, step: 0.01, format: 'percent' },
  { name: 'accessibility_visibility_weight', label: 'Visibility Weight', group: 'Accessibility', description: 'Contribution of visibility to the Machine Accessibility Score.', defaultValue: 0.20, min: 0, max: 1, step: 0.01, format: 'percent' },
  { name: 'risk_population_weight', label: 'Population Risk Weight', group: 'Risk', description: 'Contribution of normalized ZIP population to risk.', defaultValue: 0.30, min: 0, max: 1, step: 0.01, format: 'percent' },
  { name: 'risk_crime_weight', label: 'Crime Risk Weight', group: 'Risk', description: 'Contribution of normalized crime rate to risk.', defaultValue: 0.50, min: 0, max: 1, step: 0.01, format: 'percent' },
  { name: 'risk_climate_weight', label: 'Climate Risk Weight', group: 'Risk', description: 'Contribution of hardiness-zone deviation to risk.', defaultValue: 0.20, min: 0, max: 1, step: 0.01, format: 'percent' },
  { name: 'maximum_location_risk_coefficient', label: 'Maximum Location Risk Coefficient', group: 'Risk', description: 'Multiplier applied to risk before subtracting it from accessibility.', defaultValue: 1, min: 0, max: 5, step: 0.05 },
  { name: 'risk_population_min', label: 'Population Minimum', group: 'Risk Normalization', description: 'Dataset minimum used to normalize ZIP population.', defaultValue: 0, min: 0, step: 1 },
  { name: 'risk_population_max', label: 'Population Maximum', group: 'Risk Normalization', description: 'Dataset maximum used to normalize ZIP population.', defaultValue: 100000, min: 1, step: 1 },
  { name: 'risk_crime_min', label: 'Crime Minimum', group: 'Risk Normalization', description: 'Dataset minimum used to normalize crime.', defaultValue: 0, min: 0, step: 0.1 },
  { name: 'risk_crime_max', label: 'Crime Maximum', group: 'Risk Normalization', description: 'Dataset maximum used to normalize crime.', defaultValue: 100, min: 0.1, step: 0.1 },
  { name: 'risk_zone_min', label: 'Hardiness Zone Minimum', group: 'Risk Normalization', description: 'Lowest USDA zone in the program dataset.', defaultValue: 1, min: 0, step: 0.5 },
  { name: 'risk_zone_max', label: 'Hardiness Zone Maximum', group: 'Risk Normalization', description: 'Highest USDA zone in the program dataset.', defaultValue: 13, min: 0, step: 0.5 },
  { name: 'risk_zone_mid', label: 'Hardiness Zone Midpoint', group: 'Risk Normalization', description: 'Reference zone used to measure climate deviation.', defaultValue: 7, min: 0, step: 0.5 },
  { name: 'score_green_threshold', label: 'Green Score Threshold', group: 'Score Thresholds', description: 'Minimum favorable score shown as green.', defaultValue: 0.67, min: 0, max: 1, step: 0.01, format: 'percent' },
  { name: 'score_yellow_threshold', label: 'Yellow Score Threshold', group: 'Score Thresholds', description: 'Minimum review score shown as yellow.', defaultValue: 0.34, min: 0, max: 1, step: 0.01, format: 'percent' },
  { name: 'stockout_penalty_multiplier', label: 'Stockout Penalty Multiplier', group: 'Inventory', description: 'Default stockout penalty as a multiple of replenishment cost.', defaultValue: 10, min: 0, step: 0.5 },
  { name: 'inventory_watch_capacity_percent', label: 'Inventory Watch Threshold', group: 'Inventory', description: 'Capacity percentage at or below which inventory enters Watch status.', defaultValue: 0.20, min: 0, max: 1, step: 0.01, format: 'percent' },
  { name: 'safety_stock_service_level', label: 'Target Service Level', group: 'Safety Stock', description: 'Default target service level used in safety-stock analysis.', defaultValue: 0.95, min: 0.5, max: 0.999, step: 0.005, format: 'percent' },
  { name: 'safety_stock_default_lead_time_days', label: 'Default Lead Time', group: 'Safety Stock', description: 'Fallback replenishment lead time when observed history is unavailable.', defaultValue: 7, min: 0, step: 0.5, format: 'days' },
  { name: 'safety_stock_review_period_days', label: 'Review Period', group: 'Safety Stock', description: 'Default inventory review interval.', defaultValue: 7, min: 1, step: 1, format: 'days' },
  { name: 'safety_stock_warning_units', label: 'Low Safety Stock Warning', group: 'Safety Stock', description: 'Safety-stock value at or below which a review warning is shown.', defaultValue: 5, min: 0, step: 1 },
  { name: 'staffing_base_visit_hours', label: 'Base Visit Time', group: 'Staffing', description: 'Fixed service time assigned to each restock visit.', defaultValue: 0.25, min: 0, step: 0.01, format: 'hours' },
  { name: 'staffing_hours_per_unit', label: 'Hours per Unit', group: 'Staffing', description: 'Incremental service time for each unit replenished.', defaultValue: 0.003, min: 0, step: 0.001, format: 'hours' },
  { name: 'staffing_hours_per_selection', label: 'Hours per Selection', group: 'Staffing', description: 'Incremental service time for each selection serviced.', defaultValue: 0.02, min: 0, step: 0.005, format: 'hours' },
  { name: 'staffing_default_weekly_hours', label: 'Default Weekly Hours', group: 'Staffing', description: 'Available weekly hours for a technician resource.', defaultValue: 40, min: 0, step: 1, format: 'hours' },
  { name: 'demand_default_product_cost', label: 'Default Product Cost', group: 'Demand & Cost', description: 'Default acquisition cost per replenished unit.', defaultValue: 45, min: 0, step: 0.01, format: 'currency' },
  { name: 'demand_default_delivery_cost', label: 'Default Delivery Cost', group: 'Demand & Cost', description: 'Default delivery cost allocated to each replenished unit.', defaultValue: 5, min: 0, step: 0.01, format: 'currency' },
  { name: 'demand_annual_holding_rate', label: 'Annual Holding Rate', group: 'Demand & Cost', description: 'Annual inventory holding-cost percentage.', defaultValue: 0.20, min: 0, max: 2, step: 0.01, format: 'percent' },
  { name: 'demand_unmet_penalty', label: 'Unmet Demand Penalty', group: 'Demand & Cost', description: 'Default cost assigned to each unit of unmet demand.', defaultValue: 500, min: 0, step: 1, format: 'currency' },
]

export const SCORE_MAPPING_DEFAULTS: ScoreMappingDefinition[] = [
  { mappingGroup: 'availability', categoryKey: 'high', categoryLabel: 'High', defaultScore: 1, sortOrder: 1 },
  { mappingGroup: 'availability', categoryKey: 'low', categoryLabel: 'Low', defaultScore: 0.6, sortOrder: 2 },
  { mappingGroup: 'public_access', categoryKey: 'fully_public', categoryLabel: 'Fully public, ungated, no badge, no fee', defaultScore: 1, sortOrder: 1 },
  { mappingGroup: 'public_access', categoryKey: 'time_limited', categoryLabel: 'Public but time-limited', defaultScore: 0.8, sortOrder: 2 },
  { mappingGroup: 'public_access', categoryKey: 'semi_public', categoryLabel: 'Semi-public, controlled entry', defaultScore: 0.5, sortOrder: 3 },
  { mappingGroup: 'public_access', categoryKey: 'private', categoryLabel: 'Private/gated, residents/employees only', defaultScore: 0.2, sortOrder: 4 },
  { mappingGroup: 'public_access', categoryKey: 'restricted', categoryLabel: 'Highly restricted', defaultScore: 0, sortOrder: 5 },
  { mappingGroup: 'physical_access', categoryKey: 'indoor_step_free', categoryLabel: 'Indoor, step-free, near main circulation path', defaultScore: 1, sortOrder: 1 },
  { mappingGroup: 'physical_access', categoryKey: 'outdoor_step_free', categoryLabel: 'Outdoor, weather-exposed but step-free and near path', defaultScore: 0.8, sortOrder: 2 },
  { mappingGroup: 'physical_access', categoryKey: 'minor_barriers', categoryLabel: 'Indoor/outdoor with minor barriers', defaultScore: 0.5, sortOrder: 3 },
  { mappingGroup: 'physical_access', categoryKey: 'significant_barriers', categoryLabel: 'Significant barriers', defaultScore: 0.2, sortOrder: 4 },
  { mappingGroup: 'physical_access', categoryKey: 'inaccessible', categoryLabel: 'Practically inaccessible', defaultScore: 0, sortOrder: 5 },
  { mappingGroup: 'visibility', categoryKey: 'high', categoryLabel: 'High visibility', defaultScore: 1, sortOrder: 1 },
  { mappingGroup: 'visibility', categoryKey: 'moderate', categoryLabel: 'Moderate visibility', defaultScore: 0.6, sortOrder: 2 },
  { mappingGroup: 'visibility', categoryKey: 'low', categoryLabel: 'Low visibility', defaultScore: 0.3, sortOrder: 3 },
  { mappingGroup: 'visibility', categoryKey: 'hidden', categoryLabel: 'Hidden', defaultScore: 0, sortOrder: 4 },
]

export const DEFAULT_LOCAL_PREFERENCES: LocalPreferences = {
  agenciesCollapsedByDefault: true,
  defaultLocationView: 'table',
  defaultMapMetric: 'maximum',
  defaultProductFilter: 'all',
  dateFormat: 'MM/DD/YYYY',
  tableDensity: 'compact',
  pageSize: 50,
  rememberImportMappings: true,
  showDemoDataWhenEmpty: false,
}

export const LOCAL_PREFERENCES_KEY = 'ivm-local-preferences'

export function loadLocalPreferences(): LocalPreferences {
  try {
    const raw = localStorage.getItem(LOCAL_PREFERENCES_KEY)
    return raw ? { ...DEFAULT_LOCAL_PREFERENCES, ...JSON.parse(raw) } : { ...DEFAULT_LOCAL_PREFERENCES }
  } catch {
    return { ...DEFAULT_LOCAL_PREFERENCES }
  }
}

export function saveLocalPreferences(value: LocalPreferences) {
  localStorage.setItem(LOCAL_PREFERENCES_KEY, JSON.stringify(value))
}

export function defaultParameterValues(): Record<string, number> {
  return Object.fromEntries(PARAMETER_DEFINITIONS.map((item) => [item.name, item.defaultValue]))
}
