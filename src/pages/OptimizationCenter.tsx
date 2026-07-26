import { useEffect,useMemo,useState } from 'react'
import { Badge,Card } from '../components/ui'
import { buildRecommendations,loadPhase2Machines,type Phase2Machine } from '../lib/phase2'

export default function OptimizationCenter(){
 const [machines,setMachines]=useState<Phase2Machine[]>([]);const [loading,setLoading]=useState(true)
 useEffect(()=>{loadPhase2Machines().then(setMachines).finally(()=>setLoading(false))},[])
 const recs=useMemo(()=>buildRecommendations(machines),[machines])
 const kpis={machines:machines.length,recs:recs.length,critical:recs.filter(r=>r.priority==='Critical').length,dispensed:machines.reduce((s,m)=>s+m.units_dispensed,0),stockouts:machines.reduce((s,m)=>s+m.stockouts,0)}
 return <div className="space-y-6"><div><p className="text-xs font-bold uppercase tracking-[.18em] text-violet-600">Phase 2 — Decision Support</p><h1 className="mt-1 text-3xl font-bold text-slate-900">Optimization Center</h1><p className="text-slate-500">Compare observed operations with recommended placement, inventory, safety-stock, and service-capacity decisions.</p></div>
 <div className="grid gap-4 md:grid-cols-5">{Object.entries(kpis).map(([k,v])=><Card key={k}><p className="text-xs font-bold uppercase text-slate-500">{k.replaceAll('_',' ')}</p><p className="mt-2 text-2xl font-bold">{loading?'—':v.toLocaleString()}</p></Card>)}</div>
 <Card><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-bold">Current vs Recommended</h2><p className="text-sm text-slate-500">Recommendations are advisory and do not change Phase 1 records until approved.</p></div><Badge tone="blue">Non-destructive</Badge></div>
 <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Machine</th><th>Location</th><th>Capacity</th><th>Current</th><th>Fill</th><th>Dispensed</th><th>Stockouts</th><th>Recommendation</th></tr></thead><tbody>{machines.map(m=>{const rec=recs.find(r=>r.machine_uuid===m.machine_uuid);const fill=m.capacity?m.current_quantity/m.capacity:0;return <tr key={m.machine_uuid} className="border-t"><td className="p-3 font-semibold">{m.machine_wtn_id}</td><td>{m.location_name}<div className="text-xs text-slate-500">{m.agency}</div></td><td>{m.capacity}</td><td>{m.current_quantity}</td><td>{(fill*100).toFixed(0)}%</td><td>{m.units_dispensed}</td><td>{m.stockouts}</td><td>{rec?<><Badge tone={rec.priority==='Critical'?'red':rec.priority==='High'?'yellow':'blue'}>{rec.priority}</Badge><div className="mt-1 max-w-xs text-xs">{rec.title}</div></>:<Badge tone="green">No immediate change</Badge>}</td></tr>})}</tbody></table></div></Card></div>
}
