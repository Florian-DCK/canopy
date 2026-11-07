import { create } from 'zustand'
import type { AgendaBrief, AgendaMeeting, AgendaPrefs, AgendaState } from '../../shared/agenda'
import { api } from './store'

// Agenda (planches 51 à 55) : état tenu par le processus principal, relu à chaque « agenda:changed ».

type AgendaStore = {
  state: AgendaState | null
  prefs: AgendaPrefs | null
  briefs: Record<string, AgendaBrief | null>
  load(): Promise<void>
  refresh(): Promise<void>
  brief(meetingId: string): Promise<AgendaBrief | null>
  setPrefs(p: Partial<AgendaPrefs>): Promise<void>
}

export const useAgenda = create<AgendaStore>((set, get) => ({
  state: null,
  prefs: null,
  briefs: {},
  async load() {
    const [state, prefs] = await Promise.all([api.agendaState(), api.getAgendaPrefs()])
    set({ state, prefs })
  },
  async refresh() {
    set({ state: await api.agendaRefresh() })
  },
  async brief(meetingId) {
    const b = await api.agendaBrief(meetingId)
    set({ briefs: { ...get().briefs, [meetingId]: b } })
    return b
  },
  async setPrefs(p) {
    set({ prefs: await api.setAgendaPrefs(p) })
  }
}))

api.onEvent((e) => {
  if (e.type !== 'agenda:changed') return
  const st = useAgenda.getState()
  void st.load()
  // Les briefs déjà ouverts sont relus (une mise à jour a pu arriver).
  for (const id of Object.keys(st.briefs)) void st.brief(id)
})
void useAgenda.getState().load()

/** Réunions pas encore terminées, dans l'ordre. */
export const upcoming = (s: AgendaState | null, now = Date.now()): AgendaMeeting[] => (s?.meetings ?? []).filter((m) => !m.allDay && m.end > now)

/** Briefs prêts que l'utilisateur a ouverts (pour le point bleu de l'icône). */
const OPENED_KEY = 'atelier.agenda.opened'
export function openedBriefs(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(OPENED_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}
export function markBriefOpened(meetingId: string, updatedAt: number) {
  try {
    localStorage.setItem(OPENED_KEY, JSON.stringify({ ...openedBriefs(), [meetingId]: updatedAt }))
  } catch {
    /* stockage indisponible */
  }
}

/** Pastille de l'icône Agenda : losange orange (réunion dans moins de 15 min), point bleu (brief prêt pas ouvert). */
export function agendaBadge(s: AgendaState | null, now = Date.now()): 'clay' | 'blue' | null {
  const next = upcoming(s, now)
  if (next.some((m) => m.start > now - 60_000 && m.start - now <= 15 * 60_000)) return 'clay'
  const opened = openedBriefs()
  if (next.some((m) => m.brief.state === 'ready' && (opened[m.id] ?? 0) < (m.brief.updatedAt ?? 0))) return 'blue'
  return null
}

/** Sections d'un brief Markdown (## Titre → lignes). */
export function briefSections(md: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  let cur = ''
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+(.+)$/.exec(line)
    if (h) {
      cur = h[1].trim()
      out[cur] = []
    } else if (cur && line.trim() && !line.trim().startsWith('↳')) out[cur].push(line.replace(/^\s*[-*]\s+(\[[ xX]\]\s+)?/, '').trim())
  }
  return out
}

/** Puces d'une section avec leur contexte (ligne « ↳ » juste en dessous), pour le dépliant. */
export function briefItems(md: string, name: string): { text: string; ctx?: string }[] | undefined {
  const want = name.replace(/’/g, "'").toLowerCase()
  let cur: { text: string; ctx?: string }[] | undefined
  let found: typeof cur
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s+(.+)$/.exec(line)
    if (h) {
      cur = h[1].trim().replace(/’/g, "'").toLowerCase() === want ? [] : undefined
      if (cur) found = cur
      continue
    }
    const t = line.trim()
    if (!cur || !t) continue
    if (t.startsWith('↳')) {
      const last = cur[cur.length - 1]
      if (last) last.ctx = [last.ctx, t.replace(/^↳\s*/, '')].filter(Boolean).join(' ')
    } else cur.push({ text: t.replace(/^[-*]\s+(\[[ xX]\]\s+)?/, '') })
  }
  return found
}
