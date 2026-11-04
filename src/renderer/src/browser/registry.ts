import { FROM_PAGE, TO_PAGE, type PageReply, type PageRequest, type Rect } from '../../../shared/browser'

// Webviews vivants du navigateur intégré, par session : requêtes à la page, journal de la console, attente de chargement.

type Log = { level: 'error' | 'warning' | 'info'; text: string; at: number }
type Entry = {
  el: Electron.WebviewTag
  ready: boolean
  logs: Log[]
  pending: Map<string, (r: PageReply) => void>
  waiters: Set<() => void>
}

const entries = new Map<string, Entry>()

export function register(sessionId: string, el: Electron.WebviewTag) {
  const e: Entry = { el, ready: false, logs: [], pending: new Map(), waiters: new Set() }
  entries.set(sessionId, e)
  return e
}

export function unregister(sessionId: string, el: Electron.WebviewTag) {
  if (entries.get(sessionId)?.el === el) entries.delete(sessionId)
}

export const entry = (sessionId: string) => entries.get(sessionId)

export function markReady(sessionId: string) {
  const e = entries.get(sessionId)
  if (!e) return
  e.ready = true
  for (const w of e.waiters) w()
  e.waiters.clear()
}

export function resolveReply(sessionId: string, reqId: string, reply: PageReply) {
  const e = entries.get(sessionId)
  e?.pending.get(reqId)?.(reply)
  e?.pending.delete(reqId)
}

export function pushLog(sessionId: string, level: number | string, text: string) {
  const e = entries.get(sessionId)
  if (!e) return
  const lv = level === 3 || level === 'error' ? 'error' : level === 2 || level === 'warning' ? 'warning' : 'info'
  e.logs.push({ level: lv, text: text.slice(0, 600), at: Date.now() })
  if (e.logs.length > 300) e.logs.splice(0, e.logs.length - 300)
}

export function clearLogs(sessionId: string) {
  const e = entries.get(sessionId)
  if (e) e.logs = []
}

/** Attend que le webview de la session existe et que la surcouche de la page soit prête. */
export async function waitReady(sessionId: string, ms = 15_000): Promise<Entry> {
  const t0 = Date.now()
  for (;;) {
    const e = entries.get(sessionId)
    if (e?.ready) return e
    if (Date.now() - t0 > ms) throw new Error('La page ne répond pas (surcouche non prête).')
    await new Promise<void>((res) => {
      const timer = setTimeout(res, 250)
      e?.waiters.add(() => {
        clearTimeout(timer)
        res()
      })
    })
  }
}

/** Requête à la page (lecture, clic, saisie, rectangle). */
export async function ask(sessionId: string, req: PageRequest, ms = 10_000): Promise<PageReply> {
  const e = await waitReady(sessionId)
  const id = crypto.randomUUID()
  return new Promise<PageReply>((res) => {
    const timer = setTimeout(() => {
      e.pending.delete(id)
      res({ ok: false, error: 'La page n’a pas répondu.' })
    }, ms)
    e.pending.set(id, (r) => {
      clearTimeout(timer)
      res(r)
    })
    e.el.send(TO_PAGE.request, id, req)
  })
}

/** Capture de la page, ou d'un rectangle (coordonnées CSS de la page), en data URL PNG. */
export async function shot(sessionId: string, rect?: Rect, pad = 10): Promise<string | undefined> {
  const e = entries.get(sessionId)
  if (!e) return undefined
  const r = rect
    ? {
        x: Math.max(0, Math.floor(rect.x - pad)),
        y: Math.max(0, Math.floor(rect.y - pad)),
        width: Math.ceil(rect.width + pad * 2),
        height: Math.ceil(rect.height + pad * 2)
      }
    : undefined
  const img = await e.el.capturePage(r)
  return img.isEmpty() ? undefined : img.toDataURL()
}

/** Attend la fin du chargement en cours (ou un délai). */
export function untilLoaded(sessionId: string, ms = 20_000): Promise<void> {
  const e = entries.get(sessionId)
  if (!e) return Promise.resolve()
  return new Promise((res) => {
    const done = () => {
      clearTimeout(timer)
      e.el.removeEventListener('did-stop-loading', done)
      res()
    }
    const timer = setTimeout(done, ms)
    e.el.addEventListener('did-stop-loading', done)
  })
}

export { FROM_PAGE }
