import { useEffect, useRef, useState } from 'react'
import type { CompanionState } from '../../../shared/companion'
import type { ToastApi } from '../../../shared/types'
import { Icon } from '../icons'
import { type MarkState } from '../voice/CanopyMark'
import { Avatar } from '../voice/Avatar'
import '../voice/voice.css'

// Mode compagnon (planche 32) : la bulle, en bas à droite de cette fenêtre ; à sa gauche, une seule ligne
// selon ce qui se passe. Un clic la déplie, un glisser la déplace.

const bridge = (window as unknown as { atelierToast: ToastApi }).atelierToast

const MARK: Record<CompanionState['phase'], MarkState> = { rest: 'rest', listen: 'listen', work: 'think', speak: 'speak', ask: 'rest', done: 'rest', waking: 'intro', error: 'rest' }
const SIZE: Record<CompanionState['phase'], number> = { rest: 64, listen: 84, work: 76, speak: 84, ask: 76, done: 68, waking: 64, error: 64 }

const since = (t: number) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** Texte qui défile tout seul vers le bas quand il grandit (on lit la fin, on peut remonter). */
function ScrollText({ text, className }: { text: string; className: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])
  return <div ref={ref} className={className} data-hit>{text}</div>
}

/** Parle : toute la réponse, la phrase qu'on entend en clair et centrée, le texte défile au rythme de la voix. */
function Karaoke({ lines, current }: { lines: string[]; current: number }) {
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // On ne fait défiler que la bulle (scrollIntoView décalerait toute la fenêtre transparente).
    const b = box.current
    const el = b?.querySelector<HTMLElement>('.k-now')
    if (b && el) b.scrollTo({ top: el.offsetTop - b.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' })
  }, [current, lines.length])
  return (
    <div ref={box} className="c-pill c-said c-karaoke" data-hit>
      {lines.map((l, k) => (
        <span key={k} className={k === current ? 'k-now' : k < current ? 'k-past' : 'k-next'}>{l} </span>
      ))}
    </div>
  )
}

export function Companion({ c }: { c: CompanionState }) {
  const [open, setOpen] = useState(false)
  const [, tick] = useState(0)
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  // Outil écran : un œil argile tant que Claude regarde (3 s), avec la fenêtre concernée.
  const [look, setLook] = useState<string | null>(null)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined
    const off = bridge.onLook((title) => {
      setLook(title)
      clearTimeout(t)
      t = setTimeout(() => setLook(null), 3000)
    })
    return () => {
      off()
      clearTimeout(t)
    }
  }, [])

  // Le chrono de « travaille » avance chaque seconde.
  useEffect(() => {
    if (c.phase !== 'work') return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [c.phase])

  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.screenX, y: e.screenY, moved: false }
    bridge.drag('start', e.screenX, e.screenY)
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (Math.abs(e.screenX - d.x) + Math.abs(e.screenY - d.y) > 4) d.moved = true
    if (d.moved) bridge.drag('move', e.screenX, e.screenY)
  }
  const up = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) bridge.drag('end', e.screenX, e.screenY)
    else setOpen((o) => !o)
  }

  // Personnage : pas de pastille ronde autour, juste lui, plus grand pour qu'on le voie bien.
  const char = !!c.avatar && c.avatar !== 'canopy'
  const size = char ? Math.round(SIZE[c.phase] * 1.5) : SIZE[c.phase]
  // Micro coupé : c'est ce qu'on voit d'abord à côté de la bulle, avec de quoi le réactiver.
  const muteLine = c.micMuted && (c.phase === 'rest' || c.phase === 'listen') ? (
    <div className="c-pill c-muted-mic" data-hit>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" /><path d="M4 4l16 16" /></svg>
      <span className="c-strong">Micro coupé</span>
      <button type="button" onClick={() => bridge.companion('mic')}>Réactiver</button>
    </div>
  ) : null
  const line = muteLine ?? (look !== null ? (
    <div className="c-pill c-look" data-hit>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#D57151" strokeWidth="1.8"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>
      <span className="c-strong">Je regarde ton écran</span>
      {look && <span className="c-muted">{look}</span>}
    </div>
  ) : (() => {
    switch (c.phase) {
      case 'listen':
        return c.text && (
          <div className="c-pill c-you" data-hit>
            <span className="c-tag">Toi</span>
            <span>« {c.text} »</span>
          </div>
        )
      case 'work':
        return (
          <div className="c-pill" data-hit>
            <span className="c-dot" />
            <span className="c-strong">{c.activity?.label ?? 'Travaille'}</span>
            {c.activity && <span className="c-muted">{since(c.activity.since)}</span>}
          </div>
        )
      case 'speak':
        return c.lines?.length ? <Karaoke lines={c.lines} current={c.current ?? -1} /> : c.text && <ScrollText className="c-pill c-said" text={c.text} />
      case 'ask':
        return (
          <div className="c-pill c-ask" data-hit>
            <span className="c-strong">Claude attend ta réponse</span>
            <button type="button" onClick={() => bridge.companion('open')}>Voir</button>
          </div>
        )
      case 'done':
        // Un simple signe : la bulle s'éclaire en vert, une coche, puis le repos.
        return (
          <div className="c-pill c-done" data-hit>
            <span className="c-check">✓</span>
          </div>
        )
      case 'waking':
        return <div className="c-pill c-muted" data-hit>Je me réveille…</div>
      case 'error':
        return <div className="c-pill c-err" data-hit>{c.text || 'Mode voix indisponible'}</div>
      default:
        return null
    }
  })())

  return (
    <div className="c-wrap">
      {c.page && !open && (
        <div className="c-page" data-hit>
          <iframe title={c.page.title} src={c.page.src} sandbox="allow-scripts" style={{ height: c.page.height }} />
        </div>
      )}
      {open && (
        <div className="c-card" data-hit>
          <div className="c-card-head">
            <Avatar kind={c.avatar ?? 'canopy'} state={MARK[c.phase]} size={30} />
            <div className="c-card-title">
              <span className="c-card-project">{c.project ?? 'Canopy'}</span>
              <span className="c-card-session">{c.session ?? 'Aucune session'}</span>
            </div>
            <button type="button" onClick={() => bridge.companion('open')}>Ouvrir Canopy</button>
          </div>
          <div className="c-card-body">
            {c.heard && <div className="c-card-you">{c.heard}</div>}
            {c.said && <div className="c-card-said">{c.said}</div>}
            {!c.heard && !c.said && <div className="c-muted">Parle-moi : je t’écoute.</div>}
          </div>
          <div className="c-card-foot">
            {c.phase === 'speak' && <button type="button" onClick={() => bridge.companion('hush')}><Icon name="stop" size={13} />Couper</button>}
            <span style={{ flex: 1 }} />
            <button type="button" onClick={() => bridge.companion('mic')}>{c.micMuted ? 'Réactiver le micro' : 'Couper le micro'}</button>
            <button type="button" onClick={() => bridge.companion('quit')}><Icon name="close" size={13} />Quitter le compagnon</button>
          </div>
        </div>
      )}
      <div className="c-row">
        {!open && line}
        <div
          className={`c-bubble c-${c.phase}${char ? ' c-char' : ''}${look !== null ? ' c-looking' : ''}${c.micMuted ? ' c-mic-off' : ''}`}
          style={{ width: size, height: size }}
          data-hit
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          title="Clic : déplier · glisser : déplacer"
        >
          <Avatar kind={c.avatar ?? 'canopy'} state={MARK[c.phase]} size={char ? size : Math.round(size * 0.8)} />
        </div>
      </div>
    </div>
  )
}
