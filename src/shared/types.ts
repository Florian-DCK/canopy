// Types partagés main ↔ renderer. L'UI ne voit jamais les messages bruts du SDK.

export type Project = {
  id: string
  name: string
  path: string
  color: string
  branch?: string
  /** Le bac à sable : conversations sans projet (planche 35). */
  sandbox?: boolean
}

export type SessionStatus = 'idle' | 'run' | 'wait' | 'error'

export type SessionMeta = {
  id: string
  projectId: string
  sdkSessionId?: string
  title: string
  status: SessionStatus
  model?: string
  /** Choix de l'utilisateur ('opus' | 'sonnet' | 'haiku'), vide = défaut. */
  modelChoice?: string
  permissionMode: PermissionModeUI
  /** Ce que fait l'agent principal en ce moment (texte en flux, réflexion, outil). */
  activity?: { kind: 'thinking' | 'writing' | 'tool'; label?: string; since: number }
  /** Session ouverte en lecture (elle tourne encore dans un terminal). */
  readOnly?: boolean
  /** Dossier de travail propre à la session (bac à sable : un sous-dossier par conversation). */
  cwd?: string
  startedAt: number
  updatedAt: number
  contextTokens?: number
  /** Taille de la fenêtre de contexte du modèle (remontée par le SDK à chaque réponse). */
  contextWindow?: number
  /** Tâches de fond en cours (commandes shell et sous-agents passés en arrière-plan). */
  bgTasks?: BgTask[]
}

export type BgTask = { id: string; kind: string; label: string; startedAt: number }

export type PermissionModeUI = 'default' | 'acceptEdits' | 'auto' | 'plan'

export type FileDiff = {
  path: string
  added: number
  removed: number
  lines: { t: '+' | '-' | ' '; s: string }[]
}

export type Item =
  | { id: string; kind: 'user'; text: string; attachments?: string[]; at: number }
  | { id: string; kind: 'text'; text: string; parent: string | null; at: number }
  | {
      id: string
      kind: 'tool'
      name: string
      summary: string
      parent: string | null
      status: 'running' | 'ok' | 'error'
      result?: string
      diff?: FileDiff
      subagent?: { type: string; description: string }
      todos?: { content: string; status: 'pending' | 'in_progress' | 'completed' }[]
      /** Artefact claude.ai publié par cet appel de l'outil Artifact. */
      artifact?: ArtifactRef
      at: number
    }
  | {
      id: string
      kind: 'permission'
      tool: string
      summary: string
      parent: string | null
      canAlways: boolean
      state: 'pending' | 'allowed' | 'denied'
      /** Texte complet utile à la décision (le plan proposé par ExitPlanMode). */
      detail?: string
      at: number
    }
  | {
      id: string
      kind: 'question'
      parent: string | null
      questions: AskQuestion[]
      /** Outil AskUserQuestion : Claude est arrêté sur la question (sinon : question sans attente). */
      blocking: boolean
      /** wait : Claude attend ta réponse ; async : il continue en attendant (question sans attente). */
      mode: 'wait' | 'async'
      /** Sans attente : ce que Claude fait sans réponse ; absent = il met cette partie de côté. */
      fallback?: string
      state: 'pending' | 'answered' | 'skipped' | 'chat'
      /** Question → réponse (libellés séparés par des virgules pour un choix multiple, ou texte libre). */
      answers?: Record<string, string>
      notes?: Record<string, string>
      at: number
    }
  | { id: string; kind: 'result'; text: string; ok: boolean; durationMs?: number; actions?: number; at: number }
  /** Événement de la session affiché en ligne fine : compactage, reprise, changement de modèle ou de mode. */
  | { id: string; kind: 'event'; event: 'compact' | 'resume' | 'readonly' | 'model' | 'mode' | 'background'; text: string; at: number }
  /** Fin d'une tâche de fond : Claude est prévenu et reprend son résultat. */
  | { id: string; kind: 'task'; taskId: string; label: string; status: 'completed' | 'failed' | 'stopped'; summary: string; durationMs?: number; outputFile?: string; at: number }
  | { id: string; kind: 'error'; text: string; at: number }

export type AskQuestion = {
  question: string
  header: string
  options: { label: string; description: string; preview?: string }[]
  multiSelect: boolean
}
export type QuestionAnswer = { action: 'answer' | 'skip' | 'chat'; answers?: Record<string, string>; notes?: Record<string, string> }

/** « Outils de Claude » d'un projet : mesures prises sur une session ouverte, plus les réglages persistants. */
export type ToolsInventory = {
  projectId: string
  /** Absent : aucune session ouverte dans ce projet, rien n'a pu être mesuré. */
  measuredAt?: number
  sessionTitle?: string
  total?: number
  max?: number
  categories: { id: string; name: string; tokens: number }[]
  /** Fichiers chargés à chaque session (CLAUDE.md, index de mémoire…). */
  memoryFiles: { path: string; type: string; tokens: number }[]
  skills: { name: string; source: string; plugin?: string; path?: string; tokens: number; enabled: boolean }[]
  mcp: { name: string; status: string; scope?: string; error?: string; tokens: number; deferred: boolean; enabled: boolean; tools: { name: string; tokens: number; readOnly?: boolean; destructive?: boolean }[] }[]
  agents: { name: string; source: string; tokens: number }[]
}

/** Souvenirs d'un projet (~/.claude/projects/…/memory). */
export type MemoryItem = { file: string; name: string; description: string; type: string; body: string; raw: string; mtime: number; inIndex: boolean; dupIn: string[] }
export type MemoryList = { dir: string; index: { lines: number; tokens: number }; items: MemoryItem[] }

export type HistoryEntry = {
  sdkSessionId: string
  projectId: string
  title: string
  lastModified: number
  branch?: string
}

/** Session Claude Code active hors d'Atelier (terminal, VS Code…), détectée via son transcript. */
export type ExternalSession = {
  sdkSessionId: string
  cwd: string
  projectId?: string
  title: string
  lastModified: number
}

export type QuotaWindow = { pct: number | null; resetsAt?: number }

export type ArtifactRef = { url: string; version?: number; title?: string; created: boolean }

export type CaptureParams = {
  /** hidden : vue rendue hors écran ; current : copie de la fenêtre de l'utilisateur. */
  mode?: 'hidden' | 'current'
  /** Outil écran : l'écran de l'utilisateur (celui de la souris) ou sa fenêtre active, hors de Canopy. */
  desktop?: 'screen' | 'window'
  /** Outil agir : un geste de Claude sur l'écran de l'utilisateur. */
  act?: ActParams
  view?: 'session' | 'cockpit' | 'history' | 'projects' | 'tiles' | 'tools'
  sessionId?: string
  theme?: 'light' | 'dark'
  width?: number
  height?: number
  /** Recadre sur un élément (sélecteur CSS). */
  selector?: string
  /** Relevé de styles et de texte d'un élément (sélecteur CSS). */
  inspect?: string
  /** Panneaux latéraux de la session : ouverts ou fermés (sinon : disposition de l'utilisateur). */
  panels?: 'open' | 'closed'
  /** 'art' : affiche l'onglet du dernier artefact. */
  tab?: 'session' | 'art'
}
/** Mode compagnon : ce que Claude a le droit de faire sur l'ordinateur (page Paramètres). */
export type CompanionPrefs = { screen: boolean; act: boolean }

export type ActParams = {
  action: 'find' | 'invoke' | 'click' | 'type' | 'key'
  target?: string
  kind?: string
  x?: number
  y?: number
  text?: string
  append?: boolean
  keys?: string
  look?: boolean
}

export type CaptureResult = { ok: boolean; image?: string; info: string }

export type MediaKind = 'image' | 'video' | 'audio'
export type MediaSource = 'read' | 'screenshot' | 'tool' | 'mention' | 'attach'

export type MediaItem = {
  id: string
  sessionId: string
  /** Élément du fil auquel le média est rattaché (outil ou texte). */
  itemId: string
  kind: MediaKind
  source: MediaSource
  name: string
  /** Chemin réel du fichier (pour Copier / Ouvrir le dossier). */
  path: string
  /** Fichier servi (copie en cache pour les images lues, sinon le fichier lui-même). */
  file: string
  width?: number
  height?: number
  size?: number
  at: number
}

/** Pièce jointe à un message : un média connu, ou une image capturée (data URL). */
export type Attachment = { mediaId: string; name: string } | { dataUrl: string; name: string }

export type Quota = {
  five?: QuotaWindow
  week?: QuotaWindow
  models?: { name: string; pct: number | null }[]
  /** Relevés de la fenêtre 5 h (pour la courbe et la projection). */
  fiveSamples?: { t: number; pct: number }[]
  extra?: { enabled: boolean; used: number | null; currency?: string | null }
  /** Dernier statut remonté par Claude Code : allowed | allowed_warning | rejected */
  status?: string
  updatedAt?: number
}

export type AppEvent =
  | { type: 'session:created'; session: SessionMeta }
  | { type: 'session:patch'; id: string; patch: Partial<SessionMeta> }
  | { type: 'session:removed'; id: string }
  | { type: 'item:add'; sessionId: string; item: Item }
  | { type: 'items:set'; sessionId: string; items: Item[] }
  | { type: 'item:patch'; sessionId: string; itemId: string; patch: Partial<Item> }
  | { type: 'quota'; quota: Quota }
  | { type: 'navigate'; sessionId: string }
  | { type: 'external'; sessions: ExternalSession[] }
  | { type: 'media:add'; media: MediaItem }
  | { type: 'capture:request'; id: string; params: CaptureParams; at: number }
  /** Une ou plusieurs checklists ont changé (outil de Claude, interface, fichier modifié à la main). */
  | { type: 'checklists:changed'; ids: string[] }
  /** La liste des projets a changé (ajout, retrait, renommage) : les fenêtres la rechargent. */
  | { type: 'projects:changed' }
  /** Action de Claude dans le navigateur intégré d'une session (outil mcp__atelier__browser). */
  | { type: 'browser:request'; id: string; sessionId: string; params: import('./browser').BrowserParams; at: number }
  /** Claude agit sur l'interface de Canopy (outil mcp__atelier__interface). */
  | { type: 'ui:request'; id: string; sessionId: string; params: import('./ui').UiParams; at: number }

export type PermissionDecision = 'allow' | 'always' | 'deny'

/** Notifications d'Atelier (planche 9) : nos propres cartes, par-dessus tout, sans voler le focus. */
export type ToastKind = 'wait' | 'plan' | 'question' | 'done' | 'error'
export type Toast = {
  id: string
  kind: ToastKind
  sessionId: string
  /** Demande d'autorisation à laquelle la carte répond (attente, plan). */
  permId?: string
  project: string
  color: string
  title: string
  body?: string
  /** Commande ou chemin concerné, en mono. */
  cmd?: string
  /** Question simple : ses options, choisissables depuis la carte. */
  options?: string[]
  at: number
  /** Incrémenté à chaque rappel (la carte réagit et rejoue le son). */
  pulse?: number
}
export type ToastAction = { type: 'allow' | 'deny' | 'open' | 'dismiss' | 'silence' | 'mute' | 'settings' | `opt:${number}`; id: string }
export type ToastState = { toasts: Toast[]; sound: boolean; corner: NotifSettings['corner']; /** Mode compagnon : la bulle, dans cette même fenêtre. */ companion?: import('./companion').CompanionState | null }
export type NotifSettings = {
  corner: 'tl' | 'tr' | 'bl' | 'br'
  overFullscreen: boolean
  sound: boolean
  quiet: boolean
  quietFrom: string
  quietTo: string
}
export type NotifInfo = { settings: NotifSettings; silenceUntil: number; mutedProjects: string[] }

export type ThemeMode = 'system' | 'light' | 'dark'

export type CommandSuggestion = { name: string; description: string; kind: 'skill' | 'command' }

export type AtelierApi = {
  listFiles(projectId: string): Promise<string[]>
  listCommands(sessionId: string): Promise<CommandSuggestion[]>
  listProjects(): Promise<Project[]>
  addProject(): Promise<Project | null>
  removeProject(id: string): Promise<void>
  renameProject(id: string, name: string): Promise<Project | undefined>
  createSession(projectId: string, model?: string): Promise<SessionMeta>
  listHistory(): Promise<HistoryEntry[]>
  resumeSession(projectId: string, sdkSessionId: string, title: string, readOnly?: boolean, fork?: boolean): Promise<SessionMeta>
  addProjectPath(path: string): Promise<Project>
  takeOver(sessionId: string): Promise<void>
  setModel(sessionId: string, model: string): Promise<void>
  send(sessionId: string, text: string, attachments?: Attachment[]): Promise<void>
  openMedia(mediaId: string): Promise<void>
  openInEditor(projectId: string, relPath: string, line?: number): Promise<void>
  showMediaInFolder(mediaId: string): Promise<void>
  interrupt(sessionId: string): Promise<void>
  closeSession(sessionId: string): Promise<void>
  setPermissionMode(sessionId: string, mode: PermissionModeUI): Promise<void>
  respondPermission(sessionId: string, permId: string, decision: PermissionDecision): Promise<void>
  answerQuestion(sessionId: string, itemId: string, answer: QuestionAnswer): Promise<void>
  /** Passe en arrière-plan la commande ou le sous-agent lancé par cet appel (sans id : tout ce qui tourne au premier plan). */
  backgroundTask(sessionId: string, toolUseId?: string): Promise<boolean>
  stopTask(sessionId: string, taskId: string): Promise<void>
  toolsInventory(projectId: string, force?: boolean): Promise<ToolsInventory>
  setSkillEnabled(name: string, enabled: boolean): Promise<void>
  setMcpEnabled(projectId: string, name: string, enabled: boolean): Promise<void>
  reconnectMcp(projectId: string, name: string): Promise<void>
  listMemory(projectId: string): Promise<MemoryList>
  writeMemory(projectId: string, file: string, raw: string): Promise<void>
  forgetMemory(projectId: string, file: string): Promise<void>
  moveMemory(projectId: string, file: string, toProjectId: string): Promise<void>
  /** Projet « Config Claude Code » (~/.claude), créé au besoin : il accueille les mini-sessions des outils. */
  configProject(): Promise<Project>
  /** Fin de la sortie d'une tâche de fond terminée (élément « task » du fil). */
  taskOutput(sessionId: string, itemId: string): Promise<string>
  getTheme(): Promise<ThemeMode>
  setTheme(mode: ThemeMode): Promise<void>
  /** Session affichée (null = autre vue) : le main s'en sert pour ne pas notifier ce que tu regardes déjà. */
  setCurrentView(sessionId: string | null): void
  /** Événement relayé ; seq = numéro du démon (0 pour les événements locaux d'Electron). */
  onEvent(cb: (e: AppEvent, seq: number) => void): () => void
  onSnapshot(cb: (s: import('./state').AppState) => void): () => void
  snapshot(): Promise<import('./state').AppState>
  daemonStatus(): Promise<{ connected: boolean; outdated: boolean; busy: boolean }>
  onDaemon(cb: (s: { connected: boolean; outdated: boolean; busy: boolean }) => void): () => void
  restartDaemon(force?: boolean): Promise<void>
  getNotif(): Promise<NotifInfo>
  setNotif(patch: Partial<NotifSettings>): Promise<NotifInfo>
  /** Silence pendant `minutes` (0 = reprendre). */
  silenceNotif(minutes: number): Promise<NotifInfo>
  /** Rouvre les notifications d'un projet coupé. */
  unmuteProject(projectId: string): Promise<NotifInfo>
  onNotifSettings(cb: () => void): () => void
  /** Barre de fenêtre maison : état (agrandie, active) et commandes. */
  windowState(): Promise<{ maximized: boolean; focused: boolean }>
  onWindowState(cb: (s: { maximized: boolean; focused: boolean }) => void): () => void
  windowControl(action: 'minimize' | 'toggle-maximize' | 'close'): void
  /** Checklists (src/shared/checklist.ts). */
  listChecklists(): Promise<import('./checklist').ChecklistSummary[]>
  getChecklist(id: string): Promise<import('./checklist').Checklist | null>
  createChecklist(projectId: string, title: string, items?: string[], sessionId?: string): Promise<import('./checklist').Checklist>
  updateChecklist(id: string, ops: import('./checklist').ChecklistOp[]): Promise<import('./checklist').Checklist>
  deleteChecklist(id: string): Promise<void>
  /** Demande d'ouvrir les réglages des notifications (menu ⋯ d'une carte). */
  onOpenNotifSettings(cb: () => void): () => void
  /** Action de Claude dans le navigateur intégré : l'hôte l'exécute puis répond via browserResult. */
  onBrowserRequest(cb: (req: { id: string; sessionId: string; params: import('./browser').BrowserParams }) => void): () => void
  browserResult(id: string, r: import('./browser').BrowserResult): void
  /** Action de Claude sur l'interface : la fenêtre l'exécute puis répond via uiResult. */
  onUiRequest(cb: (req: { id: string; sessionId: string; params: import('./ui').UiParams }) => void): () => void
  uiResult(id: string, r: import('./ui').UiResult): void
  /** Mode compagnon : état de la bulle (null = quitter) et gestes renvoyés par la bulle. */
  companionSet(state: import('./companion').CompanionState | null): void
  /** « Stop » : Claude n'agit plus sur l'écran (quelques secondes), sa main disparaît. */
  actStop(): void
  /** Baisser (ou remettre) le son des autres applications pendant que Claude parle. */
  voiceDuck(on: boolean, factor?: number): void
  getCompanionPrefs(): Promise<CompanionPrefs>
  setCompanionPrefs(p: Partial<CompanionPrefs>): Promise<CompanionPrefs>
  /** Remettre la bulle du compagnon dans son coin. */
  companionResetPosition(): void
  /** Ramener la fenêtre de Canopy au premier plan (Claude montre quelque chose pendant le mode compagnon). */
  showWindow(): void
  onCompanionCommand(cb: (c: import('./companion').CompanionCommand) => void): () => void
  /** Mode voix : démarre le service local (Whisper + Pocket TTS) et donne son adresse. */
  voiceStart(voice: string): Promise<{ ok: true; port: number; token: string } | { ok: false; error: string }>
  voiceStop(): Promise<void>
}

/** API de la fenêtre des notifications (toast.html). */
export type ToastApi = {
  onState(cb: (s: ToastState) => void): () => void
  action(a: ToastAction): void
  size(height: number): void
  /** Mode compagnon : déplacer la bulle, la commander, laisser passer les clics hors de la bulle. */
  drag(phase: 'start' | 'move' | 'end', x: number, y: number): void
  companion(c: import('./companion').CompanionCommand): void
  mouse(inside: boolean): void
  onLook(cb: (title: string) => void): () => void
  ready(): void
}
