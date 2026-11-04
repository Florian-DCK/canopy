import type { DragEvent } from 'react'
import { create } from 'zustand'
import type { HistoryEntry, SessionMeta } from '../../shared/types'
import { api, CAPTURE, useStore } from './store'

// Mosaïque (planche 15) : 1 à 4 cases, chacune une session et une de ses vues (conversation, navigateur,
// artefact). La disposition suit le nombre de sessions : 1 pleine largeur, 2 et 3 en colonnes, 4 en 2 × 2.

/** 'session' (fil), 'browser', ou l'URL d'un artefact. */
export type TileView = string
export type Cell = { sessionId: string; sdk?: string; view: TileView }
export const MAX_TILES = 4

type Saved = { cells: Cell[]; active: number; panel: boolean }
type State = Saved & {
  setActive: (i: number) => void
  setView: (i: number, view: TileView) => void
  togglePanel: (i: number) => void
  /** Remplace la case i (ou ajoute une case si i est au-delà de la dernière). */
  place: (i: number, cell: Cell) => void
  swap: (a: number, b: number) => void
  remove: (i: number) => void
  /** Ajoute une session (ou une de ses vues) ; mosaïque pleine : à la place de la case active. */
  add: (sessionId: string, view?: TileView) => void
}

const KEY = 'atelier.tiles'
const EMPTY: Saved = { cells: [], active: 0, panel: false }

function load(): Saved {
  // La fenêtre de capture relit la mosaïque (sans jamais l'écrire, voir plus bas).
  try {
    const v = { ...EMPTY, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
    return { ...v, cells: (v.cells as (Cell | null)[]).filter((c): c is Cell => !!c).slice(0, MAX_TILES) }
  } catch {
    return EMPTY
  }
}

const cellOf = (sessionId: string, view: TileView): Cell => ({ sessionId, sdk: useStore.getState().sessions[sessionId]?.sdkSessionId, view })
/** Cases dont la session existe encore (une session fermée quitte la mosaïque). */
const live = (cells: Cell[]) => {
  const sessions = useStore.getState().sessions
  return cells.filter((c) => resolve(c, sessions))
}

export const useTiles = create<State>((set, get) => ({
  ...load(),
  setActive: (active) => set({ active }),
  setView: (i, view) => set((s) => ({ cells: s.cells.map((c, k) => (k === i ? { ...c, view } : c)) })),
  togglePanel: (i) => set((s) => ({ active: i, panel: !(s.panel && s.active === i) })),
  place: (i, cell) =>
    set((s) => {
      const cells = i < s.cells.length ? s.cells.map((c, k) => (k === i ? cell : c)) : [...s.cells, cell].slice(0, MAX_TILES)
      return { cells, active: Math.min(i, cells.length - 1) }
    }),
  swap: (a, b) =>
    set((s) => {
      const cells = [...s.cells]
      ;[cells[a], cells[b]] = [cells[b], cells[a]]
      return { cells, active: b }
    }),
  remove: (i) =>
    set((s) => {
      const cells = live(s.cells.filter((_, k) => k !== i))
      return { cells, active: Math.max(0, Math.min(s.active > i ? s.active - 1 : s.active, cells.length - 1)) }
    }),
  add: (sessionId, view = 'session') => {
    const sessions = useStore.getState().sessions
    const cells = live(get().cells)
    const same = cells.findIndex((c) => resolve(c, sessions)?.id === sessionId && c.view === view)
    if (same >= 0) return set({ cells, active: same })
    if (cells.length < MAX_TILES) return set({ cells: [...cells, cellOf(sessionId, view)], active: cells.length })
    const active = Math.min(get().active, cells.length - 1)
    set({ cells: cells.map((c, k) => (k === active ? cellOf(sessionId, view) : c)), active })
  }
}))

/** La session d'une case, retrouvée par sa conversation Claude Code si le moteur a redémarré entre-temps. */
export function resolve(c: Cell | null | undefined, sessions: Record<string, SessionMeta>): SessionMeta | undefined {
  if (!c) return undefined
  return sessions[c.sessionId] ?? (c.sdk ? Object.values(sessions).find((x) => x.sdkSessionId === c.sdk) : undefined)
}

/** Ce que fera « Ajouter » : affiché au bas du menu. */
export function addHint(count: number): string {
  return count < MAX_TILES ? 'La session prend une case de plus.' : 'Mosaïque pleine (4) : la session remplace la case active.'
}

/** Crée une session dans un projet sans quitter la vue, et la place dans la case i. */
export async function newSessionInTile(projectId: string, i?: number) {
  const s = await api.createSession(projectId)
  const st = useStore.getState()
  if (!st.sessions[s.id]) st.apply({ type: 'session:created', session: s })
  if (i === undefined) useTiles.getState().add(s.id)
  else useTiles.getState().place(i, cellOf(s.id, 'session'))
}

/** Reprend une session de l'historique directement dans la grille. */
export async function resumeIntoTiles(h: HistoryEntry) {
  const s = await api.resumeSession(h.projectId, h.sdkSessionId, h.title)
  const st = useStore.getState()
  if (!st.sessions[s.id]) st.apply({ type: 'session:created', session: s })
  useTiles.getState().add(s.id)
}

/** Clic sur une session ailleurs dans l'app : Ctrl+clic l'ajoute à la grille sans quitter l'écran. */
export function openOrTile(e: { ctrlKey: boolean; metaKey: boolean }, sessionId: string) {
  if (e.ctrlKey || e.metaKey) useTiles.getState().add(sessionId)
  else useStore.getState().go({ name: 'session', sessionId })
}

/** Glisser une session (ou une de ses vues) vers une case. */
export const DRAG_TYPE = 'application/x-canopy-tile'
export type DragData = { sessionId: string; view?: TileView; from?: number }
export function dragSession(e: DragEvent, data: DragData) {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(data))
  e.dataTransfer.effectAllowed = 'copyMove'
}

if (!CAPTURE)
  useTiles.subscribe((s, prev) => {
    if (s.cells === prev.cells && s.active === prev.active && s.panel === prev.panel) return
    try {
      localStorage.setItem(KEY, JSON.stringify({ cells: s.cells, active: s.active, panel: s.panel }))
    } catch {
      /* stockage indisponible */
    }
  })
