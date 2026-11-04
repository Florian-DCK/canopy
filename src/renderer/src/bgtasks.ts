import { create } from 'zustand'
import type { Item } from '../../shared/types'
import { api, CAPTURE, useStore } from './store'

// Tâches en arrière-plan (planche 19) : une commande shell ou un sous-agent qui tourne au premier plan
// depuis plus de `delay` secondes passe de lui-même en arrière-plan ; Claude reprend la main et continue.

const KEY = 'atelier.bg.delay'
/** Délais proposés, en secondes ; 0 = jamais (seulement à la main). */
export const BG_DELAYS = [15, 30, 60, 0] as const

const load = (): number => {
  try {
    const v = Number(localStorage.getItem(KEY))
    return (BG_DELAYS as readonly number[]).includes(v) && localStorage.getItem(KEY) !== null ? v : 15
  } catch {
    return 15
  }
}

export const useBgDelay = create<{ delay: number; set: (d: number) => void }>((set) => ({
  delay: load(),
  set: (delay) => {
    try {
      localStorage.setItem(KEY, String(delay))
    } catch {
      /* stockage indisponible */
    }
    set({ delay })
  }
}))

type Tool = Extract<Item, { kind: 'tool' }>
/** Commande ou sous-agent de l'agent principal qui bloque encore Claude. */
export const isForeground = (i: Item): i is Tool =>
  i.kind === 'tool' && i.status === 'running' && !i.parent && (i.name === 'Bash' || i.name === 'PowerShell' || !!i.subagent)

/** Déjà demandé (une fois par appel). */
const asked = new Set<string>()

export function sendToBackground(sessionId: string, toolUseId: string) {
  asked.add(toolUseId)
  void api.backgroundTask(sessionId, toolUseId)
}

if (!CAPTURE)
  setInterval(() => {
    const delay = useBgDelay.getState().delay
    if (!delay) return
    const { sessions, items } = useStore.getState()
    const now = Date.now()
    for (const s of Object.values(sessions)) {
      if (s.status !== 'run' || s.readOnly) continue
      for (const t of (items[s.id] ?? []).filter(isForeground)) {
        if (!asked.has(t.id) && now - t.at >= delay * 1000) sendToBackground(s.id, t.id)
      }
    }
  }, 1000)
