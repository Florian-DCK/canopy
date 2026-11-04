import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BROWSER_PARTITION, DEVICE_WIDTH, FROM_PAGE, TO_PAGE, type PageReply, type PickedElement } from '../../../shared/browser'
import { Icon } from '../icons'
import { api, useStore } from '../store'
import * as reg from './registry'
import { useShallow } from 'zustand/react/shallow'
import { useBrowser } from './store'
import './browser.css'

// Hôte des navigateurs intégrés : un webview par session ouverte, monté au niveau de l'app pour survivre
// aux changements de vue (Claude peut l'utiliser même quand tu regardes ailleurs). Visible, il se pose
// sur l'emplacement mesuré par l'onglet ; caché, il reste rendu hors de l'écran à sa taille.

// Caché : dans la fenêtre mais derrière tout et quasi transparent. Hors de l'écran, Chromium cesse de dessiner
// la page et les captures de Claude échouent (UnknownVizError).
const OFF = { left: 0, top: 0, width: 1280, height: 800 }
const NO_REMARKS: never[] = []

function PageView({ sessionId }: { sessionId: string }) {
  const tab = useBrowser((s) => s.tabs[sessionId])!
  const slot = useBrowser((s) => s.slots[sessionId] ?? null)
  const remarks = useBrowser((s) => s.remarks[sessionId] ?? NO_REMARKS)
  const patch = useBrowser((s) => s.patch)
  const addRemark = useBrowser((s) => s.addRemark)
  const ref = useRef<Electron.WebviewTag | null>(null)
  const src = useRef(tab.url) // l'adresse initiale ; ensuite on navigue par loadURL
  const [queue, setQueue] = useState(false)

  // Écouteurs du webview : prêt, remarques, réponses, console, navigation.
  useEffect(() => {
    const wv = ref.current
    if (!wv) return
    reg.register(sessionId, wv)
    const onMsg = (e: Electron.IpcMessageEvent) => {
      if (e.channel === FROM_PAGE.ready) {
        reg.markReady(sessionId)
        const t = useBrowser.getState().tabs[sessionId]
        wv.send(TO_PAGE.mode, t?.mode ?? 'off')
        sendPins()
      } else if (e.channel === FROM_PAGE.mode) patch(sessionId, { mode: e.args[0] })
      else if (e.channel === FROM_PAGE.reply) reg.resolveReply(sessionId, e.args[0], e.args[1] as PageReply)
      else if (e.channel === FROM_PAGE.pin) {
        const [n, action] = e.args as [number, 'reopen' | 'delete']
        const st = useBrowser.getState()
        if (action === 'reopen') st.setRemark(sessionId, n, 'new')
        else {
          const r = st.remarks[sessionId]?.find((x) => x.n === n)
          if (r) st.removeRemark(sessionId, r.id)
        }
      }
      else if (e.channel === FROM_PAGE.comment) {
        const [el, text] = e.args as [PickedElement, string]
        void reg.shot(sessionId, el.rect).then((crop) => {
          addRemark(sessionId, el, text, crop)
        })
      }
    }
    const onConsole = (e: Electron.ConsoleMessageEvent) => {
      reg.pushLog(sessionId, (e as unknown as { level: number | string }).level, e.message)
      const n = reg.entry(sessionId)?.logs.filter((l) => l.level === 'error').length ?? 0
      patch(sessionId, { errors: n })
    }
    const onNav = (e: Electron.DidNavigateEvent) => patch(sessionId, { url: e.url })
    const onStart = () => {
      const r = reg.entry(sessionId)
      if (r) r.ready = false
      reg.clearLogs(sessionId)
      patch(sessionId, { loading: true, errors: 0, failed: undefined })
    }
    const onStop = () => patch(sessionId, { loading: false })
    const onTitle = (e: Electron.PageTitleUpdatedEvent) => patch(sessionId, { title: e.title })
    // Échec de chargement de la page principale : visible dans la console (et pour Claude).
    const onFail = (e: Electron.DidFailLoadEvent) => {
      if (!e.isMainFrame || e.errorCode === -3) return // -3 = navigation remplacée par une autre
      reg.pushLog(sessionId, 'error', `Échec du chargement de ${e.validatedURL} : ${e.errorDescription} (${e.errorCode})`)
      patch(sessionId, { errors: reg.entry(sessionId)?.logs.filter((l) => l.level === 'error').length ?? 1, loading: false, failed: `${e.errorDescription} (${e.errorCode})` })
    }
    wv.addEventListener('ipc-message', onMsg)
    wv.addEventListener('console-message', onConsole)
    wv.addEventListener('did-navigate', onNav)
    wv.addEventListener('did-navigate-in-page', onNav as never)
    wv.addEventListener('did-start-loading', onStart)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('did-fail-load', onFail)
    return () => {
      wv.removeEventListener('ipc-message', onMsg)
      wv.removeEventListener('console-message', onConsole)
      wv.removeEventListener('did-navigate', onNav)
      wv.removeEventListener('did-navigate-in-page', onNav as never)
      wv.removeEventListener('did-start-loading', onStart)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('did-fail-load', onFail)
      reg.unregister(sessionId, wv)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Seules les remarques posées sur la page affichée gardent leur épingle (une navigation sans rechargement compte aussi).
  const sendPins = () => {
    const wv = ref.current
    const st = useBrowser.getState()
    const here = pageKey(st.tabs[sessionId]?.url ?? '')
    const list = (st.remarks[sessionId] ?? []).filter((r) => pageKey(r.el.url) === here)
    if (wv && reg.entry(sessionId)?.ready) wv.send(TO_PAGE.pins, list.map((r) => ({ n: r.n, state: r.state, selector: r.el.selector, text: r.text })))
  }
  useEffect(sendPins, [remarks, tab.url]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (reg.entry(sessionId)?.ready) ref.current?.send(TO_PAGE.mode, tab.mode)
  }, [tab.mode, sessionId])

  // Taille : l'emplacement visible, sinon hors écran ; largeur d'appareil centrée.
  const box = slot ? { left: slot.x, top: slot.y, width: slot.width, height: slot.height } : OFF
  const dw = DEVICE_WIDTH[tab.device]
  const pageW = dw ? Math.min(dw, box.width) : box.width
  const fresh = remarks.filter((r) => r.state === 'new')

  const send = () => {
    if (!fresh.length) return
    const lines = [`Remarques sur ${tab.url} (${tab.device === 'desktop' ? 'bureau' : `${tab.device === 'mobile' ? 'mobile' : 'tablette'}, ${dw} px`}) :`]
    for (const r of fresh) {
      const st = r.el.styles
      lines.push(
        '',
        `${r.n}. « ${r.text} »`,
        `   élément : ${r.el.selector}${r.el.text ? ` · texte « ${r.el.text.slice(0, 80)} »` : ''}`,
        `   styles : ${[st.fontWeight && st.fontSize && `${st.fontWeight} ${st.fontSize}`, st.color && `couleur ${st.color}`, st.backgroundColor && `fond ${st.backgroundColor}`, st.padding && `padding ${st.padding}`, st.border && st.border !== 'none' && `bordure ${st.border}`].filter(Boolean).join(' · ')}`,
        r.crop ? `   capture : remarque-${r.n}.png (jointe)` : ''
      )
    }
    lines.push('', 'Corrige, puis vérifie sur la page avec mcp__atelier__browser : marque chaque remarque « work » en la traitant, puis « done » une fois vérifiée.')
    const attachments = fresh.filter((r) => r.crop).map((r) => ({ dataUrl: r.crop!, name: `remarque-${r.n}.png` }))
    void api.send(sessionId, lines.filter((l) => l !== '').join('\n').replace(/\n(\d+\.)/g, '\n\n$1'), attachments.length ? attachments : undefined)
    for (const r of fresh) useBrowser.getState().setRemark(sessionId, r.n, 'sent')
    // Les remarques corrigées et non rouvertes ont fait leur temps : elles partent à l'envoi suivant.
    const st = useBrowser.getState()
    for (const r of st.remarks[sessionId] ?? []) if (r.state === 'done') st.removeRemark(sessionId, r.id)
  }

  const visible = !!slot
  return (
    <div className={`bh ${visible ? 'on' : 'off'}`} style={{ left: box.left, top: box.top, width: box.width, height: box.height }} aria-hidden={!visible}>
      <div className={`bh-page ${dw ? 'device' : ''}`} style={{ width: pageW }}>
        {createElement('webview', {
          ref,
          src: src.current,
          partition: BROWSER_PARTITION,
          style: { width: '100%', height: '100%', display: 'flex' }
        })}
      </div>
      {visible && tab.failed && (
        <div className="bh-fail" role="alert">
          <Icon name="error" size={22} />
          <b>Impossible de charger {tab.url}</b>
          <span>{tab.failed}</span>
          <button type="button" className="btn sm" onClick={() => ref.current?.reload()}><Icon name="restart" size={14} />Réessayer</button>
        </div>
      )}
      {visible && (
        <FloatingBar box={box}>
          {(min, toggleMin, above) => (
            <>
              {min ? (
                <button type="button" className={`bh-mini ${tab.mode === 'point' ? 'on' : ''}`} title="Afficher la barre d’annotation" onClick={toggleMin}>
                  <Icon name="pointer" size={17} />
                  {fresh.length > 0 && <b className="bh-n">{fresh.length}</b>}
                </button>
              ) : (
                <>
                  <button type="button" className={`bh-b ${tab.mode === 'point' ? 'on' : ''}`} aria-pressed={tab.mode === 'point'} title="Pointer un élément pour le commenter (Alt+A)" onClick={() => patch(sessionId, { mode: tab.mode === 'point' ? 'off' : 'point' })}>
                    <Icon name="pointer" size={16} />Pointer
                  </button>
                  <span className="bh-sep" />
                  <button type="button" className={`bh-b ${queue ? 'on' : ''}`} aria-expanded={queue} onClick={() => setQueue(!queue)} title="Remarques">
                    <Icon name="queue" size={16} />Remarques{remarks.length > 0 && <b className="bh-n">{remarks.length}</b>}
                  </button>
                  <button type="button" className="bh-b send" disabled={!fresh.length} onClick={send} title={fresh.length ? `Envoyer ${fresh.length} remarque${fresh.length > 1 ? 's' : ''} à Claude` : 'Aucune nouvelle remarque'}>
                    <Icon name="send" size={15} />Envoyer à Claude{fresh.length > 0 && ` (${fresh.length})`}
                  </button>
                  <button type="button" className="bh-ib" title="Réduire la barre" aria-label="Réduire la barre" onClick={() => { setQueue(false); toggleMin() }}>
                    <Icon name="chevron" size={15} />
                  </button>
                </>
              )}
              {queue && !min && <Queue sessionId={sessionId} onClose={() => setQueue(false)} above={above} />}
            </>
          )}
        </FloatingBar>
      )}
    </div>
  )
}

/* ---------- Barre d'annotation flottante : déplaçable, réductible, mémorisée ---------- */

const BAR_KEY = 'atelier.browser.bar'
type BarPos = { fx: number; fy: number } | null
const loadBar = (): { pos: BarPos; min: boolean } => {
  try {
    return { pos: null, min: false, ...JSON.parse(localStorage.getItem(BAR_KEY) ?? '{}') }
  } catch {
    return { pos: null, min: false }
  }
}
const saveBar = (v: { pos: BarPos; min: boolean }) => {
  try {
    localStorage.setItem(BAR_KEY, JSON.stringify(v))
  } catch {
    /* stockage indisponible */
  }
}

function FloatingBar({ box, children }: { box: { width: number; height: number }; children: (min: boolean, toggleMin: () => void, above: boolean) => React.ReactNode }) {
  const [st, setSt] = useState(loadBar)
  const ref = useRef<HTMLDivElement>(null)
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [size, setSize] = useState({ w: 420, h: 42 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const m = () => setSize({ w: el.offsetWidth, h: el.offsetHeight })
    m()
    const ro = new ResizeObserver(m)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const M = 10
  const maxX = Math.max(M, box.width - size.w - M)
  const maxY = Math.max(M, box.height - size.h - M)
  const clamp = (v: number, hi: number) => Math.min(hi, Math.max(M, v))
  // Par défaut : en bas au centre. Sinon la position est gardée en fraction de la page (survit aux redimensionnements).
  const left = st.pos ? clamp(st.pos.fx * box.width, maxX) : clamp((box.width - size.w) / 2, maxX)
  const top = st.pos ? clamp(st.pos.fy * box.height, maxY) : maxY - 4
  const set = (v: { pos: BarPos; min: boolean }) => {
    setSt(v)
    saveBar(v)
  }
  return (
    <div ref={ref} className={`bh-float ${st.min ? 'min' : ''}`} style={{ left, top }} role="toolbar" aria-label="Annoter la page">
      <span
        className="bh-grip"
        title="Glisser pour déplacer · double-clic : remettre en bas"
        onDoubleClick={() => set({ ...st, pos: null })}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { dx: e.clientX - left, dy: e.clientY - top }
          setDragging(true)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const x = clamp(e.clientX - drag.current.dx, maxX)
          const y = clamp(e.clientY - drag.current.dy, maxY)
          setSt((s) => ({ ...s, pos: { fx: x / box.width, fy: y / box.height } }))
        }}
        onPointerUp={() => {
          drag.current = null
          setDragging(false)
          setSt((s) => (saveBar(s), s))
        }}
      >
        <svg width="8" height="16" viewBox="0 0 8 16" aria-hidden="true">
          {[3, 8, 13].flatMap((y) => [1.5, 6.5].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" fill="currentColor" />))}
        </svg>
      </span>
      {children(st.min, () => set({ ...st, min: !st.min }), top > box.height / 2)}
      {/* Pendant le glisser, la page (autre processus) ne doit pas capter la souris. */}
      {dragging && <span className="bh-shield" aria-hidden="true" />}
    </div>
  )
}

const STATE_LABEL = { new: 'Nouvelle', sent: 'Envoyée', work: 'En cours', done: 'Corrigée' }

/** Identité d'une page pour les épingles : adresse sans l'ancre (#) ni la barre oblique finale. */
export function pageKey(url: string): string {
  try {
    const u = new URL(url)
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}${u.search}`
  } catch {
    return url
  }
}

/** Fait apparaître l'élément d'une remarque, en changeant de page si elle a été posée ailleurs. */
async function goToRemark(sessionId: string, url: string, selector: string) {
  const e = reg.entry(sessionId)
  if (!e) return
  const cur = useBrowser.getState().tabs[sessionId]?.url ?? ''
  if (pageKey(cur) !== pageKey(url)) {
    useBrowser.getState().patch(sessionId, { url })
    const loaded = reg.untilLoaded(sessionId)
    void e.el.loadURL(url)
    await loaded
    await reg.waitReady(sessionId).catch(() => {})
  }
  reg.entry(sessionId)?.el.send(TO_PAGE.scrollTo, selector)
}

function Queue({ sessionId, onClose, above = true }: { sessionId: string; onClose: () => void; above?: boolean }) {
  const remarks = useBrowser((s) => s.remarks[sessionId] ?? NO_REMARKS)
  const remove = useBrowser((s) => s.removeRemark)
  const setRemark = useBrowser((s) => s.setRemark)
  const here = pageKey(useBrowser((s) => s.tabs[sessionId]?.url ?? ''))
  const list = [...remarks].reverse()
  return (
    <div className={`bh-queue ${above ? 'above' : 'below'}`} role="dialog" aria-label="Remarques">
      <div className="bh-qh">
        <Icon name="queue" size={16} />
        <b>{remarks.length} remarque{remarks.length > 1 ? 's' : ''}</b>
        <span style={{ flex: 1 }} />
        <button type="button" className="bh-ib" aria-label="Fermer" onClick={onClose}><Icon name="close" size={14} /></button>
      </div>
      {!list.length && <p className="bh-empty">Active « Pointer », clique un élément de la page et écris ta remarque.</p>}
      {list.map((r) => (
        <div key={r.id} className="bh-qr" onClick={() => void goToRemark(sessionId, r.el.url, r.el.selector)} role="button" tabIndex={0} title={pageKey(r.el.url) === here ? 'Voir l’élément' : `Aller sur ${r.el.url}`}>
          <span className={`bh-pin ${r.state}`} title={STATE_LABEL[r.state]}>{r.n}</span>
          <span className="bh-qt">
            <span>{r.text}</span>
            <small>{STATE_LABEL[r.state]} · {pageKey(r.el.url) === here ? r.el.selector : `autre page : ${pathOf(r.el.url)}`}</small>
          </span>
          {r.crop && <img src={r.crop} alt="" />}
          <span className="bh-qa" onClick={(e) => e.stopPropagation()}>
            {r.state === 'done' && <button type="button" className="bh-ib" title="À revoir" onClick={() => setRemark(sessionId, r.n, 'new')}><Icon name="restart" size={14} /></button>}
            <button type="button" className="bh-ib" title="Supprimer" onClick={() => remove(sessionId, r.id)}><Icon name="close" size={14} /></button>
          </span>
        </div>
      ))}
    </div>
  )
}

/** Tous les navigateurs ouverts, quelle que soit la vue. */
export function BrowserHost() {
  const ids = useBrowser(useShallow((s) => Object.keys(s.tabs).filter((k) => s.tabs[k])))
  const known = useStore((s) => s.sessions)
  return (
    <>
      {ids.filter((id) => known[id]).map((id) => (
        <PageView key={id} sessionId={id} />
      ))}
    </>
  )
}

const pathOf = (url: string) => {
  try {
    const u = new URL(url)
    return u.pathname + u.search || '/'
  } catch {
    return url
  }
}
