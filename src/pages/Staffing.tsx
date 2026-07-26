import { ChangeEvent, useEffect, useMemo, useState } from 'react'
import { Badge, Card, Field, inputClass } from '../components/ui'
import { parseCsv, type CsvRow } from '../lib/csv'
import { supabase } from '../lib/supabase'
import { Upload, Users, Wrench, Building2, Clock3, AlertTriangle } from 'lucide-react'

type Machine = { id:string; machine_id:string; locations?:{agency:string|null;location_name:string|null;city:string|null;state:string|null}|null }
type MachineAlias = { source_machine_name:string; machine_uuid:string|null; ignored:boolean }
type RestockRow = { sourceLocation:string; sourceMachine:string; selection:string; product:string; packageQty:number; pickedQty:number; pickedAt:string; pickedFrom:string; sourcePerson:string; action:string; importKey:string }
type TechSummary = { technician_id:string; technician_code:string; visit_count:number; units_restocked:number; machines_serviced:number; selections_serviced:number; first_activity:string|null; last_activity:string|null; estimated_hours:number; max_hours:number; utilization_pct:number }
type MachineSummary = { machine_uuid:string; machine_wtn_id:string; agency:string; location_name:string; visit_count:number; units_restocked:number; technicians:number; avg_units_per_visit:number; first_activity:string|null; last_activity:string|null }
type AnonymousTechResult = { technician_id:string; technician_code:string }

const IGNORE='__IGNORE__'
const normalize=(v:string)=>v.trim().toLowerCase().replace(/[^a-z0-9]/g,'')
function hashText(v:string){let h=2166136261;for(let i=0;i<v.length;i++){h^=v.charCodeAt(i);h=Math.imul(h,16777619)}return (h>>>0).toString(16).padStart(8,'0')}
function parseDate(value:string){const cleaned=value.trim().replace(/\s+(EST|EDT|CST|CDT|MST|MDT|PST|PDT)$/i,'');const d=new Date(cleaned);return Number.isNaN(d.getTime())?null:d.toISOString()}
function value(row:CsvRow,key:string){return (row[key]||'').trim()}
function parseQuantity(raw:string,fallback:number){
  const cleaned=raw.trim().replace(/[$,\s]/g,'').replace(/^\((.*)\)$/,'-$1')
  if(cleaned==='')return fallback
  const n=Number(cleaned)
  return Number.isFinite(n)?n:NaN
}
function parseRestockFile(text:string){
  const clean=text.replace(/^\uFEFF/,'')
  const header='Location,Machine Stocked,Selection,'
  const idx=clean.indexOf(header)
  if(idx<0)return {rows:[] as RestockRow[],metadata:{} as Record<string,string>,errors:['RestockSummaryReport header row was not found.']}
  const metadata:Record<string,string>={}
  clean.slice(0,idx).trim().split(/\r?\n/).forEach(line=>{const comma=line.indexOf(',');if(comma>0)metadata[line.slice(0,comma).trim()]=line.slice(comma+1).trim()})
  const rows:RestockRow[]=[];const errors:string[]=[]
  parseCsv(clean.slice(idx)).forEach((row,i)=>{
    const sourceMachine=value(row,'Machine Stocked');const sourcePerson=value(row,'Restock Person');const rawDate=value(row,'Picked on Date & Time');const pickedAt=parseDate(rawDate)
    if(!sourceMachine||!sourcePerson||!pickedAt){errors.push(`Row ${i+2}: missing machine, restock person, or valid date.`);return}
    const pickedQty=parseQuantity(value(row,'Picked Qty'),NaN)
    const packageQty=parseQuantity(value(row,'Package Qty'),1)
    if(!Number.isFinite(pickedQty)||pickedQty<=0){errors.push(`Row ${i+2}: Picked Qty must be a positive number.`);return}
    if(!Number.isFinite(packageQty)||packageQty<=0){errors.push(`Row ${i+2}: Package Qty must be a positive number.`);return}
    const key=[sourceMachine,sourcePerson,rawDate,value(row,'Selection'),value(row,'Product'),pickedQty,value(row,'Restock Action')].join('|')
    rows.push({sourceLocation:value(row,'Location'),sourceMachine,selection:value(row,'Selection'),product:value(row,'Product'),packageQty,pickedQty,pickedAt,pickedFrom:value(row,'Picked From'),sourcePerson,action:value(row,'Restock Action'),importKey:hashText(key)})
  })
  return {rows,metadata,errors}
}
function machineLabel(m:Machine){const loc=m.locations;return `${m.machine_id} — ${loc?.location_name||'Unnamed location'}${loc?.city?` — ${loc.city}${loc.state?`, ${loc.state}`:''}`:''}`}
function fmt(v:string|null){return v?new Date(v).toLocaleString():'—'}

export default function Staffing(){
  const [machines,setMachines]=useState<Machine[]>([])
  const [rows,setRows]=useState<RestockRow[]>([]);const [machineMap,setMachineMap]=useState<Record<string,string>>({})
  const [machineAliases,setMachineAliases]=useState<MachineAlias[]>([])
  const [metadata,setMetadata]=useState<Record<string,string>>({});const [errors,setErrors]=useState<string[]>([]);const [filename,setFilename]=useState('');const [message,setMessage]=useState('');const [importing,setImporting]=useState(false);const [remember,setRemember]=useState(true)
  const [techSummary,setTechSummary]=useState<TechSummary[]>([]);const [machineSummary,setMachineSummary]=useState<MachineSummary[]>([])
  const [baseHours,setBaseHours]=useState(.25);const [hoursPerUnit,setHoursPerUnit]=useState(.003);const [hoursPerSelection,setHoursPerSelection]=useState(.02)

  async function loadData(){if(!supabase)return;const [m,ma,ts,ms,p]=await Promise.all([
    supabase.from('machines').select('id,machine_id,locations(agency,location_name,city,state)').order('machine_id'),
    supabase.from('restock_machine_aliases').select('source_machine_name,machine_uuid,ignored'),
    supabase.rpc('get_staffing_technician_summary'),supabase.rpc('get_staffing_machine_summary'),
    supabase.from('program_parameters').select('parameter_name,parameter_value').in('parameter_name',['staffing_base_visit_hours','staffing_hours_per_unit','staffing_hours_per_selection'])
  ]);setMachines((m.data||[]) as unknown as Machine[]);setMachineAliases((ma.data||[]) as MachineAlias[]);setTechSummary((ts.data||[]) as TechSummary[]);setMachineSummary((ms.data||[]) as MachineSummary[])
  const params=Object.fromEntries((p.data||[]).map((x:any)=>[x.parameter_name,Number(x.parameter_value)]));if(params.staffing_base_visit_hours!=null)setBaseHours(params.staffing_base_visit_hours);if(params.staffing_hours_per_unit!=null)setHoursPerUnit(params.staffing_hours_per_unit);if(params.staffing_hours_per_selection!=null)setHoursPerSelection(params.staffing_hours_per_selection)
  const err=m.error||ts.error||ms.error;if(err)setMessage(err.message)}
  useEffect(()=>{void loadData()},[])

  const sourceMachines=useMemo(()=>[...new Set(rows.map(r=>r.sourceMachine))],[rows])
  const sourcePeople=useMemo(()=>[...new Set(rows.map(r=>r.sourcePerson))],[rows])
  const mappedMachines=sourceMachines.filter(x=>machineMap[x]&&machineMap[x]!==IGNORE).length;const ignoredMachines=sourceMachines.filter(x=>machineMap[x]===IGNORE).length
  const ready=rows.length>0&&mappedMachines+ignoredMachines===sourceMachines.length

  async function chooseFile(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;const parsed=parseRestockFile(await file.text());setRows(parsed.rows);setMetadata(parsed.metadata);setErrors(parsed.errors);setFilename(file.name);const mm:Record<string,string>={};for(const source of [...new Set(parsed.rows.map(r=>r.sourceMachine))]){const alias=machineAliases.find(a=>normalize(a.source_machine_name)===normalize(source));if(alias?.ignored)mm[source]=IGNORE;else if(alias?.machine_uuid)mm[source]=alias.machine_uuid;else{const ranked=machines.map(m=>({id:m.id,score:Math.max(normalize(source)===normalize(m.locations?.location_name||'')?1:0,normalize(source)===normalize(m.machine_id)?1:0,normalize(source).includes(normalize(m.locations?.location_name||''))?.9:0)})).sort((a,b)=>b.score-a.score);if(ranked[0]?.score>=.9)mm[source]=ranked[0].id}}
    setMachineMap(mm);setMessage(`${parsed.rows.length.toLocaleString()} restock rows found. ${new Set(parsed.rows.map(r=>r.sourcePerson)).size} anonymous technician code(s) will be assigned automatically.`)}

  async function resolveAnonymousTechnicians(){if(!supabase)throw new Error('Supabase is not configured.');const resolved:Record<string,AnonymousTechResult>={};for(const source of sourcePeople){const {data,error}=await supabase.rpc('get_or_create_anonymous_technician',{p_source_person_name:source});if(error)throw error;const row=Array.isArray(data)?data[0]:data;if(!row?.technician_id)throw new Error(`Could not assign an anonymous technician code for ${source}.`);resolved[source]=row as AnonymousTechResult}return resolved}

  async function importRows(){if(!supabase||!ready)return;setImporting(true);setMessage('Assigning anonymous technician codes and importing restock history…');try{
    const anonymousTechs=await resolveAnonymousTechnicians()
    const payload=rows.filter(r=>machineMap[r.sourceMachine]!==IGNORE&&Number.isFinite(r.pickedQty)&&r.pickedQty>0&&Number.isFinite(r.packageQty)&&r.packageQty>0).map(r=>{const m=machines.find(x=>x.id===machineMap[r.sourceMachine]);const tech=anonymousTechs[r.sourcePerson];return {machine_uuid:m?.id,machine_wtn_id:m?.machine_id,technician_id:tech.technician_id,source_machine_name:r.sourceMachine,source_location_name:r.sourceLocation,source_restock_person:r.sourcePerson,selection_number:r.selection,product_name:r.product,package_quantity:r.packageQty,restock_quantity:r.pickedQty,restock_datetime:r.pickedAt,picked_from:r.pickedFrom,restock_action:r.action,source_file:filename,import_key:r.importKey}})
    for(let i=0;i<payload.length;i+=500){const {error}=await supabase.from('restock_events').upsert(payload.slice(i,i+500),{onConflict:'import_key'});if(error)throw error}
    if(remember){const machineAliasPayload=sourceMachines.map(source=>({source_machine_name:source,machine_uuid:machineMap[source]===IGNORE?null:machineMap[source],ignored:machineMap[source]===IGNORE,updated_at:new Date().toISOString()}));const a=await supabase.from('restock_machine_aliases').upsert(machineAliasPayload,{onConflict:'source_machine_name'});if(a.error)throw a.error}
    setMessage(`Imported ${payload.length.toLocaleString()} restock rows using ${Object.keys(anonymousTechs).length} anonymous technician code(s). Ignored ${rows.length-payload.length}.`);await loadData()
  }catch(err:any){setMessage(err?.message||'Restock import failed.')}finally{setImporting(false)}}

  return <div className="space-y-6"><div><h1 className="text-2xl font-extrabold text-slate-900">Staffing & Restock Operations</h1><p className="text-slate-500">Use replenishment history to estimate anonymous technician coverage, workload, visit demand, and service capacity.</p></div>
    {message&&<div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}
    <Card><div className="flex items-center gap-2"><Upload size={18} className="text-blue-600"/><h2 className="font-bold">Import Restock Summary</h2></div><p className="mt-1 text-sm text-slate-500">Upload the Restock Summary Report CSV and cross-reference only the source machines. Restock personnel are converted into stable anonymous technician codes automatically.</p><div className="mt-4 flex gap-3"><input type="file" accept=".csv,text/csv" className={inputClass} onChange={chooseFile}/><button disabled={!ready||importing} onClick={importRows} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white disabled:bg-slate-300">{importing?'Importing…':'Import Restocks'}</button></div>{filename&&<p className="mt-2 text-xs text-slate-500">{filename} • {metadata.Account||'Account not listed'} • {rows.length} rows • {sourcePeople.length} anonymous technician(s)</p>}{errors.length>0&&<p className="mt-2 text-xs text-rose-600">{errors.slice(0,3).join(' ')}</p>}</Card>
    {rows.length>0&&<Card><section><h2 className="font-bold">Match Source Machines</h2><div className="mt-3 grid gap-3 lg:grid-cols-2">{sourceMachines.map(source=><Field key={source} label={source}><select className={inputClass} value={machineMap[source]||''} onChange={e=>setMachineMap(p=>({...p,[source]:e.target.value}))}><option value="">Select WTN machine and location</option><option value={IGNORE}>Not applicable — Ignore</option>{machines.map(m=><option key={m.id} value={m.id}>{machineLabel(m)}</option>)}</select></Field>)}</div></section><div className="mt-4 flex flex-wrap items-center gap-2 text-sm"><Badge tone={ready?'green':'yellow'}>{ready?'Ready to import':'Machine mapping required'}</Badge><span>{mappedMachines} machines mapped</span><span>• {ignoredMachines} ignored</span><span>• {sourcePeople.length} anonymous technicians detected</span><label className="ml-auto flex items-center gap-2"><input type="checkbox" checked={remember} onChange={e=>setRemember(e.target.checked)}/> Remember machine mappings</label></div></Card>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[[Users,'Anonymous Technicians',techSummary.length],[Wrench,'Restock Visits',techSummary.reduce((a,b)=>a+Number(b.visit_count||0),0)],[Building2,'Machines Serviced',new Set(machineSummary.map(x=>x.machine_uuid)).size],[Clock3,'Estimated Hours',techSummary.reduce((a,b)=>a+Number(b.estimated_hours||0),0).toFixed(1)]].map(([Icon,label,val]:any)=><Card key={label} className="p-4"><Icon size={18} className="text-blue-600"/><p className="mt-3 text-xs font-bold uppercase text-slate-500">{label}</p><p className="text-2xl font-extrabold">{val}</p></Card>)}</div>
    <Card className="overflow-hidden p-0"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold">Anonymous Technician Capacity</h2><p className="text-sm text-slate-500">No personnel names are displayed. Workload estimates use base visit time + units × time per unit + selections × time per selection.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[1050px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{['Technician Code','Visits','Units','Machines','Selections','Estimated Hours','Available Hours','Utilization','First Activity','Last Activity'].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{techSummary.map(r=><tr key={r.technician_id} className="border-t border-slate-100"><td className="px-4 py-3 font-bold font-mono">{r.technician_code}</td><td className="px-4 py-3">{r.visit_count}</td><td className="px-4 py-3">{Number(r.units_restocked).toLocaleString()}</td><td className="px-4 py-3">{r.machines_serviced}</td><td className="px-4 py-3">{r.selections_serviced}</td><td className="px-4 py-3">{Number(r.estimated_hours).toFixed(1)}</td><td className="px-4 py-3">{Number(r.max_hours).toFixed(1)}</td><td className="px-4 py-3"><Badge tone={Number(r.utilization_pct)>100?'red':Number(r.utilization_pct)>85?'yellow':'green'}>{Number(r.utilization_pct).toFixed(0)}%</Badge></td><td className="px-4 py-3">{fmt(r.first_activity)}</td><td className="px-4 py-3">{fmt(r.last_activity)}</td></tr>)}</tbody></table></div></Card>
    <Card className="overflow-hidden p-0"><div className="border-b border-slate-200 px-5 py-4"><h2 className="font-bold">Machine Service Demand</h2><p className="text-sm text-slate-500">Technicians is the count of distinct anonymous restock resources that serviced each machine.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>{['Agency','Location','WTN','Visits','Units Restocked','Technician Count','Avg Units / Visit','First Activity','Last Activity'].map(h=><th key={h} className="px-4 py-3">{h}</th>)}</tr></thead><tbody>{machineSummary.map(r=><tr key={r.machine_uuid} className="border-t border-slate-100"><td className="px-4 py-3">{r.agency}</td><td className="px-4 py-3 font-semibold">{r.location_name}</td><td className="px-4 py-3 font-mono text-xs">{r.machine_wtn_id}</td><td className="px-4 py-3">{r.visit_count}</td><td className="px-4 py-3">{Number(r.units_restocked).toLocaleString()}</td><td className="px-4 py-3 font-bold">{r.technicians}</td><td className="px-4 py-3">{Number(r.avg_units_per_visit).toFixed(1)}</td><td className="px-4 py-3">{fmt(r.first_activity)}</td><td className="px-4 py-3">{fmt(r.last_activity)}</td></tr>)}</tbody></table></div></Card>
    <Card><div className="flex items-center gap-2"><AlertTriangle size={18} className="text-amber-600"/><h2 className="font-bold">Model Assumptions</h2></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><Field label="Base visit hours"><input type="number" step="0.01" className={inputClass} value={baseHours} readOnly/></Field><Field label="Hours per unit"><input type="number" step="0.001" className={inputClass} value={hoursPerUnit} readOnly/></Field><Field label="Hours per selection"><input type="number" step="0.01" className={inputClass} value={hoursPerSelection} readOnly/></Field></div><p className="mt-3 text-xs text-slate-500">Adjust these values on the Calculations page. The model supports the paper’s service-capacity logic by comparing observed replenishment workload with available anonymous technician capacity.</p></Card>
  </div>
}
