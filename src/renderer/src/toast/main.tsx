import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import { StrictMode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { Toast, ToastApi, ToastState } from '../../../shared/types'
import { Icon, type IconName } from '../icons'
import './toast.css'

// Fenêtre des notifications (planche 9) : toujours sombre, posée au-dessus de tout, sans prendre le focus.

const bridge = (window as unknown as { atelierToast: ToastApi }).atelierToast
const DONE_MS = 8000

/** Tintement doux généré (pas de fichier) : deux notes, très bas. */
function chime() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    ;[660, 880].forEach((f, k) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      const t = now + k * 0.12
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.05, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 0.5)
    })
    setTimeout(() => void ctx.close(), 900)
  } catch {
    /* audio indisponible */
  }
}

const ago = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 10) return 'à l’instant'
  if (s < 60) return `il y a ${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `il y a ${m} min` : `il y a ${Math.floor(m / 60)} h`
}

const KIND: Record<Toast['kind'], { icon: IconName; cls: string }> = {
  wait: { icon: 'wait', cls: 'clay' },
  plan: { icon: 'mode-plan', cls: 'clay' },
  question: { icon: 'wait', cls: 'clay' },
  done: { icon: 'done', cls: 'ok' },
  error: { icon: 'error', cls: 'err' }
}

/** `now` ne sert qu'à rafraîchir « il y a … ». */
function Card({ t }: { t: Toast; now: number }) {
  const [menu, setMenu] = useState(false)
  const [hover, setHover] = useState(false)
  const [left, setLeft] = useState(DONE_MS)
  const act = (type: Parameters<ToastApi['action']>[0]['type']) => bridge.action({ type, id: t.id })
  // « Terminé » s'efface seul après 8 s ; le survol met en pause.
  useEffect(() => {
    if (t.kind !== 'done' || hover) return
    const start = Date.now()
    const base = left
    const tick = setInterval(() => {
      const l = base - (Date.now() - start)
      setLeft(l)
      if (l <= 0) {
        clearInterval(tick)
        act('dismiss')
      }
    }, 100)
    return () => clearInterval(tick)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.kind, hover])
  const k = KIND[t.kind]
  return (
    <div className={`card ${t.kind} ${t.pulse ? `pulse-${t.pulse % 2}` : ''}`} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div className="head">
        <span className="tile" style={{ background: t.color }}>{(t.project.match(/\p{L}/u)?.[0] ?? '·').toUpperCase()}</span>
        <span className="proj">{t.project}</span>
        <span className="ago">· {ago(t.at)}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="ib" aria-label="Plus d’options" aria-expanded={menu} title="Plus d’options" onClick={() => setMenu(!menu)}>
          <Icon name="more" size={15} />
        </button>
        <button type="button" className="ib" aria-label="Fermer" title="Fermer" onClick={() => act('dismiss')}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {menu && (
        <div className="menu">
          <button type="button" onClick={() => act('silence')}><Icon name="idle" size={14} />Silence 1 h</button>
          <button type="button" onClick={() => act('mute')}><Icon name="close" size={14} />Couper {t.project}</button>
          <button type="button" onClick={() => act('settings')}><Icon name="more" size={14} />Réglages</button>
        </div>
      )}
      <div className="main">
        <Icon name={k.icon} size={17} className={k.cls} />
        <div className="txt">
          <b>{t.title}</b>
          {t.body && <span className="body">{t.body}</span>}
        </div>
      </div>
      {t.cmd && <code className="cmd">{t.cmd}</code>}
      <div className="acts">
        {t.kind === 'wait' && (
          <>
            <button type="button" className="b clay" onClick={() => act('allow')}>Autoriser</button>
            <button type="button" className="b" onClick={() => act('deny')}>Refuser</button>
            <button type="button" className="b text" onClick={() => act('open')}><Icon name="external" size={14} />Ouvrir</button>
            <span className="keys"><kbd>Ctrl</kbd><kbd>Alt</kbd><kbd>↵</kbd></span>
          </>
        )}
        {t.kind === 'question' && (
          <>
            {t.options?.map((o, k) => (
              <button key={k} type="button" className="b" onClick={() => act(`opt:${k}`)}>{k + 1} · {o}</button>
            ))}
            <button type="button" className={`b ${t.options?.length ? 'text' : 'clay'}`} onClick={() => act('open')}><Icon name="external" size={14} />Ouvrir la question</button>
          </>
        )}
        {t.kind === 'plan' && (
          <>
            <button type="button" className="b light" onClick={() => act('open')}>Lire le plan</button>
            <button type="button" className="b text" onClick={() => act('dismiss')}>Plus tard</button>
          </>
        )}
        {t.kind === 'done' && <button type="button" className="b" onClick={() => act('open')}>Ouvrir</button>}
        {t.kind === 'error' && (
          <>
            <button type="button" className="b light" onClick={() => act('open')}>Reprendre</button>
            <button type="button" className="b text" onClick={() => act('dismiss')}>Fermer</button>
          </>
        )}
      </div>
      {t.kind === 'done' && <span className="timer" style={{ width: `${Math.max(0, (left / DONE_MS) * 100)}%` }} />}
    </div>
  )
}

function App() {
  const [st, setSt] = useState<ToastState>({ toasts: [], sound: true, corner: 'br' })
  const [open, setOpen] = useState(false)
  const [now, setNow] = useState(Date.now())
  const ref = useRef<HTMLDivElement>(null)
  const heard = useRef(new Map<string, number>())

  useEffect(() => {
    const off = bridge.onState((s) => {
      setSt(s)
      // Un son pour une nouvelle attente ou un rappel ; jamais pour « terminé ».
      let ring = false
      for (const t of s.toasts) {
        if (t.kind !== 'wait' && t.kind !== 'plan' && t.kind !== 'question') continue
        const p = t.pulse ?? 0
        if (heard.current.get(t.id) !== p) {
          heard.current.set(t.id, p)
          ring = true
        }
      }
      if (ring && s.sound) chime()
      if (s.toasts.length <= 1) setOpen(false)
    })
    bridge.ready()
    const tick = setInterval(() => setNow(Date.now()), 15_000)
    return () => {
      off()
      clearInterval(tick)
    }
  }, [])

  // La fenêtre épouse la pile : la hauteur part au main à chaque changement.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const send = () => bridge.size(el.getBoundingClientRect().height)
    send()
    const ro = new ResizeObserver(send)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [top, ...rest] = st.toasts
  const waiting = rest.filter((t) => t.kind === 'wait' || t.kind === 'plan' || t.kind === 'question').length
  const bottom = st.corner.startsWith('b')
  const pill = rest.length > 0 && (
    <button type="button" className={`pill ${waiting ? 'clay' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
      <Icon name={waiting ? 'wait' : 'more'} size={13} />
      {open
        ? 'Réduire'
        : waiting
          ? `${waiting} autre${waiting > 1 ? 's' : ''} session${waiting > 1 ? 's' : ''} t’attend${waiting > 1 ? 'ent' : ''}`
          : `${rest.length} autre${rest.length > 1 ? 's' : ''} notification${rest.length > 1 ? 's' : ''}`}
      <Icon name="chevron" size={13} className={open ? 'up' : ''} />
    </button>
  )
  return (
    <div ref={ref} className={`stack ${bottom ? 'from-bottom' : 'from-top'} ${st.corner.endsWith('r') ? 'right' : 'left'}`}>
      {!bottom && pill}
      {top && (
        <div className={`front ${rest.length && !open ? 'has-rest' : ''}`}>
          <Card key={top.id} t={top} now={now} />
          {rest.length > 0 && !open && <span className="ghost g1" />}
          {rest.length > 1 && !open && <span className="ghost g2" />}
        </div>
      )}
      {open && rest.map((t) => <Card key={t.id} t={t} now={now} />)}
      {bottom && pill}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
