import { useEffect, useMemo, useRef, useState } from 'react'
import type { AgendaBrief, AgendaMeeting, FocusTask } from '../../../shared/agenda'
import type { Project } from '../../../shared/types'
import '../agenda.css'
import { briefSections, markBriefOpened, upcoming, useAgenda, briefItems } from '../agenda'
import { startNotes, useNotes } from '../notes/runtime'
import { api, useStore } from '../store'
import { TopBar } from '../ui'
import { NotesTab } from './NotesTab'

type Tab = 'meetings' | 'day' | 'notes'
const TABS: [Tab, string][] = [['meetings', 'Réunions'], ['day', 'Journée'], ['notes', 'Notes de réunion']]
const MIN = 60_000

/* ---------- Helpers ---------- */

const hhmm = (t: number) => new Date(t).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
const dkey = (t: number | Date) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const dayStart = (t: number, plus = 0) => {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + plus)
  return d.getTime()
}
const whenLabel = (t: number, now: number) => {
  const diff = Math.round((dayStart(t) - dayStart(now)) / 86_400_000)
  if (diff === 0) return 'Aujourd’hui'
  if (diff === 1) return 'Demain'
  return new Date(t).toLocaleDateString('fr-BE', { weekday: 'long' }).replace(/^./, (c) => c.toUpperCase())
}
const dayLabel = (t: number) => new Date(t).toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' }).replace(/^./, (c) => c.toUpperCase())
const inLabel = (m: AgendaMeeting, now: number) => {
  if (m.start <= now) return 'en cours'
  const min = Math.round((m.start - now) / MIN)
  if (min < 60) return `dans ${min} min`
  const h = Math.floor(min / 60)
  return h >= 24 ? `dans ${Math.floor(h / 24)} j` : `dans ${h} h${min % 60 ? ` ${String(min % 60).padStart(2, '0')}` : ''}`
}
const place = (m: AgendaMeeting) => (/teams\./i.test(m.joinUrl ?? '') ? 'Teams' : /meet\.google/i.test(m.joinUrl ?? '') ? 'Meet' : m.joinUrl ? 'Visio' : m.location || 'Sans lieu')
const people = (m: AgendaMeeting) => {
  const ext = m.attendees.filter((a) => a.external).length
  const n = m.attendees.length
  return `${n} personne${n > 1 ? 's' : ''}${ext ? `, dont ${ext} externe${ext > 1 ? 's' : ''}` : ''}`
}
const open = (url: string) => window.open(url, '_blank')
const sec = (md: string, name: string) => {
  const s = briefSections(md)
  const k = Object.keys(s).find((x) => x.replace(/’/g, "'").toLowerCase() === name.toLowerCase())
  return k ? s[k] : undefined
}

function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

/** Brief d'une réunion, chargé quand il est prêt. */
function useBrief(m: AgendaMeeting | undefined) {
  const brief = useAgenda((s) => (m ? s.briefs[m.id] : undefined))
  const load = useAgenda((s) => s.brief)
  const id = m?.id
  const ready = m?.brief.state === 'ready'
  const at = m?.brief.updatedAt
  useEffect(() => {
    if (id && ready) void load(id)
  }, [id, ready, at, load])
  return brief ?? null
}

/* ---------- Petits composants ---------- */

function ProjectChip({ m, projects }: { m: AgendaMeeting; projects: Project[] }) {
  const p = projects.find((x) => x.id === m.projectId)
  if (!p) return <span className="ag-proj"><em>à relier</em></span>
  return (
    <span className="ag-proj">
      <i style={{ background: p.color }} aria-hidden="true">{p.name.charAt(0).toUpperCase()}</i>
      {p.name}
      {m.link === 'auto' && <em>· relié tout seul</em>}
    </span>
  )
}

function Choose({ m, projects }: { m: AgendaMeeting; projects: Project[] }) {
  const [isOpen, setOpen] = useState(false)
  const [remember, setRemember] = useState(true)
  const ref = useRef<HTMLDivElement>(null)
  const cands = (m.candidates ?? []).map((id) => projects.find((p) => p.id === id)).filter((p): p is Project => !!p)
  const others = projects.filter((p) => !p.sandbox && !cands.includes(p))
  const pick = (id: string | null) => {
    setOpen(false)
    void api.agendaLink(m.id, id, remember)
  }
  useEffect(() => {
    if (!isOpen) return
    ref.current?.querySelector('button')?.focus()
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [isOpen])
  return (
    <div className="ag-pick" ref={ref} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button type="button" className="btn sm" aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setOpen(!isOpen)}>{m.projectId ? 'Changer' : 'Relier à un projet'}</button>
      {isOpen && (
        <div className="ag-menu" role="menu" aria-label="Projet de la réunion">
          {cands.length > 0 && <div className="ag-menu-h">Projets probables</div>}
          {cands.map((p) => <button key={p.id} type="button" role="menuitem" onClick={() => pick(p.id)}><span className="cl-dot" style={{ background: p.color }} />{p.name}</button>)}
          {cands.length > 0 && others.length > 0 && <div className="ag-menu-h">Tous les projets</div>}
          {others.map((p) => <button key={p.id} type="button" role="menuitem" onClick={() => pick(p.id)}><span className="cl-dot" style={{ background: p.color }} />{p.name}</button>)}
          <button type="button" role="menuitem" onClick={() => pick(null)}>Pas de projet</button>
          <label><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Retenir pour les suivantes</label>
        </div>
      )}
    </div>
  )
}

/** Ignorer une réunion : cette occurrence, ou toujours (la série, sinon ce titre). */
function Ignore({ m }: { m: AgendaMeeting }) {
  const [isOpen, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const pick = (always: boolean) => {
    setOpen(false)
    void api.agendaIgnore(m.id, always)
  }
  useEffect(() => {
    if (!isOpen) return
    ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [isOpen])
  return (
    <div className="ag-pick" ref={ref} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}>
      <button type="button" className="btn sm ghost" aria-haspopup="menu" aria-expanded={isOpen} title="Ignorer cette réunion" onClick={() => setOpen(!isOpen)}>Ignorer</button>
      {isOpen && (
        <div className="ag-menu" role="menu" aria-label="Ignorer la réunion">
          <button type="button" role="menuitem" onClick={() => pick(false)}>Cette fois seulement</button>
          <button type="button" role="menuitem" onClick={() => pick(true)}>{m.recurringId ? 'Toujours (toute la série)' : `Toujours (« ${m.title} »)`}</button>
        </div>
      )}
    </div>
  )
}

const briefText = (m: AgendaMeeting) =>
  m.brief.state === 'ready' ? 'brief prêt'
    : m.brief.state === 'pending' || m.brief.state === 'working' ? 'brief en préparation…'
      : m.brief.state === 'ondemand' ? 'brief à la demande'
        : m.brief.state === 'error' ? 'brief en erreur' : 'sans brief'

/** Extrait du brief (3 puces de « L'essentiel ») ou son état. */
function Excerpt({ m, onBrief, title = 'Brief' }: { m: AgendaMeeting; onBrief?: () => void; title?: string }) {
  const brief = useBrief(m)
  // Clic sur « Brief à la demande » : l’indicateur s’affiche tout de suite, sans attendre l’état du processus principal.
  const [asked, setAsked] = useState(false)
  useEffect(() => setAsked(false), [m.brief.state])
  const st = asked && m.brief.state === 'ondemand' ? 'pending' : m.brief.state
  const bullets = brief ? (sec(brief.markdown, 'L’essentiel') ?? []).slice(0, 3) : []
  if (st === 'none') return null
  return (
    <div className="ag-prep">
      <span className="ag-prep-h">{title}</span>
      {st === 'ready' && bullets.map((b, i) => <span key={i}><span aria-hidden="true">·</span>{b}</span>)}
      {st === 'ready' && !bullets.length && onBrief && <button type="button" className="ag-link" onClick={onBrief}>Voir le brief</button>}
      {(st === 'pending' || st === 'working') && <span className="ag-working" role="status"><i aria-hidden="true" />{st === 'working' ? 'Claude prépare le brief : invitation, mails, tâches… (1 à 2 min)' : 'Brief en file d’attente…'}</span>}
      {st === 'ondemand' && <div><button type="button" className="btn sm" onClick={() => { setAsked(true); void api.agendaMakeBrief(m.id) }}>Brief à la demande</button></div>}
      {st === 'error' && <span className="ag-err">{m.brief.error || 'Le brief n’a pas pu être préparé.'}</span>}
    </div>
  )
}

const dueLabel = (t: FocusTask, today: string) => (!t.due ? '' : t.due < today ? 'en retard' : t.due === today ? 'aujourd’hui' : new Date(`${t.due}T12:00`).toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' }))

function TaskLine({ t, today }: { t: FocusTask; today: string }) {
  const late = !!t.due && t.due <= today
  return (
    <div className="ag-mini">
      <span title={t.title}>{t.url ? <button type="button" className="ag-link" onClick={() => open(t.url!)}>{t.title}</button> : t.title}</span>
      <small className={late ? 'ag-due' : 'ag-sub'}>{dueLabel(t, today)}</small>
    </div>
  )
}

/* ---------- Brief ---------- */

/** Une puce du brief ; son contexte se déplie au clic quand Claude en a donné un. */
function Point({ it }: { it: { text: string; ctx?: string } }) {
  if (!it.ctx) return <span>{it.text}</span>
  return (
    <details className="ag-pt">
      <summary>{it.text}</summary>
      <p>{it.ctx}</p>
    </details>
  )
}

/** « Prendre des notes pendant » : démarre la prise de notes de la réunion, ou ramène à celle qui tourne. */
function NotesButton({ m, onNotes, primary }: { m: AgendaMeeting; onNotes: () => void; primary?: boolean }) {
  const active = useNotes((n) => n.status !== 'idle')
  return (
    <button type="button" className={`btn ${primary ? '' : 'ghost'}`} onClick={() => { if (!active) void startNotes({ title: m.title, meetingId: m.id }); onNotes() }}>
      {active ? 'Notes en cours' : 'Prendre des notes pendant'}
    </button>
  )
}

function BriefPanel({ m, onBack, onNotes }: { m: AgendaMeeting; onBack: () => void; onNotes: () => void }) {
  const projects = useStore((s) => s.projects)
  const brief = useBrief(m)
  const [ver, setVer] = useState<number | null>(null)
  const [done, setDone] = useState<Set<number>>(new Set())
  const now = useNow()
  useEffect(() => { setVer(null); setDone(new Set()) }, [m.id])
  useEffect(() => {
    if (brief && m.brief.updatedAt) markBriefOpened(m.id, m.brief.updatedAt)
  }, [m.id, m.brief.updatedAt, brief])
  const versions = (brief as AgendaBrief | null)?.versions ?? []
  const idx = ver !== null && ver < versions.length ? ver : versions.length - 1
  const md = versions[idx]?.markdown ?? brief?.markdown ?? ''
  const essential = briefItems(md, 'L’essentiel')
  const since = sec(md, 'Depuis ce matin')
  const points = briefItems(md, 'Points à aborder')
  const sources = sec(md, 'Sources')
  const st = m.brief.state
  return (
    <div className="ag-brief">
      <button type="button" className="ag-link" onClick={onBack}>← Réunions</button>
      <div className="ag-meta">
        <span>{whenLabel(m.start, now)} · {hhmm(m.start)} – {hhmm(m.end)}</span><span>·</span><span>{place(m)}</span><span>·</span><span>{people(m)}</span>
        <ProjectChip m={m} projects={projects} />
      </div>
      <h2 className="ag-hero-t">{m.title}</h2>
      {versions.length > 0 && (
        <div className="ag-vers">
          Versions
          <div className="seg" role="group" aria-label="Versions du brief">
            {versions.map((v, i) => <button key={v.at} type="button" aria-pressed={i === idx} onClick={() => setVer(i)}>{hhmm(v.at)}</button>)}
          </div>
          {idx === 0 && <span>premier jet</span>}
        </div>
      )}
      {st === 'ready' && brief ? (
        <>
          {essential && <div className="ag-card"><h3 className="ag-h">L’essentiel</h3><ul className="ag-ul">{essential.map((it, i) => <li key={i}><Point it={it} /></li>)}</ul></div>}
          {since && <div className="ag-since ag-sec"><h3 className="ag-h">Depuis ce matin</h3><ul className="ag-ul">{since.map((l, i) => <li key={i}>{l}</li>)}</ul></div>}
          {points && (
            <div className="ag-card">
              <h3 className="ag-h">Points à aborder</h3>
              <ul className="ag-ul chk">
                {points.map((it, i) => (
                  <li key={i} className="ag-chk"><input type="checkbox" aria-label={it.text} checked={done.has(i)} onChange={() => setDone((d) => { const n = new Set(d); if (!n.delete(i)) n.add(i); return n })} /><Point it={it} /></li>
                ))}
              </ul>
            </div>
          )}
          {sources && <div className="ag-sec"><h3 className="ag-h">Sources</h3><div className="ag-src">{sources.flatMap((l) => l.split(/\s*[;,]\s*/)).filter(Boolean).map((s, i) => <span key={i} className="tag">{s}</span>)}</div></div>}
          <span className="ag-mono">{brief.path}</span>
        </>
      ) : (
        <div className="ag-card"><Excerpt m={m} title="Brief" /></div>
      )}
      <div className="ag-acts">
        {m.joinUrl && <button type="button" className="btn primary" onClick={() => open(m.joinUrl!)}>Rejoindre</button>}
        <button type="button" className="btn" disabled={st === 'working'} onClick={() => void api.agendaMakeBrief(m.id)}>Mettre à jour maintenant</button>
        <NotesButton m={m} onNotes={onNotes} />
      </div>
    </div>
  )
}

/* ---------- Réunions ---------- */

function Hero({ m, now, projects, onBrief, onNotes }: { m: AgendaMeeting; now: number; projects: Project[]; onBrief: () => void; onNotes: () => void }) {
  return (
    <div className="ag-card">
      <div className="ag-meta">
        <span>{hhmm(m.start)} – {hhmm(m.end)}</span><span>·</span><span>{place(m)}</span><span>·</span><span>{people(m)}</span>
        <span className={`ag-chip ${m.start <= now ? 'blue' : ''}`}>{inLabel(m, now)}</span>
      </div>
      <h2 className="ag-hero-t">{m.title}</h2>
      <div className="ag-linkrow">
        <ProjectChip m={m} projects={projects} />
        <Choose m={m} projects={projects} />
      </div>
      <Excerpt m={m} onBrief={onBrief} title="L’essentiel du brief" />
      <div className="ag-acts">
        {m.brief.state === 'ready' && <button type="button" className="btn primary" onClick={onBrief}>Ouvrir le brief</button>}
        {m.joinUrl && <button type="button" className="btn" onClick={() => open(m.joinUrl!)}>Rejoindre</button>}
        <NotesButton m={m} onNotes={onNotes} primary />
        <Ignore m={m} />
      </div>
    </div>
  )
}

function Row({ m, now, projects, onBrief }: { m: AgendaMeeting; now: number; projects: Project[]; onBrief: () => void }) {
  return (
    <div className="ag-row">
      <div className="ag-when"><span>{whenLabel(m.start, now)}</span><b>{hhmm(m.start)}</b></div>
      <div className="ag-row-main">
        <button type="button" className="ag-row-t" onClick={onBrief} title={m.title}>{m.title}</button>
        <div className="ag-row-s"><span>{place(m)} · {people(m)}</span><span>·</span>{m.brief.state === 'working' || m.brief.state === 'pending' ? <span className="ag-working"><i aria-hidden="true" />{briefText(m)}</span> : <span>{briefText(m)}</span>}</div>
      </div>
      <div className="ag-row-side">
        <ProjectChip m={m} projects={projects} />
        <Choose m={m} projects={projects} />
        <Ignore m={m} />
      </div>
    </div>
  )
}

function Side({ meetings, now, tasks, tlOn }: { meetings: AgendaMeeting[]; now: number; tasks: FocusTask[]; tlOn: boolean }) {
  const today = dkey(now)
  const todays = meetings.filter((m) => dkey(m.start) === today && !m.allDay)
  const horizon = dkey(dayStart(now, 8))
  const due = tasks
    .filter((t) => !t.done && t.due && t.due < horizon)
    .sort((a, b) => (a.due! < b.due! ? -1 : a.due! > b.due! ? 1 : 0))
    .slice(0, 8)
  const nowIdx = todays.findIndex((m) => m.end > now)
  return (
    <div className="ag-col">
      <div className="ag-card">
        <h3 className="ag-h">Ta journée</h3>
        {todays.length === 0 && <span className="ag-sub">Aucune réunion aujourd’hui.</span>}
        {todays.map((m, i) => (
          <div key={m.id}>
            {i === nowIdx && todays[i].start > now && <div className="ag-now">maintenant</div>}
            <div className={`ag-mini ${m.end <= now ? 'past' : ''}`}>
              <time>{hhmm(m.start)}</time><span title={m.title}>{m.title}</span>
              {m.start <= now && m.end > now && <small className="ag-due">maintenant</small>}
            </div>
          </div>
        ))}
      </div>
      <div className="ag-card">
        <h3 className="ag-h">Échéances Teamleader</h3>
        {!tlOn ? <span className="ag-sub">Teamleader non connecté</span> : due.length === 0 ? <span className="ag-sub">Rien d’urgent dans les 7 jours.</span> : due.map((t) => <TaskLine key={t.id} t={t} today={today} />)}
      </div>
      <div className="ag-card ag-legend">
        <h3 className="ag-h">Sur l’icône Agenda</h3>
        <div><span className="ag-lg-blue" aria-hidden="true" />Point bleu : brief prêt, pas encore ouvert</div>
        <div><span className="ag-lg-clay" aria-hidden="true" />Losange orange : réunion dans moins de 15 minutes</div>
      </div>
    </div>
  )
}

function MeetingsTab({ meetings, tasks, tlOn, now, onBrief, onNotes }: { meetings: AgendaMeeting[]; tasks: FocusTask[]; tlOn: boolean; now: number; onBrief: (id: string) => void; onNotes: () => void }) {
  const projects = useStore((s) => s.projects)
  const next = meetings.filter((m) => !m.allDay && m.end > now)
  const [first, ...rest] = next
  return (
    <div className="ag-cols">
      <div className="ag-col">
        <h3 className="ag-h">Prochaine réunion</h3>
        {first ? <Hero m={first} now={now} projects={projects} onBrief={() => onBrief(first.id)} onNotes={onNotes} /> : <div className="ag-card ag-empty">Plus aucune réunion dans les 7 prochains jours.</div>}
        {rest.length > 0 && <h3 className="ag-h">Ensuite</h3>}
        {rest.map((m) => <Row key={m.id} m={m} now={now} projects={projects} onBrief={() => onBrief(m.id)} />)}
      </div>
      <Side meetings={meetings} now={now} tasks={tasks} tlOn={tlOn} />
    </div>
  )
}

/* ---------- Journée ---------- */

const PX = 56

function DayTab({ meetings, tasks, tlOn, now, onBrief }: { meetings: AgendaMeeting[]; tasks: FocusTask[]; tlOn: boolean; now: number; onBrief: (id: string) => void }) {
  const projects = useStore((s) => s.projects)
  const [offset, setOffset] = useState(0)
  const [sel, setSel] = useState<string | null>(null)
  const start = dayStart(now, offset)
  const key = dkey(start)
  const today = dkey(now)
  const evs = useMemo(() => meetings.filter((m) => !m.allDay && dkey(m.start) === key), [meetings, key])
  const dayTasks = tasks.filter((t) => !t.done && t.due && (t.due === key || (key === today && t.due < today)))
  const h0 = Math.min(8, ...evs.map((m) => new Date(m.start).getHours()))
  const h1 = Math.max(19, ...evs.map((m) => Math.ceil((m.end - start) / 3_600_000)))
  const y = (t: number) => ((t - start) / 3_600_000 - h0) * PX + 10
  // Colonnes : les réunions qui se chevauchent sont côte à côte.
  const lanes = useMemo(() => {
    const ends: number[] = []
    const lane = evs.map((m) => {
      let i = ends.findIndex((e) => e <= m.start)
      if (i < 0) i = ends.length
      ends[i] = m.end
      return i
    })
    return { lane, n: Math.max(1, ends.length) }
  }, [evs])
  const cur = evs.find((m) => m.id === sel) ?? (offset === 0 ? evs.find((m) => m.end > now) : evs[0]) ?? evs[0]
  const nowIn = offset === 0 && now >= start + h0 * 3_600_000 && now <= start + h1 * 3_600_000
  return (
    <>
      <div className="ag-head">
        <span className="ag-nav">
          <button type="button" className="icon-btn" aria-label="Jour précédent" disabled={offset <= 0} onClick={() => { setOffset(offset - 1); setSel(null) }}>‹</button>
          <span>{dayLabel(start)}</span>
          <button type="button" className="icon-btn" aria-label="Jour suivant" disabled={offset >= 7} onClick={() => { setOffset(offset + 1); setSel(null) }}>›</button>
        </span>
        <span className="ag-sub">{evs.length} réunion{evs.length > 1 ? 's' : ''}{tlOn ? ` · ${dayTasks.length} échéance${dayTasks.length > 1 ? 's' : ''} Teamleader` : ''}</span>
      </div>
      <div className="ag-day">
        <section className="ag-tl" style={{ height: (h1 - h0) * PX + 20 }} aria-label="Journée">
          {Array.from({ length: h1 - h0 + 1 }, (_, i) => (
            <div key={i} className="ag-hour" style={{ top: i * PX + 10 }}><span>{String(h0 + i).padStart(2, '0')}:00</span></div>
          ))}
          {evs.map((m, i) => {
            return (
              <button key={m.id} type="button" className="ag-ev" aria-pressed={cur?.id === m.id} onClick={() => setSel(m.id)}
                style={{ top: y(m.start), height: Math.max(26, ((m.end - m.start) / 3_600_000) * PX - 4), left: `calc(60px + (100% - 72px) * ${lanes.lane[i] / lanes.n})`, width: `calc((100% - 72px) / ${lanes.n} - 4px)` }}>
                <b>{m.title}</b>
                <small>{hhmm(m.start)} – {hhmm(m.end)} · {place(m)}</small>
              </button>
            )
          })}
          {nowIn && <div className="ag-nowline" style={{ top: y(now) }} aria-hidden="true" />}
        </section>
        <aside className="ag-col" aria-label="Détail">
          {cur ? (
            <div className="ag-card">
              <div className="ag-src-l"><i aria-hidden="true" />Google Agenda<span className="ag-sp" />{hhmm(cur.start)} – {hhmm(cur.end)}</div>
              <h2 className="ag-hero-t" style={{ fontSize: 21 }}>{cur.title}</h2>
              <span className="ag-meta">{place(cur)} · {people(cur)}</span>
              <ProjectChip m={cur} projects={projects} />
              <Excerpt m={cur} onBrief={() => onBrief(cur.id)} />
              <div className="ag-acts">
                {cur.brief.state === 'ready' ? <button type="button" className="btn primary" onClick={() => onBrief(cur.id)}>Ouvrir le brief</button> : <button type="button" className="btn primary" onClick={() => onBrief(cur.id)}>Voir la réunion</button>}
                {cur.joinUrl && <button type="button" className="btn" onClick={() => open(cur.joinUrl!)}>Rejoindre</button>}
              </div>
            </div>
          ) : (
            <div className="ag-card ag-empty">Aucune réunion ce jour-là.</div>
          )}
          <div className="ag-card">
            <h3 className="ag-h">Échéances du jour</h3>
            {!tlOn ? <span className="ag-sub">Teamleader non connecté</span> : dayTasks.length === 0 ? <span className="ag-sub">Aucune échéance.</span> : dayTasks.map((t) => <TaskLine key={t.id} t={t} today={today} />)}
          </div>
        </aside>
      </div>
    </>
  )
}

/* ---------- Vue ---------- */

export function AgendaView({ meetingId, tab }: { meetingId?: string; tab?: Tab }) {
  const state = useAgenda((s) => s.state)
  const refresh = useAgenda((s) => s.refresh)
  const go = useStore((s) => s.go)
  const now = useNow()
  const [cur, setCur] = useState<Tab>(tab ?? 'meetings')
  const [openId, setOpenId] = useState<string | null>(meetingId ?? null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (tab) setCur(tab) }, [tab])
  useEffect(() => { if (meetingId) { setOpenId(meetingId); setCur('meetings') } }, [meetingId])
  const meetings = useMemo(() => upcoming(state, 0), [state])
  const tasks = state?.tasks ?? []
  const connected = !!state?.google.connected
  const brief = openId ? meetings.find((m) => m.id === openId) : undefined
  const toNotes = () => { setCur('notes'); setOpenId(null) }
  const reload = async () => { setBusy(true); try { await refresh() } finally { setBusy(false) } }
  return (
    <div className="main ag">
      <TopBar>
        Canopy / <b>Agenda</b>
      </TopBar>
      <div className="scroll">
        <div className="ag-page">
          <div className="ag-head">
            <h1 className="ag-title">Agenda</h1>
            <div className="ag-tabs" role="tablist" aria-label="Vues de l’agenda">
              {TABS.map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={cur === id} onClick={() => { setCur(id); setOpenId(null) }}>{label}</button>
              ))}
            </div>
            <span className="ag-sp" />
            {state && state.updatedAt > 0 && <span className="ag-sub">Mis à jour à {hhmm(state.updatedAt)}</span>}
            <button type="button" className="btn sm" disabled={busy || !connected} onClick={() => void reload()}>{busy ? 'Actualisation…' : 'Actualiser'}</button>
          </div>
          {!state ? (
            <div className="ag-sub">Chargement…</div>
          ) : !connected ? (
            <div className="ag-card ag-empty">
              <h2 className="ag-hero-t">Ton agenda n’est pas relié</h2>
              <span>Connecte Google Agenda dans Paramètres › Agenda : Canopy prépare alors un brief avant chaque réunion.</span>
              <button type="button" className="btn primary" onClick={() => go({ name: 'settings' })}>Ouvrir les paramètres</button>
            </div>
          ) : cur === 'notes' ? (
            <NotesTab />
          ) : brief && cur === 'meetings' ? (
            <BriefPanel m={brief} onBack={() => setOpenId(null)} onNotes={toNotes} />
          ) : cur === 'meetings' ? (
            <MeetingsTab meetings={meetings} tasks={tasks} tlOn={state.teamleader.connected} now={now} onBrief={setOpenId} onNotes={toNotes} />
          ) : (
            <DayTab meetings={meetings} tasks={tasks} tlOn={state.teamleader.connected} now={now} onBrief={(id) => { setOpenId(id); setCur('meetings') }} />
          )}
        </div>
      </div>
    </div>
  )
}
