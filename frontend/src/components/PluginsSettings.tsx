import { useEffect, useState } from 'react'
import { Puzzle, Calendar, CheckCircle2, XCircle, Loader2, ChevronLeft, Copy, RefreshCw, BookOpen, AlertTriangle, Tags } from 'lucide-react'

// Setup guide for the Google Calendar plugin (creating a Google OAuth Client,
// the "unverified app" warning, how sync works) — lives in the repo so it's
// versioned alongside the code that implements it.
const GOOGLE_CALENDAR_DOCS_URL = 'https://github.com/renantmagalhaes/BlockForgeMD/blob/main/docs/plugins/google-calendar.md'

type PluginMeta = {
  id: string
  name: string
  category: string
  status: 'available' | 'coming_soon'
}

type GCalConfig = {
  clientId: string
  hasClientSecret: boolean
  pollIntervalSeconds: number
  workspaces: string[]
  productionConfirmed: boolean
  redirectUri: string
  isPrivateHost: boolean
}

type GCalStatus = {
  connected: boolean
  googleEmail?: string
  calendarId?: string
  lastSyncAt?: string
  lastSyncError?: string
  syncedPageCount: number
}

type CalendarOption = {
  id: string
  summary: string
  primary: boolean
}

function relativeTime(iso?: string): string {
  if (!iso) return 'never'
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.round(diffMs / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

// ─── PluginsSettings ─────────────────────────────────────────────────────────
// Settings > Plugins: a store-style grid of integrations. Google Calendar is
// the first real plugin (2-way due-date sync); MCP Servers/LLM Providers are
// coming-soon placeholders establishing the same store framing for later.
export default function PluginsSettings() {
  const [plugins, setPlugins] = useState<PluginMeta[]>([])
  const [view, setView] = useState<'grid' | 'google-calendar' | 'ollama-tagger'>('grid')

  useEffect(() => {
    fetch('/api/plugins', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setPlugins(d.plugins ?? []))
      .catch(() => {})
  }, [])

  if (view === 'google-calendar') {
    return <GoogleCalendarDetail onBack={() => setView('grid')} />
  }
  if (view === 'ollama-tagger') return <OllamaTaggerDetail onBack={() => setView('grid')} />

  const googleCalendar = plugins.find(p => p.id === 'google-calendar')
  const ollamaTagger = plugins.find(p => p.id === 'ollama-tagger')
  const comingSoon = plugins.filter(p => p.status === 'coming_soon')

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <h4 className="font-bold text-sm text-slate-100">Plugins</h4>
      <p className="text-xs text-slate-500 -mt-3 break-words">
        Connect external tools, calendars, and AI providers directly into your workspace.
      </p>

      <div className="grid grid-cols-2 gap-3">
        {googleCalendar && (
          <button
            onClick={() => setView('google-calendar')}
            className="text-left bg-slate-900/50 hover:bg-slate-900 border border-slate-800 hover:border-violet-500/40 rounded-xl p-4 space-y-2 transition cursor-pointer"
          >
            <div className="flex items-center gap-2">
              <Calendar size={16} className="text-blue-400" />
              <span className="text-sm font-semibold text-slate-100">{googleCalendar.name}</span>
            </div>
            <p className="text-[11px] text-slate-500">2-way sync between page due dates and your Google Calendar.</p>
          </button>
        )}
        {ollamaTagger && <button onClick={() => setView('ollama-tagger')} className="text-left bg-slate-900/50 hover:bg-slate-900 border border-slate-800 hover:border-violet-500/40 rounded-xl p-4 space-y-2 transition cursor-pointer"><div className="flex items-center gap-2"><Tags size={16} className="text-violet-400" /><span className="text-sm font-semibold text-slate-100">{ollamaTagger.name}</span></div><p className="text-[11px] text-slate-500">Use Ollama or OpenRouter to add and refresh contextual page tags.</p></button>}

        {comingSoon.map(p => (
          <div
            key={p.id}
            className="bg-slate-900/30 border border-slate-800/60 rounded-xl p-4 space-y-2 opacity-60 cursor-not-allowed"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Puzzle size={16} className="text-slate-500" />
                <span className="text-sm font-semibold text-slate-300">{p.name}</span>
              </div>
              <span className="text-[9px] uppercase tracking-wide font-bold text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded">
                Coming soon
              </span>
            </div>
            <p className="text-[11px] text-slate-600">
              {p.category === 'mcp' ? 'Connect Model Context Protocol servers.' : 'Bring your own LLM provider.'}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}

type OllamaConfig = { provider: 'ollama' | 'openrouter'; endpoint: string; apiKey: string; hasApiKey?: boolean; model: string; autoEnabled: boolean; recheckOnChange: boolean; pollIntervalSeconds: number; maxTags: number; workspaces: string[] }
function OllamaTaggerDetail({ onBack }: { onBack: () => void }) {
  const [c,setC]=useState<OllamaConfig>({provider:'ollama',endpoint:'http://10.0.10.11:11434',apiKey:'',model:'',autoEnabled:false,recheckOnChange:true,pollIntervalSeconds:900,maxTags:5,workspaces:[]}); const [msg,setMsg]=useState(''); const [saving,setSaving]=useState(false)
  const [models,setModels]=useState<string[]>([]); const [loadingModels,setLoadingModels]=useState(false)
  const [allWorkspaces,setAllWorkspaces]=useState<string[]>([]); const [restrictWorkspaces,setRestrictWorkspaces]=useState(false)
  useEffect(()=>{fetch('/api/plugins/ollama-tagger/config',{credentials:'include'}).then(r=>r.json()).then(d=>{const next={...c,...d,provider:d.provider??'ollama'} as OllamaConfig; setC(next); setRestrictWorkspaces((d.workspaces??[]).length>0); if (next.provider==='openrouter' ? next.hasApiKey : next.endpoint) void loadModels(next.provider,next.endpoint,next.model)}).catch(()=>{}); fetch('/api/workspaces',{credentials:'include'}).then(r=>r.json()).then(d=>setAllWorkspaces(d.workspaces??[])).catch(()=>{})},[])
  async function loadModels(provider=c.provider, endpoint=c.endpoint, savedModel=c.model) { setLoadingModels(true); setMsg(''); try { const r=await fetch(`/api/plugins/ollama-tagger/models?provider=${provider}&endpoint=${encodeURIComponent(endpoint)}`,{credentials:'include',headers:provider==='openrouter'&&c.apiKey?{'X-OpenRouter-Key':c.apiKey}:{}}); if(!r.ok) { setMsg(await r.text()); return }; const d=await r.json(); setModels(d.models??[]); if (!savedModel && d.models?.length) setC(x=>({...x,model:d.models[0]})); if (!d.models?.length) setMsg(`${provider === 'ollama' ? 'Ollama is reachable' : 'OpenRouter is reachable'} but has no available models.`) } finally { setLoadingModels(false) } }
  async function save(next=c){setSaving(true);setMsg(''); try {const r=await fetch('/api/plugins/ollama-tagger/config',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(next)});setMsg(r.ok?'Saved. These settings are personal to your account.':await r.text())} finally {setSaving(false)}}
  function updateCheckbox(next: OllamaConfig) { setC(next); void save(next) }
  return <div className="space-y-5 animate-in fade-in duration-150 min-w-0"><button onClick={onBack} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-100"><ChevronLeft size={14}/> Plugins</button><div><h4 className="font-bold text-sm text-slate-100">AI Auto Tags</h4><p className="text-xs text-slate-500 mt-1 break-words">Personal to your signed-in account — nothing configured here is shared with other users.</p></div><div className="space-y-3 bg-slate-900/50 border border-slate-800 rounded-xl p-4"><label className="block text-xs text-slate-300">AI provider<select value={c.provider} onChange={e=>{const provider=e.target.value as OllamaConfig['provider']; setC({...c,provider,model:''});setModels([]);setMsg('')}} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs"><option value="ollama">Ollama</option><option value="openrouter">OpenRouter</option></select></label>{c.provider==='ollama'?<label className="block text-xs text-slate-300">Ollama endpoint<input value={c.endpoint} onChange={e=>setC({...c,endpoint:e.target.value})} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs" placeholder="http://host:11434"/></label>:<label className="block text-xs text-slate-300">OpenRouter API key<input type="password" value={c.apiKey} onChange={e=>setC({...c,apiKey:e.target.value})} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs" placeholder={c.hasApiKey?'Saved key (enter a new one to replace it)':'sk-or-...'}/></label>}<div className="flex items-end gap-2"><label className="block min-w-0 flex-1 text-xs text-slate-300">Model search<input list="ai-auto-tag-models" value={c.model} onChange={e=>setC({...c,model:e.target.value})} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs" placeholder="Search or choose a model…"/><datalist id="ai-auto-tag-models">{models.map(m=><option key={m} value={m}/>)}</datalist></label><button onClick={()=>loadModels()} disabled={loadingModels||(c.provider==='ollama'?!c.endpoint:(!c.apiKey&&!c.hasApiKey))} className="shrink-0 px-3 py-1.5 border border-slate-700 hover:border-violet-500 rounded text-xs">{loadingModels?'Checking…':'Fetch models'}</button></div><div className="grid grid-cols-2 gap-3"><label className="text-xs text-slate-300">Schedule (minutes)<input type="number" min="1" value={Math.round(c.pollIntervalSeconds/60)} onChange={e=>setC({...c,pollIntervalSeconds:Number(e.target.value)*60})} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs"/></label><label className="text-xs text-slate-300">Max plugin tags<input type="number" min="1" max="20" value={c.maxTags} onChange={e=>setC({...c,maxTags:Number(e.target.value)})} className="mt-1 w-full bg-slate-950 border border-slate-700 rounded px-2 py-1.5 text-xs"/></label></div><label className="flex gap-2 text-xs text-slate-300"><input type="checkbox" checked={c.autoEnabled} onChange={e=>updateCheckbox({...c,autoEnabled:e.target.checked})}/> Automatically tag all documents on schedule</label><label className="flex gap-2 text-xs text-slate-300"><input type="checkbox" checked={c.recheckOnChange} onChange={e=>updateCheckbox({...c,recheckOnChange:e.target.checked})}/> Recheck changed documents</label><label className="flex gap-2 text-xs text-slate-300"><input type="checkbox" checked={restrictWorkspaces} onChange={e=>{setRestrictWorkspaces(e.target.checked);updateCheckbox({...c,workspaces:e.target.checked?c.workspaces:[]})}}/> Limit to selected workspaces</label>{restrictWorkspaces&&<div className="ml-5 space-y-1">{allWorkspaces.map(w=><label key={w} className="flex gap-2 text-xs text-slate-400"><input type="checkbox" checked={c.workspaces.includes(w)} onChange={e=>updateCheckbox({...c,workspaces:e.target.checked?[...c.workspaces,w]:c.workspaces.filter(x=>x!==w)})}/>{w}</label>)}</div>}<button disabled={saving} onClick={()=>save()} className="px-3 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded text-xs font-semibold">{saving?'Saving…':'Save settings'}</button>{msg&&<p className="text-xs text-slate-400 break-words">{msg}</p>}</div></div>
}

// ─── GoogleCalendarDetail ────────────────────────────────────────────────────
function GoogleCalendarDetail({ onBack }: { onBack: () => void }) {
  const [config, setConfig] = useState<GCalConfig | null>(null)
  const [status, setStatus] = useState<GCalStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(2)
  const [allWorkspaces, setAllWorkspaces] = useState<string[]>([])
  const [selectedWorkspaces, setSelectedWorkspaces] = useState<string[]>([])
  // Tracked separately from selectedWorkspaces: an empty selection is
  // ambiguous on its own (it's also what "All workspaces" looks like on the
  // wire), so this is what actually drives showing the per-workspace
  // checkboxes vs. the "All workspaces" state.
  const [restrictWorkspaces, setRestrictWorkspaces] = useState(false)
  const [savingConfig, setSavingConfig] = useState(false)
  const [configMsg, setConfigMsg] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [calendars, setCalendars] = useState<CalendarOption[]>([])
  const [switchingCalendar, setSwitchingCalendar] = useState(false)
  const [connectError, setConnectError] = useState('')

  function reloadConfig() {
    fetch('/api/plugins/google-calendar/config', { credentials: 'include' })
      .then(r => r.json())
      .then((d: GCalConfig) => {
        setConfig(d)
        setClientId(d.clientId ?? '')
        if (d.pollIntervalSeconds) setPollIntervalMinutes(Math.round(d.pollIntervalSeconds / 60) || 1)
        setSelectedWorkspaces(d.workspaces ?? [])
        setRestrictWorkspaces((d.workspaces ?? []).length > 0)
      })
      .catch(() => {})
  }

  function reloadWorkspaceList() {
    fetch('/api/workspaces', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setAllWorkspaces(d.workspaces ?? []))
      .catch(() => {})
  }

  function reloadStatus() {
    fetch('/api/plugins/google-calendar/status', { credentials: 'include' })
      .then(r => r.json())
      .then((d: GCalStatus) => {
        setStatus(d)
        if (d.connected) reloadCalendars()
      })
      .catch(() => {})
  }

  function reloadCalendars() {
    fetch('/api/plugins/google-calendar/calendars', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setCalendars(d.calendars ?? []))
      .catch(() => {})
  }

  useEffect(() => { reloadConfig(); reloadStatus(); reloadWorkspaceList() }, [])

  async function changeCalendar(calendarId: string) {
    setSwitchingCalendar(true)
    try {
      await fetch('/api/plugins/google-calendar/calendar', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ calendarId }),
      })
      reloadStatus()
    } finally {
      setSwitchingCalendar(false)
    }
  }

  async function saveConfig(e: React.FormEvent) {
    e.preventDefault()
    setSavingConfig(true)
    setConfigMsg('')
    try {
      const res = await fetch('/api/plugins/google-calendar/config', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId, clientSecret,
          pollIntervalSeconds: Math.max(1, pollIntervalMinutes) * 60,
          workspaces: selectedWorkspaces,
        }),
      })
      if (res.ok) {
        setConfigMsg('Saved.')
        setClientSecret('')
        reloadConfig()
      } else {
        setConfigMsg(await res.text() || 'Failed to save.')
      }
    } finally {
      setSavingConfig(false)
    }
  }

  async function connect() {
    setConnectError('')
    const res = await fetch('/api/plugins/google-calendar/oauth/start', { credentials: 'include' })
    if (res.ok) {
      const d = await res.json()
      window.location.href = d.authorizeUrl
    } else {
      setConnectError(await res.text() || 'Failed to start connecting.')
    }
  }

  async function disconnect() {
    await fetch('/api/plugins/google-calendar/disconnect', { method: 'POST', credentials: 'include' })
    reloadStatus()
  }

  async function syncNow() {
    setSyncing(true)
    await fetch('/api/plugins/google-calendar/sync-now', { method: 'POST', credentials: 'include' })
    setTimeout(() => { reloadStatus(); setSyncing(false) }, 2000)
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-200 transition cursor-pointer">
        <ChevronLeft size={14} /> Back to Plugins
      </button>

      <div className="flex items-center flex-wrap gap-2 justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <Calendar size={18} className="text-blue-400 shrink-0" />
          <h4 className="font-bold text-sm text-slate-100 truncate">Google Calendar</h4>
        </div>
        <a
          href={GOOGLE_CALENDAR_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11px] text-violet-400 hover:text-violet-300 transition shrink-0 whitespace-nowrap"
        >
          <BookOpen size={12} className="shrink-0" /> Setup guide
        </a>
      </div>
      <p className="text-xs text-slate-500 -mt-3 break-words">
        Any page with a due date syncs both ways with your Google Calendar. Sync runs automatically on the interval below, or on demand.
      </p>

      {config?.isPrivateHost && (
        <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-700/40 rounded-lg px-3 py-2.5 text-[11px] text-amber-300">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="min-w-0 flex-1">
            <strong>This won't work from here.</strong> You're accessing BlockForgeMD at a private IP address. Google's OAuth
            rejects private IP addresses as redirect URIs, so connecting will always fail. Access the app via a hostname
            instead (e.g. add an entry to your hosts file mapping a name to this address), then reload this page — see the{' '}
            <a href={GOOGLE_CALENDAR_DOCS_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-200">
              setup guide
            </a>.
          </span>
        </div>
      )}

      {/* Per-user OAuth config */}
      <form onSubmit={saveConfig} className="space-y-2 border-t border-slate-800 pt-4">
        <p className="text-xs font-semibold text-slate-400">Google OAuth credentials</p>
        <p className="text-[10px] text-slate-500 break-words">
          Create your own OAuth Client in Google Cloud Console and register the redirect URI below, then paste your Client ID/Secret here. This is just for your account — nothing here is shared with other users on this instance.
        </p>

        {config && (
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
            <code className="flex-1 min-w-0 text-[10px] text-slate-300 truncate">{config.redirectUri}</code>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(config.redirectUri)}
              className="text-slate-500 hover:text-slate-300 transition cursor-pointer shrink-0"
              title="Copy redirect URI"
            >
              <Copy size={12} />
            </button>
          </div>
        )}

        <input
          value={clientId}
          onChange={e => setClientId(e.target.value)}
          placeholder="Client ID"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition font-mono"
        />
        <input
          value={clientSecret}
          onChange={e => setClientSecret(e.target.value)}
          placeholder={config?.hasClientSecret ? '•••• configured (leave blank to keep)' : 'Client Secret'}
          type="password"
          className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition font-mono"
        />

        <div className="flex items-center gap-2 pt-1">
          <span className="text-[10px] text-slate-500 shrink-0">Check for changes every</span>
          <input
            type="number"
            min={1}
            step={1}
            value={pollIntervalMinutes}
            onChange={e => setPollIntervalMinutes(Math.max(1, parseInt(e.target.value, 10) || 1))}
            className="w-16 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-indigo-500 transition"
          />
          <span className="text-[10px] text-slate-500">minute{pollIntervalMinutes === 1 ? '' : 's'}</span>
        </div>
        <p className="text-[10px] text-slate-600 break-words">
          Only affects picking up changes made directly in Google Calendar — edits made here sync out immediately regardless of this setting.
        </p>

        <div className="space-y-1.5 pt-1">
          <span className="text-[10px] text-slate-500">Sync workspaces</span>
          <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={!restrictWorkspaces}
              onChange={e => {
                setRestrictWorkspaces(!e.target.checked)
                // Unchecking starts from nothing selected — the user opts
                // individual workspaces back in, rather than starting with
                // everything checked and having to opt out.
                setSelectedWorkspaces([])
              }}
              className="cursor-pointer"
            />
            All workspaces (default)
          </label>
          {restrictWorkspaces && (
            <div className="pl-5 space-y-1">
              {allWorkspaces.map(ws => (
                <label key={ws} className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedWorkspaces.includes(ws)}
                    onChange={e => setSelectedWorkspaces(prev =>
                      e.target.checked ? [...prev, ws] : prev.filter(w => w !== ws)
                    )}
                    className="cursor-pointer shrink-0"
                  />
                  <span className="min-w-0 truncate">{ws}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        <p className="text-[10px] text-slate-600 break-words">
          This only affects your own sync — other users' sync scope is unaffected. Narrowing it removes your own already-synced events outside the new scope; newly-included workspaces pick up on the next sync check.
        </p>

        {configMsg && <p className="text-[10px] text-slate-400">{configMsg}</p>}
        <button
          type="submit"
          disabled={savingConfig || !clientId}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg px-3 py-2 text-xs font-medium transition cursor-pointer"
        >
          {savingConfig ? 'Saving…' : 'Save settings'}
        </button>
        <p className="text-[10px] text-slate-600 break-words">
          If Google shows an "unverified app" warning on connect, that's expected for a self-hosted instance — click Advanced → proceed.
        </p>
      </form>

      {/* Per-user connection */}
      <div className="space-y-2 border-t border-slate-800 pt-4">
        <p className="text-xs font-semibold text-slate-400">Your connection</p>
        {!status && (
          <p className="text-xs text-slate-500 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading…</p>
        )}
        {status && !status.connected && (
          <>
            <button
              onClick={connect}
              disabled={!config?.clientId || !config?.hasClientSecret || config?.isPrivateHost}
              className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-100 rounded-lg px-3 py-2 text-xs font-medium transition cursor-pointer"
            >
              <Calendar size={13} /> Connect Google Calendar
            </button>
            {connectError && (
              <div className="flex items-start gap-1.5 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2 text-[10px] text-red-300">
                <XCircle size={12} className="shrink-0 mt-0.5" />
                <span className="min-w-0 flex-1">{connectError}</span>
              </div>
            )}
          </>
        )}
        {status && status.connected && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-900/50 rounded-lg text-xs text-slate-300">
              <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
              <span className="font-medium min-w-0 truncate">{status.googleEmail}</span>
              <span className="text-slate-500 shrink-0 ml-auto">{status.syncedPageCount} pages synced</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500 shrink-0">Sync to calendar</span>
              <select
                value={status.calendarId ?? 'primary'}
                onChange={e => changeCalendar(e.target.value)}
                disabled={switchingCalendar || calendars.length === 0}
                className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-indigo-500 transition disabled:opacity-50"
              >
                {calendars.length === 0 && <option value={status.calendarId ?? 'primary'}>Loading calendars…</option>}
                {calendars.map(c => (
                  <option key={c.id} value={c.id}>{c.summary}{c.primary ? ' (primary)' : ''}</option>
                ))}
              </select>
            </div>
            <p className="text-[10px] text-slate-600 -mt-1 break-words">
              Switching calendars removes previously synced events from the old one and recreates them on the new one.
            </p>

            <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
              <span>Last sync: {relativeTime(status.lastSyncAt)}</span>
            </div>
            {status.lastSyncError && (
              <div className="flex items-start gap-1.5 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2 text-[10px] text-red-300">
                <XCircle size={12} className="shrink-0 mt-0.5" />
                <span className="min-w-0 flex-1">{status.lastSyncError}</span>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={syncNow}
                disabled={syncing}
                className="flex-1 flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-200 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer"
              >
                <RefreshCw size={12} className={syncing ? 'animate-spin' : ''} /> Sync now
              </button>
              <button
                onClick={disconnect}
                className="flex-1 bg-red-950/40 hover:bg-red-900/50 text-red-300 rounded-lg px-3 py-1.5 text-xs font-medium transition cursor-pointer"
              >
                Disconnect
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
