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
      /** Résultats de tests lus dans la sortie de la commande (planche 49). */
      tests?: TestReport
      /** Requête psql de lecture : Canopy peut la relire sur autorisation (planche 46). */
      pg?: { sql: string; env: string }
      /** Requête HTTP lancée par la commande (curl, httpie, Invoke-WebRequest) et sa réponse (planche 48). */
      http?: HttpCall
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
  /** Claude a besoin d'un secret (planche 39) : carte dans le fil ; la valeur ne passe jamais par la conversation. */
  | {
      id: string
      kind: 'secret'
      /** Nom de variable (DATABASE_URL). */
      name: string
      /** À quoi il sert, en une phrase. */
      purpose: string
      state: 'pending' | 'given' | 'declined'
      /** Où Canopy l'a servi (.env.local). */
      where?: string
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
  mark?: MarkParams
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

/** Une cible à mettre en évidence : un élément par son nom (accessibilité), ou une position en pixels de la capture d'écran. */
export type MarkTarget = {
  /** Nom d'un élément de la fenêtre active (comme pour act), et son type pour départager. */
  target?: string
  uiKind?: string
  x?: number
  y?: number
  w?: number
  h?: number
  /** Forme : rect (défaut) ou ellipse ; points = contour libre ; lines = lignes d'un texte. */
  shape?: 'rect' | 'ellipse'
  points?: [number, number][]
  lines?: { x: number; y: number; w: number; h: number }[]
  /** Ce que c'est : décide du style en mode auto. */
  kind?: 'text' | 'element' | 'chart' | 'image' | 'other'
}
export type MarkParams = {
  targets?: MarkTarget[]
  /** auto (défaut) : texte → souligner, élément ou graphique → entourer, photo ou image → projecteur. */
  style?: 'auto' | 'circle' | 'underline' | 'spotlight'
  kind?: MarkTarget['kind']
  /** Étapes numérotées, dessinées l'une après l'autre. */
  steps?: boolean
  seconds?: number
  clear?: boolean
  /** Joint une capture une fois la marque dessinée, pour vérifier qu'elle tombe juste. */
  look?: boolean
}

/** Agent custom (fichier .md de Claude Code) : à moi (tous projets) ou au projet. */
export type AgentDraft = { name: string; description: string; model?: string; tools?: string[]; prompt: string }
export type AgentFile = AgentDraft & { scope: 'user' | 'project'; path: string; enabled: boolean }

/** Un secret du coffre : jamais la valeur, seulement le nom et où il sert. */
export type VaultEntry = { name: string; scope: 'project' | 'global'; project?: string; at: number; usedAt?: number; where?: string }

export type CaptureResult = { ok: boolean; image?: string; info: string }

/** Requête HTTP et sa réponse, telles que la commande les montre (en-têtes sensibles masqués). */
export type HttpCall = {
  method: string
  url: string
  status?: number
  statusText?: string
  headers?: [string, string][]
  body: string
  reqHeaders?: [string, string][]
  reqBody?: string
}

/** Un test en échec : où, quoi, attendu / reçu. */
export type TestFailure = { name: string; suite?: string; file?: string; line?: number; message: string; expected?: string; received?: string; snippet?: string }
export type TestReport = {
  runner: 'vitest' | 'jest' | 'playwright' | 'pytest' | 'cargo' | 'go'
  passed: number
  failed: number
  skipped: number
  files?: number
  duration?: string
  /** « paquets » pour go test sans -v (les tests réussis ne sont pas listés). */
  unit?: string
  failures: TestFailure[]
}

/** Document (planche 49) : ce qu'on lit d'un PDF ou d'un fichier Office pour la carte et la visionneuse. */
export type DocInfo = {
  type: 'pdf' | 'word' | 'powerpoint' | 'excel'
  title?: string
  pages?: number
  words?: number
  comments?: number
  headings?: { level: number; text: string }[]
  slides?: { title: string; text: string; notes?: string }[]
  sheets?: { name: string; rows: number; cols: number }[]
  text?: string
  error?: string
}

export type MediaKind = 'image' | 'video' | 'audio' | 'model' | 'db' | 'data' | 'doc'

/** Base de données (SQLite ou CSV) : photo du schéma et des comptes, prise quand elle entre dans le fil. */
export type DbColumn = { name: string; type: string; notnull: boolean; dflt: string | null; pk: number }
export type DbTable = {
  name: string
  /** null : non compté (grosse base). */
  count: number | null
  columns: DbColumn[]
  fks: { from: string; table: string; to: string }[]
  indexes: { name: string; cols: string; unique: boolean }[]
  sql?: string
  /** Petite table avec clé primaire : son contenu, par clé, pour l'avant · après ligne par ligne. */
  rows?: { cols: string[]; byKey: Record<string, unknown[]> }
  /** Empreinte du contenu (petites tables) : change même si le nombre de lignes ne change pas. */
  digest?: string
}
export type DbSummary = { format: 'sqlite' | 'csv' | 'xlsx'; tables: DbTable[]; at: number; estimated?: boolean; error?: string; sep?: string }
export type DbPageOpts = { table: string; offset?: number; limit?: number; order?: string; desc?: boolean; where?: string }
export type DbRows = { columns: string[]; rows: unknown[][]; total?: number | null; ms: number; truncated?: boolean; error?: string; refused?: boolean }
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
  /** Base de données : photo du schéma et des comptes à ce moment-là. */
  db?: DbSummary
  /** Requête SELECT lancée par l'agent sur cette base (sqlite3 …) : la carte montre son résultat. */
  query?: string
  /** Photo prise avant une commande, pour l'avant · après : pas de carte à elle seule. */
  baseline?: boolean
  /** Base du projet trouvée par Canopy dans sa config (ex. prisma/schema.prisma). */
  foundBy?: string
}

/** Pièce jointe à un message : un média connu, ou une image capturée (data URL). */
/** Image (média connu ou data URL) envoyée en bloc image, ou tout autre fichier passé à Claude par son chemin. */
export type Attachment = { mediaId: string; name: string } | { dataUrl: string; name: string } | { path: string; name: string }

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
  /** Agenda : l'état a changé (sources relues, brief prêt, lien de projet). Envoyé par le processus principal. */
  | { type: 'agenda:changed' }
  /** Notes de réunion : liste ou compte rendu changé (fin de résumé, suppression). */
  | { type: 'notes:changed'; id?: string }
  /** Agenda : ouvrir une réunion (clic sur la notification « dans 10 min »). */
  | { type: 'agenda:open'; meetingId: string }

export type PermissionDecision = 'allow' | 'always' | 'deny'

/** Notifications d'Atelier (planche 9) : nos propres cartes, par-dessus tout, sans voler le focus. */
export type ToastKind = 'wait' | 'plan' | 'question' | 'done' | 'error' | 'meeting'
export type Toast = {
  id: string
  kind: ToastKind
  /** Vide pour une carte qui ne vient pas d'une session (réunion de l'agenda). */
  sessionId: string
  /** Carte « réunion dans 10 min » : la réunion et son lien Meet ou Teams. */
  meetingId?: string
  joinUrl?: string
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
export type ToastAction = { type: 'allow' | 'deny' | 'open' | 'dismiss' | 'silence' | 'mute' | 'settings' | 'join' | `opt:${number}`; id: string }
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

/** Premier lancement (planches 42-43). */
export type SetupCheck = { ok: boolean; version?: string; path?: string; error?: string }
export type PermState = 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown'
export type SetupFeatures = { voice: boolean; companion: boolean; capture: boolean; notif: boolean; blender: boolean; fal: boolean }
export type SetupStatus = {
  /** Setup terminé, ou installation existante (projets déjà là) marquée faite sans rien toucher. */
  done: boolean
  /** Installation existante reprise sans passer par le setup : pas de bandeau « à finir ». */
  legacy?: boolean
  features?: SetupFeatures
  platform: string
  node: SetupCheck
  claude: SetupCheck
  git: SetupCheck
  auth: { loggedIn: boolean; method?: string; email?: string; plan?: string }
  blender: string | null
  voice: { installed: boolean; dir: string; stt: 'mlx' | 'openvino' | 'faster' }
  permissions: { screen: PermState; microphone: PermState; accessibility: PermState }
  /** Raccourci pour lancer Canopy sans terminal (Mac : ~/Applications/Canopy.app ; Windows : Canopy.lnk sur le Bureau). */
  shortcut: { exists: boolean; path: string | null }
}
export type FoundProject = { name: string; path: string; mtime: number; known: boolean }
export type SetupTask = 'login' | 'claude' | 'voice'
/** Ligne de journal d'une tâche du setup ; step = ligne « STEP n/total texte » du script de la voix. */
export type SetupLog = { task: SetupTask; line?: string; url?: string; step?: { n: number; total: number; text: string }; done?: boolean; error?: string }

/** Mise à jour depuis le dépôt git (bandeau « Mise à jour disponible »). */
export type UpdateInfo = { behind: number; ahead: number; subjects: string[]; dirty: boolean; error?: string; checkedAt?: number }

export type AtelierApi = {
  platform: string
  setupStatus(): Promise<SetupStatus>
  setupFindProjects(): Promise<FoundProject[]>
  setupAddProjects(paths: string[]): Promise<void>
  /** Lance `claude auth login` (abonnement : claudeai ; clé d'API : console). Journal via onSetupLog. */
  setupLogin(mode: 'claudeai' | 'console'): Promise<void>
  /** Texte envoyé à l'entrée de `claude auth login` (code collé). */
  setupLoginInput(text: string): Promise<void>
  setupInstallClaude(): Promise<void>
  setupInstallVoice(): Promise<void>
  setupAskPermission(kind: 'screen' | 'microphone' | 'accessibility'): Promise<PermState>
  setupFinish(features: SetupFeatures): Promise<void>
  /** Rouvrir le setup (Paramètres › Installation) : ne remet rien à zéro, seulement done = false. */
  setupReopen(): Promise<void>
  /** Crée le raccourci s'il n'existe pas (jamais de remplacement). */
  setupShortcut(): Promise<{ ok: boolean; path?: string; existed?: boolean; error?: string }>
  onSetupLog(cb: (e: SetupLog) => void): () => void
  updateCheck(): Promise<UpdateInfo>
  /** git pull --ff-only, puis npm install si les dépendances ont changé. */
  updateApply(): Promise<UpdateInfo>
  onUpdate(cb: (u: UpdateInfo) => void): () => void
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
  /** Chemin sur le disque d'un fichier glissé ou choisi ('' s'il n'en a pas, ex. image collée). */
  pathForFile(file: File): string
  openMedia(mediaId: string): Promise<void>
  openInEditor(projectId: string, relPath: string, line?: number): Promise<void>
  showMediaInFolder(mediaId: string): Promise<void>
  /** Fichier de données (JSON, JSONL, log) lu par la session : son texte (la fin pour un gros journal). */
  /** Postgres (planche 46) : hôte masqué et autorisation ; requête relue en lecture seule si autorisée. */
  pgInfo(sessionId: string, projectId: string, env: string): Promise<{ host?: string; database?: string; allowed: 'session' | 'project' | null; error?: string }>
  pgAllow(sessionId: string, projectId: string, scope: 'session' | 'project' | null): Promise<void>
  pgQuery(sessionId: string, projectId: string, env: string, sql: string): Promise<DbRows>
  /** Document (PDF, Word, PowerPoint) : texte, titres, diapositives ; miniature système si elle existe. */
  docInfo(mediaId: string): Promise<DocInfo & { thumb?: string; pdf?: string }>
  /** Aperçu fidèle d'un Word / PowerPoint : converti en PDF par Office (Windows) ou LibreOffice. */
  docConvert(mediaId: string): Promise<{ pdf?: string; error?: string }>
  /** Rejoue une requête GET locale (localhost) et rend sa réponse. */
  httpReplay(url: string): Promise<{ status: number; statusText: string; headers: [string, string][]; body: string; ms: number; error?: string }>
  dataRead(mediaId: string): Promise<{ text: string; size: number; truncated: boolean; error?: string }>
  /** Bases de données (lecture seule) : schéma et comptes actuels, une page de lignes, une requête SELECT. */
  dbSummary(mediaId: string): Promise<DbSummary>
  dbPage(mediaId: string, opts: DbPageOpts): Promise<DbRows>
  dbQuery(mediaId: string, sql: string, limit?: number): Promise<DbRows>
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
  listAgents(projectId: string): Promise<AgentFile[]>
  saveAgent(projectId: string, agent: AgentDraft & { scope: AgentFile['scope'] }, oldPath?: string): Promise<AgentFile>
  deleteAgent(path: string): Promise<void>
  setAgentEnabled(projectId: string, name: string, enabled: boolean): Promise<void>
  draftAgent(text: string): Promise<AgentDraft & { why: string }>
  /** Mode voix : une phrase par fichier modifié (Haiku). */
  summarizeChanges(files: { path: string; lines: string }[]): Promise<Record<string, string>>
  /** Coffre : la valeur va au processus principal (chiffrée, écrite dans .env.local), jamais au moteur. */
  vaultProvide(a: { sessionId: string; itemId?: string; projectId: string; name: string; value: string; remember: 'project' | 'global' | null }): Promise<{ ok: boolean; where?: string; error?: string }>
  vaultUseStored(a: { sessionId: string; itemId: string; projectId: string; name: string }): Promise<{ ok: boolean; where?: string; error?: string }>
  vaultDecline(sessionId: string, itemId: string): Promise<void>
  vaultList(projectId?: string): Promise<VaultEntry[]>
  vaultDelete(name: string, scope: 'project' | 'global', projectId?: string): Promise<void>
  reconnectMcp(projectId: string, name: string): Promise<void>
  listMemory(projectId: string): Promise<MemoryList>
  writeMemory(projectId: string, file: string, raw: string): Promise<void>
  forgetMemory(projectId: string, file: string): Promise<void>
  moveMemory(projectId: string, file: string, toProjectId: string): Promise<void>
  /** Projet « Config Claude Code » (~/.claude), créé au besoin : il accueille les mini-sessions des outils. */
  configProject(): Promise<Project>
  /** Fin de la sortie d'une tâche de fond terminée (élément « task » du fil). */
  taskOutput(sessionId: string, itemId: string): Promise<string>
  /** Fil d'un sous-agent de fond (lu dans son journal) : éléments de session, rendus comme le fil principal. */
  taskThread(sessionId: string, taskId: string): Promise<Item[] | null>
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
  /** `restore` : reprise après un rechargement ou un redémarrage, la fenêtre n'est pas rangée. */
  companionSet(state: import('./companion').CompanionState | null, restore?: boolean): void
  /** Le mode compagnon était actif quand Canopy s'est arrêté sans que tu le fermes (redémarrage automatique) : le reprendre. */
  companionResume(): Promise<boolean>
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
  /** Agenda (planches 51 à 55). */
  agendaState(): Promise<import('./agenda').AgendaState>
  /** Relire Google Agenda et Teamleader maintenant. */
  agendaRefresh(): Promise<import('./agenda').AgendaState>
  /** ID client et code secret de l'application de bureau Google (gardés dans le Coffre). */
  agendaSetGoogleClient(clientId: string, clientSecret: string): Promise<import('./agenda').AgendaState>
  /** Ouvre le consentement dans le navigateur ; se résout une fois connecté (ou en erreur). */
  agendaConnect(source: 'google' | 'teamleader'): Promise<{ ok: true } | { ok: false; error: string }>
  agendaDisconnect(source: 'google' | 'teamleader'): Promise<import('./agenda').AgendaState>
  /** Relier une réunion à un projet (null : pas de brief). remember : retenu pour la série. */
  agendaLink(meetingId: string, projectId: string | null, remember: boolean): Promise<import('./agenda').AgendaState>
  agendaBrief(meetingId: string): Promise<import('./agenda').AgendaBrief | null>
  /** Ignorer une réunion : cette occurrence, ou toujours (la série, sinon ce titre). */
  agendaIgnore(meetingId: string, always: boolean): Promise<import('./agenda').AgendaState>
  /** Réunions ignorées pour de bon : clé → titre. */
  agendaIgnored(): Promise<Record<string, string>>
  agendaUnignore(key: string): Promise<Record<string, string>>
  /** Écrire (ou mettre à jour) le brief maintenant. */
  agendaMakeBrief(meetingId: string): Promise<void>
  /** Notes de réunion (étape 2a). */
  notesList(): Promise<import('./notes').MeetingNoteMeta[]>
  notesGet(id: string): Promise<import('./notes').MeetingNote | null>
  /** Nouvelle prise de notes (liée à une réunion de l'agenda si meetingId). */
  notesStart(p: { title: string; meetingId?: string }): Promise<import('./notes').MeetingNote>
  /** Ajoute des segments transcrits et met à jour l'état (recording / paused). */
  notesAppend(id: string, segs: import('./notes').NoteSeg[], state?: 'recording' | 'paused'): Promise<void>
  /** Termine : Claude écrit le compte rendu (état summarizing, puis done ou error). */
  notesFinish(id: string): Promise<void>
  /** Relancer le compte rendu. */
  notesSummarize(id: string): Promise<void>
  notesNameSpeaker(id: string, speakerId: string, name: string): Promise<void>
  notesDelete(id: string): Promise<void>
  /** Oublier une ligne du transcript. */
  notesRemoveSeg(id: string, segId: string): Promise<void>
  /** Renommer une note (titre modifiable après coup). */
  notesRename(id: string, title: string): Promise<void>
  /** Ajoute des actions du compte rendu à une checklist du projet (créée au besoin : « Actions de réunion »). */
  notesToChecklist(id: string, projectId: string, items: string[]): Promise<{ ok: true } | { ok: false; error: string }>
  getAgendaPrefs(): Promise<import('./agenda').AgendaPrefs>
  setAgendaPrefs(p: Partial<import('./agenda').AgendaPrefs>): Promise<import('./agenda').AgendaPrefs>
}

/** API de la fenêtre des notifications (toast.html). */
export type ToastApi = {
  onState(cb: (s: ToastState) => void): () => void
  action(a: ToastAction): void
  size(height: number): void
  /** Mode compagnon : déplacer la bulle, la commander, laisser passer les clics hors de la bulle. */
  drag(phase: 'start' | 'move' | 'end', x: number, y: number): void
  companion(c: import('./companion').CompanionCommand): void
  /** Champ de la bulle : la fenêtre (qui ne prend jamais le focus) l'accepte le temps d'écrire. */
  typing(on: boolean): void
  mouse(inside: boolean): void
  onLook(cb: (title: string) => void): () => void
  ready(): void
}
