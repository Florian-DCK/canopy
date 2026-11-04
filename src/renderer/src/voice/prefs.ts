import { create } from 'zustand'

// Réglages de la voix (page Paramètres) : gardés dans le navigateur de Canopy et envoyés au service voix.

export type EndMode = 'fast' | 'normal' | 'patient'
export type Avatar = 'canopy' | 'esprit' | 'chouette' | 'gland'
type Prefs = {
  /** 0 = très sensible, 1 = très tolérant aux bruits. */
  tolerance: number
  end: EndMode
  duck: boolean
  /** Volume laissé aux autres applications pendant que Claude parle (0,1 à 0,8). */
  duckLevel: number
  /** Apparence de la voix : le soleil Canopée ou un personnage. */
  avatar: Avatar
  set: (p: Partial<Omit<Prefs, 'set'>>) => void
}

const KEY = 'atelier.voice.prefs'
const DEF = { tolerance: 0.5, end: 'normal' as EndMode, duck: true, duckLevel: 0.3, avatar: 'canopy' as Avatar }

export const useVoicePrefs = create<Prefs>((set) => ({
  ...DEF,
  ...(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '{}')
    } catch {
      return {}
    }
  })(),
  set: (p) =>
    set((s) => {
      const next = { ...s, ...p }
      try {
        localStorage.setItem(KEY, JSON.stringify({ tolerance: next.tolerance, end: next.end, duck: next.duck, duckLevel: next.duckLevel, avatar: next.avatar }))
      } catch {
        /* stockage indisponible */
      }
      return next
    })
}))

const END: Record<EndMode, { end: number; end_max: number }> = {
  fast: { end: 0.7, end_max: 1.8 },
  normal: { end: 1.0, end_max: 2.6 },
  patient: { end: 1.4, end_max: 3.6 }
}

/** Seuil de détection de voix, attentes de fin de phrase, délai avant d'afficher l'écoute. */
export function voiceConfig() {
  const p = useVoicePrefs.getState()
  return { threshold: 0.45 + p.tolerance * 0.35, ...END[p.end], listenDelay: Math.round(350 + p.tolerance * 700) }
}
