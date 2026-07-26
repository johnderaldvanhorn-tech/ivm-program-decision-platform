import { supabase } from './supabase'

export type Phase2Machine = {
  machine_uuid: string
  machine_wtn_id: string
  agency: string
  location_name: string
  accessibility_score: number
  risk_score: number
  maximum_location_score: number
  capacity: number
  current_quantity: number
  par_level: number
  units_dispensed: number
  stockouts: number
  first_activity: string | null
  last_activity: string | null
}

export type Recommendation = {
  id?: string
  machine_uuid?: string | null
  machine_wtn_id?: string | null
  domain: 'location'|'inventory'|'safety_stock'|'staffing'|'joint'
  priority: 'Critical'|'High'|'Medium'|'Low'
  title: string
  rationale: string
  current_value?: number | null
  recommended_value?: number | null
  expected_availability_gain?: number | null
  expected_cost_change?: number | null
  confidence?: number | null
  status?: 'Proposed'|'Approved'|'Rejected'|'Deferred'|'Implemented'
}

const n=(v:unknown)=>Number(v||0)

export async function loadPhase2Machines(): Promise<Phase2Machine[]> {
  if(!supabase) return []
  const [{data:locations},{data:machines},{data:planogram},{data:logs}] = await Promise.all([
    supabase.from('locations').select('id,machine_id,agency,location_name'),
    supabase.from('machines').select('id,machine_id,location_id'),
    supabase.from('machine_planogram_items').select('machine_uuid,max_level,current_quantity,par_level'),
    supabase.rpc('get_machine_log_machine_summary'),
  ])
  const locById=new Map((locations||[]).map((x:any)=>[x.id,x]))
  const planByMachine=new Map<string,{capacity:number;current:number;par:number}>()
  for(const row of planogram||[]){
    const key=(row as any).machine_uuid
    const cur=planByMachine.get(key)||{capacity:0,current:0,par:0}
    cur.capacity+=n((row as any).max_level);cur.current+=n((row as any).current_quantity);cur.par+=n((row as any).par_level)
    planByMachine.set(key,cur)
  }
  const logByWtn=new Map((logs||[]).map((x:any)=>[x.machine_id,x]))
  return (machines||[]).map((m:any)=>{
    const l=locById.get(m.location_id) as any
    const p=planByMachine.get(m.id)||{capacity:0,current:0,par:0}
    const g:any=logByWtn.get(m.machine_id)||{}
    return {machine_uuid:m.id,machine_wtn_id:m.machine_id,agency:l?.agency||'Unassigned',location_name:l?.location_name||g.source_name||m.machine_id,accessibility_score:0,risk_score:0,maximum_location_score:0,capacity:p.capacity,current_quantity:p.current,par_level:p.par,units_dispensed:n(g.dispensed),stockouts:n(g.stockouts),first_activity:g.first_activity||null,last_activity:g.last_activity||null}
  })
}

export function buildRecommendations(machines:Phase2Machine[]): Recommendation[] {
  const out:Recommendation[]=[]
  for(const m of machines){
    const fill=m.capacity>0?m.current_quantity/m.capacity:0
    if(m.capacity>0&&fill<.25) out.push({machine_uuid:m.machine_uuid,machine_wtn_id:m.machine_wtn_id,domain:'inventory',priority:fill<.1?'Critical':'High',title:'Increase inventory immediately',rationale:`${m.location_name} is ${(fill*100).toFixed(0)}% stocked.`,current_value:m.current_quantity,recommended_value:Math.max(m.par_level,Math.ceil(m.capacity*.75)),expected_availability_gain:Math.min(30,(.75-fill)*40),expected_cost_change:0,confidence:88,status:'Proposed'})
    if(m.stockouts>0) out.push({machine_uuid:m.machine_uuid,machine_wtn_id:m.machine_wtn_id,domain:'safety_stock',priority:m.stockouts>20?'Critical':'High',title:'Raise safety stock buffer',rationale:`${m.stockouts} stockout events were observed.`,current_value:0,recommended_value:Math.max(3,Math.ceil(m.units_dispensed/365*7)),expected_availability_gain:Math.min(25,m.stockouts*.5),expected_cost_change:0,confidence:84,status:'Proposed'})
    if(m.capacity>0&&m.par_level>m.capacity) out.push({machine_uuid:m.machine_uuid,machine_wtn_id:m.machine_wtn_id,domain:'inventory',priority:'Medium',title:'Correct PAR above capacity',rationale:'Configured PAR exceeds physical machine capacity.',current_value:m.par_level,recommended_value:m.capacity,expected_availability_gain:0,expected_cost_change:0,confidence:99,status:'Proposed'})
  }
  return out
}

export async function saveRecommendations(rows:Recommendation[]){
  if(!supabase||!rows.length)return
  await supabase.from('optimization_recommendations').upsert(rows.map(r=>({...r,updated_at:new Date().toISOString()})),{onConflict:'machine_uuid,domain,title'})
}
