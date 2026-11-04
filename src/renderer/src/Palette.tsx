import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon, type IconName } from './icons'
import { addProjectDialog, resumeFromHistory, useStore } from './store'
import { hhmm } from './usage'
import { newSession } from './views/Cockpit'

const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

type Entry = { key: string; section: string; icon: IconName; color?: string; label: string; hint?: string; kbd?: string; run: () => void }

/** Carte au-dessus de la saisie quand la fenêtre des 5 h est épuisée. */
export function LimitCard() {
  const q = useStore((s) => s.quota)
  if (q.status !== 'rejected') return null
  const reset = q.five?.resetsAt
  return (
    <div className="limit-card" role="status">
      <Icon name="quota" size={18} />
      <div>
        <b>Limite des 5 h atteinte</b>
        <span>{reset ? `Reprise possible vers ${hhmm(reset)}.` : 'Reprise dès que la fenêtre se libère.'}</span>
      </div>
    </div>
  )
}

export function Palette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const sessions = useStore((s) => s.sessions)
  const projects = useStore((s) => s.projects)
  const history = useStore((s) => s.history)
  const go = useStore((s) => s.go)

  // Ctrl+K ouvre/ferme ; Ctrl+Tab / Ctrl+Maj+Tab : session suivante/précédente.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setQ('')
        setIdx(0)
        setOpen((o) => !o)
        return
      }
      if (e.ctrlKey && e.key === 'Tab') {
        const st = useStore.getState()
        if (st.view.name !== 'session') return
        e.preventDefault()
        const list = Object.values(st.sessions).sort((a, b) => b.updatedAt - a.updatedAt)
        if (list.length < 2) return
        const cur = list.findIndex((s) => s.id === (st.view as { sessionId: string }).sessionId)
        const next = list[(cur + (e.shiftKey ? -1 : 1) + list.length) % list.length]
        st.go({ name: 'session', sessionId: next.id })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open && !useStore.getState().history.length) void useStore.getState().loadHistory()
  }, [open])

  const entries = useMemo<Entry[]>(() => {
    if (!open) return []
    const needle = norm(q.trim())
    const pname = (id: string) => projects.find((p) => p.id === id)?.name ?? ''
    const match = (...t: string[]) => !needle || t.some((x) => norm(x).includes(needle))
    const out: Entry[] = []
    const rank = (s: { status: string }) => (s.status === 'wait' ? 0 : 1)
    Object.values(sessions)
      .sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)
      .filter((s) => match(s.title, pname(s.projectId)))
      .forEach((s) =>
        out.push({
          key: 's' + s.id,
          section: 'Sessions',
          icon: s.status === 'wait' ? 'wait' : s.status === 'run' ? 'run' : s.status === 'error' ? 'error' : 'done',
          color: s.status === 'wait' ? 'var(--clay)' : s.status === 'run' ? 'var(--st-run)' : s.status === 'error' ? 'var(--st-err)' : 'var(--st-ok)',
          label: s.title,
          hint: [pname(s.projectId), s.status === 'wait' ? 'attend ta réponse' : ''].filter(Boolean).join(' · '),
          run: () => go({ name: 'session', sessionId: s.id })
        })
      )
    const actions: Entry[] = [
      ...projects.map((p) => ({
        key: 'n' + p.id,
        section: 'Actions',
        icon: 'plus' as IconName,
        label: `Nouvelle session dans ${p.name}`,
        run: () => void newSession(p.id)
      })),
      { key: 'a-cockpit', section: 'Actions', icon: 'run', label: 'Ouvrir le cockpit', run: () => go({ name: 'cockpit' }) },
      { key: 'a-history', section: 'Actions', icon: 'history', label: 'Historique', run: () => go({ name: 'history' }) },
      { key: 'a-projects', section: 'Actions', icon: 'files', label: 'Projets', run: () => go({ name: 'projects' }) },
      { key: 'a-addproject', section: 'Actions', icon: 'plus', label: 'Ajouter un projet (dossier)…', run: () => void addProjectDialog() }
    ]
    out.push(...actions.filter((a) => match(a.label)))
    history
      .filter((h) => match(h.title, pname(h.projectId)))
      .slice(0, 8)
      .forEach((h) =>
        out.push({
          key: 'h' + h.sdkSessionId,
          section: 'Historique',
          icon: 'history',
          label: h.title,
          hint: pname(h.projectId),
          run: () => void resumeFromHistory(h)
        })
      )
    return out
  }, [open, q, sessions, projects, history, go])

  const active = Math.min(idx, Math.max(0, entries.length - 1))
  useEffect(() => {
    listRef.current?.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [active, entries])

  if (!open) return null
  const close = () => setOpen(false)
  const exec = (e?: Entry) => {
    if (!e) return
    close()
    e.run()
  }
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const n = entries.length
      if (n) setIdx((active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      exec(entries[active])
    }
  }

  let last = ''
  return (
    <div className="pal-back" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="pal" role="dialog" aria-label="Palette de commandes" onKeyDown={onKeyDown}>
        <div className="pal-search">
          <Icon name="search" size={16} />
          <input
            autoFocus
            value={q}
            placeholder="Chercher une session, une action…"
            onChange={(e) => {
              setQ(e.target.value)
              setIdx(0)
            }}
          />
        </div>
        <div className="pal-list" ref={listRef}>
          {entries.length === 0 && <div className="pal-empty">Aucun résultat</div>}
          {entries.map((e, k) => {
            const head = e.section !== last
            last = e.section
            return (
              <div key={e.key}>
                {head && <div className="pal-sec">{e.section}</div>}
                <div className={`pal-item${k === active ? ' on' : ''}`} onMouseMove={() => k !== active && setIdx(k)} onClick={() => exec(e)}>
                  <span style={{ color: e.color, display: 'inline-flex' }}>
                    <Icon name={e.icon} size={15} />
                  </span>
                  <span className="pal-label">{e.label}</span>
                  {e.hint && <span className="pal-hint">{e.hint}</span>}
                  {e.kbd && <kbd>{e.kbd}</kbd>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="pal-foot">
          <span>
            <kbd>Ctrl 1…9</kbd> vue
          </span>
          <span>
            <kbd>Ctrl B</kbd> sessions
          </span>
          <span>
            <kbd>Échap</kbd> arrêter
          </span>
        </div>
      </div>
    </div>
  )
}
