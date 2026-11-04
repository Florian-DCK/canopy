// Outil « scène » (planche 30) : en mode voix, Claude pose à droite du soleil un bloc qu'il choisit
// selon ce qu'il veut montrer. Les images, fichiers modifiés et artefacts du tour s'y ajoutent seuls.

export type SceneType = 'clear' | 'bar' | 'line' | 'donut' | 'kpi' | 'before_after' | 'list' | 'table' | 'gauge' | 'plan'
export type SceneStatus = 'ok' | 'ko' | 'warn' | 'done' | 'work' | 'todo'

export type SceneItem = {
  label: string
  /** Valeur numérique (barres, courbe, anneau, chiffres clés, avant/après). */
  value?: number
  /** Texte affiché à la place de la valeur brute (« 1,4 s », « 52 % »). */
  display?: string
  status?: SceneStatus
  note?: string
}

export type SceneBlock = {
  type: SceneType
  title: string
  subtitle?: string
  unit?: string
  items?: SceneItem[]
  /** table : en-têtes et lignes. */
  columns?: string[]
  rows?: string[][]
  /** gauge : score et maximum ; donut : texte au centre. */
  value?: number
  max?: number
  center?: string
}
