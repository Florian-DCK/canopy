// Preload du <webview> du navigateur intégré (partition BROWSER_PARTITION) : surcouche « Pointer »
// (survol inspecteur, remarques, épingles) et exécution des actions de Claude sur le DOM.
// Preload sandboxé : seul 'electron' est importé au runtime (le reste est regroupé par le bundler).
import { ipcRenderer } from 'electron'
import {
  FROM_PAGE,
  TO_PAGE,
  type PageReply,
  type PageRequest,
  type PickedElement,
  type Rect,
  type RemarkState
} from '../shared/browser'

type Mode = 'off' | 'point'
type Pin = { n: number; state: RemarkState; selector: string; text: string }
const STATE_LABEL: Record<RemarkState, string> = { new: 'Nouvelle', sent: 'Envoyée à Claude', work: 'En cours', done: 'Corrigée' }

const BLUE = '#5B9BE6'
const PIN_COLORS: Record<RemarkState, string> = { new: BLUE, sent: '#F5F4EE', work: '#E5B567', done: '#8FC47A' }
const SANS = "'Inter Variable','Segoe UI',system-ui,sans-serif"
const MONO = "'JetBrains Mono',Consolas,monospace"

const SHEET = `
:host{all:initial}
*{box-sizing:border-box}
.root{position:fixed;inset:0;pointer-events:none;font-family:${SANS};font-size:12px;color:#E3E1D8}
.frame{position:fixed;display:none;border:2px solid ${BLUE};background:rgba(91,155,230,0.08);border-radius:2px}
.flash{position:fixed;display:none;border:2px solid ${BLUE};background:rgba(91,155,230,0.18);border-radius:2px}
.tag{position:fixed;display:none;background:${BLUE};color:#141413;font:600 11px ${MONO};padding:2px 6px;border-radius:4px;white-space:nowrap}
.card,.bubble{position:fixed;display:none;background:rgba(26,25,24,0.97);border:1px solid rgba(227,225,216,0.16);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,0.45)}
.card{width:250px;padding:10px 12px}
.row{display:flex;justify-content:space-between;gap:10px;margin:3px 0;line-height:1.4}
.k{color:rgba(227,225,216,0.55);flex:none}
.v{text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.mono{font-family:${MONO};font-size:11px}
.sw{display:inline-block;width:10px;height:10px;border-radius:3px;border:1px solid rgba(227,225,216,0.4);margin-right:5px;vertical-align:-1px}
.bad{color:#E5736B}
.hint{margin-top:8px;padding-top:6px;border-top:1px solid rgba(227,225,216,0.12);color:rgba(227,225,216,0.55);font-size:11px}
.bubble{width:300px;padding:10px;pointer-events:auto}
.bh{font:11px ${MONO};color:${BLUE};margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
textarea{width:100%;height:76px;resize:none;background:rgba(227,225,216,0.06);color:#E3E1D8;border:1px solid rgba(227,225,216,0.18);border-radius:6px;padding:7px 8px;font:13px ${SANS};outline:none}
textarea:focus{border-color:${BLUE}}
.btns{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
button{font:600 12px ${SANS};border-radius:6px;padding:5px 12px;cursor:pointer;border:1px solid rgba(227,225,216,0.18);background:transparent;color:#E3E1D8}
button.go{background:${BLUE};border-color:${BLUE};color:#141413}
.pin{position:fixed;display:none;width:22px;height:22px;border-radius:11px 11px 11px 3px;color:#141413;font:700 11px ${SANS};align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.35);pointer-events:auto;cursor:pointer;transition:transform .12s}
.pin:hover{transform:scale(1.12)}
.pcard{position:fixed;display:none;width:260px;padding:10px 12px;pointer-events:auto;background:rgba(26,25,24,0.97);border:1px solid rgba(227,225,216,0.16);border-radius:10px;box-shadow:0 8px 28px rgba(0,0,0,0.45)}
.ph{display:flex;align-items:center;gap:8px;font-size:11px;color:rgba(227,225,216,0.6);margin-bottom:6px}
.pdot{width:8px;height:8px;border-radius:50%}
.pt{font-size:13px;line-height:1.45;color:#F5F4EE;white-space:pre-wrap;overflow-wrap:anywhere}
.pcard .btns{margin-top:10px}
`

let mode: Mode = 'off'
let pins: Pin[] = []
let host: HTMLElement
let frame: HTMLDivElement
let flash: HTMLDivElement
let tag: HTMLDivElement
let card: HTMLDivElement
let bubble: HTMLDivElement
let pinLayer: HTMLDivElement
let pinCard: HTMLDivElement
let pinOpen: number | null = null
let hovered: Element | null = null
let locked: Element | null = null // élément figé pendant la saisie
let ready = false

// ---------- utilitaires ----------
function h<K extends keyof HTMLElementTagNameMap>(tagName: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tagName)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

function place(box: HTMLElement, r: DOMRect, preferSide: boolean): void {
  box.style.display = 'block'
  const w = box.offsetWidth
  const bh = box.offsetHeight
  const vw = window.innerWidth
  const vh = window.innerHeight
  let x: number
  let y: number
  if (preferSide && r.right + 10 + w <= vw) {
    x = r.right + 10
    y = r.top
  } else if (preferSide && r.left - 10 - w >= 0) {
    x = r.left - 10 - w
    y = r.top
  } else {
    x = r.left
    y = r.bottom + 8
    if (y + bh > vh) y = r.top - 8 - bh
  }
  box.style.left = Math.max(4, Math.min(x, vw - w - 4)) + 'px'
  box.style.top = Math.max(4, Math.min(y, vh - bh - 4)) + 'px'
}

const isOverlay = (t: EventTarget | null): boolean => t === host

function generated(c: string): boolean {
  return /\d{3,}|__/.test(c)
}

function part(el: Element): string {
  const classes = Array.from(el.classList).filter((c) => !generated(c)).slice(0, 2)
  let s = el.tagName.toLowerCase() + classes.map((c) => '.' + CSS.escape(c)).join('')
  const parent = el.parentElement
  if (parent) {
    const same = Array.from(parent.children).filter((c) => c.tagName === el.tagName)
    if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`
  }
  return s
}

function unique(sel: string, el: Element): boolean {
  try {
    const all = document.querySelectorAll(sel)
    return all.length === 1 && all[0] === el
  } catch {
    return false
  }
}

function selectorOf(el: Element): string {
  if (el.id && unique('#' + CSS.escape(el.id), el)) return '#' + CSS.escape(el.id)
  const parts: string[] = []
  let cur: Element | null = el
  for (let i = 0; i < 4 && cur && cur !== document.documentElement; i++) {
    if (cur.id && unique('#' + CSS.escape(cur.id), cur)) {
      parts.unshift('#' + CSS.escape(cur.id))
      break
    }
    parts.unshift(part(cur))
    if (unique(parts.join(' > '), el)) break
    cur = cur.parentElement
  }
  return parts.join(' > ')
}

function labelOf(el: Element): string {
  const c = Array.from(el.classList).find((x) => !generated(x))
  return el.tagName.toLowerCase() + (c ? '.' + c : '')
}

type RGBA = [number, number, number, number]
function parseColor(s: string): RGBA | null {
  if (!s.startsWith('rgb')) return null
  const n = s.match(/[\d.]+/g)?.map(Number)
  if (!n || n.length < 3) return null
  return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1]
}
const hex = (c: RGBA | null): string =>
  c ? '#' + [c[0], c[1], c[2]].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase() : '—'

/** Premier fond non transparent en remontant (chaîne vide si aucun). */
function backgroundOf(el: Element): string {
  for (let cur: Element | null = el; cur; cur = cur.parentElement) {
    const bg = getComputedStyle(cur).backgroundColor
    const c = parseColor(bg)
    if (c && c[3] > 0) return bg
  }
  return ''
}

function lum(c: RGBA): number {
  const [r, g, b] = [c[0], c[1], c[2]].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(fg: RGBA, bg: RGBA): number {
  const over = (a: RGBA, b: RGBA): RGBA => {
    const al = a[3]
    return [a[0] * al + b[0] * (1 - al), a[1] * al + b[1] * (1 - al), a[2] * al + b[2] * (1 - al), 1]
  }
  const back = over(bg, [255, 255, 255, 1])
  const front = over(fg, back)
  const l1 = lum(front)
  const l2 = lum(back)
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

const rectOf = (el: Element): Rect => {
  const r = el.getBoundingClientRect()
  return { x: r.x, y: r.y, width: r.width, height: r.height }
}

function pick(el: Element): PickedElement {
  const cs = getComputedStyle(el)
  const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 120)
  return {
    selector: selectorOf(el),
    label: labelOf(el),
    text,
    rect: rectOf(el),
    styles: {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      color: cs.color,
      backgroundColor: backgroundOf(el) || 'transparent',
      border: cs.border,
      padding: cs.padding,
      margin: cs.margin,
      borderRadius: cs.borderRadius,
      display: cs.display,
      gap: cs.gap
    },
    url: location.href,
    viewport: { width: window.innerWidth, height: window.innerHeight }
  }
}

function query(selector: string): Element | null {
  try {
    return document.querySelector(selector)
  } catch {
    return null
  }
}

// ---------- surcouche ----------
function build(): void {
  host = document.createElement('atelier-overlay')
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
  const root = host.attachShadow({ mode: 'closed' })
  // Une balise <style> dans le shadow DOM : adoptedStyleSheets « réussit » depuis le monde isolé du preload
  // sans rien appliquer (surcouche invisible). Les CSP de la page ne s'appliquent pas aux scripts du preload.
  const st = document.createElement('style')
  st.textContent = SHEET
  root.appendChild(st)
  const wrap = h('div', 'root')
  frame = h('div', 'frame')
  flash = h('div', 'flash')
  tag = h('div', 'tag')
  card = h('div', 'card')
  bubble = h('div', 'bubble')
  pinLayer = h('div')
  pinCard = h('div', 'pcard')
  wrap.append(pinLayer, flash, frame, tag, card, bubble, pinCard)
  root.appendChild(wrap)
  document.documentElement.appendChild(host)
}

function boxAt(box: HTMLElement, r: DOMRect): void {
  box.style.display = 'block'
  box.style.left = r.left - 2 + 'px'
  box.style.top = r.top - 2 + 'px'
  box.style.width = r.width + 4 + 'px'
  box.style.height = r.height + 4 + 'px'
}

function hideHover(): void {
  frame.style.display = 'none'
  tag.style.display = 'none'
  card.style.display = 'none'
}

function row(k: string, v: string | HTMLElement, cls = ''): HTMLElement {
  const r = h('div', 'row')
  const vv = h('span', 'v ' + cls)
  if (typeof v === 'string') vv.textContent = v
  else vv.appendChild(v)
  vv.title = typeof v === 'string' ? v : (v.textContent ?? '')
  r.append(h('span', 'k', k), vv)
  return r
}

function swatch(css: string, label: string): HTMLElement {
  const s = h('span')
  const dot = h('span', 'sw')
  dot.style.background = css
  s.append(dot, label)
  return s
}

function showHover(el: Element): void {
  const r = el.getBoundingClientRect()
  boxAt(frame, r)
  tag.textContent = `${labelOf(el)} · ${Math.round(r.width)} × ${Math.round(r.height)}`
  tag.style.display = 'block'
  tag.style.left = Math.max(2, Math.min(r.left - 2, window.innerWidth - tag.offsetWidth - 2)) + 'px'
  tag.style.top = (r.top - 24 < 2 ? r.bottom + 4 : r.top - 24) + 'px'

  const cs = getComputedStyle(el)
  const fg = parseColor(cs.color)
  const bgStr = backgroundOf(el)
  const bg = parseColor(bgStr)
  const ratio = fg ? contrast(fg, bg ?? [255, 255, 255, 1]) : 0
  const fam = cs.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')
  card.replaceChildren(
    row('Sélecteur', selectorOf(el), 'mono'),
    row('Police', `${fam} · ${cs.fontWeight} · ${cs.fontSize}/${cs.lineHeight}`),
    row('Texte', swatch(cs.color, hex(fg))),
    row('Fond', bg ? swatch(bgStr, hex(bg)) : 'transparent'),
    row('Marges internes', cs.padding),
    ratio
      ? row('Contraste', ratio >= 4.5 ? `${ratio.toFixed(2)} ✓` : ratio.toFixed(2), ratio >= 4.5 ? '' : 'bad')
      : row('Contraste', '—'),
    h('div', 'hint', 'clic = commenter · Maj = traverser')
  )
  place(card, r, true)
}

function closeBubble(): void {
  bubble.style.display = 'none'
  bubble.replaceChildren()
  locked = null
}

function openBubble(el: Element): void {
  locked = el
  hideHover()
  const r = el.getBoundingClientRect()
  boxAt(frame, r)
  const info = pick(el)
  const ta = h('textarea')
  ta.placeholder = 'Ta remarque…'
  const submit = (): void => {
    const text = ta.value.trim()
    if (!text) return
    ipcRenderer.sendToHost(FROM_PAGE.comment, info, text)
    closeBubble()
    frame.style.display = 'none'
  }
  const cancel = h('button', '', 'Annuler')
  cancel.onclick = () => {
    closeBubble()
    frame.style.display = 'none'
  }
  const add = h('button', 'go', 'Ajouter')
  add.onclick = submit
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation()
    if (e.key === 'Enter' && e.ctrlKey) {
      e.preventDefault()
      submit()
    }
  })
  ta.addEventListener('keyup', (e) => e.stopPropagation())
  ta.addEventListener('keypress', (e) => e.stopPropagation())
  bubble.replaceChildren(h('div', 'bh', info.selector), ta, Object.assign(h('div', 'btns'), {}))
  bubble.lastElementChild?.append(cancel, add)
  place(bubble, r, false)
  ta.focus()
}

function setMode(next: Mode, notify: boolean): void {
  if (next === mode) return
  mode = next
  if (mode === 'off') {
    hovered = null
    closeBubble()
    hideHover()
  }
  if (notify) ipcRenderer.sendToHost(FROM_PAGE.mode, mode)
}

function onMove(e: MouseEvent): void {
  if (mode !== 'point' || locked || isOverlay(e.target)) return
  const el = e.target as Element
  if (!(el instanceof Element) || el === hovered) return
  hovered = el
  showHover(el)
}

function onClick(e: MouseEvent): void {
  if (mode !== 'point' || isOverlay(e.target) || e.shiftKey) return
  const el = e.target
  if (!(el instanceof Element)) return
  e.preventDefault()
  e.stopPropagation()
  openBubble(el)
}

// Les autres événements de souris sont bloqués aussi (sinon la page réagit au mousedown/pointerdown).
function onPress(e: Event): void {
  if (mode !== 'point' || isOverlay(e.target) || (e as MouseEvent).shiftKey) return
  e.preventDefault()
  e.stopPropagation()
}

function onKey(e: KeyboardEvent): void {
  if (e.altKey && e.code === 'KeyA') {
    e.preventDefault()
    e.stopPropagation()
    setMode(mode === 'point' ? 'off' : 'point', true)
    return
  }
  if (e.key === 'Escape' && pinOpen !== null) {
    closePinCard()
    return
  }
  if (e.key === 'Escape' && mode === 'point') {
    e.preventDefault()
    e.stopPropagation()
    if (locked) {
      closeBubble()
      frame.style.display = 'none'
    } else setMode('off', true)
  }
}

// ---------- épingles ----------
let pinRaf = 0
function layoutPins(): void {
  pinRaf = 0
  for (const node of Array.from(pinLayer.children) as HTMLElement[]) {
    const el = query(node.dataset.selector ?? '')
    const r = el?.getBoundingClientRect()
    if (!r || (r.width === 0 && r.height === 0)) {
      node.style.display = 'none'
      continue
    }
    node.style.display = 'flex'
    node.style.left = r.left - 8 + 'px'
    node.style.top = r.top - 8 + 'px'
  }
}
function schedulePins(): void {
  if (!pinRaf && ready) pinRaf = requestAnimationFrame(layoutPins)
}

function setPins(list: Pin[]): void {
  pins = list
  pinLayer.replaceChildren(
    ...pins.map((p) => {
      const n = h('div', 'pin', String(p.n))
      n.style.background = PIN_COLORS[p.state] ?? BLUE
      n.dataset.selector = p.selector
      n.title = `${p.n} · ${STATE_LABEL[p.state]} — ${p.text}`
      // Les clics sur l'épingle ne doivent jamais atteindre la page.
      for (const t of ['mousedown', 'pointerdown', 'mouseup', 'pointerup']) n.addEventListener(t, (e) => e.stopPropagation())
      n.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (pinOpen === p.n) closePinCard()
        else openPinCard(p, n)
      })
      return n
    })
  )
  // La carte ouverte suit l'état à jour (ou se ferme si la remarque a disparu).
  const still = pinOpen !== null ? pins.find((p) => p.n === pinOpen) : undefined
  const node = still ? (Array.from(pinLayer.children) as HTMLElement[]).find((x) => x.textContent === String(still.n)) : undefined
  if (still && node) openPinCard(still, node)
  else closePinCard()
  layoutPins()
}

/** Carte d'une épingle : état, texte, Rouvrir / Supprimer. */
function openPinCard(p: Pin, anchor: HTMLElement): void {
  pinOpen = p.n
  const head = h('div', 'ph')
  const dot = h('span', 'pdot')
  dot.style.background = PIN_COLORS[p.state] ?? BLUE
  head.append(dot, document.createTextNode(`Remarque ${p.n} · ${STATE_LABEL[p.state]}`))
  const text = h('div', 'pt', p.text)
  const btns = h('div', 'btns')
  if (p.state !== 'new') {
    const re = h('button', '', 'Rouvrir')
    re.title = 'La remarque redevient « nouvelle », à renvoyer à Claude'
    re.addEventListener('click', (e) => {
      e.stopPropagation()
      ipcRenderer.sendToHost(FROM_PAGE.pin, p.n, 'reopen')
    })
    btns.append(re)
  }
  const del = h('button', '', 'Supprimer')
  del.addEventListener('click', (e) => {
    e.stopPropagation()
    ipcRenderer.sendToHost(FROM_PAGE.pin, p.n, 'delete')
    closePinCard()
  })
  btns.append(del)
  pinCard.replaceChildren(head, text, btns)
  pinCard.style.display = 'block'
  const r = anchor.getBoundingClientRect()
  const w = 260
  const left = Math.min(Math.max(8, r.right + 8), innerWidth - w - 8)
  pinCard.style.left = left + 'px'
  const ph = pinCard.offsetHeight
  pinCard.style.top = Math.min(Math.max(8, r.top), innerHeight - ph - 8) + 'px'
}

function closePinCard(): void {
  pinOpen = null
  if (pinCard) pinCard.style.display = 'none'
}

function flashTo(selector: string): void {
  const el = query(selector)
  if (!el) return
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  const end = performance.now() + 1200
  const tick = (): void => {
    if (performance.now() >= end) {
      flash.style.display = 'none'
      return
    }
    boxAt(flash, el.getBoundingClientRect())
    requestAnimationFrame(tick)
  }
  tick()
}

// ---------- actions de Claude ----------
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    let done = false
    const f = (): void => {
      if (!done) {
        done = true
        resolve()
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(f))
    setTimeout(f, 150)
  })

async function handle(req: PageRequest): Promise<PageReply> {
  if (req.kind === 'read') {
    const base = { ok: true, title: document.title, url: location.href }
    if (!req.selector) return { ...base, text: (document.body?.innerText ?? '').slice(0, 8000) }
    const el = query(req.selector)
    if (!el) return { ok: false, error: `Élément introuvable : ${req.selector}` }
    return { ...base, el: pick(el), text: ((el as HTMLElement).innerText ?? el.textContent ?? '').slice(0, 8000) }
  }
  const el = query(req.selector)
  if (!el) return { ok: false, error: `Élément introuvable : ${req.selector}` }
  el.scrollIntoView({ block: 'center', behavior: 'instant' })
  if (req.kind === 'rect') {
    await settle()
    return { ok: true, rect: rectOf(el) }
  }
  if (req.kind === 'click') {
    await settle()
    const r = el.getBoundingClientRect()
    const init = { bubbles: true, cancelable: true, composed: true, button: 0, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new MouseEvent(type, init))
    return { ok: true }
  }
  const t = el as HTMLElement
  t.focus()
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set
    if (setter) setter.call(el, req.text)
    else el.value = req.text
  } else if (t.isContentEditable) {
    t.textContent = req.text
  } else {
    return { ok: false, error: `Élément non éditable : ${req.selector}` }
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true }
}

// ---------- branchement ----------
ipcRenderer.on(TO_PAGE.mode, (_e, m: Mode) => {
  if (ready) setMode(m === 'point' ? 'point' : 'off', false)
  else mode = m === 'point' ? 'point' : 'off'
})
ipcRenderer.on(TO_PAGE.pins, (_e, list: Pin[]) => {
  if (ready) setPins(list)
  else pins = list
})
ipcRenderer.on(TO_PAGE.scrollTo, (_e, selector: string) => {
  if (ready) flashTo(selector)
})
ipcRenderer.on(TO_PAGE.request, async (_e, reqId: string, req: PageRequest) => {
  let reply: PageReply
  try {
    reply = await handle(req)
  } catch (err) {
    reply = { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  ipcRenderer.sendToHost(FROM_PAGE.reply, reqId, reply)
})

function init(): void {
  build()
  ready = true
  window.addEventListener('mousemove', onMove, true)
  window.addEventListener('click', onClick, true)
  for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'auxclick', 'dblclick']) window.addEventListener(t, onPress, true)
  window.addEventListener('keydown', onKey, true)
  // Clic ailleurs que sur la surcouche : la carte d'épingle se ferme.
  window.addEventListener('mousedown', (e) => {
    if (pinOpen !== null && e.target !== host) closePinCard()
  }, true)
  window.addEventListener('scroll', schedulePins, { capture: true, passive: true })
  window.addEventListener('resize', schedulePins)
  window.addEventListener('scroll', () => {
    if (mode === 'point' && locked) boxAt(frame, locked.getBoundingClientRect())
  }, { capture: true, passive: true })
  setPins(pins)
  ipcRenderer.sendToHost(FROM_PAGE.ready)
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true })
else init()
