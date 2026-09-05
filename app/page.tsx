'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  ArrowLeft, ArrowUp, Bookmark, Check, ChevronRight, Eye, EyeOff, ExternalLink, Gavel,
  History, KeyRound, ListOrdered, Menu, Moon, MoreHorizontal, PanelLeft, RefreshCw, Scale,
  Settings, ShieldCheck, Sparkles, Sun, Trash2, X, Zap,
} from 'lucide-react'

import type { DebateEvent, JudgeVerdict, Role, SavedDebate } from '@/lib/ai/types'
import { ROLES } from '@/lib/ai/types'
import { retryAgent, startDebate, type PeerContext } from '@/lib/debate-client'
import { clearHistory, loadHistory, saveDebate } from '@/lib/history'
import { activeByokKey, loadByok, maskKey, saveByok, type ByokState } from '@/lib/byok'
import { loadSidebarCollapsed, loadTheme, saveSidebarCollapsed, saveTheme } from '@/lib/prefs'

type Agent = { role: Role; name: string; title: string; icon: typeof Scale; accent: string; blurb: string }
type Status = 'idle' | 'analyzing' | 'generating' | 'complete' | 'error'
type JudgeStatus = 'idle' | 'running' | 'complete' | 'error'
type Phase = 'triaging' | 'debate' | 'chat'
type ChatReply = { message: string; suggestions: string[] }

const agents: Agent[] = [
  { role: 'advocate', name: 'Advocate', title: 'Argues the case FOR', icon: Scale, accent: 'role-advocate', blurb: 'Building the strongest case in favour…' },
  { role: 'critic', name: 'Critic', title: 'Argues the case AGAINST', icon: Gavel, accent: 'role-critic', blurb: 'Building the strongest case against…' },
  { role: 'auditor', name: 'Auditor', title: 'Fact-checks BOTH sides', icon: ShieldCheck, accent: 'role-auditor', blurb: 'Waiting for both arguments, then it audits them…' },
]

const prompts = ['Should cities prioritize rewilding over new housing?', 'Is remote work actually better for society?', 'Do school uniforms improve student outcomes?', 'Should AI-generated art be copyrightable?']

const EMPTY_CONTENTS: Record<Role, string> = { advocate: '', critic: '', auditor: '' }
const EMPTY_ERRORS: Record<Role, string> = { advocate: '', critic: '', auditor: '' }
const IDLE_STATUSES: Record<Role, Status> = { advocate: 'idle', critic: 'idle', auditor: 'idle' }

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return 'now'
  const m = Math.floor(s / 60); if (m < 60) return `${m}m`
  const h = Math.floor(m / 60); if (h < 24) return `${h}h`
  return `${Math.floor(h / 24)}d`
}

function winnerLabel(winner: JudgeVerdict['winner']): string {
  if (winner === 'advocate') return 'Advocate prevails'
  if (winner === 'critic') return 'Critic prevails'
  return 'Evenly matched'
}

function Logo() { return <div className="brand-mark" aria-label="Tribunal home"><span>TR</span></div> }

function parseInlineBold(str: string) {
  const parts = str.split(/(\*\*.*?\*\*)/g)
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length >= 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>
    }
    return part
  })
}

function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('## ')) return <h3 key={i}>{parseInlineBold(line.slice(3))}</h3>
        if (line.startsWith('### ')) return <h4 key={i}>{parseInlineBold(line.slice(4))}</h4>
        if (line.startsWith('> ')) return <blockquote key={i}>{parseInlineBold(line.slice(2))}</blockquote>
        if (line.startsWith('- ')) return <li key={i}>{parseInlineBold(line.slice(2))}</li>
        return line ? <p key={i}>{parseInlineBold(line)}</p> : <div key={i} className="line-gap" />
      })}
    </div>
  )
}

function Sidebar({ open, onClose, dark, setDark, onNew, history, onSelect, onClear, onOpenSettings, byokOn }: {
  open: boolean; onClose: () => void; dark: boolean; setDark: (v: boolean) => void; onNew: () => void
  history: SavedDebate[]; onSelect: (d: SavedDebate) => void; onClear: () => void; onOpenSettings: () => void; byokOn: boolean
}) {
  return <>
    <AnimatePresence>{open && <motion.button className="drawer-scrim" aria-label="Close menu" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}</AnimatePresence>
    <motion.aside className={`sidebar ${open ? 'sidebar-open' : ''}`} aria-label="Main navigation" initial={false} animate={{ x: open ? 0 : undefined }}>
      <div className="sidebar-top"><div className="brand"><Logo /><span>TRIBUNAL</span></div><button className="icon-button mobile-only" onClick={onClose} aria-label="Close menu"><X size={18} /></button></div>
      <button className="new-debate" onClick={onNew}><Sparkles size={16} /> New debate <span>⌘ N</span></button>
      <nav className="nav-list"><a className="nav-active" href="#workspace"><PanelLeft size={16} /> Workspace</a><a href="#history"><History size={16} /> Recent debates <b>{history.length}</b></a><a href="#saved"><Bookmark size={16} /> Saved debates</a></nav>
      <div className="sidebar-section" id="history">
        <p>RECENT{history.length > 0 && <button className="clear-history" onClick={onClear}>Clear</button>}</p>
        {history.length === 0 ? <span className="history-empty">No debates yet</span> : history.map(item => (
          <button className="history-item" key={item.id} onClick={() => onSelect(item)} title={item.proposition}><span className="history-dot" />{item.proposition}<small>{timeAgo(item.createdAt)}</small></button>
        ))}
      </div>
      <div className="sidebar-bottom">
        <button className="sidebar-action" onClick={onOpenSettings}><Settings size={16} /> Settings{byokOn && <b style={{ marginLeft: 'auto', color: 'var(--advocate)' }}>BYOK</b>}</button>
        <button className="sidebar-action" onClick={() => setDark(!dark)}>{dark ? <Sun size={16} /> : <Moon size={16} />} {dark ? 'Light mode' : 'Dark mode'}</button>
        <div className="account"><div className="avatar">DA</div><div><strong>Demo Account</strong><small>Personal workspace</small></div><MoreHorizontal size={16} /></div>
      </div>
    </motion.aside>
  </>
}

function StatusPill({ status }: { status: Status }) { const label = status === 'idle' ? 'READY' : status === 'analyzing' ? 'ANALYZING' : status === 'generating' ? 'GENERATING' : status === 'complete' ? 'COMPLETE' : 'ERROR'; return <span className={`status status-${status}`}><i />{label}</span> }

function AgentCard({ agent, status, content, errorMessage, onFocus, onRetry }: { agent: Agent; status: Status; content: string; errorMessage?: string; onFocus: () => void; onRetry: () => void }) {
  const Icon = agent.icon
  return <motion.article className={`agent-card ${agent.accent} ${status === 'error' ? 'has-error' : ''}`} tabIndex={0} onClick={onFocus} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onFocus() }}>
    <div className="agent-head"><div className="agent-identity"><div className="role-icon"><Icon size={18} /></div><div><h3>{agent.name}</h3><p>{agent.title}</p></div></div><StatusPill status={status} /></div>
    <div className="card-body">{status === 'error' ? <div className="error-state"><p>{errorMessage || "Couldn't complete this analysis."}</p><button className="retry" onClick={e => { e.stopPropagation(); onRetry() }}><RefreshCw size={14} /> Retry analysis</button></div> : status === 'analyzing' ? <div className="analyzing"><span /><span /><span /><p>{agent.blurb}</p></div> : <Markdown text={content} />}</div>
    {status === 'generating' && <span className="cursor" aria-label="Generating" />}
    <div className="card-foot"><span>{status === 'complete' ? 'Analysis complete' : status === 'error' ? 'Partial response saved' : status === 'idle' ? 'Click to focus' : 'Generating…'}</span><ChevronRight size={15} /></div>
  </motion.article>
}

function SettingsModal({ open, onClose, dark, setDark, byok, setByok }: {
  open: boolean; onClose: () => void; dark: boolean; setDark: (v: boolean) => void
  byok: ByokState; setByok: (b: ByokState) => void
}) {
  const [draft, setDraft] = useState(byok.key)
  const [show, setShow] = useState(false)

  useEffect(() => { if (open) { setDraft(byok.key); setShow(false) } }, [open, byok.key])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div className="modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: .98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: .98 }} transition={{ duration: .18 }}>
            <div className="modal-head"><h2>Settings</h2><button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={18} /></button></div>
            <div className="modal-body">
              <div className="setting-group">
                <div className="group-label"><Sun size={13} /> Appearance</div>
                <div className="segmented">
                  <button className={!dark ? 'active' : ''} onClick={() => setDark(false)}><Sun size={15} /> Light</button>
                  <button className={dark ? 'active' : ''} onClick={() => setDark(true)}><Moon size={15} /> Dark</button>
                </div>
              </div>

              <div className="setting-group">
                <div className="group-label"><KeyRound size={13} /> Your own API key (BYOK)</div>
                <div className="setting-row">
                  <div className="txt"><strong>Run debates on my key</strong><small>Uses your Google billing instead of the shared key. Great if you want unlimited, private usage.</small></div>
                  <button className="switch" role="switch" aria-checked={byok.enabled} aria-label="Use my own API key"
                    onClick={() => setByok(saveByok({ enabled: !byok.enabled, key: draft.trim() }))} />
                </div>
                <div className="byok-field">
                  <div className="byok-input-row">
                    <input type={show ? 'text' : 'password'} value={draft} onChange={e => setDraft(e.target.value)}
                      placeholder="Paste your Gemini API key" spellCheck={false} autoComplete="off" aria-label="Gemini API key" />
                    <button className="ghost-btn" onClick={() => setShow(s => !s)} aria-label={show ? 'Hide key' : 'Show key'}>{show ? <EyeOff size={16} /> : <Eye size={16} />}</button>
                  </div>
                  <div className="btn-row">
                    <button className="btn" onClick={() => setByok(saveByok({ enabled: byok.enabled, key: draft.trim() }))} disabled={!draft.trim()}><Check size={14} /> Save key</button>
                    <button className="btn secondary" onClick={() => { setDraft(''); setByok(saveByok({ enabled: false, key: '' })) }} disabled={!byok.key}><Trash2 size={14} /> Remove</button>
                    <a className="btn secondary" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Get a free key</a>
                  </div>
                  {byok.enabled && byok.key.trim() && <span className="byok-status"><Check size={12} /> Active — using {maskKey(byok.key)}</span>}
                  <p className="byok-help">Your key is stored only in this browser and passed straight to Google for your requests — it is never logged or kept on our servers. Create one free at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google&nbsp;AI&nbsp;Studio</a>.</p>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export default function Page() {
  const reduce = useReducedMotion()
  const [dark, setDark] = useState(true)
  const [drawer, setDrawer] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [byok, setByok] = useState<ByokState>({ enabled: false, key: '' })
  const [query, setQuery] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [phase, setPhase] = useState<Phase>('triaging')
  const [chat, setChat] = useState<ChatReply | null>(null)
  const [refinedProp, setRefinedProp] = useState('')
  const [focused, setFocused] = useState<Role | null>(null)
  const [active, setActive] = useState<Role>('advocate')
  const [statuses, setStatuses] = useState<Record<Role, Status>>({ ...IDLE_STATUSES })
  const [contents, setContents] = useState<Record<Role, string>>({ ...EMPTY_CONTENTS })
  const [agentErrors, setAgentErrors] = useState<Record<Role, string>>({ ...EMPTY_ERRORS })
  const [verdict, setVerdict] = useState<JudgeVerdict | null>(null)
  const [judgeStatus, setJudgeStatus] = useState<JudgeStatus>('idle')
  const [judgeError, setJudgeError] = useState<string | null>(null)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<SavedDebate[]>([])
  const [promptIndex, setPromptIndex] = useState(0)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const propositionRef = useRef<string>('')
  const liveRef = useRef<{ id: string; proposition: string; contents: Record<Role, string>; errors: Partial<Record<Role, string>>; verdict: JudgeVerdict | null } | null>(null)

  // The key we actually send: only when BYOK is on and a key exists.
  const byokKey = activeByokKey(byok)

  useEffect(() => { document.documentElement.classList.toggle('dark', dark); document.documentElement.classList.toggle('light', !dark) }, [dark])
  useEffect(() => { const timer = setInterval(() => setPromptIndex(i => (i + 1) % prompts.length), 5000); return () => clearInterval(timer) }, [])
  useEffect(() => {
    setHistory(loadHistory())
    const storedTheme = loadTheme(); if (storedTheme !== null) setDark(storedTheme)
    setCollapsed(loadSidebarCollapsed())
    setByok(loadByok())
  }, [])
  useEffect(() => () => { abortRef.current?.abort() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') { e.preventDefault(); newDebate() }
      if (e.key === 'Escape' && focused) { setFocused(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focused])

  const applyTheme = (v: boolean) => { setDark(v); saveTheme(v) }
  const toggleSidebar = () => setCollapsed(c => { const n = !c; saveSidebarCollapsed(n); return n })

  /** Persists the in-flight debate to history once it settles. */
  const persist = () => {
    const live = liveRef.current
    if (!live) return
    const hasAny = ROLES.some(r => (live.contents[r] ?? '').trim()) || live.verdict
    if (!hasAny) return
    const saved: SavedDebate = {
      id: live.id,
      proposition: live.proposition,
      createdAt: Date.now(),
      contents: { advocate: live.contents.advocate ?? '', critic: live.contents.critic ?? '', auditor: live.contents.auditor ?? '' },
      errors: { ...live.errors },
      verdict: live.verdict,
    }
    setHistory(saveDebate(saved))
  }

  /** Translates generic stream events into UI state — no Gemini details leak in. */
  const handleEvent = (event: DebateEvent) => {
    const live = liveRef.current
    switch (event.type) {
      case 'triage_start':
        setPhase('triaging')
        break
      case 'proposition_ready':
        propositionRef.current = event.refined || propositionRef.current
        setRefinedProp(event.refined || '')
        setPhase('debate')
        setStatuses({ advocate: 'analyzing', critic: 'analyzing', auditor: 'analyzing' })
        break
      case 'chat_reply':
        setChat({ message: event.message, suggestions: event.suggestions ?? [] })
        setPhase('chat')
        break
      case 'agent_start':
        setStatuses(s => ({ ...s, [event.agent]: 'analyzing' }))
        setContents(c => ({ ...c, [event.agent]: '' }))
        setAgentErrors(e => ({ ...e, [event.agent]: '' }))
        if (live) { live.contents[event.agent] = ''; delete live.errors[event.agent] }
        break
      case 'agent_chunk':
        setStatuses(s => (s[event.agent] === 'generating' ? s : { ...s, [event.agent]: 'generating' }))
        setContents(c => ({ ...c, [event.agent]: (c[event.agent] ?? '') + event.text }))
        if (live) live.contents[event.agent] = (live.contents[event.agent] ?? '') + event.text
        break
      case 'agent_complete':
        setStatuses(s => ({ ...s, [event.agent]: 'complete' }))
        break
      case 'agent_error':
        setStatuses(s => ({ ...s, [event.agent]: 'error' }))
        setAgentErrors(e => ({ ...e, [event.agent]: event.message }))
        if (live) live.errors[event.agent] = event.message
        break
      case 'judge_start':
        setJudgeStatus('running')
        break
      case 'judge_complete':
        setVerdict(event.verdict)
        setJudgeStatus('complete')
        if (live) live.verdict = event.verdict
        break
      case 'judge_error':
        setJudgeError(event.message)
        setJudgeStatus('error')
        break
      case 'error':
        setGlobalError(event.message)
        break
      case 'done':
        break
    }
  }

  const markIncompleteAsError = (message: string) => {
    setStatuses(s => { const n = { ...s }; ROLES.forEach(r => { if (n[r] === 'idle' || n[r] === 'analyzing' || n[r] === 'generating') n[r] = 'error' }); return n })
    const live = liveRef.current
    if (live) ROLES.forEach(r => { if (!(live.contents[r] ?? '').trim() && !live.errors[r]) live.errors[r] = message })
  }

  const runDebate = async (proposition: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    propositionRef.current = proposition
    liveRef.current = { id: makeId(), proposition, contents: { ...EMPTY_CONTENTS }, errors: {}, verdict: null }

    setRunning(true); setGlobalError(null); setVerdict(null); setJudgeError(null); setJudgeStatus('idle')
    setAgentErrors({ ...EMPTY_ERRORS }); setContents({ ...EMPTY_CONTENTS }); setStatuses({ ...IDLE_STATUSES })
    setChat(null); setRefinedProp(''); setPhase('triaging')

    try {
      await startDebate(proposition, handleEvent, controller.signal, byokKey)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        const message = (err as Error)?.message || 'Could not start the debate.'
        setGlobalError(message)
        // If we never made it past intake, surface the problem as a chat-style message.
        setPhase(p => (p === 'triaging' ? 'chat' : p))
        setChat(c => c ?? { message, suggestions: prompts.slice(0, 3) })
        markIncompleteAsError(message)
      }
    } finally {
      if (abortRef.current === controller) { setRunning(false); persist() }
    }
  }

  const retry = async (role: Role) => {
    const proposition = propositionRef.current
    if (!proposition || running) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    if (!liveRef.current) liveRef.current = { id: makeId(), proposition, contents: { ...contents }, errors: {}, verdict }

    setStatuses(s => ({ ...s, [role]: 'analyzing' }))
    setContents(c => ({ ...c, [role]: '' }))
    setAgentErrors(e => ({ ...e, [role]: '' }))

    // The Auditor cross-checks both sides, so pass the current arguments back.
    const context: PeerContext | undefined = role === 'auditor'
      ? { advocate: contents.advocate, critic: contents.critic }
      : undefined

    try {
      await retryAgent(proposition, role, handleEvent, controller.signal, byokKey, context)
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        const message = (err as Error)?.message || 'Retry failed.'
        setStatuses(s => ({ ...s, [role]: 'error' }))
        setAgentErrors(e => ({ ...e, [role]: message }))
        if (liveRef.current) liveRef.current.errors[role] = message
      }
    } finally {
      if (abortRef.current === controller) persist()
    }
  }

  const startFromText = (text: string) => {
    const effective = text.trim()
    if (!effective) return
    setQuery(effective)
    setSubmitted(true)
    setFocused(null)
    setChat(null)
    setPhase('triaging')
    void runDebate(effective)
  }

  const submit = () => startFromText(query.trim() || prompts[promptIndex])

  const newDebate = () => {
    abortRef.current?.abort(); abortRef.current = null
    setRunning(false); setSubmitted(false); setFocused(null); setQuery(''); setGlobalError(null)
    setStatuses({ ...IDLE_STATUSES }); setContents({ ...EMPTY_CONTENTS }); setAgentErrors({ ...EMPTY_ERRORS })
    setVerdict(null); setJudgeStatus('idle'); setJudgeError(null); setChat(null); setRefinedProp(''); setPhase('triaging')
    liveRef.current = null
    setDrawer(false)
    inputRef.current?.focus()
  }

  const openSaved = (debate: SavedDebate) => {
    abortRef.current?.abort(); abortRef.current = null
    propositionRef.current = debate.proposition
    liveRef.current = null
    setRunning(false); setSubmitted(true); setFocused(null); setGlobalError(null)
    setChat(null); setRefinedProp(''); setPhase('debate')
    setQuery(debate.proposition)
    setContents({ advocate: debate.contents.advocate ?? '', critic: debate.contents.critic ?? '', auditor: debate.contents.auditor ?? '' })
    setAgentErrors({ advocate: debate.errors.advocate ?? '', critic: debate.errors.critic ?? '', auditor: debate.errors.auditor ?? '' })
    setStatuses({
      advocate: debate.errors.advocate || !(debate.contents.advocate ?? '').trim() ? 'error' : 'complete',
      critic: debate.errors.critic || !(debate.contents.critic ?? '').trim() ? 'error' : 'complete',
      auditor: debate.errors.auditor || !(debate.contents.auditor ?? '').trim() ? 'error' : 'complete',
    })
    setVerdict(debate.verdict)
    setJudgeStatus(debate.verdict ? 'complete' : 'error')
    setJudgeError(debate.verdict ? null : 'Verdict unavailable for this saved debate.')
    setDrawer(false)
  }

  const agentsDone = submitted && phase === 'debate' && ROLES.every(r => statuses[r] === 'complete' || statuses[r] === 'error')
  const showVerdict = agentsDone && judgeStatus !== 'idle'
  const focusedAgent = agents.find(a => a.role === (focused ?? active))!
  const FocusIcon = focusedAgent.icon
  const keyPoints = verdict?.keyPoints ?? []
  const summary = verdict?.summary ?? ''

  return <div className={`app-shell ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <Sidebar open={drawer} onClose={() => setDrawer(false)} dark={dark} setDark={applyTheme} onNew={newDebate} history={history} onSelect={openSaved} onClear={() => setHistory(clearHistory())} onOpenSettings={() => setSettingsOpen(true)} byokOn={!!byokKey} />
    <main className="main-content" id="workspace">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-only" onClick={() => setDrawer(true)} aria-label="Open menu"><Menu size={20} /></button>
          <button className="icon-button desktop-only sidebar-toggle" onClick={toggleSidebar} aria-label={collapsed ? 'Show sidebar' : 'Hide sidebar'} title={collapsed ? 'Show sidebar' : 'Hide sidebar'}><PanelLeft size={19} /></button>
          <div className="topbar-title">{submitted ? <><span className="eyebrow">{phase === 'chat' ? 'TRIBUNAL' : running ? 'DEBATE / LIVE' : 'DEBATE'}</span><strong>{query || prompts[promptIndex]}</strong></> : <span className="eyebrow">A CLEARER WAY TO THINK</span>}</div>
        </div>
        <div className="topbar-actions">
          {byokKey && <span className="byok-badge desktop-only"><KeyRound size={12} /> BYOK</span>}
          <button className="icon-button" onClick={() => applyTheme(!dark)} aria-label="Toggle theme">{dark ? <Sun size={17} /> : <Moon size={17} />}</button>
          <button className="icon-button" onClick={() => setSettingsOpen(true)} aria-label="Settings"><Settings size={17} /></button>
        </div>
      </header>

      <AnimatePresence mode="wait">
        {!submitted ? (
          <motion.section className="home-view" key="home" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }} transition={{ duration: reduce ? 0 : .35 }}>
            <div className="home-intro"><div className="intro-kicker"><span /> THREE MINDS. ONE QUESTION.</div><h1>Think it<br /><em>through.</em></h1><p>Bring a complex question to the table. An Advocate argues for it, a Critic argues against, an Auditor checks both — then the Judge delivers a verdict.</p></div>
            <div className="composer-wrap">
              <textarea ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); submit() } }} placeholder="What would you like to debate?" aria-label="Debate question" rows={2} />
              <button className="submit-button" onClick={submit} aria-label="Start debate"><ArrowUp size={18} /></button>
              <div className="composer-meta"><span><Zap size={13} /> Three independent perspectives</span><kbd>Enter ↵</kbd></div>
            </div>
            <div className="suggestions"><span>TRY ONE OF THESE</span>{prompts.map((p, i) => <button key={p} className={i === promptIndex ? 'suggestion-current' : ''} onClick={() => setQuery(p)}>{p}<ArrowUp size={13} /></button>)}</div>
          </motion.section>
        ) : phase === 'triaging' ? (
          <motion.section className="intake" key="intake" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="intro-kicker"><span /> READING YOUR QUESTION</div>
            <h1 className="question">{query}</h1>
            <div className="reading"><span className="spinner" /> Deciding how to convene the tribunal…</div>
          </motion.section>
        ) : phase === 'chat' ? (
          <motion.section className="chat-view" key="chat" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <div className="debate-summary"><div><span className="eyebrow">YOU SAID</span><h1>{query}</h1></div><button className="text-button" onClick={newDebate}><ArrowLeft size={15} /> New debate</button></div>
            <div className="chat-bubble">
              <div className="who"><Sparkles size={14} /> TRIBUNAL</div>
              <p className="msg">{chat?.message || 'Bring me a debatable question and I will convene the tribunal.'}</p>
            </div>
            {(chat?.suggestions?.length ?? 0) > 0 && (
              <div className="chat-suggestions"><span>OR PUT ONE OF THESE ON TRIAL</span>
                {chat!.suggestions.map(s => <button key={s} onClick={() => startFromText(s)}>{s}<ArrowUp size={14} /></button>)}
              </div>
            )}
          </motion.section>
        ) : (
          <motion.section className="debate-view" key="debate" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            <div className="debate-summary">
              <div>
                <span className="eyebrow">THE QUESTION</span>
                <h1>{query || prompts[promptIndex]}</h1>
                {refinedProp && refinedProp.trim().toLowerCase() !== query.trim().toLowerCase() && (
                  <p className="reframed"><span>Framed for the tribunal</span>{refinedProp}</p>
                )}
              </div>
              <button className="text-button" onClick={newDebate}><ArrowLeft size={15} /> New debate</button>
            </div>
            <div className="timeline">
              <div className="timeline-line" />
              <div className="timeline-step done"><Check size={13} /><span>Question</span></div>
              <div className={`timeline-step ${agentsDone ? 'done' : ''}`}><span>{agentsDone ? <Check size={13} /> : '01'}</span><span>Perspectives</span></div>
              <div className={`timeline-step ${verdict ? 'done' : ''}`}><span>{verdict ? <Check size={13} /> : '02'}</span><span>Verdict</span></div>
            </div>
            {globalError && <div className="error-banner" role="alert"><span>{globalError}</span><button onClick={() => setGlobalError(null)} aria-label="Dismiss error"><X size={14} /></button></div>}
            <div className="agents-grid">
              {agents.map(agent => (
                <AgentCard key={agent.role} agent={agent} status={statuses[agent.role]} content={contents[agent.role]} errorMessage={agentErrors[agent.role]} onFocus={() => { setFocused(agent.role); setActive(agent.role) }} onRetry={() => { void retry(agent.role) }} />
              ))}
            </div>
            <AnimatePresence>
              {showVerdict && (
                <motion.section className="verdict" initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <div className="verdict-label"><Gavel size={15} /> THE JUDGE&apos;S VERDICT{verdict && <span className={`winner-tag winner-${verdict.winner}`}>{winnerLabel(verdict.winner)}</span>}</div>
                  {judgeStatus === 'running' && !verdict ? (
                    <div className="verdict-pending"><div className="analyzing"><span /><span /><span /><p>The Judge is weighing all three arguments…</p></div></div>
                  ) : verdict ? (
                    <>
                      <div className="verdict-grid">
                        <div><h2>{verdict.verdict}</h2><p className="verdict-summary">{summary || 'The Judge did not leave a summary, but the key points below still stand.'}</p></div>
                        <div className="verdict-facts">
                          <div><span>KEY DISAGREEMENT</span><strong>{verdict.keyDisagreement || '—'}</strong></div>
                          <div><span>FACTUAL CONCERN</span><strong>{verdict.factualConcerns[0] || 'None flagged'}</strong></div>
                          <div><span>CONFIDENCE</span><strong>{verdict.confidence}% <i className="confidence-bar" style={{ width: `${Math.max(6, verdict.confidence)}%` }} /></strong></div>
                        </div>
                      </div>
                      {keyPoints.length > 0 && (
                        <div className="judge-points">
                          <div className="jp-head"><ListOrdered size={14} /> THE JUDGE&apos;S POINTS</div>
                          <ol>{keyPoints.map((p, i) => <li key={i}>{p}</li>)}</ol>
                        </div>
                      )}
                      {(verdict.strongestArgument || verdict.weakestArgument || verdict.factualConcerns.length > 1) && (
                        <div className="verdict-details">
                          {verdict.strongestArgument && <div><span>STRONGEST ARGUMENT</span><p>{verdict.strongestArgument}</p></div>}
                          {verdict.weakestArgument && <div><span>WEAKEST ARGUMENT</span><p>{verdict.weakestArgument}</p></div>}
                          {verdict.factualConcerns.length > 1 && <div><span>OTHER FACTUAL CONCERNS</span><ul>{verdict.factualConcerns.slice(1).map((c, i) => <li key={i}>{c}</li>)}</ul></div>}
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="verdict-error"><p>{judgeError || 'The Judge could not reach a verdict.'}</p><small>The three perspectives above are still available to read.</small></div>
                  )}
                </motion.section>
              )}
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>
    </main>

    <AnimatePresence>
      {focused && phase === 'debate' && (
        <motion.div className="focus-layer" onClick={() => setFocused(null)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          <motion.section className={`focus-card ${focusedAgent.accent}`} onClick={e => e.stopPropagation()} initial={{ opacity: 0, scale: 0.95, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 10 }} transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}>
            <div className="focus-head"><button className="icon-button" onClick={() => setFocused(null)} aria-label="Close focus mode"><X size={19} /></button><div className="focused-title"><FocusIcon size={19} /><div><span className="eyebrow">FOCUSED PERSPECTIVE</span><h2>{focusedAgent.name}</h2></div></div><StatusPill status={statuses[focused]} /></div>
            <div className="focus-switcher">{agents.map(a => <button className={a.role === focused ? 'active' : ''} key={a.role} onClick={() => { setFocused(a.role); setActive(a.role) }}>{a.name}</button>)}</div>
            <div className="focus-content">
              {statuses[focused] === 'analyzing' ? <div className="analyzing"><span /><span /><span /><p>{focusedAgent.blurb}</p></div>
                : statuses[focused] === 'error' ? <div className="error-state"><p>{agentErrors[focused] || 'This perspective stopped early.'}</p><button className="retry" onClick={() => { void retry(focused) }}><RefreshCw size={14} /> Retry analysis</button></div>
                  : <Markdown text={contents[focused]} />}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>

    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} dark={dark} setDark={applyTheme} byok={byok} setByok={setByok} />
  </div>
}
