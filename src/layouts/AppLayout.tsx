import { APP_NAME, VERSION_LABEL } from "../config/version";
import { NavLink, Outlet } from 'react-router-dom'
import { BarChart3, Boxes, Database, FileText, Gauge, Settings, ShieldCheck, Sigma, Upload, Users, Sparkles, ListChecks, FlaskConical, TrendingUp, Microscope, BadgeCheck, Scale, ScanSearch, AlertTriangle } from 'lucide-react'

type NavItem={label:string;to:string;icon:typeof BarChart3;end?:boolean}
type NavGroup={label:string;description?:string;items:NavItem[]}
type Phase={label:string;tone:'blue'|'violet';groups:NavGroup[]}

const phases:Phase[]=[
 {label:'Phase 1 — Operations',tone:'blue',groups:[
  {label:'Program Overview',items:[{label:'Command Center',to:'/',icon:BarChart3,end:true},{label:'Operations Analyzer',to:'/operations-analyzer',icon:ScanSearch}]},
  {label:'Placement & Access',description:'Strategic network design',items:[{label:'Locations',to:'/locations',icon:Gauge}]},
  {label:'Inventory Availability',description:'Operational control',items:[{label:'Machines & Inventory',to:'/machines',icon:Boxes},{label:'Machine Logs',to:'/machine-logs',icon:Upload},{label:'Safety Stock',to:'/safety-stock',icon:ShieldCheck}]},
  {label:'Service Capacity',description:'Operational feasibility',items:[{label:'Staffing',to:'/staffing',icon:Users}]},
  {label:'Data Management',items:[{label:'Imports & Readiness',to:'/data-management',icon:Database},{label:'Sync Conflicts',to:'/sync-conflicts',icon:AlertTriangle}]},
  {label:'Model & Evaluation',items:[{label:'Reports',to:'/reports',icon:FileText},{label:'Calculations',to:'/calculations',icon:Sigma}]},
  {label:'Administration',items:[{label:'Settings',to:'/settings',icon:Settings}]},
 ]},
 {label:'Phase 2 — Decision Support',tone:'violet',groups:[
  {label:'Optimization',items:[{label:'Optimization Center',to:'/phase-2/optimization',icon:Sparkles},{label:'Recommendations',to:'/phase-2/recommendations',icon:ListChecks},{label:'Scenario Comparison',to:'/phase-2/scenarios',icon:FlaskConical}]},
  {label:'Predictive Analytics',items:[{label:'Forecasting',to:'/phase-2/forecasting',icon:TrendingUp}]},
  {label:'Research & Validation',items:[{label:'Research Mode',to:'/phase-2/research',icon:Microscope},{label:'Model Validation',to:'/phase-2/validation',icon:BadgeCheck},{label:'Equity & Availability',to:'/phase-2/equity',icon:Scale}]},
 ]}
]

export default function AppLayout(){return <div className="min-h-screen bg-slate-50"><aside className="fixed inset-y-0 left-0 z-30 w-72 overflow-y-auto bg-slate-950 px-4 py-5 text-white"><div className="mb-6 px-2"><p className="text-xs font-semibold uppercase tracking-[.2em] text-blue-300">{APP_NAME}<span className="ml-2 rounded-md border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{VERSION_LABEL}</span></p><h1 className="mt-1.5 text-xl font-bold">Decision Platform</h1><p className="mt-1 text-xs leading-5 text-slate-400">Availability-first operations and decision support</p></div><nav className="space-y-7">{phases.map(phase=><section key={phase.label} className={phase.label.startsWith('Phase 2')?'border-t border-violet-500/30 pt-6':''}><div className={`mb-4 rounded-xl px-3 py-2 text-[11px] font-bold uppercase tracking-[.16em] ${phase.tone==='violet'?'bg-violet-500/15 text-violet-300':'bg-blue-500/10 text-blue-300'}`}>{phase.label}</div><div className="space-y-5">{phase.groups.map(group=><section key={group.label}><div className="mb-1.5 px-3"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-slate-500">{group.label}</p>{group.description?<p className="mt-0.5 text-[10px] text-slate-600">{group.description}</p>:null}</div><div className="space-y-1">{group.items.map(({label,to,icon:Icon,end})=><NavLink key={to} to={to} end={end} className={({isActive})=>`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${isActive?(phase.tone==='violet'?'bg-violet-600 text-white shadow-sm shadow-violet-950/40':'bg-blue-600 text-white shadow-sm shadow-blue-950/40'):'text-slate-300 hover:bg-slate-800 hover:text-white'}`}><Icon size={18}/><span>{label}</span></NavLink>)}</div></section>)}</div></section>)}</nav></aside><main className="ml-72 min-h-screen"><header className="flex h-20 items-center justify-between border-b border-slate-200 bg-white px-8"><div><h2 className="font-semibold text-slate-900">Intelligent Vending Program Management</h2><p className="text-sm text-slate-500">Phase 1 operations remain separate from Phase 2 analytics and recommendations</p></div><div className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium">Program Manager</div></header><div className="p-8"><Outlet/></div></main></div>}
