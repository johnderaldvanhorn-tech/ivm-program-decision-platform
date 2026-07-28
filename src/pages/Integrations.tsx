import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Mail, RefreshCw, Save, Send, ShieldCheck, XCircle } from 'lucide-react'
import { Badge, Card, Field, inputClass } from '../components/ui'
import { supabase } from '../lib/supabase'

type IntegrationStatus = {
  configured: boolean
  provider: string
  senderName: string
  senderEmail: string
  replyTo: string
  lastTestedAt?: string | null
  lastTestStatus?: 'success' | 'failed' | null
  keySuffix?: string | null
}

type FunctionResult = {
  ok: boolean
  message?: string
  status?: IntegrationStatus
  messageId?: string
  sentAt?: string
  error?: string
}

const DEFAULT_SENDER = 'support@contact.splatterin.com'

function adminToken() {
  return import.meta.env.VITE_IVM_INTEGRATION_ADMIN_TOKEN || ''
}

async function invokeCommunication(body: Record<string, unknown>) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.functions.invoke<FunctionResult>('resend-communication', {
    body,
    headers: { 'x-ivm-admin-token': adminToken() },
  })
  if (error) throw new Error(error.message)
  if (!data?.ok) throw new Error(data?.error || data?.message || 'The communication request failed.')
  return data
}

export default function Integrations() {
  const [status, setStatus] = useState<IntegrationStatus>({
    configured: false,
    provider: 'resend',
    senderName: 'IVM Program',
    senderEmail: DEFAULT_SENDER,
    replyTo: DEFAULT_SENDER,
  })
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [senderName, setSenderName] = useState('IVM Program')
  const [senderEmail, setSenderEmail] = useState(DEFAULT_SENDER)
  const [replyTo, setReplyTo] = useState(DEFAULT_SENDER)
  const [recipient, setRecipient] = useState('')
  const [subject, setSubject] = useState('IVM Program Test Email')
  const [message, setMessage] = useState('This is a successful communication test from the IVM Program Decision Platform.')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [testResult, setTestResult] = useState<{ messageId?: string; sentAt?: string } | null>(null)

  const maskedKey = useMemo(() => status.configured ? `••••••••••••${status.keySuffix || ''}` : 'No API key stored', [status])

  const loadStatus = async () => {
    setLoading(true)
    setNotice(null)
    try {
      const result = await invokeCommunication({ action: 'status' })
      if (result.status) {
        setStatus(result.status)
        setSenderName(result.status.senderName || 'IVM Program')
        setSenderEmail(result.status.senderEmail || DEFAULT_SENDER)
        setReplyTo(result.status.replyTo || DEFAULT_SENDER)
      }
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to load integration status.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadStatus() }, [])

  const save = async () => {
    setSaving(true)
    setNotice(null)
    try {
      const result = await invokeCommunication({
        action: 'save',
        apiKey: apiKey.trim() || undefined,
        senderName: senderName.trim(),
        senderEmail: senderEmail.trim(),
        replyTo: replyTo.trim(),
      })
      if (result.status) setStatus(result.status)
      setApiKey('')
      setShowKey(false)
      setNotice({ tone: 'success', text: result.message || 'Resend configuration saved.' })
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Unable to save the integration.' })
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    if (!recipient.trim()) {
      setNotice({ tone: 'error', text: 'Enter a recipient email address.' })
      return
    }
    setTesting(true)
    setNotice(null)
    setTestResult(null)
    try {
      const result = await invokeCommunication({
        action: 'test',
        recipient: recipient.trim(),
        subject: subject.trim(),
        message: message.trim(),
      })
      setTestResult({ messageId: result.messageId, sentAt: result.sentAt })
      setNotice({ tone: 'success', text: result.message || 'Test email sent successfully.' })
      await loadStatus()
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'The test email failed.' })
    } finally {
      setTesting(false)
    }
  }

  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[.16em] text-blue-600">Settings</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-950">Integrations & Communications</h1>
        <p className="mt-2 max-w-3xl text-sm text-slate-500">Configure the server-side Resend connection used for alerts, reports, user messages, and test communications.</p>
      </div>
      <button onClick={() => void loadStatus()} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"><RefreshCw size={16} className={loading ? 'animate-spin' : ''}/>Refresh Status</button>
    </div>

    {notice && <div className={`flex items-start gap-3 rounded-xl border px-4 py-3 text-sm ${notice.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{notice.tone === 'success' ? <CheckCircle2 size={18}/> : <XCircle size={18}/>}<span>{notice.text}</span></div>}

    <div className="grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3"><div className="rounded-xl bg-blue-50 p-3 text-blue-600"><Mail size={22}/></div><div><h2 className="text-lg font-bold text-slate-900">Resend Email</h2><p className="mt-1 text-sm text-slate-500">Server-side email provider for platform communications.</p></div></div>
          <Badge tone={status.configured ? 'green' : 'yellow'}>{loading ? 'Checking' : status.configured ? (status.lastTestStatus === 'success' ? 'Connected' : 'Ready') : 'Not Configured'}</Badge>
        </div>

        <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[.14em] text-slate-500">Stored API Key</p><p className="mt-1 font-mono text-sm text-slate-700">{maskedKey}</p></div><ShieldCheck className="text-emerald-600" size={22}/></div>
          <p className="mt-2 text-xs leading-5 text-slate-500">The complete key is never returned to the browser. Enter a new key below only when configuring or replacing it.</p>
        </div>

        <div className="mt-5 space-y-4">
          <Field label="Resend API Key">
            <div className="relative"><KeyRound className="pointer-events-none absolute left-3 top-3 text-slate-400" size={17}/><input className={`${inputClass} pl-10 pr-11`} type={showKey ? 'text' : 'password'} autoComplete="new-password" placeholder={status.configured ? 'Leave blank to keep current key' : 're_...'} value={apiKey} onChange={(event) => setApiKey(event.target.value)}/><button type="button" onClick={() => setShowKey((current) => !current)} className="absolute right-2 top-2 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100" title={showKey ? 'Hide key' : 'Show key'}>{showKey ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
          </Field>
          <div className="grid gap-4 md:grid-cols-2"><Field label="From Name"><input className={inputClass} value={senderName} onChange={(event) => setSenderName(event.target.value)}/></Field><Field label="From Email"><input className={inputClass} type="email" value={senderEmail} onChange={(event) => setSenderEmail(event.target.value)}/></Field></div>
          <Field label="Reply-To"><input className={inputClass} type="email" value={replyTo} onChange={(event) => setReplyTo(event.target.value)}/></Field>
          <button onClick={() => void save()} disabled={saving || !senderName.trim() || !senderEmail.trim()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">{saving ? <Loader2 size={16} className="animate-spin"/> : <Save size={16}/>}Save Configuration</button>
        </div>
      </Card>

      <Card className="p-5">
        <div className="flex items-start gap-3"><div className="rounded-xl bg-violet-50 p-3 text-violet-600"><Send size={22}/></div><div><h2 className="text-lg font-bold text-slate-900">Send Test Email</h2><p className="mt-1 text-sm text-slate-500">Verify the sender domain, API key, and delivery path.</p></div></div>
        <div className="mt-5 space-y-4"><Field label="Recipient"><input className={inputClass} type="email" placeholder="recipient@example.com" value={recipient} onChange={(event) => setRecipient(event.target.value)}/></Field><Field label="Subject"><input className={inputClass} value={subject} onChange={(event) => setSubject(event.target.value)}/></Field><Field label="Message"><textarea className={`${inputClass} min-h-32 resize-y`} value={message} onChange={(event) => setMessage(event.target.value)}/></Field><button onClick={() => void sendTest()} disabled={testing || !status.configured} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50">{testing ? <Loader2 size={16} className="animate-spin"/> : <Send size={16}/>}Send Test Email</button>{!status.configured && <p className="text-xs text-amber-700">Save the Resend configuration and API key before sending a test.</p>}</div>
        {testResult && <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800"><p className="font-bold">Delivered to Resend</p>{testResult.messageId && <p className="mt-1 break-all text-xs">Message ID: {testResult.messageId}</p>}{testResult.sentAt && <p className="mt-1 text-xs">Sent: {new Date(testResult.sentAt).toLocaleString()}</p>}</div>}
      </Card>
    </div>

    <Card className="p-5"><h2 className="font-bold text-slate-900">Connection Details</h2><div className="mt-4 grid gap-3 text-sm md:grid-cols-4"><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase text-slate-500">Provider</p><p className="mt-1 font-semibold text-slate-800">Resend</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase text-slate-500">Sender</p><p className="mt-1 break-all font-semibold text-slate-800">{status.senderEmail}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase text-slate-500">Last Tested</p><p className="mt-1 font-semibold text-slate-800">{status.lastTestedAt ? new Date(status.lastTestedAt).toLocaleString() : 'Never'}</p></div><div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase text-slate-500">Last Result</p><p className="mt-1 font-semibold text-slate-800">{status.lastTestStatus || 'Not tested'}</p></div></div></Card>
  </div>
}
