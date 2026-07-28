import { useEffect, useState } from 'react'
import { Puzzle, Calendar, CheckCircle2, XCircle, Loader2, ChevronLeft, Copy, RefreshCw, BookOpen, AlertTriangle } from 'lucide-react'

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
  const [view, setView] = useState<'grid' | 'google-calendar'>('grid')

  useEffect(() => {
    fetch('/api/plugins', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setPlugins(d.plugins ?? []))
      .catch(() => {})
  }, [])

  if (view === 'google-calendar') {
    return <GoogleCalendarDetail onBack={() => setView('grid')} />
  }

  const googleCalendar = plugins.find(p => p.id === 'google-calendar')
  const comingSoon = plugins.filter(p => p.status === 'coming_soon')

  return (
    <div className="space-y-5 animate-in fade-in duration-150">
      <h4 className="font-bold text-sm text-slate-100">Plugins</h4>
      <p className="text-xs text-slate-500 -mt-3">
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

// ─── GoogleCalendarDetail ────────────────────────────────────────────────────
function GoogleCalendarDetail({ onBack }: { onBack: () => void }) {
  const [config, setConfig] = useState<GCalConfig | null>(null)
  const [status, setStatus] = useState<GCalStatus | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(2)
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
      })
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

  useEffect(() => { reloadConfig(); reloadStatus() }, [])

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
        body: JSON.stringify({ clientId, clientSecret, pollIntervalSeconds: Math.max(1, pollIntervalMinutes) * 60 }),
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

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar size={18} className="text-blue-400" />
          <h4 className="font-bold text-sm text-slate-100">Google Calendar</h4>
        </div>
        <a
          href={GOOGLE_CALENDAR_DOCS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-[11px] text-violet-400 hover:text-violet-300 transition"
        >
          <BookOpen size={12} /> Setup guide
        </a>
      </div>
      <p className="text-xs text-slate-500 -mt-3">
        Any page with a due date syncs both ways with your Google Calendar. Sync runs automatically on the interval below, or on demand.
      </p>

      {config?.isPrivateHost && (
        <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-700/40 rounded-lg px-3 py-2.5 text-[11px] text-amber-300">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            <strong>This won't work from here.</strong> You're accessing BlockForgeMD at a private IP address. Google's OAuth
            rejects private IP addresses as redirect URIs, so connecting will always fail. Access the app via a hostname
            instead (e.g. add an entry to your hosts file mapping a name to this address), then reload this page — see the{' '}
            <a href={GOOGLE_CALENDAR_DOCS_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-amber-200">
              setup guide
            </a>.
          </span>
        </div>
      )}

      {/* Instance-wide OAuth config */}
      <form onSubmit={saveConfig} className="space-y-2 border-t border-slate-800 pt-4">
        <p className="text-xs font-semibold text-slate-400">Google OAuth credentials</p>
        <p className="text-[10px] text-slate-500">
          Create an OAuth Client in Google Cloud Console and register the redirect URI below, then paste the Client ID/Secret here. This is shared instance-wide — each user still connects their own Google account below.
        </p>

        <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-700/40 rounded-lg px-3 py-2.5 text-[11px] text-amber-300">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>
            <strong>Publish the app to Production before connecting.</strong> In Google Auth Platform → <strong>Audience</strong> tab, click <strong>Publish app</strong> to switch from Testing to Production. Skip this and every connected account will silently stop syncing and need to be reconnected every 7 days — Google forcibly expires refresh tokens while an app sits in Testing. Publishing to Production doesn't require completing Google's verification process.
          </span>
        </div>

        {config && (
          <div className="flex items-center gap-2 bg-slate-900 border border-slate-700 rounded-lg px-3 py-2">
            <code className="flex-1 text-[10px] text-slate-300 truncate">{config.redirectUri}</code>
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
        <p className="text-[10px] text-slate-600">
          Only affects picking up changes made directly in Google Calendar — edits made here sync out immediately regardless of this setting.
        </p>

        {configMsg && <p className="text-[10px] text-slate-400">{configMsg}</p>}
        <button
          type="submit"
          disabled={savingConfig || !clientId}
          className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-white rounded-lg px-3 py-2 text-xs font-medium transition cursor-pointer"
        >
          {savingConfig ? 'Saving…' : 'Save credentials'}
        </button>
        <p className="text-[10px] text-slate-600">
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
                <span>{connectError}</span>
              </div>
            )}
          </>
        )}
        {status && status.connected && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-3 py-2 bg-slate-900/50 rounded-lg text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={13} className="text-emerald-400" />
                <span className="font-medium">{status.googleEmail}</span>
              </div>
              <span className="text-slate-500">{status.syncedPageCount} pages synced</span>
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
            <p className="text-[10px] text-slate-600 -mt-1">
              Switching calendars removes previously synced events from the old one and recreates them on the new one.
            </p>

            <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
              <span>Last sync: {relativeTime(status.lastSyncAt)}</span>
            </div>
            {status.lastSyncError && (
              <div className="flex items-start gap-1.5 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2 text-[10px] text-red-300">
                <XCircle size={12} className="shrink-0 mt-0.5" />
                <span>{status.lastSyncError}</span>
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
