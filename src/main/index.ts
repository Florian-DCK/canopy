import { app, BrowserWindow, clipboard, dialog, globalShortcut, ipcMain, Menu, type MenuItemConstructorOptions, nativeImage, session, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { BROWSER_PARTITION, type BrowserResult } from '../shared/browser'
import type { UiResult } from '../shared/ui'
import type { CompanionState } from '../shared/companion'
import { emptyState, reduce, type AppState } from '../shared/state'
import type { CompanionPrefs, CaptureResult, AppEvent, Item, NotifInfo, NotifSettings, Project, ThemeMode } from '../shared/types'
import { capture } from './capture'
import { captureScreen } from './screen'
import { runAct, stopActing } from './act'
import { restoreDuck, setDuck } from './duck'
import { DaemonClient, type DaemonStatus } from './daemon'
import { MediaServer, registerMediaScheme } from './media'
import { applySavedTheme, getCompanionAnchor, getCompanionPrefs, setCompanionPrefs, getNotifSettings, getTheme, setCompanionAnchor, setNotifSettings, setTheme, windowBackground } from './settings'
import { inQuietHours, ToastCenter } from './toasts'
import { startVoice, stopVoice } from './voice'

// Electron n'est qu'un client du démon (src/daemon) : fenêtre, notifications, boîtes de dialogue,
// serveur de médias. Il peut redémarrer (mode dev, modification du main…) sans couper les agents.

// Dossier de données isolé (tests e2e).
if (process.env.ATELIER_USER_DATA) app.setPath('userData', process.env.ATELIER_USER_DATA)
registerMediaScheme()

let win: BrowserWindow | null = null
let mirror: AppState = emptyState()
let daemonStatus: DaemonStatus = { connected: false, outdated: false, busy: false }
let media: MediaServer
let projects: Project[] = []

const toRenderer = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

// Notifications de Canopy (planche 9) : nos propres cartes (toasts.ts), le badge et le clignotement de la barre des tâches.
let currentSession: string | null = null
const runSince = new Map<string, number>()
let badgeCount = -1
let silenceUntil = 0
const mutedProjects = new Set<string>()

/** Pastille argile pleine (sans chiffre) en surimpression de l'icône de la barre des tâches. */
function updateBadge() {
  if (!win || win.isDestroyed()) return
  const n = Object.values(mirror.sessions).filter((s) => s.status === 'wait').length
  if (n === badgeCount) return
  badgeCount = n
  if (!n) return win.setOverlayIcon(null, '')
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if ((x - 15.5) ** 2 + (y - 15.5) ** 2 > 15 ** 2) continue
      buf.set([87, 119, 217, 255], (y * size + x) * 4) // BGRA : #D97757
    }
  win.setOverlayIcon(nativeImage.createFromBitmap(buf, { width: size, height: size }), n === 1 ? '1 session t’attend' : `${n} sessions t’attendent`)
}

const VERB: Record<string, string> = {
  Bash: 'exécuter une commande',
  PowerShell: 'exécuter une commande',
  Edit: 'modifier un fichier',
  MultiEdit: 'modifier un fichier',
  Write: 'créer un fichier',
  WebFetch: 'ouvrir une page web',
  WebSearch: 'chercher sur le web',
  Read: 'lire un fichier',
  Artifact: 'publier un artefact'
}
const short = (t: string, n: number) => (t.length > n ? t.slice(0, n - 1) + '…' : t)
const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
}
const focusedOn = (sid: string) => !!win && !win.isDestroyed() && win.isFocused() && currentSession === sid
const notifInfo = (): NotifInfo => ({ settings: getNotifSettings(), silenceUntil: Date.now() < silenceUntil ? silenceUntil : 0, mutedProjects: [...mutedProjects] })
const notifChanged = () => {
  toasts.refresh()
  toRenderer('notif:changed')
}

/** Montre Canopy sur une session (clic sur une carte). */
function showSession(sid: string) {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  toRenderer('atelier:event', { type: 'navigate', sessionId: sid }, 0)
}

const toasts = new ToastCenter({
  preload: join(__dirname, '../preload/index.js'),
  page: () => (process.env['ELECTRON_RENDERER_URL'] ? { url: `${process.env['ELECTRON_RENDERER_URL']}/toast.html` } : { file: join(__dirname, '../renderer/toast.html') }),
  settings: getNotifSettings,
  act: (t, action) => {
    if (action === 'open') return showSession(t.sessionId)
    if (t.kind === 'question' && t.permId && action.startsWith('opt:')) {
      const item = (mirror.items[t.sessionId] ?? []).find((i) => i.id === t.permId)
      const q = item?.kind === 'question' ? item.questions[0] : undefined
      const label = q?.options[Number(action.slice(4))]?.label as string | undefined
      if (q && label) void daemon.rpc('answerQuestion', t.sessionId, t.permId, { action: 'answer', answers: { [q.question]: label } }).catch(() => {})
      return
    }
    if (t.permId && t.kind !== 'question') void daemon.rpc('respondPermission', t.sessionId, t.permId, action).catch(() => {})
  },
  silence: (minutes) => {
    silenceUntil = Date.now() + minutes * 60_000
    toasts.remove(() => true)
    notifChanged()
  },
  mute: (sid) => {
    const pid = mirror.sessions[sid]?.projectId
    if (!pid) return
    mutedProjects.add(pid)
    toasts.remove((t) => mirror.sessions[t.sessionId]?.projectId === pid)
    notifChanged()
  },
  openSettings: () => {
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    toRenderer('notif:open-settings')
  },
  anchor: getCompanionAnchor,
  setAnchor: setCompanionAnchor,
  // Gestes de la bulle : rouvrir Canopy (sur le mode voix), quitter le compagnon, couper Claude.
  companion: (c) => {
    if ((c === 'open' || c === 'quit') && win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
    toRenderer('companion:command', c)
  }
})

// Mode compagnon : la fenêtre principale envoie l'état de la bulle (null = quitter). En entrant, Canopy se range
// dans la barre des tâches ; la voix continue (pas de ralentissement en arrière-plan, voir webPreferences).
ipcMain.on('act:stop', () => stopActing())
ipcMain.handle('companion:prefs', (_e, p?: Partial<CompanionPrefs>) => (p ? setCompanionPrefs(p) : getCompanionPrefs()))
ipcMain.on('companion:reset-position', () => {
  setCompanionAnchor(null)
  toasts.resetAnchor()
})
ipcMain.on('voice:duck', (_e, on: boolean, factor?: number) => setDuck(!!on, typeof factor === 'number' ? factor : 0.3))
ipcMain.on('win:show', () => {
  if (!win || win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

ipcMain.on('companion:set', (_e, state: CompanionState | null) => {
  const entering = !!state && !toasts.companionOn
  const leaving = !state && toasts.companionOn
  toasts.setCompanion(state)
  if (!win || win.isDestroyed()) return
  if (entering) win.minimize()
  // En sortant (à la voix, depuis la bulle ou Canopy), Canopy revient.
  if (leaving) {
    if (win.isMinimized()) win.restore()
    win.show()
  }
})

/** Carte de notification d'une question qui attend ta réponse ; une question simple se répond depuis la carte. */
function notifyQuestion(sid: string, item: Extract<Item, { kind: 'question' }>) {
  const meta = mirror.sessions[sid]
  if (!meta) return
  if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true)
  const quiet = Date.now() < silenceUntil || inQuietHours(getNotifSettings()) || mutedProjects.has(meta.projectId)
  if (quiet || focusedOn(sid)) return
  const project = projects.find((p) => p.id === meta.projectId)
  const q = item.questions[0]
  const simple = item.questions.length === 1 && q && !q.multiSelect && !q.options.some((o) => o.preview)
  toasts.push({
    sessionId: sid,
    project: project?.name ?? 'Canopy',
    color: project?.color ?? '#8F8D86',
    kind: 'question',
    permId: item.id,
    title: q ? short(q.question, 120) : 'Claude a une question',
    body: item.questions.length > 1 ? `Question 1 sur ${item.questions.length} · ${meta.title}` : meta.title,
    ...(simple ? { options: q.options.map((o) => short(o.label, 40)) } : {})
  })
}

function maybeNotify(prev: AppState, e: AppEvent) {
  // Demande résolue (ici ou ailleurs) : sa carte part.
  if (e.type === 'item:patch') {
    const st = (e.patch as { state?: string }).state
    if (st && st !== 'pending') toasts.remove((t) => t.permId === e.itemId)
    // Question sans attente devenue bloquante (Claude n'a plus rien d'autre à faire).
    if ((e.patch as { mode?: string }).mode === 'wait') {
      const item = (mirror.items[e.sessionId] ?? []).find((i) => i.id === e.itemId)
      if (item?.kind === 'question' && item.state === 'pending') notifyQuestion(e.sessionId, item)
    }
    return
  }
  if (e.type === 'item:add' && e.item.kind === 'question' && e.item.mode === 'wait') return notifyQuestion(e.sessionId, e.item)
  if (e.type === 'session:removed') return toasts.remove((t) => t.sessionId === e.id)

  const sid = e.type === 'item:add' ? e.sessionId : e.type === 'session:patch' ? e.id : null
  const meta = sid ? mirror.sessions[sid] : undefined
  if (!sid || !meta) return
  const project = projects.find((p) => p.id === meta.projectId)
  const base = { sessionId: sid, project: project?.name ?? 'Canopy', color: project?.color ?? '#8F8D86' }
  const quiet = Date.now() < silenceUntil || inQuietHours(getNotifSettings()) || mutedProjects.has(meta.projectId)

  if (e.type === 'item:add' && e.item.kind === 'permission' && e.item.state === 'pending') {
    if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true)
    if (quiet || focusedOn(sid)) return
    const p = e.item
    if (p.tool === 'ExitPlanMode') {
      const first = p.detail?.split('\n').find((l) => l.trim())?.replace(/^#+\s*/, '')
      toasts.push({ ...base, kind: 'plan', permId: p.id, title: 'Plan prêt — à toi de valider', body: short(first ?? meta.title, 120) })
    } else
      toasts.push({ ...base, kind: 'wait', permId: p.id, title: `${p.parent ? 'Un sous-agent' : 'Claude'} veut ${VERB[p.tool] ?? `utiliser ${p.tool}`}`, body: meta.title, cmd: short(p.summary || p.tool, 160) })
    return
  }

  if (e.type !== 'session:patch' || !e.patch.status) return
  const before = prev.sessions[sid]?.status
  const next = e.patch.status
  if (before === next) return
  if (next === 'run') runSince.set(sid, Date.now())
  const started = runSince.get(sid)
  if (next !== 'run') runSince.delete(sid)
  const away = !win || win.isDestroyed() || !win.isFocused()
  if (quiet || !away) return
  const items = mirror.items[sid] ?? []
  if (next === 'idle' && before === 'run' && started && Date.now() - started > 60_000) {
    const said = [...items].reverse().find((i) => i.kind === 'text' && !i.parent && i.text.trim())
    const excerpt = said && said.kind === 'text' ? short(said.text.replace(/[#*`>_[\]]/g, '').replace(/\s+/g, ' ').trim(), 110) : ''
    toasts.push({ ...base, kind: 'done', title: `Terminé · ${short(meta.title, 60)}`, body: [fmtDuration(Date.now() - started), excerpt && `« ${excerpt} »`].filter(Boolean).join(' · ') })
  } else if (next === 'error') {
    const err = [...items].reverse().find((i) => i.kind === 'error')
    toasts.push({ ...base, kind: 'error', title: 'La session s’est arrêtée', body: err && err.kind === 'error' ? short(err.text, 140) : meta.title })
  }
}

const daemon = new DaemonClient(app.getPath('userData'), join(__dirname, 'daemon.js'), {
  snapshot: (s) => {
    for (const list of Object.values(s.media)) list.forEach((m, k) => (list[k] = media.register(m)))
    mirror = s
    updateBadge()
    toRenderer('atelier:snapshot', mirror)
    void refreshProjects()
  },
  event: (seq, e) => {
    // Demande de capture d'un agent : on ne traite que les demandes fraîches (pas celles rejouées).
    if (e.type === 'capture:request') {
      console.log('[atelier] capture demandée', e.id, Date.now() - e.at, 'ms', JSON.stringify(e.params))
      if (Date.now() - e.at < 15_000) {
        const { id, params } = e
        // Autorisations de la page Paramètres : regarder l'écran, agir dessus.
        const prefs = getCompanionPrefs()
        const denied = (what: string): Promise<CaptureResult> => Promise.resolve({ ok: false, info: `${what} est désactivé dans les Paramètres de Canopy (section Compagnon). Demande à l'utilisateur de l'activer s'il le souhaite.` })
        void (params.act ? (prefs.act ? runAct(params.act) : denied('Agir à l’écran')) : params.desktop ? (prefs.screen ? captureScreen(params.desktop).then((r) => (toasts.look(r.title ?? ''), r)) : denied('Regarder l’écran')) : capture(win, params))
          .then((r) => {
            console.log('[atelier] capture prête', id, r.ok, r.info.slice(0, 120))
            return daemon.rpc('captureResult', id, r)
          })
          .catch((err) => console.error('[atelier] capture échouée', id, err))
      }
      return
    }
    // Action de Claude dans le navigateur intégré : relayée à la fenêtre principale (exécution côté renderer).
    if (e.type === 'browser:request') {
      if (Date.now() - e.at < 60_000) {
        const { id, sessionId, params } = e
        if (win && !win.isDestroyed()) toRenderer('browser:request', { id, sessionId, params })
        else void daemon.rpc('browserResult', id, { ok: false, text: "Canopy n'est pas ouvert." }).catch(() => {})
      }
      return
    }
    // Action de Claude sur l'interface : même relais que le navigateur.
    if (e.type === 'ui:request') {
      if (Date.now() - e.at < 30_000) {
        const { id, sessionId, params } = e
        if (win && !win.isDestroyed()) toRenderer('ui:request', { id, sessionId, params })
        else void daemon.rpc('uiResult', id, { ok: false, text: "Canopy n'est pas ouvert." }).catch(() => {})
      }
      return
    }
    if (e.type === 'projects:changed') void refreshProjects()
    if (e.type === 'media:add') e = { ...e, media: media.register(e.media) }
    const prev = mirror
    mirror = reduce({ ...mirror, seq }, e)
    maybeNotify(prev, e)
    updateBadge()
    toRenderer('atelier:event', e, seq)
  },
  status: (s) => {
    daemonStatus = s
    toRenderer('atelier:daemon', s)
  }
})

async function refreshProjects() {
  try {
    projects = await daemon.rpc<Project[]>('listProjects')
  } catch {
    /* démon indisponible */
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: windowBackground(),
    title: 'Canopy',
    // Barre de fenêtre dessinée par Canopy (titlebar.tsx) : sur Windows, « hidden » retire la barre et les boutons
    // natifs mais garde les bords de redimensionnement, l'ombre et l'ancrage.
    titleBarStyle: 'hidden',
    // Icône de la fenêtre et de la barre des tâches (resources/ à la racine du projet).
    icon: join(__dirname, '../../resources/canopy.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Artefacts claude.ai affichés en direct (session persistante « persist:claude »).
      webviewTag: true,
      // Mode voix et compagnon : micro, voix et animations continuent fenêtre réduite.
      backgroundThrottling: false
    }
  })
  win.on('closed', () => app.quit())
  // Revenir dans Canopy (barre des tâches, Alt+Tab) met fin au mode compagnon : pas de bulle en double.
  // État de la fenêtre pour la barre maison (bouton Agrandir / Restaurer, barre atténuée sans le focus).
  const sendState = () => toRenderer('win:state', { maximized: !!win?.isMaximized(), focused: !!win?.isFocused() })
  for (const ev of ['maximize', 'unmaximize', 'focus', 'blur', 'enter-full-screen', 'leave-full-screen'] as const) win.on(ev as 'maximize', sendState)
  // Barre des tâches Windows : identité et icône Canopy, y compris une fois l'application épinglée
  // (sinon Windows montre l'icône d'electron.exe et relance Electron nu).
  if (process.platform === 'win32')
    win.setAppDetails({
      appId: APP_ID,
      appIconPath: join(__dirname, '../../resources/canopy.ico'),
      appIconIndex: 0,
      relaunchCommand: `wscript.exe "${join(__dirname, '../../scripts/atelier-dev.vbs')}"`,
      relaunchDisplayName: 'Canopy'
    })
  win.on('focus', () => {
    win?.flashFrame(false)
    // Tu regardes la session : ses cartes n'ont plus lieu d'être.
    if (currentSession) toasts.remove((t) => t.sessionId === currentSession)
  })
  win.webContents.on('did-finish-load', () => ((badgeCount = -1), updateBadge()))
  // Menu du clic droit (Electron n'en a pas par défaut) : lien, sélection, champ de saisie, image.
  win.webContents.on('context-menu', (_e, p) => {
    const t: MenuItemConstructorOptions[] = []
    const sep = () => t.length && t[t.length - 1].type !== 'separator' && t.push({ type: 'separator' })
    if (p.linkURL && /^https?:|^mailto:/.test(p.linkURL)) {
      t.push({ label: 'Ouvrir le lien dans le navigateur', click: () => void shell.openExternal(p.linkURL) })
      t.push({ label: 'Copier l’adresse du lien', click: () => clipboard.writeText(p.linkURL) })
      if (p.linkText && p.linkText !== p.linkURL) t.push({ label: 'Copier le texte du lien', click: () => clipboard.writeText(p.linkText) })
    }
    if (p.mediaType === 'image' && p.srcURL) {
      sep()
      t.push({ label: 'Copier l’image', click: () => win?.webContents.copyImageAt(p.x, p.y) })
    }
    if (p.isEditable) {
      if (p.misspelledWord && p.dictionarySuggestions.length) {
        sep()
        for (const s of p.dictionarySuggestions.slice(0, 5)) t.push({ label: s, click: () => win?.webContents.replaceMisspelling(s) })
      }
      sep()
      t.push(
        { label: 'Annuler', role: 'undo', enabled: p.editFlags.canUndo },
        { label: 'Rétablir', role: 'redo', enabled: p.editFlags.canRedo },
        { type: 'separator' },
        { label: 'Couper', role: 'cut', enabled: p.editFlags.canCut },
        { label: 'Copier', role: 'copy', enabled: p.editFlags.canCopy },
        { label: 'Coller', role: 'paste', enabled: p.editFlags.canPaste },
        { label: 'Tout sélectionner', role: 'selectAll' }
      )
    } else if (p.selectionText.trim()) {
      sep()
      t.push({ label: 'Copier', role: 'copy' })
    }
    if (t.length) Menu.buildFromTemplate(t).popup({ window: win! })
  })

  // Liens externes → navigateur par défaut, jamais dans l'app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

// --- IPC : état local, puis relais vers le démon ---
ipcMain.on('browser:result', (_e, id: string, r: BrowserResult) => void daemon.rpc('browserResult', id, r).catch(() => {}))
ipcMain.on('ui:result', (_e, id: string, r: UiResult) => void daemon.rpc('uiResult', id, r).catch(() => {}))
ipcMain.handle('state:snapshot', () => mirror)
ipcMain.handle('daemon:status', () => daemonStatus)
ipcMain.handle('voice:start', (_e, voice: string) => startVoice(voice))
ipcMain.handle('voice:stop', () => stopVoice())
ipcMain.handle('daemon:restart', async (_e, force?: boolean) => daemon.restart(!!force))
ipcMain.on('view:current', (_e, id: string | null) => {
  currentSession = id
  if (id && win?.isFocused()) toasts.remove((t) => t.sessionId === id)
})
ipcMain.handle('win:state', () => ({ maximized: !!win?.isMaximized(), focused: !!win?.isFocused() }))
ipcMain.on('win:control', (_e, action: string) => {
  if (!win || win.isDestroyed()) return
  if (action === 'minimize') win.minimize()
  else if (action === 'toggle-maximize') (win.isMaximized() ? win.unmaximize() : win.maximize())
  else if (action === 'close') win.close()
})
ipcMain.handle('notif:get', () => notifInfo())
ipcMain.handle('notif:set', (_e, patch: Partial<NotifSettings>) => {
  setNotifSettings(patch)
  notifChanged()
  return notifInfo()
})
ipcMain.handle('notif:silence', (_e, minutes: number) => {
  silenceUntil = minutes > 0 ? Date.now() + minutes * 60_000 : 0
  if (minutes > 0) toasts.remove(() => true)
  notifChanged()
  return notifInfo()
})
ipcMain.handle('notif:unmute', (_e, projectId: string) => {
  mutedProjects.delete(projectId)
  notifChanged()
  return notifInfo()
})
ipcMain.handle('theme:get', () => getTheme())
ipcMain.handle('theme:set', (_e, mode: ThemeMode) => {
  setTheme(mode)
  win?.setBackgroundColor(windowBackground())
})
ipcMain.handle('projects:add', async () => {
  const r = await dialog.showOpenDialog(win!, { title: 'Ajouter un projet', properties: ['openDirectory'] })
  if (r.canceled || !r.filePaths[0]) return null
  const p = await daemon.rpc('addProjectPath', r.filePaths[0])
  void refreshProjects()
  return p
})
ipcMain.handle('media:open', async (_e, id: string) => {
  const f = media.fileOf(id)
  if (f) await shell.openPath(f)
})
ipcMain.handle('editor:open', (_e, projectId: string, relPath: string, line?: number) => {
  const root = projects.find((p) => p.id === projectId)?.path
  if (!root || typeof relPath !== 'string') return
  const abs = resolve(root, relPath)
  const inside = relative(root, abs)
  if (inside.startsWith('..') || isAbsolute(inside) || !existsSync(abs)) return
  const target = Number.isInteger(line) && (line as number) > 0 ? `${abs}:${line}` : abs
  spawn('code', ['-g', `"${target}"`], { shell: true, detached: true, stdio: 'ignore', windowsHide: true }).unref()
})
ipcMain.handle('media:folder', (_e, id: string) => {
  const f = media.fileOf(id)
  if (f) shell.showItemInFolder(f)
})

/** Canaux relayés tels quels au démon : canal IPC → méthode RPC. */
const RELAY: Record<string, string> = {
  'projects:list': 'listProjects',
  'projects:addPath': 'addProjectPath',
  'projects:remove': 'removeProject',
  'projects:rename': 'renameProject',
  'session:create': 'createSession',
  'session:send': 'send',
  'session:interrupt': 'interrupt',
  'session:close': 'closeSession',
  'session:mode': 'setPermissionMode',
  'session:model': 'setModel',
  'session:resume': 'resumeSession',
  'session:takeover': 'takeOver',
  'permission:respond': 'respondPermission',
  'question:answer': 'answerQuestion',
  'task:background': 'backgroundTask',
  'task:stop': 'stopTask',
  'tools:inventory': 'toolsInventory',
  'tools:skill': 'setSkillEnabled',
  'tools:mcp': 'setMcpEnabled',
  'tools:reconnect': 'reconnectMcp',
  'memory:list': 'listMemory',
  'memory:write': 'writeMemory',
  'memory:forget': 'forgetMemory',
  'memory:move': 'moveMemory',
  'tools:configProject': 'configProject',
  'task:output': 'taskOutput',
  'history:list': 'listHistory',
  'files:list': 'listFiles',
  'commands:list': 'listCommands',
  'checklists:list': 'listChecklists',
  'checklists:get': 'getChecklist',
  'checklists:create': 'createChecklist',
  'checklists:update': 'updateChecklist',
  'checklists:delete': 'deleteChecklist'
}
for (const [channel, method] of Object.entries(RELAY))
  ipcMain.handle(channel, async (_e, ...args) => {
    const r = await daemon.rpc(method, ...args)
    if (channel.startsWith('projects:')) void refreshProjects()
    return r
  })

app.setAppUserModelId('be.hilarious.atelier') // requis pour les notifications Windows
// Contenu des <webview> (claude.ai) : pas de Node, liens externes vers le navigateur,
// fenêtres de connexion (claude.ai, Google, Anthropic) autorisées dans la même session.
app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() !== 'webview') return
  wc.setWindowOpenHandler(({ url }) => {
    const host = (() => {
      try {
        return new URL(url).hostname
      } catch {
        return ''
      }
    })()
    if (/(^|\.)(claude\.ai|anthropic\.com|google\.com|googleusercontent\.com)$/.test(host)) return { action: 'allow' }
    void shell.openExternal(url)
    return { action: 'deny' }
  })
})
app.on('web-contents-created', (_e, wc) => {
  wc.on('will-attach-webview', (_ev, prefs, params) => {
    if (params.partition === BROWSER_PARTITION) {
      // Navigateur intégré : surcouche Pointer injectée par notre preload (sandboxé).
      prefs.preload = join(__dirname, '../preload/webview.js')
      prefs.sandbox = true
    } else {
      delete (prefs as any).preload
    }
    prefs.nodeIntegration = false
    prefs.contextIsolation = true
  })
})

const APP_ID = 'be.hilarious.canopy'
// Avant toute fenêtre : regroupe les fenêtres de Canopy sous sa propre icône dans la barre des tâches.
app.setAppUserModelId(APP_ID)

app.whenReady().then(() => {
  // Agent utilisateur de Chrome (sans « Electron/… ») : sinon certaines connexions refusent le navigateur intégré.
  const claudeSession = session.fromPartition('persist:claude')
  claudeSession.setUserAgent(claudeSession.getUserAgent().replace(/\s(Electron|atelier)\/\S+/gi, ''))
  media = new MediaServer()
  media.handleProtocol()
  applySavedTheme()
  createWindow()
  void daemon.start()
  setInterval(() => void daemon.checkVersion(), 4000)
})

// Fermer la fenêtre ne coupe pas les agents : le démon continue.
// La fenêtre des notifications ne doit pas garder l'app ouverte : fermer Canopy quitte.
app.on('window-all-closed', () => app.quit())
app.on('will-quit', () => {
  toasts.dispose()
  restoreDuck()
  globalShortcut.unregisterAll()
})

// Tests e2e (ATELIER_DAEMON_EPHEMERAL) : le démon s'arrête avec l'app, quelle que soit la façon de quitter.
let daemonStopped = false
app.on('before-quit', (e) => {
  if (!process.env.ATELIER_DAEMON_EPHEMERAL || daemonStopped) return
  e.preventDefault()
  void daemon.stop(true).finally(() => {
    daemonStopped = true
    app.quit()
  })
})
