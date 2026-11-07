// Mode compagnon (planche 32) : une bulle libre au-dessus du bureau, dans la fenêtre des notifications (une fenêtre
// de moins). La voix tourne toujours dans la fenêtre principale (micro, service voix, lecture) : elle envoie son état,
// la bulle renvoie les gestes de l'utilisateur.

export type CompanionPhase = 'rest' | 'listen' | 'work' | 'speak' | 'ask' | 'done' | 'waking' | 'error'

export type CompanionState = {
  phase: CompanionPhase
  /** Ce que tu dis (écoute) ou ce que Claude dit (parle), selon la phase. */
  text: string
  /** Ce que Claude fait à l'instant (« Lit ToolsView.tsx ») et depuis quand. */
  activity?: { label: string; since: number }
  /** Fini : une ligne de résumé. */
  summary?: string
  /** Bulle dépliée : la session et le dernier échange. */
  project?: string
  session?: string
  heard?: string
  said?: string
  /** Parle : les phrases du tour et l'index de celle qu'on entend (le texte défile à ce rythme). */
  lines?: string[]
  current?: number
  /** Mot prononcé à l'instant dans la ligne `current` (estimé). */
  word?: number
  /** Page libre posée par Claude : affichée au-dessus de la bulle. */
  page?: { src: string; title: string; height: number }
  /** Micro coupé : la bulle le montre et propose de le réactiver. */
  micMuted?: boolean
  /** Apparence de la voix (soleil ou personnage). */
  avatar?: 'canopy' | 'esprit' | 'chouette' | 'gland'
}

/** open : rouvrir Canopy sur le mode voix ; quit : quitter le compagnon ; hush : couper Claude ; say : une phrase écrite. */
export type CompanionCommand = 'open' | 'quit' | 'hush' | 'mic' | { say: string }
