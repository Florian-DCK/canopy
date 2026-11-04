import { create } from 'zustand'
import type { BrowserDevice, PickedElement, Remark, RemarkState } from '../../../shared/browser'

// État du navigateur intégré, par session : onglet ouvert, adresse, largeur, mode Pointer, remarques.

export type BrowserTab = { url: string; device: BrowserDevice; mode: 'off' | 'point'; title?: string; errors: number; loading: boolean; /** Échec du chargement de la page principale. */ failed?: string; /** Conversation affichée à côté (sinon page en plein écran). */ chat?: boolean }

type Rect = { x: number; y: number; width: number; height: number }

type S = {
  tabs: Record<string, BrowserTab | undefined>
  remarks: Record<string, Remark[] | undefined>
  /** Emplacement visible de chaque onglet (mesuré dans la vue) : le webview s'y pose. Plusieurs à la fois dans la Mosaïque. */
  slots: Record<string, Rect | undefined>
  open: (sessionId: string, url?: string) => void
  close: (sessionId: string) => void
  patch: (sessionId: string, p: Partial<BrowserTab>) => void
  setSlot: (sessionId: string, rect: Rect | null) => void
  addRemark: (sessionId: string, el: PickedElement, text: string, crop?: string) => Remark
  setRemark: (sessionId: string, n: number, state: RemarkState) => boolean
  removeRemark: (sessionId: string, id: string) => void
}

export const DEFAULT_URL = 'http://localhost:5173'

// Gardé entre deux rechargements d'Atelier : onglets (adresse, largeur, conversation) et remarques.
const KEY = 'atelier.browser'
type Saved = { tabs: Record<string, Pick<BrowserTab, 'url' | 'device' | 'chat'>>; remarks: Record<string, Remark[]> }
function load(): Saved {
  if (new URLSearchParams(location.search).get('capture') === '1') return { tabs: {}, remarks: {} }
  try {
    return { tabs: {}, remarks: {}, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { tabs: {}, remarks: {} }
  }
}
const saved = load()

export const useBrowser = create<S>((set, get) => ({
  tabs: Object.fromEntries(Object.entries(saved.tabs).map(([k, t]) => [k, { ...t, mode: 'off' as const, errors: 0, loading: true }])),
  remarks: saved.remarks,
  slots: {},
  open: (sessionId, url) => {
    const cur = get().tabs[sessionId]
    set((s) => ({ tabs: { ...s.tabs, [sessionId]: { url: url ?? cur?.url ?? DEFAULT_URL, device: cur?.device ?? 'desktop', mode: cur?.mode ?? 'off', title: cur?.title, errors: cur?.errors ?? 0, loading: !!url || !cur, chat: cur?.chat ?? true } } }))
  },
  close: (sessionId) => set((s) => ({ tabs: { ...s.tabs, [sessionId]: undefined } })),
  patch: (sessionId, p) => {
    const cur = get().tabs[sessionId]
    if (cur) set((s) => ({ tabs: { ...s.tabs, [sessionId]: { ...cur, ...p } } }))
  },
  setSlot: (sessionId, rect) => {
    const cur = get().slots[sessionId]
    if (JSON.stringify(cur ?? null) === JSON.stringify(rect)) return
    set((s) => ({ slots: { ...s.slots, [sessionId]: rect ?? undefined } }))
  },
  addRemark: (sessionId, el, text, crop) => {
    const list = get().remarks[sessionId] ?? []
    const r: Remark = { id: crypto.randomUUID(), n: (list.at(-1)?.n ?? 0) + 1, state: 'new', text, el, crop, at: Date.now() }
    set((s) => ({ remarks: { ...s.remarks, [sessionId]: [...list, r] } }))
    return r
  },
  setRemark: (sessionId, n, state) => {
    const list = get().remarks[sessionId] ?? []
    if (!list.some((r) => r.n === n)) return false
    set((s) => ({ remarks: { ...s.remarks, [sessionId]: list.map((r) => (r.n === n ? { ...r, state } : r)) } }))
    return true
  },
  removeRemark: (sessionId, id) => set((s) => ({ remarks: { ...s.remarks, [sessionId]: (s.remarks[sessionId] ?? []).filter((r) => r.id !== id) } }))
}))

/** Hôte lisible d'une adresse : « localhost:5173 ». */
export const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Dernière adresse locale vue dans la session (sortie de « npm run dev »…). */
export function localUrlIn(text: string): string | undefined {
  const m = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d{2,5}[^\s'"`)>\]]*/g)
  return m?.at(-1)
}

/** Sauvegarde légère (après chaque changement d'onglet ou de remarque) ; sans les captures si la place manque. */
useBrowser.subscribe((s, prev) => {
  if (s.tabs === prev.tabs && s.remarks === prev.remarks) return
  if (new URLSearchParams(location.search).get('capture') === '1') return
  const tabs = Object.fromEntries(Object.entries(s.tabs).filter(([, t]) => t).map(([k, t]) => [k, { url: t!.url, device: t!.device, chat: t!.chat }]))
  const remarks = Object.fromEntries(Object.entries(s.remarks).filter(([, r]) => r?.length)) as Record<string, Remark[]>
  try {
    localStorage.setItem(KEY, JSON.stringify({ tabs, remarks }))
  } catch {
    try {
      const light = Object.fromEntries(Object.entries(remarks).map(([k, list]) => [k, list.map((r) => ({ ...r, crop: undefined }))]))
      localStorage.setItem(KEY, JSON.stringify({ tabs, remarks: light }))
    } catch {
      /* stockage indisponible */
    }
  }
})
