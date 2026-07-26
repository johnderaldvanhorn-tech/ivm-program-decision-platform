import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Calculator, Save, RotateCcw } from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { Card, Field, inputClass, Badge } from '../components/ui'
import { supabase } from '../lib/supabase'

type Machine = { id:string; machine_id:string; location_id:string; locations?: { agency?:string|null; location_name?:string|null; city?:string|null; state?:string|null } | null }
type Summary = { capacity:number; selection_count:number; successful_transactions:number; dispensed_units:number; requested_from_logs:number; restocked_from_logs:number; stockout_events:number; evaluation_days:number; first_activity:string|null; last_activity:string|null }
type Selection = { selection_number:string; product_name:string; item_number:string; capacity:number; critical_level:number; low_level:number; par_level:number; dispensed_units:number; requested_units:number; restocked_units:number; stockout_events:number }
type Params = { product_cost:number; delivery_cost:number; annual_holding_rate:number; unmet_demand_penalty:number; requested_quantity_override:string; restocked_quantity_override:string; average_inventory_override:string }

const defaults: Params = { product_cost:45, delivery_cost:5, annual_holding_rate:0.20, unmet_demand_penalty:500, requested_quantity_override:'', restocked_quantity_override:'', average_inventory_override:'' }
const money = (value:number) => new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(Number.isFinite(value)?value:0)
const num = (value:unknown) => Number(value || 0)
const today = new Date().toISOString().slice(0,10)
const oneYearAgo = new Date(Date.now()-365*86400000).toISOString().slice(0,10)

export default function DemandEvaluation(){
  const { machineId } = useParams()
  const [machine,setMachine]=useState<Machine|null>(null)
  const [products,setProducts]=useState<string[]>([])
  const [productFilter,setProductFilter]=useState('All Products')
  const [startDate,setStartDate]=useState(oneYearAgo)
  const [endDate,setEndDate]=useState(today)
  const [summary,setSummary]=useState<Summary|null>(null)
  const [selections,setSelections]=useState<Selection[]>([])
  const [params,setParams]=useState<Params>(defaults)
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  async function loadMachine(){
    if(!supabase||!machineId)return
    const [{data:m,error:me},{data:p,error:pe}] = await Promise.all([
      supabase.from('machines').select('id,machine_id,location_id,locations(agency,location_name,city,state)').eq('id',machineId).single(),
      supabase.from('machine_planogram_items').select('product_name').eq('machine_uuid',machineId).order('product_name'),
    ])
    if(me||pe){setMessage(me?.message||pe?.message||'Unable to load machine.');return}
    setMachine(m as Machine)
    const unique=[...new Set((p||[]).map((row:any)=>String(row.product_name||'').trim()).filter(Boolean))]
    const grouped = unique.some((product) => product.toLowerCase().includes('narcan')) ? ['Narcan', ...unique] : unique
    setProducts([...new Set(grouped)])
  }

  async function loadEvaluation(){
    if(!supabase||!machineId)return
    setLoading(true); setMessage('')
    const [{data:s,error:se},{data:rows,error:re},{data:saved,error:pe}] = await Promise.all([
      supabase.rpc('get_demand_evaluation_summary',{p_machine_uuid:machineId,p_product_filter:productFilter,p_start_date:startDate||null,p_end_date:endDate||null}),
      supabase.rpc('get_demand_evaluation_selection_summary',{p_machine_uuid:machineId,p_product_filter:productFilter,p_start_date:startDate||null,p_end_date:endDate||null}),
      supabase.from('demand_evaluation_parameters').select('*').eq('machine_uuid',machineId).eq('product_filter',productFilter).maybeSingle(),
    ])
    const error=se||re||pe
    if(error){setMessage(error.message);setLoading(false);return}
    setSummary(((s||[])[0]||null) as Summary|null)
    setSelections((rows||[]) as Selection[])
    if(saved)setParams({product_cost:num(saved.product_cost),delivery_cost:num(saved.delivery_cost),annual_holding_rate:num(saved.annual_holding_rate),unmet_demand_penalty:num(saved.unmet_demand_penalty),requested_quantity_override:saved.requested_quantity_override==null?'':String(saved.requested_quantity_override),restocked_quantity_override:saved.restocked_quantity_override==null?'':String(saved.restocked_quantity_override),average_inventory_override:saved.average_inventory_override==null?'':String(saved.average_inventory_override)})
    else setParams(defaults)
    setLoading(false)
  }

  useEffect(()=>{void loadMachine()},[machineId])
  useEffect(()=>{void loadEvaluation()},[machineId,productFilter,startDate,endDate])

  const calculations=useMemo(()=>{
    const s=summary||{capacity:0,selection_count:0,successful_transactions:0,dispensed_units:0,requested_from_logs:0,restocked_from_logs:0,stockout_events:0,evaluation_days:1,first_activity:null,last_activity:null}
    const requested=params.requested_quantity_override===''?num(s.requested_from_logs):num(params.requested_quantity_override)
    const restocked=params.restocked_quantity_override===''?num(s.restocked_from_logs):num(params.restocked_quantity_override)
    const cQ=params.product_cost+params.delivery_cost
    const dailyHolding=params.product_cost*params.annual_holding_rate/365
    const roundedDailyHolding=Math.round(dailyHolding*100)/100
    const averageInventory=params.average_inventory_override===''?num(s.capacity)/2:num(params.average_inventory_override)
    const holdingCost=requested*roundedDailyHolding
    const plannedCost=requested*cQ
    const actualCost=restocked*cQ
    const fillRate=requested>0?restocked/requested:0
    const avgTransactions=num(s.successful_transactions)/Math.max(1,num(s.evaluation_days))
    const avgUnits=num(s.dispensed_units)/Math.max(1,num(s.evaluation_days))
    const unmet=Math.max(num(s.stockout_events),requested-restocked,0)
    const unmetCost=unmet*params.unmet_demand_penalty
    return {requested,restocked,cQ,dailyHolding,roundedDailyHolding,averageInventory,holdingCost,plannedCost,actualCost,fillRate,avgTransactions,avgUnits,unmet,unmetCost,totalCost:holdingCost+actualCost+unmetCost}
  },[summary,params])

  async function save(){
    if(!supabase||!machineId)return
    const payload={machine_id:machineId,machine_uuid:machineId,machine_wtn_id:machine?.machine_id||null,product_filter:productFilter,product_cost:params.product_cost,delivery_cost:params.delivery_cost,annual_holding_rate:params.annual_holding_rate,unmet_demand_penalty:params.unmet_demand_penalty,evaluation_start_date:startDate||null,evaluation_end_date:endDate||null,requested_quantity_override:params.requested_quantity_override===''?null:num(params.requested_quantity_override),restocked_quantity_override:params.restocked_quantity_override===''?null:num(params.restocked_quantity_override),average_inventory_override:params.average_inventory_override===''?null:num(params.average_inventory_override),updated_at:new Date().toISOString()}
    const {error}=await supabase.from('demand_evaluation_parameters').upsert(payload,{onConflict:'machine_uuid,product_filter'})
    setMessage(error?error.message:'Demand evaluation assumptions saved.')
  }
  function update<K extends keyof Params>(key:K,value:Params[K]){setParams(current=>({...current,[key]:value}))}

  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><Link to={`/machines/${machineId}`} className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-blue-700"><ArrowLeft size={16}/>Back to Machine</Link><h1 className="text-2xl font-bold">Demand Evaluation</h1><p className="text-slate-500">Evaluate product demand, replenishment performance, holding cost, and unmet demand using machine logs and the planogram.</p></div><div className="flex gap-2"><button onClick={()=>setParams(defaults)} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold"><RotateCcw size={16}/>Reset Defaults</button><button onClick={()=>void save()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"><Save size={16}/>Save Assumptions</button></div></div>
    {message&&<div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}
    <Card className="p-4"><div className="grid gap-4 lg:grid-cols-[1.2fr_1fr_1fr_1fr]"><div><p className="text-xs font-bold uppercase text-slate-500">Machine / Location</p><p className="mt-1 font-bold">{machine?.machine_id||'Loading…'}</p><p className="text-sm text-slate-500">{machine?.locations?.location_name} · {machine?.locations?.agency}</p></div><Field label="Product"><select className={inputClass} value={productFilter} onChange={e=>setProductFilter(e.target.value)}><option>All Products</option>{products.map(product=><option key={product}>{product}</option>)}</select></Field><Field label="Start Date"><input type="date" className={inputClass} value={startDate} onChange={e=>setStartDate(e.target.value)}/></Field><Field label="End Date"><input type="date" className={inputClass} value={endDate} onChange={e=>setEndDate(e.target.value)}/></Field></div></Card>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{[['Capacity',summary?.capacity||0],['Avg Transactions / Day',calculations.avgTransactions.toFixed(3)],['Avg Units / Day',calculations.avgUnits.toFixed(3)],['Total Requested',calculations.requested],['Actually Restocked',calculations.restocked],['Supplier Fill Rate',`${(calculations.fillRate*100).toFixed(1)}%`]].map(([label,value])=><Card key={String(label)} className="p-4"><p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 text-2xl font-extrabold">{value}</p></Card>)}</div>
    <div className="grid gap-5 xl:grid-cols-2">
      <Card><div className="mb-4 flex items-center gap-2"><Calculator size={18} className="text-blue-600"/><h2 className="font-bold">Editable Model Parameters</h2></div><div className="grid gap-4 sm:grid-cols-2"><Field label="Product Cost"><input type="number" step="0.01" className={inputClass} value={params.product_cost} onChange={e=>update('product_cost',num(e.target.value))}/></Field><Field label="Delivery Cost"><input type="number" step="0.01" className={inputClass} value={params.delivery_cost} onChange={e=>update('delivery_cost',num(e.target.value))}/></Field><Field label="Annual Holding Rate"><input type="number" step="0.01" className={inputClass} value={params.annual_holding_rate} onChange={e=>update('annual_holding_rate',num(e.target.value))}/></Field><Field label="Unmet Demand Penalty"><input type="number" step="1" className={inputClass} value={params.unmet_demand_penalty} onChange={e=>update('unmet_demand_penalty',num(e.target.value))}/></Field><Field label="Total Requested Override"><input type="number" className={inputClass} placeholder={`Logs: ${summary?.requested_from_logs||0}`} value={params.requested_quantity_override} onChange={e=>update('requested_quantity_override',e.target.value)}/></Field><Field label="Actually Restocked Override"><input type="number" className={inputClass} placeholder={`Logs: ${summary?.restocked_from_logs||0}`} value={params.restocked_quantity_override} onChange={e=>update('restocked_quantity_override',e.target.value)}/></Field><Field label="Average Inventory Override"><input type="number" className={inputClass} placeholder={`Estimated: ${((summary?.capacity||0)/2).toFixed(0)}`} value={params.average_inventory_override} onChange={e=>update('average_inventory_override',e.target.value)}/></Field></div><p className="mt-4 text-xs text-slate-500">Requested and restocked overrides are available because the current machine-log export primarily contains dispense and exception events. Leave blank to use values detected from log keywords. Holding cost follows the current spreadsheet method: requested units multiplied by the rounded daily holding cost per unit.</p></Card>
      <Card><h2 className="font-bold">Calculated Costs and Performance</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{[['Cost / Replenished Unit',money(calculations.cQ)],['Daily Holding Cost / Unit',money(calculations.roundedDailyHolding)],['Estimated Holding Cost',money(calculations.holdingCost)],['Planned Replenishment Cost',money(calculations.plannedCost)],['Actual Replenishment Cost',money(calculations.actualCost)],['Unmet Demand Units',calculations.unmet],['Unmet Demand Cost',money(calculations.unmetCost)],['Total Evaluation Cost',money(calculations.totalCost)]].map(([label,value])=><div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-1 text-lg font-bold">{value}</p></div>)}</div></Card>
    </div>
    <Card className="overflow-hidden p-0"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold">Product and Selection Performance</h2><p className="text-sm text-slate-500">Planogram capacity combined with machine-log demand by selection.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Selection','Product','Item #','Capacity','Critical','Low','PAR','Dispensed','Requested','Restocked','Fill Rate','Stockouts'].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{loading?<tr><td colSpan={12} className="px-4 py-10 text-center text-slate-500">Calculating evaluation…</td></tr>:selections.length===0?<tr><td colSpan={12} className="px-4 py-10 text-center text-slate-500">No planogram selections match this product filter.</td></tr>:selections.map(row=>{const fill=row.requested_units>0?row.restocked_units/row.requested_units:0;return <tr key={row.selection_number} className="border-t border-slate-100"><td className="px-4 py-3 font-bold">{row.selection_number}</td><td className="px-4 py-3">{row.product_name}</td><td className="px-4 py-3">{row.item_number||'—'}</td><td className="px-4 py-3">{row.capacity}</td><td className="px-4 py-3">{row.critical_level}</td><td className="px-4 py-3">{row.low_level}</td><td className="px-4 py-3">{row.par_level}</td><td className="px-4 py-3 font-semibold">{row.dispensed_units}</td><td className="px-4 py-3">{row.requested_units}</td><td className="px-4 py-3">{row.restocked_units}</td><td className="px-4 py-3"><Badge tone={fill>=.9?'green':fill>=.7?'yellow':'red'}>{row.requested_units?`${(fill*100).toFixed(0)}%`:'—'}</Badge></td><td className="px-4 py-3">{row.stockout_events}</td></tr>})}</tbody></table></div></Card>
  </div>
}
