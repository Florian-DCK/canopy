// Navigateur intégré (planches 10 et 11) : protocole commun entre
// - la page (preload du <webview>, src/preload/webview.ts) : surcouche Pointer + actions sur le DOM ;
// - l'hôte (renderer d'Atelier) : onglet, barre, remarques, exécution des actions de Claude ;
// - le démon : outil MCP mcp__atelier__browser (même chemin que l'outil de capture).

/** Partition persistante du navigateur intégré (connexions gardées, séparée de claude.ai). */
export const BROWSER_PARTITION = 'persist:atelier-browser'

export type BrowserDevice = 'desktop' | 'tablet' | 'mobile'
export const DEVICE_WIDTH: Record<BrowserDevice, number | null> = { desktop: null, tablet: 820, mobile: 390 }

export type RemarkState = 'new' | 'sent' | 'work' | 'done'

export type Rect = { x: number; y: number; width: number; height: number }

/** Élément pointé dans la page (coordonnées CSS dans la fenêtre de la page). */
export type PickedElement = {
  selector: string
  /** Libellé court : « button.cta ». */
  label: string
  /** Texte visible, tronqué à 120 caractères. */
  text: string
  rect: Rect
  /** Styles calculés utiles : police, taille, graisse, couleur, fond, bordure, marges, rayon… */
  styles: Record<string, string>
  url: string
  viewport: { width: number; height: number }
}

/** Remarque posée par l'utilisateur (gardée côté hôte). */
export type Remark = {
  id: string
  n: number
  state: RemarkState
  text: string
  el: PickedElement
  /** Capture recadrée sur l'élément (data URL PNG). */
  crop?: string
  at: number
}

// ---- Messages hôte → page (webview.send(canal, ...args)) ----
export const TO_PAGE = {
  /** (mode: 'off' | 'point') */
  mode: 'atl:mode',
  /** (pins: { n: number; state: RemarkState; selector: string; text: string }[]) */
  pins: 'atl:pins',
  /** (selector: string) : fait défiler jusqu'à l'élément et le fait clignoter. */
  scrollTo: 'atl:scroll-to',
  /** (reqId: string, req: PageRequest) → réponse FROM_PAGE.reply (reqId, PageReply) */
  request: 'atl:request'
} as const

// ---- Messages page → hôte (ipcRenderer.sendToHost(canal, ...args)) ----
export const FROM_PAGE = {
  /** (el: PickedElement, text: string) : remarque validée dans la bulle. */
  comment: 'atl:comment',
  /** (mode: 'off' | 'point') : changé depuis la page (Alt+A, Échap). */
  mode: 'atl:mode',
  /** (reqId: string, reply: PageReply) */
  reply: 'atl:reply',
  /** (n: number, action: 'reopen' | 'delete') : action depuis la carte d'une épingle. */
  pin: 'atl:pin',
  /** () : surcouche prête (à chaque chargement de page). */
  ready: 'atl:ready'
} as const

export type PageRequest =
  | { kind: 'read'; selector?: string }
  | { kind: 'rect'; selector: string }
  | { kind: 'click'; selector: string }
  | { kind: 'type'; selector: string; text: string }

export type PageReply = {
  ok: boolean
  error?: string
  /** read : titre, adresse, texte visible (≤ 8000 car.), et l'élément s'il y a un sélecteur. */
  title?: string
  url?: string
  text?: string
  el?: PickedElement
  /** rect : rectangle de l'élément après défilement pour le rendre visible. */
  rect?: Rect
}

// ---- Outil de Claude (démon → Electron → hôte) ----
export type BrowserParams = {
  action: 'open' | 'capture' | 'read' | 'console' | 'click' | 'type' | 'remarks' | 'mark'
  url?: string
  device?: BrowserDevice
  selector?: string
  text?: string
  /** mark : numéro de la remarque et nouvel état. */
  remark?: number
  state?: RemarkState
}

export type BrowserResult = { ok: boolean; text: string; /** PNG en base64 (capture). */ image?: string }
