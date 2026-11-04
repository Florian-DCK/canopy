import { create } from 'zustand'
import type { Checklist, ChecklistOp, ChecklistSummary, CheckItem } from '../../shared/checklist'
import { api } from './store'

type State = {
  summaries: ChecklistSummary[]
  byId: Record<string, Checklist>
  load: () => Promise<void>
  fetch: (id: string) => Promise<Checklist | null>
  update: (id: string, ops: ChecklistOp[]) => Promise<void>
  create: (projectId: string, title: string, items?: string[], sessionId?: string) => Promise<Checklist>
  remove: (id: string) => Promise<void>
}

const counts = (items: CheckItem[]) => ({
  total: items.length,
  done: items.filter((i) => i.state === 'done').length,
  working: items.filter((i) => i.state === 'work').length
})

const summarize = (c: Checklist): ChecklistSummary => {
  const { items, ...rest } = c
  return { ...rest, ...counts(items) }
}

/** Application locale d'une opération (affichage immédiat, la réponse du démon fait foi). */
function applyOp(items: CheckItem[], o: ChecklistOp): CheckItem[] {
  switch (o.op) {
    case 'set':
      return items.map((i) => (i.id === o.itemId ? { ...i, state: o.state, by: 'user', at: Date.now() } : i))
    case 'edit':
      return items.map((i) => (i.id === o.itemId ? { ...i, text: o.text } : i))
    case 'remove':
      return items.filter((i) => i.id !== o.itemId)
    default:
      return items
  }
}

export const useChecklists = create<State>((set, get) => ({
  summaries: [],
  byId: {},
  load: async () => {
    try {
      set({ summaries: await api.listChecklists() })
    } catch {
      /* démon indisponible */
    }
  },
  fetch: async (id) => {
    const c = await api.getChecklist(id)
    if (c) set((s) => ({ byId: { ...s.byId, [id]: c } }))
    return c
  },
  update: async (id, ops) => {
    const prev = get().byId[id]
    if (prev) {
      const items = ops.reduce(applyOp, prev.items)
      set((s) => ({
        byId: { ...s.byId, [id]: { ...prev, items } },
        summaries: s.summaries.map((x) => (x.id === id ? { ...x, ...counts(items) } : x))
      }))
    }
    try {
      const c = await api.updateChecklist(id, ops)
      set((s) => ({ byId: { ...s.byId, [id]: c }, summaries: s.summaries.map((x) => (x.id === id ? summarize(c) : x)) }))
    } catch (e) {
      void get().fetch(id)
      void get().load()
      throw e
    }
  },
  create: async (projectId, title, items, sessionId) => {
    const c = await api.createChecklist(projectId, title, items, sessionId)
    set((s) => ({ byId: { ...s.byId, [c.id]: c }, summaries: [summarize(c), ...s.summaries.filter((x) => x.id !== c.id)] }))
    return c
  },
  remove: async (id) => {
    await api.deleteChecklist(id)
    set((s) => {
      const { [id]: _, ...byId } = s.byId
      return { byId, summaries: s.summaries.filter((x) => x.id !== id) }
    })
  }
}))

api.onEvent((e) => {
  if (e.type !== 'checklists:changed') return
  const st = useChecklists.getState()
  void st.load()
  for (const id of e.ids) if (st.byId[id]) void st.fetch(id)
})
void useChecklists.getState().load()

const SEEN_KEY = 'atelier.checklists.seen'
export const lastSeen = (): number => {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0
  } catch {
    return 0
  }
}
export const markSeen = () => {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()))
  } catch {
    /* stockage indisponible */
  }
}
