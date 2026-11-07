import { app, ipcMain } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgendaBrief, AgendaMeeting, AgendaPrefs, AgendaState, BriefInput, BriefState, BriefVersion, FocusTask, SourceStatus } from '../../shared/agenda'
import type { HistoryEntry, Project, Toast } from '../../shared/types'
import { getAgendaIgnored, getAgendaLinks, getAgendaPrefs, setAgendaIgnored, setAgendaLinks, setAgendaPrefs } from '../settings'
import { googleAccount, googleConfigured, googleConnect, googleConnected, googleDisconnect, googleListEvents, googleMails, googleSetClient, type RawMeeting } from './google'
import { teamleaderAccount, teamleaderConfigured, teamleaderConnect, teamleaderConnected, teamleaderDisconnect, teamleaderTasks } from './teamleader'

// Service Agenda (planches 51 à 55) : lit Google Agenda et Teamleader, relie les réunions aux projets,
// fait écrire les briefs par le démon (un à la fois) et prévient 10 min avant.

export type AgendaDeps = {
  projects: () => Project[]
  rpc: <T = unknown>(method: string, ...args: unknown[]) => Promise<T>
  /** Le démon répond. */
  ready: () => boolean
  /** Dit au renderer que l'état a changé. */
  emit: () => void
  toast: (t: Omit<Toast, 'id' | 'at'>) => void
  /** Silence ou heures calmes. */
  quiet: () => boolean
}

type Entry = { state: BriefState; updatedAt?: number; error?: string; path: string; versions: BriefVersion[] }
type Saved = { briefs: Record<string, Entry>; overrides: Record<string, string | null>; /** Occurrences ignorées une seule fois. */ ignoredOnce?: string[] }

const MIN = 60_000
const HOUR = 60 * MIN
const GENERIC = new Set(['hilarious', 'projet', 'project', 'test', 'sandbox', '2026', 'bac', 'sable'])
const FREE_MAIL = new Set(['gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'yahoo.com'])

const dir = () => join(app.getPath('userData'), 'agenda')
const stateFile = () => join(dir(), 'state.json')
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (t: number) => `${pad(new Date(t).getHours())}:${pad(new Date(t).getMinutes())}`
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

// Accès pour les notes de réunion : la réunion et son brief (renseigné par startAgenda).
let lookup: { meeting: (id: string) => AgendaMeeting | undefined; brief: (id: string) => AgendaBrief | null } | null = null
export const agendaMeeting = (id: string) => lookup?.meeting(id)
export const agendaBrief = (id: string) => lookup?.brief(id) ?? null

export function startAgenda(d: AgendaDeps) {
  let saved: Saved = { briefs: {}, overrides: {} }
  try {
    saved = { briefs: {}, overrides: {}, ...JSON.parse(readFileSync(stateFile(), 'utf8')) }
    // Un brief interrompu par la fermeture de Canopy : on garde sa dernière version, sinon on l'oublie.
    for (const [id, e] of Object.entries(saved.briefs)) {
      if (e.state === 'working' || e.state === 'pending') {
        if (e.versions.length) e.state = 'ready'
        else delete saved.briefs[id]
      }
    }
  } catch {
    /* premier lancement */
  }
  const persist = () => {
    try {
      write(stateFile(), JSON.stringify(saved))
    } catch (e) {
      console.log('[agenda] état non enregistré :', msg(e))
    }
  }

  let raws: RawMeeting[] = []
  let meetings: AgendaMeeting[] = []
  let tasks: FocusTask[] = []
  let updatedAt = 0
  let gError: string | undefined
  let tError: string | undefined
  const queue: string[] = []
  let busy = false
  let refreshing: Promise<void> | null = null
  const notified = new Set<string>()

  // ── Lien réunion → projet ────────────────────────────────────────────────
  const tokens = (name: string) => name.split(/[\s/\-_.]+/).map(norm).filter((t) => t.length >= 3 && !GENERIC.has(t))
  const extDomains = (m: { attendees: RawMeeting['attendees'] }) => [...new Set(m.attendees.filter((a) => a.external).map((a) => a.email.split('@')[1]).filter((x) => x && !FREE_MAIL.has(x)))]
  const keysOf = (m: RawMeeting) => [...(m.recurringId ? [`r:${m.recurringId}`] : []), `t:${norm(m.title).trim()}`, ...extDomains(m).map((x) => `d:${x}`)]

  function scores(title: string, description = '') {
    const t = norm(title)
    const desc = norm(description)
    return d
      .projects()
      .filter((p) => !p.sandbox)
      .map((p) => ({ id: p.id, score: tokens(p.name).reduce((s, tok) => s + (t.includes(tok) ? 2 : 0) + (desc.includes(tok) ? 1 : 0), 0) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
  }

  /** Projet Canopy d'une tâche Teamleader : par le nom du projet Teamleader, sinon par le titre de la tâche. */
  const taskProject = (t: FocusTask) => {
    for (const text of [t.projectName, t.title]) {
      if (!text) continue
      const s = scores(text)
      if (s.length && s[0].score > (s[1]?.score ?? 0)) return s[0].id
    }
    return null
  }

  function linkOf(m: RawMeeting): Pick<AgendaMeeting, 'projectId' | 'link' | 'candidates'> {
    const known = (id: string | null) => id === null || d.projects().some((p) => p.id === id)
    if (m.id in saved.overrides && known(saved.overrides[m.id])) return { projectId: saved.overrides[m.id], link: 'chosen' }
    const mem = getAgendaLinks()
    for (const k of keysOf(m)) if (k in mem && known(mem[k])) return { projectId: mem[k], link: 'chosen' }
    const s = scores(m.title, m.description)
    if (!s.length) return { projectId: null, link: 'none' }
    const tied = s.filter((x) => x.score === s[0].score)
    return tied.length === 1 ? { projectId: s[0].id, link: 'auto' } : { projectId: null, link: 'doubt', candidates: tied.map((x) => x.id) }
  }

  // ── Briefs ───────────────────────────────────────────────────────────────
  const wantsAuto = (m: AgendaMeeting, p = getAgendaPrefs()) => !m.allDay && (p.briefFor === 'all' || (p.briefFor === 'external' && m.external))
  const inWindow = (m: AgendaMeeting, now = Date.now()) => m.end > now && m.start - now <= 24 * HOUR

  function rebuild() {
    const p = getAgendaPrefs()
    const now = Date.now()
    const ignored = getAgendaIgnored()
    const once = new Set(saved.ignoredOnce ?? [])
    // Pas une réunion : rien que toi, sans lien de visio (bloc « Télétravail », rappel). Ou ignorée par toi.
    const kept = raws.filter((r) => !once.has(r.id) && !keysOf(r).some((k) => k in ignored) && (r.joinUrl || r.attendees.some((a) => !a.self)))
    meetings = kept.map((r) => {
      const e = saved.briefs[r.id]
      const m = { ...r, ...linkOf(r), brief: { state: 'none' as BriefState } } as AgendaMeeting
      m.brief = e ? { state: e.state, updatedAt: e.updatedAt, error: e.error } : { state: wantsAuto(m, p) ? (inWindow(m, now) ? 'pending' : 'none') : 'ondemand' }
      return m
    })
  }

  const briefPath = (m: AgendaMeeting) => {
    const day = `${new Date(m.start).getFullYear()}-${pad(new Date(m.start).getMonth() + 1)}-${pad(new Date(m.start).getDate())}`
    const slug = norm(m.title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'reunion'
    return join(dir(), 'briefs', `${day}-${slug}-${createHash('sha1').update(m.id).digest('hex').slice(0, 6)}.md`)
  }

  const readCurrent = (e: Entry) => (existsSync(e.path) ? readFileSync(e.path, 'utf8') : e.versions[e.versions.length - 1]?.markdown)

  function enqueue(m: AgendaMeeting) {
    if (queue.includes(m.id)) return
    const e = (saved.briefs[m.id] ??= { state: 'pending', path: briefPath(m), versions: [] })
    if (!e.versions.length) e.state = 'pending'
    queue.push(m.id)
  }

  /** Premier brief dès que la réunion entre dans les 24 h ; mise à jour une fois, 30 min avant. */
  function schedule() {
    const p = getAgendaPrefs()
    const now = Date.now()
    for (const m of meetings) {
      if (m.allDay || m.end <= now) continue
      const e = saved.briefs[m.id]
      if (!e) {
        if (wantsAuto(m, p) && inWindow(m, now)) enqueue(m)
      } else if (e.state === 'ready' && p.refreshBefore && now >= m.start - 30 * MIN && (e.versions[e.versions.length - 1]?.at ?? 0) < m.start - 30 * MIN) enqueue(m)
    }
    rebuild()
  }

  function tasksFor(project?: Project) {
    const s = new Date(Date.now() + 7 * 86_400_000)
    const soon = `${s.getFullYear()}-${pad(s.getMonth() + 1)}-${pad(s.getDate())}`
    const mine = project ? tasks.filter((t) => taskProject(t) === project.id) : []
    return mine.length ? mine : tasks.filter((t) => t.due && t.due <= soon)
  }

  async function makeBrief(id: string) {
    const m = meetings.find((x) => x.id === id)
    const e = saved.briefs[id]
    if (!m || !e) return
    e.state = 'working'
    e.error = undefined
    rebuild()
    d.emit()
    try {
      const project = d.projects().find((p) => p.id === m.projectId)
      let mails: BriefInput['mails'] = []
      if (getAgendaPrefs().useMail && googleConnected()) {
        const others = m.attendees.filter((a) => !a.self)
        mails = await googleMails({ title: m.title, project: project?.name, participants: others.map((a) => a.email), external: others.filter((a) => a.external).map((a) => a.email) }, 8).catch((err) => {
          console.log('[agenda] mails illisibles :', msg(err))
          return []
        })
      }
      let sessions: BriefInput['sessions'] = []
      if (project) {
        const since = Date.now() - 14 * 86_400_000
        sessions = (await d.rpc<HistoryEntry[]>('listHistory'))
          .filter((h) => h.projectId === project.id && h.lastModified >= since)
          .sort((a, b) => b.lastModified - a.lastModified)
          .slice(0, 15)
          .map((h) => ({ title: h.title, at: h.lastModified }))
      }
      const input: BriefInput = { meeting: m, projectName: project?.name, projectPath: project?.path, mails, tasks: tasksFor(project), sessions, previous: readCurrent(e), path: e.path, now: Date.now() }
      const markdown = await d.rpc<string>('makeBrief', input)
      write(e.path, markdown)
      e.versions = [...e.versions, { at: Date.now(), markdown }].slice(-10)
      e.state = 'ready'
      e.updatedAt = Date.now()
    } catch (err) {
      e.state = 'error'
      e.error = msg(err)
      console.log('[agenda] brief en erreur :', e.error)
    }
    persist()
    rebuild()
    d.emit()
  }

  async function runQueue() {
    if (busy || !d.ready()) return
    busy = true
    try {
      for (let id = queue.shift(); id; id = d.ready() ? queue.shift() : undefined) await makeBrief(id)
    } finally {
      busy = false
    }
  }

  function readBrief(id: string): AgendaBrief | null {
    const e = saved.briefs[id]
    if (!e || !e.versions.length) return null
    const cur = readCurrent(e) ?? ''
    // Une session du projet a pu compléter le fichier : on en garde une version.
    if (cur !== e.versions[e.versions.length - 1].markdown) {
      e.versions = [...e.versions, { at: Date.now(), markdown: cur }].slice(-10)
      e.updatedAt = Date.now()
      persist()
      rebuild()
      d.emit()
    }
    return { meetingId: id, markdown: cur, versions: e.versions, path: e.path }
  }

  lookup = { meeting: (id) => meetings.find((x) => x.id === id), brief: readBrief }

  // ── Contexte des sessions et notification ───────────────────────────────
  function pushLines() {
    if (!d.ready()) return
    const now = Date.now()
    const day0 = new Date()
    day0.setHours(24, 0, 0, 0)
    const lines: Record<string, string> = {}
    for (const m of meetings) {
      const e = saved.briefs[m.id]
      if (!m.projectId || !e || !e.versions.length || m.allDay || m.end <= now || m.start >= day0.getTime()) continue
      const line = `Réunion aujourd'hui : « ${m.title} » à ${hhmm(m.start)} (${m.attendees.length} participants). Brief : ${e.path}. Si l'utilisateur te demande d'ajouter quelque chose au brief, ajoute-le dans la section « ## Depuis ce matin » de ce fichier, avec l'heure.`
      lines[m.projectId] = lines[m.projectId] ? `${lines[m.projectId]}\n${line}` : line
    }
    // Renvoyé à chaque tick : un démon redémarré retrouve ses lignes.
    void d.rpc('setAgendaLines', lines).catch(() => {})
  }

  function notify() {
    if (!getAgendaPrefs().notifyBefore || d.quiet()) return
    const now = Date.now()
    for (const m of meetings) {
      if (m.allDay || notified.has(m.id) || m.start <= now || m.start - now > 10 * MIN) continue
      notified.add(m.id)
      const e = saved.briefs[m.id]
      const essential = e?.versions.length ? (readCurrent(e) ?? '').match(/^##\s+L['’]essentiel[^\n]*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/im)?.[1] : undefined
      const bullets = (essential ?? '')
        .split('\n')
        .filter((l) => /^\s*[-*•]\s+/.test(l))
        .map((l) => l.replace(/^\s*[-*•]\s+/, '').trim())
        .slice(0, 3)
      const people = m.attendees.filter((a) => !a.self).map((a) => a.name || a.email)
      const project = d.projects().find((p) => p.id === m.projectId)
      d.toast({
        kind: 'meeting',
        sessionId: '',
        meetingId: m.id,
        joinUrl: m.joinUrl,
        project: project?.name ?? 'Agenda',
        color: project?.color ?? '#5B9BE6',
        title: `${m.title} dans ${Math.max(1, Math.round((m.start - now) / MIN))} min`,
        body: bullets.length ? bullets.map((b) => `• ${b}`).join('\n') : people.slice(0, 5).join(', ') || undefined
      })
    }
  }

  const tick = () => {
    notify()
    schedule()
    pushLines()
    void runQueue()
  }

  // ── Lecture des sources ─────────────────────────────────────────────────
  function refresh(): Promise<void> {
    return (refreshing ??= (async () => {
      let ok = false
      let gOk = false
      if (googleConnected()) {
        try {
          raws = (await googleListEvents()).sort((a, b) => a.start - b.start)
          gError = undefined
          ok = true
          gOk = true
        } catch (e) {
          gError = msg(e)
          console.log('[agenda] Google :', gError)
        }
      }
      if (teamleaderConnected()) {
        try {
          tasks = (await teamleaderTasks()).map((t) => ({ ...t, projectId: null }))
          tError = undefined
          ok = true
        } catch (e) {
          tError = msg(e)
          console.log('[agenda] Teamleader :', tError)
        }
      }
      if (ok) updatedAt = Date.now()
      // Ne garder que les briefs des réunions encore à l'agenda, et seulement si Google a répondu (hors ligne : on ne supprime rien).
      if (gOk) {
        const ids = new Set(raws.map((r) => r.id))
        for (const id of Object.keys(saved.briefs)) if (!ids.has(id) && !queue.includes(id)) delete saved.briefs[id]
        if (saved.ignoredOnce) saved.ignoredOnce = saved.ignoredOnce.filter((id) => ids.has(id))
      }
      persist()
      rebuild()
      tick()
      d.emit()
    })().finally(() => {
      refreshing = null
    }))
  }

  const status = (configured: boolean, connected: boolean, account: string, error?: string): SourceStatus => ({ configured, connected, account: account || undefined, error })
  const state = (): AgendaState => ({
    google: status(googleConfigured(), googleConnected(), googleAccount(), gError),
    teamleader: status(teamleaderConfigured(), teamleaderConnected(), teamleaderAccount(), tError),
    updatedAt,
    meetings,
    tasks
  })

  // ── IPC ─────────────────────────────────────────────────────────────────
  ipcMain.handle('agenda:state', () => state())
  ipcMain.handle('agenda:refresh', async () => {
    await refresh()
    return state()
  })
  ipcMain.handle('agenda:googleClient', (_e, id: string, secret: string) => {
    googleSetClient(String(id).trim(), String(secret).trim())
    return state()
  })
  ipcMain.handle('agenda:connect', async (_e, source: 'google' | 'teamleader') => {
    try {
      if (source === 'google') await googleConnect()
      else await teamleaderConnect()
      if (source === 'google') gError = undefined
      else tError = undefined
      void refresh()
      return { ok: true as const }
    } catch (e) {
      const err = e as NodeJS.ErrnoException
      return { ok: false as const, error: err.code === 'EADDRINUSE' ? 'Le port de connexion est déjà utilisé : une autre connexion est peut-être en cours.' : msg(e) }
    }
  })
  ipcMain.handle('agenda:disconnect', (_e, source: 'google' | 'teamleader') => {
    if (source === 'google') {
      googleDisconnect()
      raws = []
      gError = undefined
    } else {
      teamleaderDisconnect()
      tasks = []
      tError = undefined
    }
    rebuild()
    d.emit()
    return state()
  })
  ipcMain.handle('agenda:link', (_e, meetingId: string, projectId: string | null, remember: boolean) => {
    const r = raws.find((x) => x.id === meetingId)
    if (r) {
      saved.overrides[meetingId] = projectId
      persist()
      if (remember) {
        const mem = { ...getAgendaLinks() }
        for (const k of [r.recurringId ? `r:${r.recurringId}` : `t:${norm(r.title).trim()}`, ...extDomains(r).map((x) => `d:${x}`)]) mem[k] = projectId
        setAgendaLinks(mem)
      }
      rebuild()
      pushLines()
      d.emit()
    }
    return state()
  })
  ipcMain.handle('agenda:ignore', (_e, meetingId: string, always: boolean) => {
    const r = raws.find((x) => x.id === meetingId)
    if (r) {
      if (always) setAgendaIgnored({ ...getAgendaIgnored(), [r.recurringId ? `r:${r.recurringId}` : `t:${norm(r.title).trim()}`]: r.title })
      else saved.ignoredOnce = [...(saved.ignoredOnce ?? []).filter((id) => raws.some((x) => x.id === id)), meetingId]
      persist()
      rebuild()
      pushLines()
      d.emit()
    }
    return state()
  })
  ipcMain.handle('agenda:ignored', () => getAgendaIgnored())
  ipcMain.handle('agenda:unignore', (_e, key: string) => {
    const { [key]: _, ...rest } = getAgendaIgnored()
    setAgendaIgnored(rest)
    rebuild()
    pushLines()
    d.emit()
    return rest
  })
  ipcMain.handle('agenda:brief', (_e, id: string) => readBrief(id))
  ipcMain.handle('agenda:makeBrief', (_e, id: string) => {
    const m = meetings.find((x) => x.id === id)
    if (m && saved.briefs[id]?.state !== 'working') {
      enqueue(m)
      rebuild()
      d.emit()
      tick()
    }
  })
  ipcMain.handle('agenda:prefs', (_e, p?: Partial<AgendaPrefs>) => {
    if (!p) return getAgendaPrefs()
    const r = setAgendaPrefs(p)
    rebuild()
    tick()
    d.emit()
    return r
  })

  setTimeout(() => void refresh(), 3000)
  setInterval(() => void refresh(), 5 * MIN).unref?.()
  setInterval(tick, MIN).unref?.()
}
