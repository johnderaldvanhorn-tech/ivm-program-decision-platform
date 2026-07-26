import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Download, Printer, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { Badge, Card, Field, inputClass } from '../components/ui'
import { supabase } from '../lib/supabase'

type RawRow = {
  machine_uuid:string
  machine_wtn_id:string
  agency:string
  location_name:string
  city:string
  state:string
  capacity:number
  current_inventory:number
  selection_count:number
  evaluation_days:number
  dispensed_units:number
  average_daily_demand:number
  demand_stddev:number
  demand_peak_daily:number
  restock_visits:number
  restocked_units:number
  average_lead_time_days:number
  lead_time_stddev_days:number
  stockout_events:number
  first_activity:string|null
  last_activity:string|null
}

type Policy = {
  id?:string
  machine_uuid:string
  product_filter:string
  service_level:number
  z_score:number
  demand_rate:number
  demand_stddev:number
  lead_time_days:number
  observed_lead_time_days:number
  lead_time_stddev_days:number
  review_period_days:number
  safety_stock_units:number
  reorder_point:number
  base_stock_level:number
  optimal_fill_quantity:number
  order_quantity:number
  restock_trigger:string
  safety_stock_flag:string
  calculation_method:string
  capacity:number
  current_inventory:number
  stockout_events:number
}

type Result = RawRow & Policy & {
  effectiveLeadTime:number
  coverageDays:number|null
  daysToReorder:number|null
  status:'Order Now'|'Review'|'Healthy'|'No Demand'|'No Planogram'
}

const today = new Date().toISOString().slice(0,10)
const oneYearAgo = new Date(Date.now()-365*86400000).toISOString().slice(0,10)
const number = (value:unknown) => Number(value||0)
const round = (value:number,digits=2) => Number(value.toFixed(digits))
const fmt = (value:number,digits=1) => new Intl.NumberFormat('en-US',{maximumFractionDigits:digits}).format(Number.isFinite(value)?value:0)

function zForServiceLevel(level:number){
  const table:[number,number][]=[[0.80,.842],[0.85,1.036],[0.90,1.282],[0.95,1.645],[0.975,1.96],[0.98,2.054],[0.99,2.326],[0.995,2.576]]
  return table.reduce((best,row)=>Math.abs(row[0]-level)<Math.abs(best[0]-level)?row:best,table[0])[1]
}

function statusTone(status:Result['status']){
  if(status==='Order Now')return 'red' as const
  if(status==='Review')return 'yellow' as const
  if(status==='Healthy')return 'green' as const
  return 'slate' as const
}

function csvEscape(value:unknown){const text=String(value??'');return /[",\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text}

export default function SafetyStock(){
  const [rows,setRows]=useState<RawRow[]>([])
  const [saved,setSaved]=useState<Map<string,Policy>>(new Map())
  const [startDate,setStartDate]=useState(oneYearAgo)
  const [endDate,setEndDate]=useState(today)
  const [productFilter,setProductFilter]=useState('All Products')
  const [serviceLevel,setServiceLevel]=useState(.95)
  const [leadMode,setLeadMode]=useState<'observed'|'manual'>('observed')
  const [manualLeadTime,setManualLeadTime]=useState(14)
  const [reviewPeriod,setReviewPeriod]=useState(0)
  const [calculationMethod,setCalculationMethod]=useState<'Demand and lead-time variability'|'Demand variability only'>('Demand and lead-time variability')
  const [collapsed,setCollapsed]=useState<Record<string,boolean>>({})
  const [expanded,setExpanded]=useState<Record<string,boolean>>({})
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')

  async function load(){
    if(!supabase)return
    setLoading(true);setMessage('')
    const [{data,error},{data:policies,error:policyError}] = await Promise.all([
      supabase.rpc('get_safety_stock_analysis',{p_start_date:startDate||null,p_end_date:endDate||null,p_product_filter:productFilter}),
      supabase.from('safety_stock').select('*').eq('product_filter',productFilter),
    ])
    if(error||policyError){setMessage(error?.message||policyError?.message||'Unable to load safety-stock analysis.');setLoading(false);return}
    setRows((data||[]).map((row:any)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='string'&&value!==''&&!['machine_uuid','machine_wtn_id','agency','location_name','city','state','first_activity','last_activity'].includes(key)&&!Number.isNaN(Number(value))?Number(value):value])) as RawRow))
    const map=new Map<string,Policy>();for(const policy of (policies||[]) as any[])map.set(policy.machine_uuid,policy as Policy);setSaved(map)
    setLoading(false)
  }

  useEffect(()=>{void load()},[startDate,endDate,productFilter])

  const z=zForServiceLevel(serviceLevel)
  const results=useMemo<Result[]>(()=>rows.map(row=>{
    const policy=saved.get(row.machine_uuid)
    const effectiveLeadTime=leadMode==='manual'?manualLeadTime:Math.max(1,number(row.average_lead_time_days)||manualLeadTime)
    const demandRate=number(row.average_daily_demand)
    const demandStd=number(row.demand_stddev)
    const leadStd=leadMode==='observed'?number(row.lead_time_stddev_days):0
    const variance = calculationMethod==='Demand and lead-time variability'
      ? effectiveLeadTime*Math.pow(demandStd,2)+Math.pow(demandRate,2)*Math.pow(leadStd,2)
      : effectiveLeadTime*Math.pow(demandStd,2)
    const safetyStock=Math.max(0,Math.ceil(z*Math.sqrt(Math.max(0,variance))))
    const reorderPoint=Math.min(number(row.capacity),Math.ceil(demandRate*effectiveLeadTime+safetyStock))
    const baseStock=Math.min(number(row.capacity),Math.ceil(demandRate*(effectiveLeadTime+reviewPeriod)+safetyStock))
    const optimalFill=Math.max(0,number(row.capacity)-number(row.current_inventory))
    const orderQuantity=Math.max(0,Math.min(optimalFill,baseStock-number(row.current_inventory)))
    const coverageDays=demandRate>0?number(row.current_inventory)/demandRate:null
    const daysToReorder=demandRate>0?Math.max(0,(number(row.current_inventory)-reorderPoint)/demandRate):null
    let status:Result['status']='Healthy'
    if(number(row.capacity)<=0)status='No Planogram'
    else if(demandRate<=0)status='No Demand'
    else if(number(row.current_inventory)<=reorderPoint)status='Order Now'
    else if(number(row.stockout_events)>0||safetyStock<=5||coverageDays!==null&&coverageDays<=effectiveLeadTime+reviewPeriod+3)status='Review'
    const restockTrigger=status==='Order Now'?'Place order':'No order'
    const flag=safetyStock<=5?'Review: safety stock at or under 5 units':number(row.stockout_events)>0?'Review: observed stockout activity':'Ready'
    return {...row,
      ...(policy||{}),machine_uuid:row.machine_uuid,product_filter:productFilter,service_level:serviceLevel,z_score:z,
      demand_rate:demandRate,demand_stddev:demandStd,lead_time_days:effectiveLeadTime,observed_lead_time_days:number(row.average_lead_time_days),lead_time_stddev_days:leadStd,review_period_days:reviewPeriod,
      safety_stock_units:safetyStock,reorder_point:reorderPoint,base_stock_level:baseStock,optimal_fill_quantity:optimalFill,order_quantity:orderQuantity,restock_trigger:restockTrigger,safety_stock_flag:flag,calculation_method:calculationMethod,capacity:number(row.capacity),current_inventory:number(row.current_inventory),stockout_events:number(row.stockout_events),effectiveLeadTime,coverageDays,daysToReorder,status
    }
  }),[rows,saved,productFilter,serviceLevel,z,leadMode,manualLeadTime,reviewPeriod,calculationMethod])

  const groups=useMemo(()=>{const map=new Map<string,Result[]>();for(const row of results){const list=map.get(row.agency)||[];list.push(row);map.set(row.agency,list)}return [...map.entries()].sort(([a],[b])=>a.localeCompare(b))},[results])
  const totals=useMemo(()=>({machines:results.length,orderNow:results.filter(r=>r.status==='Order Now').length,review:results.filter(r=>r.status==='Review').length,avgSafety:results.length?results.reduce((s,r)=>s+r.safety_stock_units,0)/results.length:0,totalOrder:results.reduce((s,r)=>s+r.order_quantity,0)}),[results])

  async function savePolicies(){
    if(!supabase)return
    setMessage('Saving policies…')
    const payload=results.map(row=>({
      machine_id:row.machine_uuid,machine_uuid:row.machine_uuid,machine_wtn_id:row.machine_wtn_id,product_filter:productFilter,
      service_level:serviceLevel,z_score:z,demand_rate:round(row.demand_rate,6),demand_stddev:round(row.demand_stddev,6),lead_time_days:round(row.effectiveLeadTime,3),observed_lead_time_days:round(row.average_lead_time_days,3),lead_time_stddev_days:round(row.lead_time_stddev_days,3),review_period_days:reviewPeriod,
      safety_stock_units:row.safety_stock_units,reorder_point:row.reorder_point,base_stock_level:row.base_stock_level,optimal_fill_quantity:row.optimal_fill_quantity,order_quantity:row.order_quantity,restock_trigger:row.restock_trigger,safety_stock_flag:row.safety_stock_flag,calculation_method:calculationMethod,capacity:row.capacity,current_inventory:row.current_inventory,stockout_events:row.stockout_events,evaluation_start_date:startDate,evaluation_end_date:endDate,updated_at:new Date().toISOString()
    }))
    const {error}=await supabase.from('safety_stock').upsert(payload,{onConflict:'machine_uuid,product_filter'})
    setMessage(error?error.message:`Saved ${payload.length} safety-stock policies.`)
    if(!error)void load()
  }

  function exportCsv(){
    const headers=['Agency','Location','Machine ID','Product Filter','Capacity','Current Inventory','Average Daily Demand','Demand Std Dev','Observed Lead Time','Lead Time Std Dev','Service Level','Safety Stock','Reorder Point','Base Stock','Order Quantity','Coverage Days','Stockouts','Status']
    const body=results.map(r=>[r.agency,r.location_name,r.machine_wtn_id,productFilter,r.capacity,r.current_inventory,round(r.demand_rate,3),round(r.demand_stddev,3),round(r.average_lead_time_days,2),round(r.lead_time_stddev_days,2),serviceLevel,r.safety_stock_units,r.reorder_point,r.base_stock_level,r.order_quantity,r.coverageDays===null?'':round(r.coverageDays,1),r.stockout_events,r.status])
    const csv=[headers,...body].map(row=>row.map(csvEscape).join(',')).join('\n')
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`safety-stock-${productFilter.toLowerCase().replace(/\s+/g,'-')}-${endDate}.csv`;a.click();URL.revokeObjectURL(url)
  }

  function reset(){setServiceLevel(.95);setLeadMode('observed');setManualLeadTime(14);setReviewPeriod(0);setCalculationMethod('Demand and lead-time variability');setStartDate(oneYearAgo);setEndDate(today);setProductFilter('All Products')}

  return <div className="space-y-4 print:bg-white">
    <div className="flex flex-wrap items-end justify-between gap-3 print:hidden"><div><h1 className="text-2xl font-bold">Safety Stock</h1><p className="text-slate-500">Telemetry-informed reorder points using demand variability, observed restock intervals, capacity, and service-level targets.</p></div><div className="flex gap-2"><button onClick={reset} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"><RotateCcw size={16}/>Reset Defaults</button><button onClick={exportCsv} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"><Download size={16}/>CSV</button><button onClick={()=>window.print()} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"><Printer size={16}/>Print</button><button onClick={()=>void savePolicies()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white"><Save size={16}/>Save Policies</button></div></div>

    {message?<div className={`rounded-xl border px-4 py-3 text-sm ${message.toLowerCase().includes('saved')?'border-emerald-200 bg-emerald-50 text-emerald-800':'border-amber-200 bg-amber-50 text-amber-800'}`}>{message}</div>:null}

    <Card className="print:hidden"><div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7"><Field label="Start Date"><input type="date" className={inputClass} value={startDate} onChange={e=>setStartDate(e.target.value)}/></Field><Field label="End Date"><input type="date" className={inputClass} value={endDate} onChange={e=>setEndDate(e.target.value)}/></Field><Field label="Product"><select className={inputClass} value={productFilter} onChange={e=>setProductFilter(e.target.value)}><option>All Products</option><option>Narcan</option></select></Field><Field label="Service Level"><select className={inputClass} value={serviceLevel} onChange={e=>setServiceLevel(Number(e.target.value))}>{[[.80,'80%'],[.85,'85%'],[.90,'90%'],[.95,'95%'],[.975,'97.5%'],[.99,'99%']].map(([v,l])=><option key={String(v)} value={v}>{l}</option>)}</select></Field><Field label="Lead Time"><select className={inputClass} value={leadMode} onChange={e=>setLeadMode(e.target.value as any)}><option value="observed">Observed restock interval</option><option value="manual">Manual</option></select></Field><Field label="Manual Lead Days"><input type="number" min="1" step="1" className={inputClass} disabled={leadMode!=='manual'} value={manualLeadTime} onChange={e=>setManualLeadTime(Math.max(1,Number(e.target.value)))}/></Field><Field label="Review Period Days"><input type="number" min="0" step="1" className={inputClass} value={reviewPeriod} onChange={e=>setReviewPeriod(Math.max(0,Number(e.target.value)))}/></Field></div><div className="mt-3"><Field label="Safety Stock Method"><select className={inputClass} value={calculationMethod} onChange={e=>setCalculationMethod(e.target.value as any)}><option>Demand and lead-time variability</option><option>Demand variability only</option></select></Field></div></Card>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{[
      ['Machines Evaluated',totals.machines,'blue'],['Order Now',totals.orderNow,'red'],['Needs Review',totals.review,'yellow'],['Average Safety Stock',fmt(totals.avgSafety,1),'green'],['Total Recommended Order',fmt(totals.totalOrder,0),'blue']
    ].map(([label,value,tone])=><Card key={String(label)} className="py-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className={`mt-1 text-2xl font-bold ${tone==='red'?'text-rose-700':tone==='yellow'?'text-amber-700':tone==='green'?'text-emerald-700':'text-blue-700'}`}>{value}</p></Card>)}</div>

    <Card className="bg-slate-900 text-white"><div className="flex items-start gap-3"><ShieldCheck className="mt-1 text-blue-300"/><div><h2 className="font-bold">Calculation used</h2><p className="mt-1 text-sm text-slate-300">Safety Stock = z × √(Lead Time × Demand Variance + Average Demand² × Lead-Time Variance). Reorder Point = Average Daily Demand × Lead Time + Safety Stock. Base Stock also includes the selected review period. Values are capped at planogram capacity.</p></div></div></Card>

    {loading?<Card><p className="py-12 text-center text-slate-500">Calculating safety-stock policies…</p></Card>:groups.map(([agency,machines])=>{
      const isCollapsed=collapsed[agency]!==false
      const avgSS=machines.reduce((s,r)=>s+r.safety_stock_units,0)/Math.max(1,machines.length)
      const avgLead=machines.reduce((s,r)=>s+r.effectiveLeadTime,0)/Math.max(1,machines.length)
      const orderCount=machines.filter(r=>r.status==='Order Now').length
      return <Card key={agency} className="overflow-hidden p-0"><button className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left" onClick={()=>setCollapsed(v=>({...v,[agency]:!isCollapsed}))}><div className="flex items-center gap-3"><ShieldCheck size={18} className="text-blue-600"/><div><h2 className="font-bold">{agency}</h2><p className="text-xs text-slate-500">{machines.length} machines • {orderCount} order now</p></div></div><div className="flex items-center gap-2"><Badge tone="blue">Avg SS {fmt(avgSS,1)}</Badge><Badge tone="slate">Avg Lead {fmt(avgLead,1)}d</Badge>{isCollapsed?<ChevronRight size={18}/>:<ChevronDown size={18}/>}</div></button>{!isCollapsed?<div className="overflow-x-auto border-t border-slate-200"><table className="w-full min-w-[1250px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Machine','Location','Capacity','Current','Avg/Day','Variability','Lead Days','Safety Stock','ROP','Base Stock','Order Qty','Coverage','Stockouts','Status',''].map(h=><th key={h} className="px-3 py-2.5">{h}</th>)}</tr></thead><tbody>{machines.map(row=>{const open=!!expanded[row.machine_uuid];return <><tr key={row.machine_uuid} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50" onClick={()=>setExpanded(v=>({...v,[row.machine_uuid]:!open}))}><td className="px-3 py-3 font-semibold">{row.machine_wtn_id}</td><td className="px-3 py-3"><p className="font-medium">{row.location_name}</p><p className="text-xs text-slate-500">{row.city}{row.city&&row.state?', ':''}{row.state}</p></td><td className="px-3 py-3">{row.capacity}</td><td className="px-3 py-3">{row.current_inventory}</td><td className="px-3 py-3">{fmt(row.demand_rate,3)}</td><td className="px-3 py-3">{fmt(row.demand_stddev,3)}</td><td className="px-3 py-3">{fmt(row.effectiveLeadTime,1)}</td><td className="px-3 py-3 font-bold">{row.safety_stock_units}</td><td className="px-3 py-3">{row.reorder_point}</td><td className="px-3 py-3">{row.base_stock_level}</td><td className="px-3 py-3 font-bold text-blue-700">{row.order_quantity}</td><td className="px-3 py-3">{row.coverageDays===null?'—':`${fmt(row.coverageDays,1)}d`}</td><td className="px-3 py-3">{row.stockout_events}</td><td className="px-3 py-3"><Badge tone={statusTone(row.status)}>{row.status}</Badge></td><td className="px-3 py-3">{open?<ChevronDown size={16}/>:<ChevronRight size={16}/>}</td></tr>{open?<tr className="bg-slate-50"><td colSpan={15} className="px-5 py-4"><div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">{[
        ['Selections',row.selection_count],['Dispensed Units',row.dispensed_units],['Peak Daily Demand',fmt(row.demand_peak_daily,1)],['Restock Visits',row.restock_visits],['Units Restocked',fmt(row.restocked_units,0)],['Lead-Time Std Dev',`${fmt(row.lead_time_stddev_days,2)}d`],['Days Until ROP',row.daysToReorder===null?'—':`${fmt(row.daysToReorder,1)}d`],['Optimal Fill',row.optimal_fill_quantity],['Service Level',`${(serviceLevel*100).toFixed(1)}%`],['Z Score',fmt(z,3)],['First Activity',row.first_activity?new Date(row.first_activity).toLocaleDateString():'—'],['Last Activity',row.last_activity?new Date(row.last_activity).toLocaleDateString():'—']
      ].map(([label,value])=><div key={String(label)} className="rounded-xl border border-slate-200 bg-white p-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p><p className="mt-1 font-bold">{value}</p></div>)}</div><p className="mt-3 text-xs text-slate-500">{row.safety_stock_flag}</p></td></tr>:null}</>})}</tbody></table></div>:null}</Card>
    })}
  </div>
}
