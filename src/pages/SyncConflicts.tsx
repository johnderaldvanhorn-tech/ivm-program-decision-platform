import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, Search } from 'lucide-react'
import { Badge, Card, inputClass } from '../components/ui'
import { supabase } from '../lib/supabase'

type Machine = { id:string; machine_id:string; location_id:string; active:boolean; locations?:{ agency:string|null; location_name:string|null; city:string|null; state:string|null }|null }
type Alias = { source_machine_name:string; machine_id:string|null; machine_uuid:string|null; machine_wtn_id:string|null; ignored:boolean|null }
type Summary = { machine_uuid:string|null; machine_wtn_id:string|null; source_name:string|null; units_dispensed:number|null; first_activity:string|null; last_activity:string|null }

function norm(v:string|null|undefined){return String(v||'').toLowerCase().replace(/&/g,' and ').replace(/[^a-z0-9]+/g,' ').replace(/\b(?:site|location|machine|vending)\b/g,' ').replace(/\s+/g,' ').trim()}
function compact(v:string|null|undefined){return norm(v).replace(/\b(?:bccs|department|health|services?)\b/g,' ').replace(/\s+/g,' ').trim()}

export default function SyncConflicts(){
 const [machines,setMachines]=useState<Machine[]>([]),[aliases,setAliases]=useState<Alias[]>([]),[summaries,setSummaries]=useState<Summary[]>([])
 const [mapping,setMapping]=useState<Record<string,string>>({}),[query,setQuery]=useState(''),[loading,setLoading]=useState(true),[message,setMessage]=useState('')
 async function load(){if(!supabase)return;setLoading(true);setMessage('');const [m,a,s]=await Promise.all([
  supabase.from('machines').select('id,machine_id,location_id,active,locations(agency,location_name,city,state)').order('machine_id'),
  supabase.from('machine_name_aliases').select('source_machine_name,machine_id,machine_uuid,machine_wtn_id,ignored'),
  supabase.rpc('get_machine_log_machine_summary')
 ]);const err=m.error||(a.error?.code==='42P01'?null:a.error)||s.error;if(err)setMessage(err.message);setMachines((m.data||[]).map((machine:any)=>({
  ...machine,
  locations:Array.isArray(machine.locations)?(machine.locations[0]??null):machine.locations,
})) as Machine[]);setAliases((a.data||[]) as Alias[]);setSummaries((s.data||[]) as Summary[]);setLoading(false)}
 useEffect(()=>{void load()},[])
 const rows=useMemo(()=>summaries.filter(x=>x.source_name).map(summary=>{
  const source=summary.source_name!;const alias=aliases.find(a=>norm(a.source_machine_name)===norm(source));
  const direct=machines.filter(m=>m.id===summary.machine_uuid||m.machine_id===summary.machine_wtn_id)
  const nameMatches=machines.filter(m=>{const name=m.locations?.location_name||'';const a=compact(name),b=compact(source);return a&&b&&(a===b||a.includes(b)||b.includes(a))})
  let machine:Machine|undefined;let status:'Resolved'|'Ignored'|'Conflict'|'Unmatched';let method=''
  if(alias?.ignored){status='Ignored';method='Remembered ignore'}
  else if(alias){machine=machines.find(m=>m.id===alias.machine_uuid||m.id===alias.machine_id||m.machine_id===alias.machine_wtn_id);status=machine?'Resolved':'Conflict';method='Saved mapping'}
  else if(direct.length===1){machine=direct[0];status='Resolved';method=summary.machine_wtn_id?'WTN ID':'Machine UUID'}
  else if(nameMatches.length===1){machine=nameMatches[0];status='Resolved';method='Unique normalized name'}
  else if(nameMatches.length>1){status='Conflict';method=`${nameMatches.length} possible matches`}
  else {status='Unmatched';method='No reliable match'}
  return {source,summary,machine,status,method,candidates:nameMatches}
 }),[summaries,aliases,machines])
 const visible=rows.filter(r=>`${r.source} ${r.machine?.machine_id||''} ${r.machine?.locations?.location_name||''}`.toLowerCase().includes(query.toLowerCase()))
 const unresolved=rows.filter(r=>r.status==='Conflict'||r.status==='Unmatched').length
 async function save(source:string,ignore=false){if(!supabase)return;const machine=machines.find(m=>m.id===mapping[source]);const payload={source_machine_name:source,machine_id:ignore?null:machine?.id||null,machine_uuid:ignore?null:machine?.id||null,machine_wtn_id:ignore?null:machine?.machine_id||null,ignored:ignore,updated_at:new Date().toISOString()};const {error}=await supabase.from('machine_name_aliases').upsert(payload,{onConflict:'source_machine_name'});if(error)return setMessage(error.message);setMessage(`Saved resolution for ${source}.`);await load()}
 return <div className="space-y-5"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-blue-600">Shared Platform — Data Quality</p><h1 className="text-3xl font-bold">Sync Conflicts</h1><p className="text-slate-500">Resolve Machine Log source names that cannot be reliably matched to a program machine.</p></div><button onClick={()=>void load()} className="flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-semibold"><RefreshCw size={16}/>Refresh</button></div>
 <div className="grid gap-4 md:grid-cols-3"><Card><p className="text-xs font-bold uppercase text-slate-500">Log sources</p><p className="mt-2 text-3xl font-bold">{rows.length}</p></Card><Card><p className="text-xs font-bold uppercase text-slate-500">Needs resolution</p><p className="mt-2 text-3xl font-bold text-amber-700">{unresolved}</p></Card><Card><p className="text-xs font-bold uppercase text-slate-500">Resolved or ignored</p><p className="mt-2 text-3xl font-bold text-emerald-700">{rows.length-unresolved}</p></Card></div>
 {message&&<div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{message}</div>}
 <Card><div className="relative max-w-xl"><Search className="absolute left-3 top-3 text-slate-400" size={17}/><input className={`${inputClass} pl-10`} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search source, WTN, or facility..."/></div></Card>
 <Card>{loading?<p className="p-8 text-center text-slate-500">Checking synchronization…</p>:<div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Machine Log source</th><th>Status</th><th>Current match</th><th>Method</th><th>Dispensed</th><th>Resolution</th></tr></thead><tbody>{visible.map(r=><tr key={r.source} className="border-t align-top"><td className="p-3"><p className="font-semibold">{r.source}</p><p className="text-xs text-slate-500">{r.summary.first_activity?new Date(r.summary.first_activity).toLocaleDateString():'—'} – {r.summary.last_activity?new Date(r.summary.last_activity).toLocaleDateString():'—'}</p></td><td className="pt-3"><Badge tone={r.status==='Resolved'?'green':r.status==='Ignored'?'slate':'yellow'}>{r.status}</Badge></td><td className="pt-3"><p className="font-semibold">{r.machine?.machine_id||'—'}</p><p className="text-xs text-slate-500">{r.machine?.locations?.location_name||''}</p></td><td className="pt-3 text-slate-600">{r.method}</td><td className="pt-3 font-semibold">{Number(r.summary.units_dispensed||0)}</td><td className="p-3"><div className="flex min-w-[360px] gap-2"><select className={inputClass} value={mapping[r.source]||r.machine?.id||''} onChange={e=>setMapping(x=>({...x,[r.source]:e.target.value}))}><option value="">Select machine…</option>{machines.map(m=><option key={m.id} value={m.id}>{m.machine_id} — {m.locations?.location_name||'No location'} ({m.locations?.agency||'No agency'})</option>)}</select><button disabled={!mapping[r.source]&&!r.machine?.id} onClick={()=>void save(r.source)} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-40">Save</button><button onClick={()=>void save(r.source,true)} className="rounded-lg border px-3 py-2 font-semibold">Ignore</button></div></td></tr>)}</tbody></table>{!visible.length&&<div className="p-10 text-center text-slate-500"><CheckCircle2 className="mx-auto mb-2"/>No matching conflicts.</div>}</div>}</Card>
 <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><div className="flex gap-2"><AlertTriangle size={18}/><p><strong>Matching order:</strong> saved resolution, machine UUID, WTN ID, then one unique normalized facility-name match. Ambiguous names are never assigned automatically.</p></div></div></div>
}
