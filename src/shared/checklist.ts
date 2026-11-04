// Checklists (planches 12 et 13) : documents durables, liés à un projet et à des sessions, que l'utilisateur
// et Claude lisent et cochent. Différent de TodoWrite (le brouillon d'un tour).
//
// Stockage : un fichier Markdown par checklist dans le projet, `<projet>/.canopy/checklists/<slug>.md` :
//
//   ---
//   title: Feuille de route Canopy
//   sessions: [<sdkSessionId>, …]
//   ---
//   ## Fait
//   - [x] Refonte de la session <!-- id:k3f9 by:claude at:2026-11-03T22:10:00.000Z -->
//   ## En cours
//   - [ ] Checklists <!-- id:p0a2 state:work by:claude at:2026-11-04T10:12:00.000Z -->
//   - [ ] Tiling de sessions
//     - [ ] Sous-élément (un niveau d'indentation, 2 espaces)
//
// Les titres `##` sont des sections libres. Le commentaire en fin de ligne porte les métadonnées ; une ligne
// écrite à la main sans commentaire reçoit un id stable dérivé de son texte (« h:… ») jusqu'à la prochaine écriture.

export type CheckState = 'todo' | 'work' | 'done'
export type CheckWho = 'claude' | 'user'

export type CheckItem = {
  id: string
  text: string
  state: CheckState
  /** Qui a changé l'état en dernier, et quand (ms). */
  by?: CheckWho
  at?: number
  /** 0 = élément, 1 = sous-élément. */
  depth: 0 | 1
  /** Titre `##` sous lequel se trouve l'élément. */
  section?: string
}

export type Checklist = {
  /** `${projectId}:${path}` */
  id: string
  projectId: string
  /** Chemin relatif au projet, séparateur « / » (ex. .canopy/checklists/feuille-de-route.md). */
  path: string
  title: string
  /** Sessions liées (sdkSessionId de Claude Code : stable d'une reprise à l'autre). */
  sessions: string[]
  items: CheckItem[]
  updatedAt: number
}

export type ChecklistSummary = Omit<Checklist, 'items'> & { total: number; done: number; working: number }

export type ChecklistOp =
  | { op: 'set'; itemId: string; state: CheckState }
  | { op: 'add'; text: string; afterId?: string; section?: string; depth?: 0 | 1 }
  | { op: 'edit'; itemId: string; text: string }
  | { op: 'remove'; itemId: string }
  | { op: 'move'; itemId: string; beforeId?: string }
  | { op: 'link'; sessionId: string }
  | { op: 'unlink'; sessionId: string }
  | { op: 'title'; title: string }

/**
 * Résumé machine que l'outil de Claude place en PREMIÈRE ligne de son résultat, pour la carte du fil :
 *   <!--canopy-checklist {"id":"…","title":"…","done":6,"total":13,"action":"read|create|update","changes":[…]}-->
 * suivi du texte lisible destiné à Claude. `changes` : au plus 8 entrées.
 */
export type ChecklistToolSummary = {
  id: string
  title: string
  done: number
  total: number
  action: 'list' | 'read' | 'create' | 'update'
  changes?: { text: string; change: 'added' | 'done' | 'undone' | 'work' | 'edited' | 'removed' }[]
}
export const TOOL_SUMMARY_RE = /^<!--canopy-checklist (\{.*?\})-->/
