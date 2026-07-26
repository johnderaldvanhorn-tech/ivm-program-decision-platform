import type { RiskWeights, ScoreWeights } from '../types/domain'
export const clamp = (value:number, min=0, max=1) => Math.min(max, Math.max(min, value))
export const temporalAccessScore = (hours:number) => clamp(hours / 168)
export function calculateAccessibilityScore(scores:{publicAccess:number;physicalAccess:number;hours:number;visibility:number}, weights:ScoreWeights) {
  return clamp(weights.publicAccess*scores.publicAccess + weights.physicalAccess*scores.physicalAccess + weights.temporalAccess*temporalAccessScore(scores.hours) + weights.visibility*scores.visibility)
}
export function classifyUrbanRural(v:{populationDensity:number}) {
  // Simplified location workflow: classify using population density only.
  return v.populationDensity >= 1000 ? 'Urban' : 'Rural'
}
export const normalize = (value:number,min:number,max:number) => max === min ? 0 : clamp((value-min)/(max-min))
export function calculateRiskScore(values:{population:number;crime:number;zone:number}, ranges:{populationMin:number;populationMax:number;crimeMin:number;crimeMax:number;zoneMin:number;zoneMax:number;zoneMid:number}, weights:RiskWeights) {
  const p = normalize(values.population,ranges.populationMin,ranges.populationMax)
  const c = normalize(values.crime,ranges.crimeMin,ranges.crimeMax)
  const denominator = Math.abs(ranges.zoneMax-ranges.zoneMid)
  const t = denominator === 0 ? 0 : clamp(Math.abs(values.zone-ranges.zoneMid)/denominator)
  return { normalizedPopulation:p, normalizedCrime:c, normalizedClimate:t, riskScore:clamp(weights.population*p+weights.crime*c+weights.climate*t) }
}
export const calculateMaximumLocationScore = (accessibility:number,risk:number,coefficient=1) => accessibility-(coefficient*risk)
export function calculateInventory(v:{priorInventory:number;replenished:number;dispensed:number;demand:number;capacity:number;supplierReliability:number;maxOrderable:number;costPerUnit:number;holdingCost:number;stockoutPenalty?:number}) {
  const maxReliableOrder = Math.floor(v.supplierReliability*v.maxOrderable)
  const acceptedReplenishment = Math.min(v.replenished,maxReliableOrder)
  const available = v.priorInventory+acceptedReplenishment
  const dispensed = Math.min(v.dispensed,available,v.demand)
  const unmetDemand = Math.max(0,v.demand-dispensed)
  const endingInventory = Math.min(v.capacity,Math.max(0,available-dispensed))
  const penalty = v.stockoutPenalty ?? 10*v.costPerUnit
  const totalCost = acceptedReplenishment*v.costPerUnit + endingInventory*v.holdingCost + unmetDemand*penalty
  const status = endingInventory === 0 ? 'Stockout' : unmetDemand > 0 ? 'Restock Required' : endingInventory <= Math.max(5,v.capacity*.2) ? 'Watch' : 'Healthy'
  return {acceptedReplenishment,dispensed,unmetDemand,endingInventory,totalCost,status}
}
export function calculateSafetyStock(v:{capacity:number;currentInventory:number;demandRate:number;leadTimeDays:number;safetyStock:number}) {
  const reorderPoint=v.demandRate*v.leadTimeDays+v.safetyStock
  const baseStockLevel=reorderPoint
  const optimalFillQuantity=Math.max(0,v.capacity-v.currentInventory)
  const orderQuantity=Math.max(0,Math.min(optimalFillQuantity,baseStockLevel-v.currentInventory))
  return {reorderPoint,baseStockLevel,optimalFillQuantity,orderQuantity,restockTrigger:v.currentInventory<=reorderPoint?'Place order':'No order',safetyStockFlag:v.safetyStock<=5?'Review: safety stock at or under 5 units':'Ready'}
}
export function calculateStaffingFeasibility(v:{qualified:boolean;locationSafe:boolean;clusterMatch:boolean;currentWorkload:number;taskHours:number;maxHours:number;assignedTaskCount:number;requiredFrequency:number}) {
  const feasible=v.qualified&&v.locationSafe&&v.clusterMatch
  const workload=v.currentWorkload+(feasible?v.taskHours:0)
  return {feasible,feasibilityStatus:feasible?'Feasible':'Blocked',workload,capacityStatus:workload<=v.maxHours?'Pass':'Over Capacity',coverageStatus:v.assignedTaskCount>=v.requiredFrequency?'Pass':'Gap'}
}
