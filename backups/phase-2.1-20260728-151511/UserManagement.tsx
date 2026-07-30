import { FormEvent, useEffect, useState } from 'react'
import { Plus, Save, Trash2, UserCog, UserRoundCheck } from 'lucide-react'
import { Badge, Card, Field, inputClass } from './ui'
import { createUser, deleteUser, listUsers, updateUser, type LocalUser, type PublicUser } from '../lib/localAuth'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'

type FormState = { displayName: string; email: string; role: LocalUser['role']; password: string }
const emptyForm: FormState = { displayName: '', email: '', role: 'Viewer', password: '' }

export default function UserManagement() {
  const { user: currentUser } = useAuth()

  const refreshUser = async () => {
    const { error } = await supabase.auth.refreshSession()

    if (error) {
      console.error('Unable to refresh the authenticated user:', error)
      throw error
    }
  }
  const [users, setUsers] = useState<PublicUser[]>([])
  const [form, setForm] = useState<FormState>(emptyForm)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const refresh = () => setUsers(listUsers())
  useEffect(refresh, [])

  const edit = (user: PublicUser) => { setEditingId(user.id); setForm({ displayName: user.displayName, email: user.email, role: user.role, password: '' }); setMessage('') }
  const reset = () => { setEditingId(null); setForm(emptyForm); setMessage('') }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true); setMessage('')
    try {
      if (editingId) await updateUser(editingId, { displayName: form.displayName, email: form.email, role: form.role, ...(form.password ? { password: form.password } : {}) })
      else await createUser(form)
      refresh(); refreshUser(); reset(); setMessage(editingId ? 'User updated.' : 'User created.')
    } catch (problem) { setMessage(problem instanceof Error ? problem.message : 'User could not be saved.') }
    finally { setSaving(false) }
  }
  const toggleActive = async (user: PublicUser) => {
    try { await updateUser(user.id, { active: !user.active }); refresh(); refreshUser(); setMessage(`${user.displayName} ${user.active ? 'disabled' : 'enabled'}.`) }
    catch (problem) { setMessage(problem instanceof Error ? problem.message : 'User could not be updated.') }
  }
  const remove = (user: PublicUser) => {
    if (!confirm(`Delete ${user.displayName}? This cannot be undone.`)) return
    try { deleteUser(user.id); refresh(); setMessage('User deleted.') } catch (problem) { setMessage(problem instanceof Error ? problem.message : 'User could not be deleted.') }
  }

  return <div className="grid gap-5 xl:grid-cols-[.9fr_1.4fr]">
    <Card className="p-5"><div className="flex items-center gap-3"><div className="rounded-xl bg-blue-100 p-2.5 text-blue-700"><UserCog size={21}/></div><div><h2 className="font-bold">{editingId ? 'Edit User' : 'Add User'}</h2><p className="text-xs text-slate-500">Manage application users, authentication, roles, and permissions.</p></div></div>
      <form onSubmit={submit} className="mt-5 space-y-4"><Field label="Display Name"><input className={inputClass} value={form.displayName} onChange={(e) => setForm({...form,displayName:e.target.value})} required /></Field><Field label="Email"><input className={inputClass} type="email" value={form.email} onChange={(e) => setForm({...form,email:e.target.value})} required /></Field><Field label="Role"><select className={inputClass} value={form.role} onChange={(e) => setForm({...form,role:e.target.value as LocalUser['role']})}><option>Administrator</option><option>Program Manager</option><option>Analyst</option><option>Viewer</option></select></Field><Field label={editingId ? 'New Password (leave blank to keep current)' : 'Password'}><input className={inputClass} type="password" minLength={6} value={form.password} onChange={(e) => setForm({...form,password:e.target.value})} required={!editingId}/></Field><div className="flex gap-2"><button disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white"><Save size={16}/>{saving ? 'Saving…' : editingId ? 'Update User' : 'Add User'}</button>{editingId && <button type="button" onClick={reset} className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-semibold">Cancel</button>}</div></form>
      {message && <div className="mt-4 rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700">{message}</div>}
    </Card>
    <Card className="overflow-hidden"><div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="font-bold">Users & Access</h2><p className="text-xs text-slate-500">{users.length} configured account{users.length === 1 ? '' : 's'}</p></div><Badge tone="blue"><UserRoundCheck size={13} className="mr-1"/>Users & Access</Badge></div><div className="divide-y divide-slate-100">{users.map((user) => <div key={user.id} className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"><div><div className="flex items-center gap-2"><p className="font-semibold text-slate-900">{user.displayName}</p>{currentUser?.id === user.id && <Badge tone="green">Current</Badge>}{!user.active && <Badge tone="red">Disabled</Badge>}</div><p className="mt-1 text-sm text-slate-500">{user.email}</p><p className="mt-1 text-xs text-slate-400">{user.role}</p></div><div className="flex gap-2"><button onClick={() => edit(user)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold hover:bg-slate-50">Edit</button><button disabled={currentUser?.id === user.id} onClick={() => toggleActive(user)} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold disabled:opacity-40">{user.active ? 'Disable' : 'Enable'}</button><button disabled={currentUser?.id === user.id} onClick={() => remove(user)} className="rounded-lg border border-rose-200 p-2 text-rose-600 disabled:opacity-40"><Trash2 size={15}/></button></div></div>)}</div></Card>
  </div>
}