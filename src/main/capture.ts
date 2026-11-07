import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import type { CaptureParams, CaptureResult } from '../shared/types'

// Captures de Canopy pour les agents (outil mcp__atelier__capture) :
// - « hidden » : une fenêtre hors écran charge la vue demandée et la photographie (rien ne s'affiche) ;
// - « current » : copie de la fenêtre de l'utilisateur, sans la déplacer ni la mettre au premier plan.
// Lecture seule : pas d'exécution de code arbitraire, seulement un relevé de styles et de texte.

const MAX_W = 1400
let busy = Promise.resolve()

const INSPECT_JS = (selector: string) => `(() => {
  const all = document.querySelectorAll(${JSON.stringify(selector)})
  if (!all.length) return null
  const e = all[0], r = e.getBoundingClientRect(), cs = getComputedStyle(e)
  const pick = ['color','background-color','font-family','font-size','font-weight','line-height','border-left','border-radius','padding','display','width','height']
  const styles = {}; for (const k of pick) styles[k] = cs.getPropertyValue(k)
  const before = getComputedStyle(e, '::before').getPropertyValue('content')
  return { count: all.length, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    text: (e.innerText || '').slice(0, 400), styles, before: before && before !== 'none' ? before : undefined }
})()`

// Défilement instantané (le fil défile en douceur), puis deux images avant de mesurer : sinon la position
// est lue en plein défilement et le cadrage tombe à côté pour un élément loin dans le fil.
const RECT_JS = (selector: string) => `new Promise((res) => {
  const e = document.querySelector(${JSON.stringify(selector)})
  if (!e) return res(null)
  e.scrollIntoView({ block: 'nearest', behavior: 'instant' })
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const r = e.getBoundingClientRect()
    res({ x: Math.max(0, Math.floor(r.x) - 8), y: Math.max(0, Math.floor(r.y) - 8), width: Math.ceil(r.width) + 16, height: Math.ceil(r.height) + 16 })
  }))
})`

const READY_JS = `new Promise((res) => {
  const t0 = Date.now()
  const tick = () => {
    if (document.documentElement.dataset.captureReady === '1' || Date.now() - t0 > 6000) setTimeout(res, 700)
    else setTimeout(tick, 100)
  }
  tick()
})`

async function shoot(wc: Electron.WebContents, selector?: string) {
  const rect = selector ? await wc.executeJavaScript(RECT_JS(selector)) : undefined
  if (selector && !rect) return { error: `Aucun élément ne correspond à « ${selector} ».` }
  let img = await wc.capturePage(rect ?? undefined)
  if (img.isEmpty()) return { error: 'Capture vide (fenêtre réduite ou non peinte).' }
  const { width } = img.getSize()
  if (width > MAX_W) img = img.resize({ width: MAX_W, quality: 'good' })
  const s = img.getSize()
  return { image: img.toJPEG(82).toString('base64'), size: `${s.width}×${s.height}` }
}

async function inspect(wc: Electron.WebContents, selector?: string) {
  if (!selector) return ''
  const r = await wc.executeJavaScript(INSPECT_JS(selector))
  return r ? `\nInspection de « ${selector} » : ${JSON.stringify(r)}` : `\nInspection : aucun élément « ${selector} ».`
}

async function run(win: BrowserWindow | null, p: CaptureParams): Promise<CaptureResult> {
  if (p.mode === 'current') {
    if (!win || win.isDestroyed()) return { ok: false, info: 'La fenêtre Canopy n’est pas ouverte.' }
    if (win.isMinimized()) return { ok: false, info: 'La fenêtre Canopy est réduite : impossible de la copier.' }
    const shot = await shoot(win.webContents, p.selector)
    if ('error' in shot) return { ok: false, info: shot.error! }
    return { ok: true, image: shot.image, info: `Copie de la fenêtre de l’utilisateur (${shot.size}).${await inspect(win.webContents, p.inspect)}` }
  }

  const width = p.width ?? 1440
  const height = p.height ?? 900
  const cap = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      offscreen: true,
      backgroundThrottling: false
    }
  })
  const step = (m: string) => console.log('[atelier] capture ·', m)
  try {
    const wc = cap.webContents
    step('fenêtre créée')
    const query: Record<string, string> = { capture: '1', view: p.view ?? 'session' }
    if (p.sessionId) query.session = p.sessionId
    if (p.theme) query.theme = p.theme
    if (p.panels) query.panels = p.panels
    if (p.tab) query.tab = p.tab
    if (process.env['ELECTRON_RENDERER_URL']) await cap.loadURL(`${process.env['ELECTRON_RENDERER_URL']}?${new URLSearchParams(query)}`)
    else await cap.loadFile(join(__dirname, '../renderer/index.html'), { query })
    step('page chargée')
    await wc.executeJavaScript(READY_JS)
    step('vue prête')
    const shot = await shoot(wc, p.selector)
    if ('error' in shot) return { ok: false, info: shot.error! }
    const what = `${p.view ?? 'session'}${p.sessionId ? ` ${p.sessionId}` : ''}, ${width}×${height}, thème ${p.theme ?? 'système'}`
    return { ok: true, image: shot.image, info: `Rendu hors écran : ${what} (image ${shot.size}).${await inspect(wc, p.inspect)}` }
  } finally {
    cap.destroy()
  }
}

/** Une capture à la fois (les fenêtres hors écran coûtent de la mémoire). */
export function capture(win: BrowserWindow | null, p: CaptureParams): Promise<CaptureResult> {
  const limit = new Promise<CaptureResult>((res) => setTimeout(() => res({ ok: false, info: 'Capture trop longue (15 s), abandonnée.' }), 15_000))
  const next = busy.then(() => Promise.race([run(win, p), limit])).catch((err) => ({ ok: false, info: `Échec de la capture : ${String(err?.message ?? err)}` }))
  busy = next.then(() => undefined)
  return next
}
