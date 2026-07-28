import { FormEvent, useState } from 'react'
import { Eye, EyeOff, LockKeyhole, LogIn, ShieldCheck } from 'lucide-react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { APP_NAME, VERSION_LABEL } from '../config/version'

export default function Login() {
  const { user, signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('johnderaldvanhorn@gmail.com')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  if (user) return <Navigate to="/" replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSubmitting(true); setError('')
    try {
      await signIn(email, password)
      const destination = (location.state as { from?: string } | null)?.from || '/'
      navigate(destination, { replace: true })
    } catch (problem) { setError(problem instanceof Error ? problem.message : 'Login failed.') }
    finally { setSubmitting(false) }
  }

  return <div className="min-h-screen bg-slate-950 px-5 py-10 text-slate-900">
    <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl overflow-hidden rounded-3xl bg-white shadow-2xl lg:grid-cols-[1.08fr_.92fr]">
      <section className="hidden bg-gradient-to-br from-blue-700 via-blue-800 to-slate-950 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div><div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold"><ShieldCheck size={15}/>Secure program access</div><h1 className="mt-8 max-w-xl text-5xl font-bold leading-tight">Intelligent vending operations, decisions, and planning in one workspace.</h1><p className="mt-5 max-w-lg text-lg leading-8 text-blue-100">Monitor fleet performance, identify inventory risk, and prioritize operational action through the IVM Program Decision Platform.</p></div>
        <div className="text-sm text-blue-200">{APP_NAME} {VERSION_LABEL} · Authorized users only</div>
      </section>
      <section className="flex items-center p-7 sm:p-12">
        <div className="mx-auto w-full max-w-md">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-200"><LockKeyhole size={27}/></div>
          <p className="mt-7 text-xs font-bold uppercase tracking-[.18em] text-blue-600">{APP_NAME} {VERSION_LABEL}</p>
          <h2 className="mt-2 text-3xl font-bold">Sign in</h2>
          <p className="mt-2 text-sm leading-6 text-slate-500">Enter your assigned account to access the program command center.</p>
          <form onSubmit={submit} className="mt-8 space-y-5">
            <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-700">Email address</span><input autoComplete="username" className="w-full rounded-xl border border-slate-300 px-4 py-3 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label className="block"><span className="mb-2 block text-sm font-semibold text-slate-700">Password</span><div className="relative"><input autoComplete="current-password" className="w-full rounded-xl border border-slate-300 px-4 py-3 pr-12 outline-none transition focus:border-blue-500 focus:ring-4 focus:ring-blue-100" type={showPassword ? 'text' : 'password'} value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-2 text-slate-500 hover:bg-slate-100">{showPassword ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
            {error && <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-medium text-rose-700">{error}</div>}
            <button disabled={submitting} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3.5 font-semibold text-white shadow-lg shadow-blue-200 transition hover:bg-blue-700 disabled:opacity-60"><LogIn size={18}/>{submitting ? 'Signing in…' : 'Sign in'}</button>
          </form>
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-800"><strong>Temporary local authentication:</strong> user accounts are stored in this browser until Supabase Authentication is enabled.</div>
        </div>
      </section>
    </div>
  </div>
}
