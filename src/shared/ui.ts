// Outil « interface » (planche 28) : Claude agit sur ce que l'utilisateur voit dans Canopy.
// Démon (outil MCP mcp__atelier__interface) → Electron → fenêtre principale, comme l'outil navigateur.

export type UiTarget = 'session' | 'cockpit' | 'tiles' | 'tools' | 'history' | 'projects' | 'checklist' | 'artifact' | 'browser' | 'voice'
export type UiPanelTab = 'lists' | 'files' | 'media' | 'ctx'

export type UiParams = {
  action: 'show' | 'panel' | 'highlight' | 'scroll' | 'back' | 'scene'
  /** scene : le bloc à poser à droite du soleil (mode voix). */
  scene?: import('./scene').SceneBlock
  /** show : la vue à afficher. */
  target?: UiTarget
  /** show session : la session à mettre devant (défaut : celle de Claude). */
  sessionId?: string
  /** show checklist : id résolu par le démon (absent = la liste des checklists). */
  checklistId?: string
  /** show artifact : l'URL claude.ai de l'artefact. */
  url?: string
  /** panel : ouvrir ou fermer le panneau de travail, et l'onglet à montrer. */
  state?: 'open' | 'closed'
  tab?: UiPanelTab
  /** highlight / scroll : l'élément visé (sélecteur CSS). */
  selector?: string
  /** scroll : haut ou bas de la conversation (si pas de selector). */
  to?: 'top' | 'bottom'
}

export type UiResult = { ok: boolean; text: string }

/** Événements DOM internes au renderer : les composants qui gardent leur état en local s'y abonnent. */
export const UI_PANEL_EVENT = 'atelier:ui-panel'
export type UiPanelDetail = { sessionId: string; state?: 'open' | 'closed'; tab?: UiPanelTab }
