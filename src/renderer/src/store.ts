import { create } from 'zustand'
import { reduce, type AppState } from '../../shared/state'
import type {
  AppEvent,
  AtelierApi,
  Attachment,
  ExternalSession,
  HistoryEntry,
  Item,
  MediaItem,
  Project,
  Quota,
  SessionMeta
} from '../../shared/types'

export type ArtTabs = { active: string; closed: Record<string, number>; seen: Record<string, number> }

export type ViewerMode = 'single' | 'side' | 'slider'
export type Viewer = { sessionId: string; mediaId: string; compareId?: string; mode: ViewerMode }

declare global {
  interface Window {
    atelier: AtelierApi
  }
}
export const api = window.atelier

const VIEW_KEY = 'atelier.view'
/** Fenêtre de capture hors écran (outil des agents) : vue imposée par l'URL, rien n'est mémorisé. */
export const CAPTURE = new URLSearchParams(location.search).get('capture') === '1'
/** Fenêtre de capture : force clair ou sombre sans toucher au thème de l'utilisateur. */
function applyCaptureTheme() {
  const theme = new URLSearchParams(location.search).get('theme')
  if (!CAPTURE || (theme !== 'dark' && theme !== 'light')) return
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue
    }
    for (let k = rules.length - 1; k >= 0; k--) {
      const r = rules[k]
      if (!(r instanceof CSSMediaRule) || !/prefers-color-scheme:\s*dark/.test(r.conditionText)) continue
      const inner = Array.from(r.cssRules).map((x) => x.cssText)
      sheet.deleteRule(k)
      if (theme === 'dark') inner.forEach((css, j) => sheet.insertRule(css, k + j))
    }
  }
  document.documentElement.style.colorScheme = theme
}

function captureView(): View | null {
  if (!CAPTURE) return null
  const q = new URLSearchParams(location.search)
  const v = q.get('view')
  if (v === 'session' && q.get('session')) return { name: 'session', sessionId: q.get('session')! }
  if (v === 'history' || v === 'projects' || v === 'tiles' || v === 'tools') return { name: v }
  return { name: 'cockpit' }
}
function savedView(): { view: View; sdk?: string } {
  const cv = captureView()
  if (cv) return { view: cv }
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null')
    if (v?.view?.name) return v
  } catch {
    /* illisible */
  }
  return { view: { name: 'cockpit' } }
}

export type View =
  | { name: 'cockpit' }
  | { name: 'project'; projectId: string }
  | { name: 'session'; sessionId: string }
  | { name: 'projects' }
  | { name: 'history' }
  | { name: 'checklists'; id?: string }
  | { name: 'agenda'; meetingId?: string; tab?: 'meetings' | 'day' | 'notes' }
  | { name: 'tiles' }
  | { name: 'tools' }
  | { name: 'voice' }
  | { name: 'settings' }

type State = {
  projects: Project[]
  external: ExternalSession[]
  media: Record<string, MediaItem[]>
  viewer: Viewer | null
  /** Onglets de vue par session : actif ('session' ou URL d'artefact), fermés (à la date de la publication), vus. */
  artTabs: Record<string, ArtTabs>
  setActiveTab: (sessionId: string, key: string) => void
  openArtTab: (sessionId: string, url: string) => void
  closeArtTab: (sessionId: string, url: string, at: number) => void
  artifactTitles: Record<string, string>
  setArtifactTitle: (url: string, title: string) => void
  openViewer: (v: Viewer) => void
  closeViewer: () => void
  attachments: Record<string, Attachment[]>
  attach: (sessionId: string, a: Attachment) => void
  detach: (sessionId: string, index?: number) => void
  /** Texte à remettre dans la saisie (« Réutiliser »). */
  draft: Record<string, string | undefined>
  setDraft: (sessionId: string, text: string | undefined) => void
  /** Texte à ajouter à la fin de la saisie (ex. une ligne de base jointe depuis la visionneuse). */
  insert: Record<string, string | undefined>
  insertDraft: (sessionId: string, text: string | undefined) => void
  history: HistoryEntry[]
  historyLoading: boolean
  loadHistory: () => Promise<void>
  sessions: Record<string, SessionMeta>
  items: Record<string, Item[]>
  quota: Quota
  view: View
  go: (v: View) => void
  loadProjects: () => Promise<void>
  seq: number
  daemon: { connected: boolean; outdated: boolean; busy: boolean }
  hydrate: (snap: AppState) => void
  apply: (e: AppEvent, seq?: number) => void
}

export const useStore = create<State>((set, get) => ({
  projects: [],
  external: [],
  media: {},
  viewer: null,
  // Onglets de vue mémorisés : après un rechargement, on revient sur l'onglet ouvert (navigateur, artefact…).
  artTabs: (() => {
    if (CAPTURE) return {}
    try {
      return JSON.parse(localStorage.getItem('atelier.artTabs') ?? '{}')
    } catch {
      return {}
    }
  })(),
  setActiveTab: (sessionId, key) =>
    set((s) => {
      const cur = s.artTabs[sessionId] ?? { active: 'session', closed: {}, seen: {} }
      const now = Date.now()
      const seen = { ...cur.seen }
      if (cur.active !== 'session') seen[cur.active] = now // quitter un onglet = tout vu jusqu'ici
      if (key !== 'session') seen[key] = now
      return { artTabs: { ...s.artTabs, [sessionId]: { ...cur, active: key, seen } } }
    }),
  openArtTab: (sessionId, url) => {
    const cur = get().artTabs[sessionId] ?? { active: 'session', closed: {}, seen: {} }
    const { [url]: _, ...closed } = cur.closed
    set((s) => ({ artTabs: { ...s.artTabs, [sessionId]: { ...cur, closed } } }))
    get().setActiveTab(sessionId, url)
  },
  closeArtTab: (sessionId, url, at) =>
    set((s) => {
      const cur = s.artTabs[sessionId] ?? { active: 'session', closed: {}, seen: {} }
      return {
        artTabs: {
          ...s.artTabs,
          [sessionId]: { ...cur, active: cur.active === url ? 'session' : cur.active, closed: { ...cur.closed, [url]: at } }
        }
      }
    }),
  artifactTitles: (() => {
    try {
      return JSON.parse(localStorage.getItem('atelier.artifactTitles') ?? '{}')
    } catch {
      return {}
    }
  })(),
  setArtifactTitle: (url, title) =>
    set((s) => {
      if (s.artifactTitles[url] === title) return {}
      const artifactTitles = { ...s.artifactTitles, [url]: title }
      try {
        localStorage.setItem('atelier.artifactTitles', JSON.stringify(artifactTitles))
      } catch {
        /* stockage indisponible */
      }
      return { artifactTitles }
    }),
  openViewer: (viewer) => set({ viewer }),
  closeViewer: () => set({ viewer: null }),
  attachments: {},
  draft: {},
  setDraft: (sessionId, text) => set((s) => ({ draft: { ...s.draft, [sessionId]: text } })),
  insert: {},
  insertDraft: (sessionId, text) => set((s) => ({ insert: { ...s.insert, [sessionId]: text } })),
  attach: (sessionId, a) => set((s) => ({ attachments: { ...s.attachments, [sessionId]: [...(s.attachments[sessionId] ?? []), a] } })),
  detach: (sessionId, index) =>
    set((s) => ({
      attachments: {
        ...s.attachments,
        [sessionId]: index === undefined ? [] : (s.attachments[sessionId] ?? []).filter((_, k) => k !== index)
      }
    })),
  history: [],
  historyLoading: false,
  loadHistory: async () => {
    set({ historyLoading: true })
    try {
      set({ history: await api.listHistory() })
    } finally {
      set({ historyLoading: false })
    }
  },
  sessions: {},
  items: {},
  quota: {},
  view: savedView().view,
  go: (view) => set({ view }),
  loadProjects: async () => set({ projects: await api.listProjects() }),
  seq: 0,
  daemon: { connected: false, outdated: false, busy: false },
  /**
   * Nouvel état complet (chargement, reconnexion, redémarrage du moteur). Si la session affichée
   * a changé d'identifiant, on la retrouve par sa conversation Claude Code (sdkSessionId).
   */
  hydrate: (snap) => {
    // État complet du moteur (démarrage, reconnexion, redémarrage) : la liste des projets peut avoir changé.
    void get().loadProjects()
    if (CAPTURE)
      setTimeout(() => {
        applyCaptureTheme()
        document.documentElement.dataset.captureReady = '1'
      }, 0)
    const s = get()
    const remap = (id: string) => {
      if (snap.sessions[id]) return id
      const sdk = s.sessions[id]?.sdkSessionId ?? savedView().sdk
      return sdk ? Object.values(snap.sessions).find((x) => x.sdkSessionId === sdk)?.id : undefined
    }
    let view = s.view
    if (view.name === 'session') {
      const id = remap(view.sessionId)
      view = id ? { name: 'session', sessionId: id } : { name: 'cockpit' }
    }
    const vid = s.viewer && remap(s.viewer.sessionId)
    set({
      seq: snap.seq,
      sessions: snap.sessions,
      items: snap.items,
      media: snap.media,
      quota: snap.quota,
      external: snap.external,
      view,
      viewer: s.viewer && vid ? { ...s.viewer, sessionId: vid } : null
    })
  },
  /** seq > 0 : événement du démon (ignoré s'il est déjà intégré au snapshot) ; 0 : événement local. */
  apply: (e, seq = 0) => {
    const s = get()
    if (seq && seq <= s.seq) return
    if (e.type === 'navigate') {
      if (s.sessions[e.sessionId]) set({ view: { name: 'session', sessionId: e.sessionId } })
      return
    }
    if (e.type === 'projects:changed') {
      void s.loadProjects()
      return
    }
    const next = reduce({ seq: s.seq, sessions: s.sessions, items: s.items, media: s.media, quota: s.quota, external: s.external }, e)
    const view = e.type === 'session:removed' && s.view.name === 'session' && s.view.sessionId === e.id ? { name: 'cockpit' as const } : s.view
    set({ ...next, seq: seq || s.seq, view })
  }
}))

// Reconstruction de l'état depuis le démon : au chargement, à chaque rechargement à chaud
// de la fenêtre et à chaque reconnexion (le démon a pu redémarrer).
// Écran courant mémorisé : un redémarrage d'Electron (mode dev) revient là où tu étais.
useStore.subscribe((st, prev) => {
  if (CAPTURE) return
  if (st.view === prev.view && st.sessions === prev.sessions) return
  const sdk = st.view.name === 'session' ? st.sessions[st.view.sessionId]?.sdkSessionId : undefined
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ view: st.view, sdk }))
  } catch {
    /* stockage indisponible */
  }
})

api.onEvent((e, seq) => useStore.getState().apply(e, seq))
api.onEvent((e) => {
  if (e.type === 'agenda:open') useStore.getState().go({ name: 'agenda', meetingId: e.meetingId })
})
api.onSnapshot((snap) => useStore.getState().hydrate(snap))
api.onDaemon((daemon) => useStore.setState({ daemon }))
void api.snapshot().then((snap) => useStore.getState().hydrate(snap))
void api.daemonStatus().then((daemon) => useStore.setState({ daemon }))

/** Choix d'un dossier (boîte de dialogue Windows) ajouté comme projet ; null si annulé. */
export async function addProjectDialog(): Promise<Project | null> {
  const p = await api.addProject()
  if (p) await useStore.getState().loadProjects()
  return p
}

/** Ouvre une session (nouvelle ou reprise) et y navigue, sans attendre l'événement de création. */
export function openSession(s: SessionMeta) {
  const st = useStore.getState()
  if (!st.sessions[s.id]) st.apply({ type: 'session:created', session: s })
  st.go({ name: 'session', sessionId: s.id })
}

export async function resumeFromHistory(h: HistoryEntry) {
  openSession(await api.resumeSession(h.projectId, h.sdkSessionId, h.title))
}

/** Ouvre en lecture une session qui tourne ailleurs (ajoute son dossier comme projet si besoin). */
export async function openExternal(x: ExternalSession) {
  let projectId = x.projectId
  if (!projectId) {
    projectId = (await api.addProjectPath(x.cwd)).id
    await useStore.getState().loadProjects()
  }
  openSession(await api.resumeSession(projectId, x.sdkSessionId, x.title, true))
}

/** Recharge le transcript d'une session en lecture (nouvelle copie, l'ancienne est fermée). */
export async function refreshReadOnly(s: SessionMeta) {
  if (!s.sdkSessionId) return
  await api.closeSession(s.id)
  openSession(await api.resumeSession(s.projectId, s.sdkSessionId, s.title, true))
}

// Mémorise les onglets de vue de chaque session (hors fenêtre de capture).
if (!CAPTURE)
  useStore.subscribe((s, prev) => {
    if (s.artTabs === prev.artTabs) return
    try {
      localStorage.setItem('atelier.artTabs', JSON.stringify(s.artTabs))
    } catch {
      /* stockage indisponible */
    }
  })
