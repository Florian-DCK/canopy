import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Attachment, Item, PermissionModeUI, SessionMeta } from '../../../shared/types'
import { contextWindowOf } from '../derive'
import { Icon, MODE_ICON, Ring, toolDoing, type IconName } from '../icons'
import { thumbUrl } from '../media'
import { api, useStore } from '../store'
import { BG_DELAYS, isForeground, sendToBackground, useBgDelay } from '../bgtasks'
import { LimitCard } from '../Palette'
import { UsageChip } from '../usage'
import { useAutocomplete } from './session/Autocomplete'
import { Thread } from './session/Thread'

// Saisie (planche 3) : la bande d'activité au-dessus du texte, puis la barre — joindre, modèle, mode
// à gauche ; contexte, fenêtre 5 h et un seul bouton (Envoyer ou Arrêter) à droite.

const NO_ATTACH: Attachment[] = []
const NO_ITEMS: Item[] = []

const MODELS = [
  { v: '', name: 'Défaut', desc: 'Celui de ta config Claude Code' },
  { v: 'opus', name: 'Opus', desc: 'Le plus capable' },
  { v: 'sonnet', name: 'Sonnet', desc: 'Rapide et solide' },
  { v: 'haiku', name: 'Haiku', desc: 'Le plus léger' }
]
const MODES: { v: PermissionModeUI; name: string; desc: string }[] = [
  { v: 'default', name: 'Demander', desc: 'Une carte d’autorisation pour chaque action sensible' },
  { v: 'acceptEdits', name: 'Accepter les modifs', desc: 'Les modifications de fichiers passent sans demander' },
  { v: 'auto', name: 'Auto', desc: 'Un classifieur décide, il ne demande qu’en cas de doute' },
  { v: 'plan', name: 'Plan', desc: 'Claude propose un plan, sans rien exécuter' }
]

/** Bouton + menu qui s'ouvre au-dessus ; se ferme au clic dehors ou Échap. */
function Dropdown({ label, button, children }: { label: string; button: ReactNode; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative', minWidth: 0 }}>
      <button type="button" className="cmp-chip" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}>
        {button}
      </button>
      {open && (
        <div className="cmp-menu" role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

function Option({ icon, name, desc, checked, onClick }: { icon: IconName; name: string; desc: string; checked: boolean; onClick: () => void }) {
  return (
    <button type="button" role="menuitemradio" aria-checked={checked} className="cmp-item" onClick={onClick}>
      <Icon name={icon} size={17} />
      <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <b>{name}</b>
        <span className="small muted">{desc}</span>
      </span>
      {checked && <Icon name="done" size={15} className="cmp-check" />}
    </button>
  )
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = rej
    r.readAsDataURL(file)
  })
}

/** Fait défiler le fil jusqu'à la carte de la question et lui donne le focus (1 à 4 répondent ensuite). */
function goToQuestion(itemId: string) {
  const el = document.getElementById(`q-${itemId}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.focus({ preventScroll: true })
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/** Bande au-dessus du texte : ce que fait l'agent (bleu) ou ce qu'il attend de toi (argile). */
const BG_KIND: Record<string, string> = { local_bash: 'Commande', shell: 'Commande', local_agent: 'Sous-agent', agent: 'Sous-agent', remote_agent: 'Sous-agent' }

/** Pastille « N en fond » : la liste des tâches de fond, avec Arrêter, et le délai de passage automatique. */
function BgPill({ sessionId, tasks }: { sessionId: string; tasks: NonNullable<SessionMeta['bgTasks']> }) {
  const [open, setOpen] = useState(false)
  const [thread, setThread] = useState<{ id: string; label: string } | null>(null)
  const ref = useRef<HTMLSpanElement>(null)
  const { delay, set } = useBgDelay()
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <span ref={ref} className="bg-wrap" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="bg-pill" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="run" size={12} />
        {tasks.length} en fond
      </button>
      {open && (
        <div className="bg-list" role="dialog" aria-label="Tâches de fond">
          <div className="bg-list-h">Tâches de fond de cette session</div>
          {tasks.map((t) => (
            <div key={t.id} className="bg-row">
              <Icon name="run" size={13} className="st-run" />
              <span className="bg-kind">{BG_KIND[t.kind] ?? 'Tâche'}</span>
              <span className="bg-label" title={t.label}>{t.label}</span>
              <span className="bg-time">{clock(Math.max(0, Math.round((Date.now() - t.startedAt) / 1000)))}</span>
              {/agent/.test(t.kind) && (
                <button type="button" className="btn text sm" onClick={() => {
                  setThread({ id: t.id, label: t.label })
                  setOpen(false)
                }}>Voir son fil</button>
              )}
              <button type="button" className="btn text sm bg-stop" onClick={() => void api.stopTask(sessionId, t.id)}>Arrêter</button>
            </div>
          ))}
          <div className="bg-delay" role="radiogroup" aria-label="Passage automatique en arrière-plan">
            <span>Commande longue → arrière-plan</span>
            {BG_DELAYS.map((d) => (
              <button key={d} type="button" role="radio" aria-checked={delay === d} onClick={() => set(d)}>
                {d === 0 ? 'jamais' : d < 60 ? `${d} s` : '1 min'}
              </button>
            ))}
          </div>
        </div>
      )}
      {thread && <TaskThread sessionId={sessionId} taskId={thread.id} label={thread.label} running={tasks.some((t) => t.id === thread.id)} onClose={() => setThread(null)} />}
    </span>
  )
}

/** Fil d'un sous-agent de fond, en lecture seule, rafraîchi toutes les 2 s tant qu'il travaille. */
function TaskThread({ sessionId, taskId, label, running, onClose }: { sessionId: string; taskId: string; label: string; running: boolean; onClose: () => void }) {
  const [entries, setEntries] = useState<Item[] | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    let alive = true
    const load = () => void api.taskThread(sessionId, taskId).then((e) => alive && setEntries(e ?? [])).catch(() => {})
    load()
    const t = running ? setInterval(load, 2000) : undefined
    return () => {
      alive = false
      if (t) clearInterval(t)
    }
  }, [sessionId, taskId, running])
  // Suit la fin du fil, sauf si tu es remonté le lire.
  useEffect(() => {
    const b = box.current
    if (b && stick.current) b.scrollTop = b.scrollHeight
  }, [entries])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="tt-wrap" role="dialog" aria-label={`Fil de ${label}`} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tt">
        <div className="tt-h">
          <Icon name="agent" size={15} />
          <b title={label}>{label}</b>
          <span className={`tt-state ${running ? 'run' : ''}`}>{running ? 'travaille…' : 'terminé'}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="icon-btn sm" aria-label="Fermer" onClick={onClose}><Icon name="close" size={14} /></button>
        </div>
        <div ref={box} className="tt-body thread" onScroll={(e) => (stick.current = e.currentTarget.scrollHeight - e.currentTarget.scrollTop - e.currentTarget.clientHeight < 40)}>
          {entries === null && <div className="empty">Lecture du fil…</div>}
          {entries?.length === 0 && <div className="empty">Rien encore : il démarre.</div>}
          {entries && entries.length > 0 && <Thread sessionId={sessionId} items={entries} limit={400} onMore={() => {}} />}
        </div>
      </div>
    </div>
  )
}

function ActivityStrip({ session, items, empty }: { session: SessionMeta; items: Item[]; empty: boolean }) {
  const delay = useBgDelay((s) => s.delay)
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  // Question encore ouverte (bloquante ou en suspens) : un clic sur la bande ramène le fil dessus.
  const open = [...items].reverse().find((i) => i.kind === 'question' && i.state === 'pending') as Extract<Item, { kind: 'question' }> | undefined
  const bg = session.bgTasks ?? []
  if (session.status !== 'run' && session.status !== 'wait' && !open && !bg.length) return null
  // Commande ou sous-agent qui bloque Claude : bouton « Continuer pendant ce temps » et compte à rebours.
  const fg = session.status === 'run' ? [...items].reverse().find(isForeground) : undefined
  let since = 0
  let label: string
  const ask = [...items].reverse().find((i) => i.kind === 'question' && i.state === 'pending' && i.mode === 'wait') as Extract<Item, { kind: 'question' }> | undefined
  if (session.status === 'wait' && ask) {
    since = ask.at
    label = `Claude te pose ${ask.questions.length > 1 ? `${ask.questions.length} questions` : 'une question'} — choisis au-dessus, ou écris ici pour répondre librement`
  } else if (session.status === 'wait') {
    const p = [...items].reverse().find((i) => i.kind === 'permission' && i.state === 'pending') as Extract<Item, { kind: 'permission' }> | undefined
    since = p?.at ?? Date.now()
    label = p?.tool === 'ExitPlanMode' ? 'Plan prêt — à toi de valider' : `En attente de ta réponse — ${p ? toolDoing(p.tool, p.summary) : ''}`
    if (p && p.tool !== 'ExitPlanMode' && empty) label += ' · Entrée pour autoriser'
  } else {
    const lastUser = [...items].reverse().find((i) => i.kind === 'user')
    since = lastUser?.at ?? Date.now()
    const running = items.filter((i): i is Extract<Item, { kind: 'tool' }> => i.kind === 'tool' && i.status === 'running')
    const tool = [...running].reverse().find((t) => !t.parent && !t.subagent)
    const agents = running.filter((t) => t.subagent).length
    const a = session.activity
    if (tool) label = toolDoing(tool.name, tool.summary)
    else if (agents) label = `${agents} sous-agent${agents > 1 ? 's' : ''} au travail`
    else if (a?.kind === 'writing') label = 'Écrit'
    else if (a?.kind === 'tool') label = a.label ? toolDoing(a.label) : 'Prépare un outil'
    else label = 'Réfléchit'
    if (tool && agents) label += ` · ${agents} sous-agent${agents > 1 ? 's' : ''}`
    if (session.status !== 'run') {
      since = open?.at ?? Math.min(...bg.map((t) => t.startedAt))
      label = open ? 'Question en suspens' : 'Tâches de fond en cours'
    }
    if (open) label += ' · question en suspens'
  }
  const secs = Math.max(0, Math.round((Date.now() - since) / 1000))
  return (
    <div
      className={`cmp-strip ${session.status === 'wait' ? 'wait' : 'run'} ${open ? 'link' : ''}`}
      role="status"
      aria-live="polite"
      title={open ? 'Aller à la question' : undefined}
      onClick={open ? () => goToQuestion(open.id) : undefined}
    >
      <Icon name={session.status === 'wait' ? 'wait' : 'run'} size={14} />
      <span className="cmp-strip-l">{label}</span>
      {open && (
        <button type="button" className="cmp-strip-go" onClick={(e) => { e.stopPropagation(); goToQuestion(open.id) }}>
          Voir la question
        </button>
      )}
      {fg && (
        <button type="button" className="cmp-strip-go" title="Mettre en arrière-plan et laisser Claude continuer" onClick={(e) => { e.stopPropagation(); sendToBackground(session.id, fg.id) }}>
          Continuer pendant ce temps
        </button>
      )}
      {bg.length > 0 && <BgPill sessionId={session.id} tasks={bg} />}
      <span className="cmp-strip-t">{clock(secs)}</span>
      {fg && delay > 0 && (
        <span className="cmp-strip-count" aria-hidden="true">
          <span style={{ width: `${Math.max(0, 100 - ((Date.now() - fg.at) / (delay * 1000)) * 100)}%` }} />
        </span>
      )}
    </div>
  )
}

export function Composer({ sessionId, onSent, inputId = 'composer' }: { sessionId: string; onSent: () => void; inputId?: string }) {
  const [text, setText] = useState('')
  const [drag, setDrag] = useState(false)
  const session = useStore((s) => s.sessions[sessionId])
  const items = useStore((s) => s.items[sessionId] ?? NO_ITEMS)
  const pending = useStore((s) => s.attachments[sessionId] ?? NO_ATTACH)
  const attach = useStore((s) => s.attach)
  const detach = useStore((s) => s.detach)
  const fileRef = useRef<HTMLInputElement>(null)
  const draft = useStore((s) => s.draft[sessionId])
  const setDraft = useStore((s) => s.setDraft)
  useEffect(() => {
    if (draft === undefined) return
    setText(draft)
    setDraft(sessionId, undefined)
    document.getElementById(inputId)?.focus()
  }, [draft, sessionId, inputId, setDraft])
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const ac = useAutocomplete({ text, setText, sessionId, projectId: session?.projectId ?? '', inputRef })
  if (!session) return null
  const running = session.status === 'run'
  const waiting = session.status === 'wait'
  const empty = !text.trim() && !pending.length

  const send = () => {
    const t = text.trim() || (pending.length ? 'Regarde cette image.' : '')
    if (!t) return
    setText('')
    onSent()
    // Une question bloquante en cours : écrire dans la saisie, c'est y répondre librement.
    const ask = [...items].reverse().find((i) => i.kind === 'question' && i.state === 'pending' && i.blocking)
    if (ask) void api.answerQuestion(sessionId, ask.id, { action: 'chat' })
    void api.send(sessionId, t, pending.length ? pending : undefined)
    detach(sessionId)
  }
  const allowPending = () => {
    const p = [...items].reverse().find((i) => i.kind === 'permission' && i.state === 'pending') as Extract<Item, { kind: 'permission' }> | undefined
    if (p && p.tool !== 'ExitPlanMode') void api.respondPermission(sessionId, p.id, 'allow')
  }
  const addFiles = async (files: Iterable<File>) => {
    for (const f of files) if (f.type.startsWith('image/')) attach(sessionId, { dataUrl: await readAsDataUrl(f), name: f.name || 'image collée' })
  }

  const model = MODELS.find((m) => m.v === (session.modelChoice ?? '')) ?? MODELS[0]
  const modelLabel = model.v ? model.name : session.model ? session.model.replace(/^claude-/, '').replace(/-\d{8}$/, '') : 'Défaut'
  const mode = MODES.find((m) => m.v === session.permissionMode) ?? MODES[0]
  const ctx = session.contextTokens
  const win = contextWindowOf(session)
  const ctxPct = ctx ? Math.min(100, Math.round((ctx / win) * 100)) : 0
  const ctxTone = ctxPct >= 90 ? 'hot' : ctxPct >= 75 ? 'warm' : ''
  const placeholder = waiting
    ? 'Réponds à la demande ci-dessus, ou ajoute une précision…'
    : running
      ? 'Ajoute une précision, elle sera prise en compte à la suite…'
      : 'Écris ta demande… (@ fichier, / skill, coller ou glisser une image)'

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${waiting ? 'wait' : ''} ${drag ? 'drag' : ''}`}
        onDragOver={(e) => {
          if ([...e.dataTransfer.items].some((i) => i.kind === 'file')) {
            e.preventDefault()
            setDrag(true)
          }
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDrag(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDrag(false)
          void addFiles(e.dataTransfer.files)
        }}
      >
        <LimitCard />
        <ActivityStrip session={session} items={items} empty={empty} />
        {drag && (
          <div className="cmp-drop" aria-hidden="true">
            <Icon name="attach" size={20} />
            <b>Dépose pour joindre</b>
          </div>
        )}
        {pending.length > 0 && (
          <div className="cmp-att">
            {pending.map((a, k) => (
              <span key={k} className="attach">
                <img src={'mediaId' in a ? thumbUrl(a.mediaId) : a.dataUrl} alt="" />
                <span>{a.name}</span>
                <button type="button" aria-label={`Retirer ${a.name}`} onClick={() => detach(sessionId, k)}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        {ac.menu}
        <label htmlFor={inputId} className="sr-only">Message</label>
        <textarea
          id={inputId}
          rows={2}
          value={text}
          ref={inputRef}
          autoFocus
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value)
            ac.inputProps.onChangeText()
          }}
          onSelect={ac.inputProps.onSelect}
          onFocus={ac.inputProps.onFocus}
          onBlur={ac.inputProps.onBlur}
          onPaste={(e) => {
            const imgs = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
            if (imgs.length) {
              e.preventDefault()
              void addFiles(imgs)
            }
          }}
          onKeyDown={(e) => {
            if (ac.onKeyDown(e)) return
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              if (empty && waiting) allowPending()
              else send()
            } else if (e.key === 'Escape' && running && empty) {
              e.preventDefault()
              void api.interrupt(sessionId)
            }
          }}
        />
        <div className="cmp-bar">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files)
              e.target.value = ''
            }}
          />
          <button type="button" className="cmp-icon" aria-label="Joindre une image" title="Joindre une image" onClick={() => fileRef.current?.click()}>
            <Icon name="attach" size={17} />
          </button>
          <Dropdown label={`Modèle : ${modelLabel}`} button={<><Icon name="model" size={15} /><span className="cmp-chip-txt">{modelLabel}</span><Icon name="chevron" size={13} className="cmp-caret" /></>}>
            {(close) =>
              MODELS.map((m) => (
                <Option key={m.v || 'default'} icon="model" name={m.name} desc={m.desc} checked={m.v === model.v} onClick={() => { void api.setModel(sessionId, m.v); close() }} />
              ))
            }
          </Dropdown>
          <Dropdown label={`Mode : ${mode.name} — ${mode.desc}`} button={<><Icon name={MODE_ICON[mode.v]} size={15} /><span className="cmp-chip-txt cmp-mode-txt">{mode.name}</span><Icon name="chevron" size={13} className="cmp-caret" /></>}>
            {(close) =>
              MODES.map((m) => (
                <Option key={m.v} icon={MODE_ICON[m.v]} name={m.name} desc={m.desc} checked={m.v === mode.v} onClick={() => { void api.setPermissionMode(sessionId, m.v); close() }} />
              ))
            }
          </Dropdown>
          <span style={{ flex: 1 }} />
          <span className={`cmp-ctx ${ctxTone}`} title={ctx ? `Contexte utilisé : ${Math.round(ctx / 1000)}k sur ${Math.round(win / 1000)}k` : 'Contexte : pas encore mesuré'}>
            <Ring pct={ctxPct / 100} size={16} label={`Contexte utilisé à ${ctxPct} %`} />
            {ctx ? `${ctxPct} %` : '—'}
          </span>
          <UsageChip />
          {running && empty ? (
            <button type="button" className="cmp-send stop" aria-label="Arrêter (Échap)" title="Arrêter (Échap)" onClick={() => api.interrupt(sessionId)}>
              <Icon name="stop" size={15} />
            </button>
          ) : (
            <button type="button" className="cmp-send" aria-label="Envoyer (Entrée)" title="Envoyer (Entrée)" onClick={send} disabled={empty}>
              <Icon name="send" size={17} />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
