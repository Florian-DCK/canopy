import { BrowserWindow, globalShortcut, ipcMain, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import type { NotifSettings, Toast, ToastAction, ToastState } from '../shared/types'

// Notifications de Canopy (planche 9) : une fenêtre à nous, sans cadre, au-dessus du plein écran,
// qui ne vole jamais le focus. Les cartes s'empilent (attentes d'abord) dans un coin de l'écran de la souris.

const WIDTH = 392
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
}

export class ToastCenter {
  private win: BrowserWindow | null = null
  private list: Toast[] = []
  private height = 0
  private ready = false
  private shortcuts = false
  private reminded = new Map<string, number>()

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
    setInterval(() => this.remind(), 30_000).unref?.()
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
    if (!this.list.length) {
      if (this.win && !this.win.isDestroyed()) this.win.hide()
      this.height = 0
      return
    }
    const w = this.ensureWindow()
    if (!this.ready) return
    const s = this.h.settings()
    const state: ToastState = { toasts: this.list, sound: s.sound, corner: s.corner }
    w.webContents.send('toasts:state', state)
    this.place()
  }

  /** Coin choisi, sur l'écran où se trouve la souris. */
  private place() {
    const w = this.win
    if (!w || w.isDestroyed() || !this.list.length || !this.height) return
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
