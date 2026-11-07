import { create } from 'zustand'

// Reconnaître ta voix : état de l'empreinte vocale (service voix) et de l'apprentissage en cours.
// Les messages viennent du service (runtime.ts) ; les actions sont dans runtime.ts (enrollStart, enrollSave…).

export type EnrollSample = { ok: boolean; seconds?: number; same?: number; reason?: string }

type MyVoice = {
  /** Le service sait calculer une empreinte (modèle présent). */
  available: boolean
  /** Une empreinte de ta voix est enregistrée. */
  profile: boolean
  /** Apprentissage en cours : phrases lues jusqu'ici. */
  enrolling: boolean
  samples: EnrollSample[]
  result: { ok: boolean; n?: number; error?: string } | null
  /** Morceaux écartés depuis le démarrage (pas ta voix). */
  ignored: number
}

export const useMyVoice = create<MyVoice>(() => ({ available: false, profile: false, enrolling: false, samples: [], result: null, ignored: 0 }))

/** Phrases à lire pendant l'apprentissage : variées en sons, avec la façon de les dire. */
export const ENROLL_PHRASES: { how: string; text: string }[] = [
  { how: 'Voix normale', text: 'Bonjour Claude, ouvre la dernière session et montre-moi ce qui a changé depuis ce matin.' },
  { how: 'Voix normale', text: 'Est-ce que tu peux relancer les tests et me dire lesquels échouent encore ?' },
  { how: 'Plus calmement, comme le soir', text: 'Attends, laisse-moi réfléchir une seconde avant qu’on continue.' },
  { how: 'Plus fort, un peu pressé', text: 'Stop, arrête-toi là, ce n’est pas du tout ce que je voulais.' },
  { how: 'Un pas en arrière du micro', text: 'Passe en mode compagnon et baisse un peu le son de la vidéo.' },
  { how: 'Un peu plus loin encore, en te retournant', text: 'Rappelle-moi demain matin d’envoyer le compte rendu à toute l’équipe.' }
]
