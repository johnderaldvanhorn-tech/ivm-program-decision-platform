import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Badge, Card, Field, inputClass } from '../components/ui'
import { calculateInventory } from '../lib/calculations'
import { supabase } from '../lib/supabase'

type Machine = { id: string; machine_id: string; capacity: number; current_inventory: number; supplier_reliability: number; max_orderable_quantity: number; active: boolean }
type InventoryRow = { id: string; period_date: string; demand: number; prior_inventory: number; units_replenished: number; units_dispensed: number; ending_inventory: number; unmet_demand: number; cost_per_unit: number; holding_cost_per_unit: number; stockout_penalty: number | null; total_period_cost: number; stockout_flag: boolean; inventory_status: string; machines?: { machine_id: string } | null }

const today = new Date().toISOString().slice(0, 10)
const emptyForm = { machine_id: '', period_date: today, demand: 0, prior_inventory: 0, units_replenished: 0, units_dispensed: 0, cost_per_unit: 0, holding_cost_per_unit: 0, stockout_penalty: '' }

export default function Inventory() {
  const [machines, setMachines] = useState<Machine[]>([])
  const [rows, setRows] = useState<InventoryRow[]>([])
  const [form, setForm] = useState(emptyForm)
  const [message, setMessage] = useState('')
  const [q, setQ] = useState('')
  const [showForm, setShowForm] = useState(false)
  const selected = machines.find(m => m.id === form.machine_id)

  async function loadData() {
    if (!supabase) return
    const [{ data: machineData, error: machineError }, { data: periodData, error: periodError }] = await Promise.all([
      supabase.from('machines').select('id,machine_id,capacity,current_inventory,supplier_reliability,max_orderable_quantity,active').order('machine_id'),
      supabase.from('inventory_periods').select('*, machines(machine_id)').order('period_date', { ascending: false }),
    ])
    if (machineError || periodError) setMessage(machineError?.message || periodError?.message || 'Unable to load inventory.')
    setMachines((machineData || []) as Machine[])
    setRows((periodData || []) as InventoryRow[])
  }

  useEffect(() => { void loadData() }, [])

  const result = useMemo(() => calculateInventory({
    priorInventory: Number(form.prior_inventory), replenished: Number(form.units_replenished), dispensed: Number(form.units_dispensed), demand: Number(form.demand), capacity: selected?.capacity || 0, supplierReliability: selected?.supplier_reliability || 0, maxOrderable: selected?.max_orderable_quantity || 0, costPerUnit: Number(form.cost_per_unit), holdingCost: Number(form.holding_cost_per_unit), stockoutPenalty: form.stockout_penalty === '' ? undefined : Number(form.stockout_penalty),
  }), [form, selected])

  function chooseMachine(id: string) {
    const machine = machines.find(m => m.id === id)
    setForm(v => ({ ...v, machine_id: id, prior_inventory: machine?.current_inventory || 0 }))
  }

  async function saveInventory(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !selected) return setMessage('Select a valid Machine ID.')
    const payload = { machine_id: selected.id, period_date: form.period_date, demand: Number(form.demand), prior_inventory: Number(form.prior_inventory), units_replenished: result.acceptedReplenishment, units_dispensed: result.dispensed, ending_inventory: result.endingInventory, unmet_demand: result.unmetDemand, cost_per_unit: Number(form.cost_per_unit), holding_cost_per_unit: Number(form.holding_cost_per_unit), stockout_penalty: form.stockout_penalty === '' ? 10 * Number(form.cost_per_unit) : Number(form.stockout_penalty), total_period_cost: result.totalCost, stockout_flag: result.endingInventory === 0 || result.unmetDemand > 0, inventory_status: result.status }
    const { error } = await supabase.from('inventory_periods').upsert(payload, { onConflict: 'machine_uuid,period_date' })
    if (error) return setMessage(error.message)
    const { error: machineError } = await supabase.from('machines').update({ current_inventory: result.endingInventory, updated_at: new Date().toISOString() }).eq('id', selected.id)
    if (machineError) return setMessage(machineError.message)
    setMessage(`Inventory saved for ${selected.machine_id}.`)
    setShowForm(false)
    setForm(emptyForm)
    await loadData()
  }

  const filtered = rows.filter(r => `${r.machines?.machine_id || ''} ${r.period_date} ${r.inventory_status}`.toLowerCase().includes(q.toLowerCase()))
  const tone = (status: string): 'green'|'yellow'|'red'|'slate' => status === 'Healthy' ? 'green' : status === 'Watch' ? 'yellow' : status === 'Restock Required' || status === 'Stockout' ? 'red' : 'slate'

  return <div className="space-y-6">
    <div className="flex items-end justify-between gap-4"><div><h1 className="text-2xl font-bold">Inventory</h1><p className="text-slate-500">Load inventory activity by Machine ID and update each machine’s current inventory.</p></div><div className="flex gap-3"><input className={`${inputClass} w-72`} placeholder="Search Machine ID or status..." value={q} onChange={e => setQ(e.target.value)} /><button onClick={() => setShowForm(true)} className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white">Add Inventory Period</button></div></div>
    {message && <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">{message}</div>}

    {showForm && <Card><form className="space-y-5" onSubmit={saveInventory}><div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">Load Inventory Information</h2><p className="text-sm text-slate-500">Select a Machine ID, enter period activity, and review the calculated ending balance.</p></div><button type="button" onClick={() => setShowForm(false)} className="text-sm font-semibold text-slate-500">Close</button></div>
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Machine ID"><select className={inputClass} value={form.machine_id} onChange={e => chooseMachine(e.target.value)} required><option value="">Select Machine ID</option>{machines.map(m => <option key={m.id} value={m.id}>{m.machine_id}</option>)}</select></Field>
        <Field label="Period Date"><input type="date" className={inputClass} value={form.period_date} onChange={e => setForm(v => ({ ...v, period_date: e.target.value }))} /></Field>
        <Field label="Capacity"><input className={inputClass} value={selected?.capacity ?? ''} readOnly /></Field>
        <Field label="Prior Inventory"><input type="number" min="0" className={inputClass} value={form.prior_inventory} onChange={e => setForm(v => ({ ...v, prior_inventory: Number(e.target.value) }))} /></Field>
        <Field label="Demand"><input type="number" min="0" className={inputClass} value={form.demand} onChange={e => setForm(v => ({ ...v, demand: Number(e.target.value) }))} /></Field>
        <Field label="Units Replenished"><input type="number" min="0" className={inputClass} value={form.units_replenished} onChange={e => setForm(v => ({ ...v, units_replenished: Number(e.target.value) }))} /></Field>
        <Field label="Units Dispensed"><input type="number" min="0" className={inputClass} value={form.units_dispensed} onChange={e => setForm(v => ({ ...v, units_dispensed: Number(e.target.value) }))} /></Field>
        <Field label="Supplier Reliability"><input className={inputClass} value={selected ? `${Math.round(selected.supplier_reliability * 100)}%` : ''} readOnly /></Field>
        <Field label="Cost per Unit"><input type="number" min="0" step="0.01" className={inputClass} value={form.cost_per_unit} onChange={e => setForm(v => ({ ...v, cost_per_unit: Number(e.target.value) }))} /></Field>
        <Field label="Holding Cost per Unit"><input type="number" min="0" step="0.01" className={inputClass} value={form.holding_cost_per_unit} onChange={e => setForm(v => ({ ...v, holding_cost_per_unit: Number(e.target.value) }))} /></Field>
        <Field label="Stockout Penalty (blank = 10× cost)"><input type="number" min="0" step="0.01" className={inputClass} value={form.stockout_penalty} onChange={e => setForm(v => ({ ...v, stockout_penalty: e.target.value }))} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-5"><Card className="bg-slate-50"><p className="text-xs uppercase text-slate-500">Accepted Replenishment</p><p className="mt-1 text-xl font-bold">{result.acceptedReplenishment}</p></Card><Card className="bg-slate-50"><p className="text-xs uppercase text-slate-500">Ending Inventory</p><p className="mt-1 text-xl font-bold">{result.endingInventory}</p></Card><Card className="bg-slate-50"><p className="text-xs uppercase text-slate-500">Unmet Demand</p><p className="mt-1 text-xl font-bold">{result.unmetDemand}</p></Card><Card className="bg-slate-50"><p className="text-xs uppercase text-slate-500">Period Cost</p><p className="mt-1 text-xl font-bold">${result.totalCost.toFixed(2)}</p></Card><Card className="bg-slate-50"><p className="text-xs uppercase text-slate-500">Status</p><div className="mt-2"><Badge tone={tone(result.status)}>{result.status}</Badge></div></Card></div>
      <div className="flex justify-end"><button className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white">Save Inventory</button></div>
    </form></Card>}

    <Card className="overflow-hidden p-0"><table className="w-full text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr>{['Machine ID','Period','Prior','Replenished','Dispensed','Ending','Unmet','Status','Cost'].map(h => <th className="px-5 py-4" key={h}>{h}</th>)}</tr></thead><tbody>{filtered.length === 0 ? <tr><td colSpan={9} className="px-5 py-8 text-center text-slate-500">No inventory periods found.</td></tr> : filtered.map(r => <tr key={r.id} className="border-t border-slate-100"><td className="px-5 py-4 font-semibold">{r.machines?.machine_id || '—'}</td><td className="px-5 py-4">{r.period_date}</td><td className="px-5 py-4">{r.prior_inventory}</td><td className="px-5 py-4">{r.units_replenished}</td><td className="px-5 py-4">{r.units_dispensed}</td><td className="px-5 py-4">{r.ending_inventory}</td><td className="px-5 py-4">{r.unmet_demand}</td><td className="px-5 py-4"><Badge tone={tone(r.inventory_status)}>{r.inventory_status}</Badge></td><td className="px-5 py-4">${Number(r.total_period_cost).toFixed(2)}</td></tr>)}</tbody></table></Card>
  </div>
}
