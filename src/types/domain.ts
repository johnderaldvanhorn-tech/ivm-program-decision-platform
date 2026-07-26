export type ScoreWeights = { publicAccess: number; physicalAccess: number; temporalAccess: number; visibility: number }
export type RiskWeights = { population: number; crime: number; climate: number }
export type LocationFormData = {
  machineId: string; agency: string; locationName: string; address: string; city: string; state: string; zip: string;
  latitude: number | ''; longitude: number | ''; contactName: string; contactPhone: string; contactEmail: string;
  machineStatus: 'Planned'|'Active'|'Inactive'|'Removed'; clusterId: string; populationServed: number; availabilityTier: 'High'|'Low';
  publicAccessScore: number; physicalAccessScore: number; accessibleHoursPerWeek: number; visibilityScore: number;
  housingUnitDensity: number; populationDensity: number; contiguousHousingUnits: number; contiguousPopulation: number;
  zipPopulation: number; zipCrimeRate: number; usdaHardinessZone: number;
}
