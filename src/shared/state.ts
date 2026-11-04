import type { AppEvent, ExternalSession, Item, MediaItem, Quota, SessionMeta } from './types'

/** État complet observable : tenu par le démon, rejoué par Electron et l'interface. */
export type AppState = {
  seq: number
  sessions: Record<string, SessionMeta>
  items: Record<string, Item[]>
  media: Record<string, MediaItem[]>
  quota: Quota
  external: ExternalSession[]
}

export const emptyState = (): AppState => ({ seq: 0, sessions: {}, items: {}, media: {}, quota: {}, external: [] })

/** Applique un événement (immuable : renvoie un nouvel état, les branches non touchées sont partagées). */
export function reduce(s: AppState, e: AppEvent): AppState {
  switch (e.type) {
    case 'session:created':
      if (s.sessions[e.session.id]) return s
      return { ...s, sessions: { ...s.sessions, [e.session.id]: e.session }, items: { ...s.items, [e.session.id]: [] } }
    case 'session:patch': {
      const cur = s.sessions[e.id]
      return cur ? { ...s, sessions: { ...s.sessions, [e.id]: { ...cur, ...e.patch } } } : s
    }
    case 'session:removed': {
      const { [e.id]: _a, ...sessions } = s.sessions
      const { [e.id]: _b, ...items } = s.items
      const { [e.id]: _c, ...media } = s.media
      return { ...s, sessions, items, media }
    }
    case 'items:set':
      return { ...s, items: { ...s.items, [e.sessionId]: e.items } }
    case 'item:add':
      return { ...s, items: { ...s.items, [e.sessionId]: [...(s.items[e.sessionId] ?? []), e.item] } }
    case 'item:patch':
      return {
        ...s,
        items: {
          ...s.items,
          [e.sessionId]: (s.items[e.sessionId] ?? []).map((it) => (it.id === e.itemId ? ({ ...it, ...e.patch } as Item) : it))
        }
      }
    case 'media:add':
      return { ...s, media: { ...s.media, [e.media.sessionId]: [...(s.media[e.media.sessionId] ?? []), e.media] } }
    case 'quota':
      return { ...s, quota: { ...s.quota, ...e.quota } }
    case 'external':
      return { ...s, external: e.sessions }
    default:
      return s
  }
}
