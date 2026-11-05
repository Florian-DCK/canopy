import { app, BrowserWindow, screen } from 'electron'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ActParams, CaptureResult } from '../shared/types'
import { captureScreen } from './screen'

// Mode compagnon (planche 33) : Claude agit sur l'écran. scripts/act.ps1 fait le travail (accessibilité Windows, souris,
// clavier) ; ici on montre la main de Claude (fenêtre transparente, les clics la traversent) qui glisse jusqu'à la cible
// avant chaque geste, et on tient le « stop ».

let overlay: BrowserWindow | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null
let stoppedUntil = 0
let last = { x: 0, y: 0 }

/** Rectangle (pixels physiques) d'un élément de la fenêtre active, ou null. */
export async function locate(target: string, kind?: string) {
  const r = await ps({ action: 'locate', target, kind })
  return r.ok && r.rect ? r.rect : null
}

/** « Stop » : plus aucune action pendant quelques secondes, la main disparaît. */
export function stopActing() {
  stoppedUntil = Date.now() + 8000
  overlay?.hide()
}

function ps(payload: object): Promise<{ ok: boolean; text: string; rect?: { x: number; y: number; w: number; h: number } }> {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
  let cmd: string
  let args: string[]
  if (process.platform === 'win32') {
    cmd = 'powershell.exe'
    args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(app.getAppPath(), 'scripts', 'act.ps1'), '-Payload', b64]
  } else if (process.platform === 'darwin') {
    cmd = 'osascript'
    args = ['-l', 'JavaScript', join(app.getAppPath(), 'scripts', 'act-mac.js'), b64]
  } else return Promise.resolve({ ok: false, text: 'Le mode compagnon (agir sur l’écran) n’est pas disponible sur ce système.' })
  return new Promise((resolve) => {
    execFile(cmd, args, { windowsHide: true, timeout: 20_000, maxBuffer: 4 << 20 }, (err, out) => {
      try {
        resolve(JSON.parse(String(out).trim().split('\n').pop() ?? ''))
      } catch {
        resolve({ ok: false, text: `Échec de l'action : ${err?.message ?? String(out).slice(0, 300)}` })
      }
    })
  })
}

const HAND = (() => {
  try {
    return readFileSync(join(app.getAppPath(), 'design', 'cursor', 'hand.svg'), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
  } catch {
    return ''
  }
})()

const PAGE = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;background:transparent;overflow:hidden;font-family:'Segoe UI',system-ui,sans-serif}
#h{position:absolute;left:0;top:0;transition:transform .6s cubic-bezier(.3,.7,.2,1),opacity .25s;opacity:0}
#h svg{display:block;width:44px;height:44px;transform:translate(-6px,-4px);filter:drop-shadow(0 4px 8px rgba(0,0,0,.4));transform-origin:13% 8%}
#h.press svg{animation:press .35s ease-in-out}
@keyframes press{50%{transform:translate(-6px,-3px) scale(.86)}}
#t{position:absolute;left:30px;top:34px;white-space:nowrap;padding:5px 10px;border-radius:9px 9px 9px 3px;background:rgba(26,25,24,.95);border:.5px solid rgba(213,113,81,.6);color:#F5F4EE;font-size:12px;font-weight:500;box-shadow:0 6px 18px rgba(0,0,0,.4)}
.r{position:absolute;left:-16px;top:-16px;width:32px;height:32px;border-radius:50%;border:2px solid #D57151;animation:rip .7s ease-out forwards}
@keyframes rip{from{transform:scale(.4);opacity:1}to{transform:scale(1.9);opacity:0}}
#box{position:absolute;border:3px solid #D57151;border-radius:8px;box-shadow:0 0 0 6px rgba(213,113,81,.22);opacity:0;transition:opacity .25s}
</style><div id="box"></div><div id="h">${HAND.replace(/`/g, '')}<span id="t"></span></div>
<script>
const h=document.getElementById('h'),t=document.getElementById('t'),box=document.getElementById('box');
window.move=(x,y,label)=>{h.style.opacity=1;h.style.transform='translate('+x+'px,'+y+'px)';t.textContent=label};
window.press=()=>{h.classList.remove('press');void h.offsetWidth;h.classList.add('press');const r=document.createElement('span');r.className='r';h.appendChild(r);setTimeout(()=>r.remove(),800)};
window.frame=(r)=>{if(!r){box.style.opacity=0;return}Object.assign(box.style,{left:r.x-4+'px',top:r.y-4+'px',width:r.w+8+'px',height:r.h+8+'px',opacity:1})};
</script>`

/** Fenêtre transparente sur l'écran de la souris : la main de Claude y vit, les clics la traversent. */
function ensureOverlay(): BrowserWindow {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  if (!overlay || overlay.isDestroyed()) {
    overlay = new BrowserWindow({
      ...d.bounds,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true }
    })
    overlay.setAlwaysOnTop(true, 'screen-saver')
    overlay.setIgnoreMouseEvents(true)
    void overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
    last = { x: d.bounds.width - 120, y: d.bounds.height - 120 } // part du coin de la bulle
  } else overlay.setBounds(d.bounds)
  if (hideTimer) clearTimeout(hideTimer)
  if (!overlay.isVisible()) overlay.showInactive()
  return overlay
}

function idleHide() {
  if (hideTimer) clearTimeout(hideTimer)
  hideTimer = setTimeout(() => overlay?.hide(), 2500)
}

const js = (w: BrowserWindow, code: string) => w.webContents.executeJavaScript(code).catch(() => {})
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Rectangle en pixels physiques (accessibilité) → coordonnées de la fenêtre de la main. */
function toOverlay(r: { x: number; y: number; w: number; h: number }) {
  const dip = screen.screenToDipRect(null, { x: r.x, y: r.y, width: r.w, height: r.h })
  const b = overlay!.getBounds()
  return { x: dip.x - b.x, y: dip.y - b.y, w: dip.width, h: dip.height }
}

function labelOf(p: ActParams) {
  if (p.action === 'invoke') return `Clique sur « ${p.target} »`
  if (p.action === 'type') return p.target ? `Écrit dans « ${p.target} »` : 'Écrit'
  if (p.action === 'key') return `Touches ${p.keys}`
  if (p.action === 'click') return 'Clique'
  return 'Regarde'
}

export async function runAct(p: ActParams): Promise<CaptureResult> {
  if (Date.now() < stoppedUntil) return { ok: false, info: "Arrêté à la demande de l'utilisateur : n'agis plus sans qu'il te le redemande." }
  if (p.action === 'find') {
    const r = await ps(p)
    return { ok: r.ok, info: r.text }
  }
  const w = ensureOverlay()
  await wait(80)
  // La main glisse jusqu'à la cible et s'y pose une demi-seconde avant le geste.
  let target: { x: number; y: number; w: number; h: number } | null = null
  if ((p.action === 'invoke' || p.action === 'type') && p.target) {
    const loc = await ps({ ...p, action: 'locate' })
    if (!loc.ok || !loc.rect) {
      idleHide()
      return { ok: false, info: loc.text }
    }
    target = toOverlay(loc.rect)
  } else if (p.action === 'click' && p.x !== undefined && p.y !== undefined) {
    const b = w.getBounds()
    target = { x: p.x - b.x, y: p.y - b.y, w: 0, h: 0 }
  }
  const at = target ? { x: Math.round(target.x + target.w / 2), y: Math.round(target.y + target.h / 2) } : last
  await js(w, `move(${last.x},${last.y},${JSON.stringify(labelOf(p))})`)
  await wait(30)
  await js(w, `move(${at.x},${at.y},${JSON.stringify(labelOf(p))})`)
  if (p.action === 'type' && target) await js(w, `frame(${JSON.stringify(target)})`)
  last = at
  await wait(650)
  if (Date.now() < stoppedUntil) return { ok: false, info: 'Arrêté avant le geste.' }
  if (p.action !== 'type') await js(w, 'press()')
  let r
  if (p.action === 'click') {
    // Coordonnées données en points d'écran (comme la capture) : converties en pixels physiques.
    const phys = screen.dipToScreenPoint({ x: p.x ?? 0, y: p.y ?? 0 })
    r = await ps({ ...p, x: phys.x, y: phys.y })
  } else r = await ps(p)
  await js(w, 'frame(null)')
  idleHide()
  let info = r.text
  let image: string | undefined
  if (r.ok && p.look) {
    await wait(500)
    const shot = await captureScreen('screen')
    image = shot.image
    info += ` Capture après le geste jointe.`
  }
  return { ok: r.ok, info, image }
}
