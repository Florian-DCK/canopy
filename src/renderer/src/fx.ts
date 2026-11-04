import { create } from 'zustand'
import type { SessionMeta } from '../../shared/types'
import { useStore } from './store'
import { resolve, useTiles } from './tiles'
import './fx.css'

// Effets d'état des sessions (planche 16) : l'attente respire en argile, la fin flashe en vert puis garde
// un liseré vert tant que tu n'as pas regardé la session, le travail respire en bleu, l'erreur reste rouge.

/** Sessions terminées que tu n'as pas encore regardées. */
export const useFx = create<{ fresh: Record<string, true> }>(() => ({ fresh: {} }))

/** La session est-elle sous tes yeux (vue Session, ou case active de la Mosaïque) ? */
function viewed(id: string): boolean {
  const st = useStore.getState()
  if (st.view.name === 'session') return st.view.sessionId === id
  if (st.view.name === 'tiles') {
    const t = useTiles.getState()
    return resolve(t.cells[t.active], st.sessions)?.id === id
  }
  return false
}

let prev: Record<string, SessionMeta['status']> = {}
function sync() {
  const sessions = useStore.getState().sessions
  const cur = useFx.getState().fresh
  const fresh: Record<string, true> = {}
  for (const s of Object.values(sessions)) {
    const justDone = prev[s.id] === 'run' && s.status === 'idle'
    if ((cur[s.id] || justDone) && s.status === 'idle' && !viewed(s.id)) fresh[s.id] = true
  }
  prev = Object.fromEntries(Object.values(sessions).map((s) => [s.id, s.status]))
  const a = Object.keys(cur)
  const b = Object.keys(fresh)
  if (a.length !== b.length || b.some((k) => !cur[k])) useFx.setState({ fresh })
}
useStore.subscribe((s, p) => {
  if (s.sessions !== p.sessions || s.view !== p.view) sync()
})
useTiles.subscribe((s, p) => {
  if (s.active !== p.active || s.cells !== p.cells) sync()
})

/** Classe d'effet d'une session : 'fx-wait', 'fx-err', 'fx-done', 'fx-run' ou ''. */
export function fxClass(s: SessionMeta | undefined, fresh: Record<string, true>): string {
  if (!s || s.readOnly) return ''
  if (s.status === 'wait') return 'fx-wait'
  if (s.status === 'error') return 'fx-err'
  if (fresh[s.id]) return 'fx-done'
  if (s.status === 'run') return 'fx-run'
  return ''
}

/** L'état le plus urgent d'un groupe de sessions (icône Mosaïque de la barre de gauche). */
export function fxOfGroup(list: (SessionMeta | undefined)[], fresh: Record<string, true>): string {
  const c = list.map((s) => fxClass(s, fresh))
  return ['fx-wait', 'fx-err', 'fx-done', 'fx-run'].find((k) => c.includes(k)) ?? ''
}
