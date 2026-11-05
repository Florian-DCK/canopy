import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import type { CompanionCommand, CompanionState } from '../shared/companion'
import type { NotifSettings, Toast, ToastAction, ToastState } from '../shared/types'

// Notifications de Canopy (planche 9) : une fenêtre à nous, sans cadre, au-dessus du plein écran,
// qui ne vole jamais le focus. Les cartes s'empilent (attentes d'abord) dans un coin de l'écran de la souris.

const WIDTH = 392
/** Mode compagnon : la fenêtre s'élargit pour la bulle et sa ligne de texte à côté. */
const C_WIDTH = 520
const MARGIN = 14
const ORDER: Record<Toast['kind'], number> = { wait: 0, question: 0, plan: 1, error: 2, done: 3 }
const REMIND_FIRST = 2 * 60_000
const REMIND_EVERY = 10 * 60_000

type Hooks = {
  preload: string
  page: () => { url: string } | { file: string }
  settings: () => NotifSettings
  /** Autoriser / refuser / ouvrir la session d'une carte. */
  act: (t: Toast, action: 'allow' | 'deny' | 'open' | `opt:${number}`) => void
  silence: (minutes: number) => void
  mute: (sessionId: string) => void
  openSettings: () => void
  /** Mode compagnon : coin bas-droit de la bulle (mémorisé) et gestes de la bulle. */
  anchor: () => { x: number; y: number } | null
  setAnchor: (p: { x: number; y: number }) => void
  companion: (c: CompanionCommand) => void
}

export class ToastCenter {
  private win: BrowserWindow | null = null
  private list: Toast[] = []
  private height = 0
  private ready = false
  private shortcuts = false
  private reminded = new Map<string, number>()
  private comp: CompanionState | null = null
  private anchorPt: { x: number; y: number } | null = null
  private drag: { x: number; y: number; ax: number; ay: number } | null = null
  private passThrough = false
  /** Canopy est au premier plan : la bulle s'efface (le mode voix est sous tes yeux), elle revient dès que tu en sors. */
  private hidden = false

  constructor(private h: Hooks) {
    ipcMain.on('toasts:size', (e, height: number) => {
      if (e.sender !== this.win?.webContents) return
      this.height = Math.max(0, Math.min(900, Math.ceil(height)))
      this.place()
    })
    ipcMain.on('toasts:action', (e, a: ToastAction) => {
      if (e.sender !== this.win?.webContents) return
      this.onAction(a)
    })
    ipcMain.on('toasts:ready', (e) => {
      if (e.sender !== this.win?.webContents) return
      this.ready = true
      this.sync()
    })
    ipcMain.on('companion:command', (e, c: CompanionCommand) => {
      if (e.sender === this.win?.webContents) this.h.companion(c)
    })
    // Écrire dans la bulle : la fenêtre accepte le focus le temps de la saisie, puis redevient transparente au clavier.
    ipcMain.on('companion:typing', (e, on: boolean) => {
      const w = this.win
      if (e.sender !== w?.webContents || w.isDestroyed()) return
      w.setFocusable(on)
      if (on) w.focus()
    })
    ipcMain.on('companion:drag', (e, phase: 'start' | 'move' | 'end', x: number, y: number) => {
      if (e.sender !== this.win?.webContents || !this.shown) return
      const a = this.anchor()
      if (phase === 'start') this.drag = { x, y, ax: a.x, ay: a.y }
      else if (this.drag) {
        this.anchorPt = { x: this.drag.ax + (x - this.drag.x), y: this.drag.ay + (y - this.drag.y) }
        if (phase === 'end') {
          this.drag = null
          this.anchorPt = this.clamp(this.anchorPt)
          this.h.setAnchor(this.anchorPt)
        }
        this.place()
      }
    })
    // Hors de la bulle et des cartes, les clics passent à l'application dessous.
    ipcMain.on('toasts:mouse', (e, inside: boolean) => {
      if (e.sender !== this.win?.webContents) return
      this.setPassThrough(!!this.shown && !inside)
    })
    setInterval(() => this.remind(), 30_000).unref?.()
  }

  /** Mode compagnon : afficher ou mettre à jour la bulle (null = la retirer). */
  setCompanion(state: CompanionState | null) {
    const was = !!this.shown
    this.comp = state
    if (!this.shown) this.setPassThrough(false)
    if (!!this.shown !== was) this.height = 0
    this.sync()
  }

  /** Canopy au premier plan (vrai) ou non : la bulle se cache ou revient, sans quitter le mode compagnon. */
  setCompanionHidden(hidden: boolean) {
    if (hidden === this.hidden) return
    const was = !!this.shown
    this.hidden = hidden
    if (!this.shown) this.setPassThrough(false)
    if (!!this.shown === was) return
    this.height = 0
    this.sync()
  }

  /** La bulle telle qu'elle est affichée (rien quand Canopy est au premier plan). */
  private get shown() {
    return this.hidden ? null : this.comp
  }

  /** Outil écran : l'œil s'allume dans la bulle quelques secondes, avec la fenêtre regardée. */
  look(title: string) {
    if (!this.shown || !this.win || this.win.isDestroyed()) return
    this.win.webContents.send('companion:look', title)
  }

  /** Paramètres : la bulle revient en bas à droite de l'écran principal. */
  resetAnchor() {
    this.anchorPt = null
    this.place()
  }

  get companionOn() {
    return !!this.comp
  }

  private setPassThrough(on: boolean) {
    if (on === this.passThrough || !this.win || this.win.isDestroyed()) return
    this.passThrough = on
    this.win.setIgnoreMouseEvents(on, { forward: true })
  }

  /** Coin bas-droit de la bulle : mémorisé, sinon en bas à droite de l'écran principal. */
  private anchor() {
    if (!this.anchorPt) this.anchorPt = this.h.anchor()
    if (!this.anchorPt) {
      const a = screen.getPrimaryDisplay().workArea
      this.anchorPt = { x: a.x + a.width - 24, y: a.y + a.height - 24 }
    }
    return this.anchorPt
  }

  /** La bulle reste entière sur l'écran où on l'a lâchée. */
  private clamp(p: { x: number; y: number }) {
    const a = screen.getDisplayNearestPoint(p).workArea
    return { x: Math.min(Math.max(p.x, a.x + 96), a.x + a.width - 8), y: Math.min(Math.max(p.y, a.y + 96), a.y + a.height - 8) }
  }

  get all(): readonly Toast[] {
    return this.list
  }

  push(t: Omit<Toast, 'id' | 'at'>) {
    // Une seule carte par demande d'autorisation, et une seule « terminé / erreur » par session.
    this.list = this.list.filter((x) => !(t.permId && x.permId === t.permId) && !(t.kind !== 'wait' && t.kind !== 'plan' && t.kind !== 'question' && x.sessionId === t.sessionId && x.kind === t.kind))
    this.list.push({ ...t, id: randomUUID(), at: Date.now() })
    this.list.sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.at - b.at)
    this.sync()
  }

  remove(pred: (t: Toast) => boolean) {
    const n = this.list.length
    this.list = this.list.filter((t) => !pred(t))
    if (this.list.length !== n) this.sync()
  }

  /** Réglages modifiés : niveau « au-dessus du plein écran », coin, son. */
  refresh() {
    if (this.win && !this.win.isDestroyed()) this.win.setAlwaysOnTop(true, this.h.settings().overFullscreen ? 'screen-saver' : 'floating')
    this.sync()
  }

  private onAction(a: ToastAction) {
    const t = this.list.find((x) => x.id === a.id)
    if (a.type === 'silence') return this.h.silence(60)
    if (a.type === 'settings') return this.h.openSettings()
    if (!t) return
    if (a.type === 'mute') return this.h.mute(t.sessionId)
    if (a.type === 'allow' || a.type === 'deny' || a.type === 'open' || a.type.startsWith('opt:')) this.h.act(t, a.type as 'open')
    // Autoriser / refuser : la carte part quand la demande est résolue (événement du démon) ; sinon tout de suite.
    if (a.type === 'dismiss' || a.type === 'open') this.remove((x) => x.id === t.id)
  }

  /** Rappel doux : 2 min après l'arrivée d'une attente, puis toutes les 10 min. */
  private remind() {
    const now = Date.now()
    let changed = false
    for (const t of this.list) {
      if (t.kind !== 'wait' && t.kind !== 'plan' && t.kind !== 'question') continue
      const last = this.reminded.get(t.id) ?? t.at
      const due = this.reminded.has(t.id) ? REMIND_EVERY : REMIND_FIRST
      if (now - last < due) continue
      this.reminded.set(t.id, now)
      t.pulse = (t.pulse ?? 0) + 1
      changed = true
    }
    if (changed) this.sync()
  }

  private ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win
    this.ready = false
    this.height = 0
    const w = new BrowserWindow({
      width: WIDTH,
      height: 120,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      // Ne prend jamais le focus : tu continues à taper dans ton application.
      focusable: false,
      alwaysOnTop: true,
      title: 'Canopy — notifications',
      webPreferences: {
        preload: this.h.preload,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required'
      }
    })
    w.setAlwaysOnTop(true, this.h.settings().overFullscreen ? 'screen-saver' : 'floating')
    if (process.platform === 'darwin') {
      w.setAlwaysOnTop(true, 'screen-saver')
      w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }
    w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    w.webContents.on('will-navigate', (e) => e.preventDefault())
    const page = this.h.page()
    if ('url' in page) void w.loadURL(page.url)
    else void w.loadFile(page.file)
    w.on('closed', () => {
      if (this.win === w) this.win = null
    })
    this.win = w
    return w
  }

  private sync() {
    this.shortcutsFor(this.list.some((t) => t.kind === 'wait'))
    const s = this.h.settings()
    const state: ToastState = { toasts: this.list, sound: s.sound, corner: this.shown ? 'br' : s.corner, companion: this.shown }
    if (!this.list.length && !this.shown) {
      if (this.win && !this.win.isDestroyed()) {
        // La page doit oublier la bulle avant d'être cachée : sinon, au retour du compagnon, elle croit l'afficher
        // déjà, ne renvoie pas sa taille, et la fenêtre reste invisible.
        if (this.ready) this.win.webContents.send('toasts:state', state)
        this.win.hide()
      }
      this.height = 0
      return
    }
    const w = this.ensureWindow()
    if (!this.ready) return
    w.webContents.send('toasts:state', state)
    this.place()
  }

  /** Coin choisi, sur l'écran où se trouve la souris. */
  private place() {
    const w = this.win
    if (!w || w.isDestroyed() || (!this.list.length && !this.shown) || !this.height) return
    if (this.shown) {
      // La fenêtre pend au-dessus et à gauche du coin de la bulle : les cartes s'empilent au-dessus d'elle.
      const a = this.anchor()
      w.setBounds({ x: Math.round(a.x - C_WIDTH), y: Math.round(a.y - this.height), width: C_WIDTH, height: this.height })
      if (!w.isVisible()) w.showInactive()
      return
    }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const corner = this.h.settings().corner
    const x = corner.endsWith('r') ? area.x + area.width - WIDTH - MARGIN : area.x + MARGIN
    const y = corner.startsWith('b') ? area.y + area.height - this.height - MARGIN : area.y + MARGIN
    w.setBounds({ x: Math.round(x), y: Math.round(y), width: WIDTH, height: this.height })
    if (!w.isVisible()) w.showInactive()
  }

  /** Ctrl+Alt+Entrée / Ctrl+Alt+Échap : répondre à l'attente du dessus depuis n'importe quelle application. */
  private shortcutsFor(on: boolean) {
    if (on === this.shortcuts) return
    this.shortcuts = on
    const top = () => this.list.find((t) => t.kind === 'wait')
    if (on) {
      globalShortcut.register('CommandOrControl+Alt+Enter', () => {
        const t = top()
        if (t) this.h.act(t, 'allow')
      })
      globalShortcut.register('CommandOrControl+Alt+Escape', () => {
        const t = top()
        if (t) this.h.act(t, 'deny')
      })
    } else {
      globalShortcut.unregister('CommandOrControl+Alt+Enter')
      globalShortcut.unregister('CommandOrControl+Alt+Escape')
    }
  }

  dispose() {
    this.shortcutsFor(false)
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
  }
}

/** « 22:00 » → minutes depuis minuit. */
const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/** Heures calmes (plage qui peut passer minuit). */
export function inQuietHours(s: NotifSettings, d = new Date()) {
  if (!s.quiet) return false
  const now = d.getHours() * 60 + d.getMinutes()
  const a = mins(s.quietFrom)
  const b = mins(s.quietTo)
  return a <= b ? now >= a && now < b : now >= a || now < b
}
