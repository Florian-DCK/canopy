import { Icon } from './icons'
import { useEffect, useRef, useState } from 'react'
import type { Quota } from '../../shared/types'
import { useStore } from './store'

const WINDOW_MS = 5 * 3600_000

export const hhmm = (t: number) =>
  new Date(Math.round(t / 60000) * 60000).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
const dayHour = (t: number) => new Date(t).toLocaleDateString('fr-BE', { weekday: 'long' }) + ' ' + hhmm(t)
const pctOf = (v: number | null | undefined) => (v == null ? null : Math.max(0, Math.min(100, Math.round(v))))

export type Projection = {
  start: number
  reset: number
  pct: number
  /** %/ms */
  rate: number
  /** Heure estimée d'atteinte des 100 %, ou null si pas avant le reset. */
  hit: number | null
  /** % estimé au reset si la limite n'est pas atteinte avant. */
  atReset: number
}

/**
 * Rythme : pente des relevés des 45 dernières minutes (si ≥ 10 min de recul),
 * sinon moyenne depuis le début de la fenêtre.
 */
export function project(q: Quota, now = Date.now()): Projection | null {
  const pct = q.five?.pct
  const reset = q.five?.resetsAt
  if (pct == null || !reset) return null
  const start = reset - WINDOW_MS
  const recent = (q.fiveSamples ?? []).filter((s) => s.t >= now - 45 * 60_000)
  let rate = 0
  const span = recent.length >= 2 ? recent.at(-1)!.t - recent[0].t : 0
  if (span >= 10 * 60_000) rate = (recent.at(-1)!.pct - recent[0].pct) / span
  else if (now > start) rate = pct / (now - start)
  rate = Math.max(0, rate)
  const hitAt = rate > 0 ? now + (100 - pct) / rate : Infinity
  const hit = hitAt < reset ? hitAt : null
  return { start, reset, pct, rate, hit, atReset: Math.min(100, pct + rate * Math.max(0, reset - now)) }
}

function Ring({ r, pct, color, width }: { r: number; pct: number | null; color: string; width: number }) {
  const c = 2 * Math.PI * r
  const size = (r + width) * 2
  return (
    <>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--g200)" strokeWidth={width} />
      {pct ? (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={`${(c * pct) / 100} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      ) : null}
    </>
  )
}

/** Barre d'état : deux anneaux concentriques (5 h dehors, semaine dedans). */
function Rings({ five, week, warn }: { five: number | null; week: number | null; warn: boolean }) {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
      <Ring r={12.5} width={3} pct={five} color={warn ? 'var(--clay)' : 'var(--gauge)'} />
      <g transform="translate(5.5 5.5)">
        <Ring r={7} width={3} pct={week} color="var(--gauge-2)" />
      </g>
    </svg>
  )
}

function Chart({ q, p }: { q: Quota; p: Projection }) {
  const now = Math.min(Date.now(), p.reset)
  const X = (t: number) => 10 + ((t - p.start) / (p.reset - p.start)) * 380
  const Y = (v: number) => 10 + ((100 - v) / 100) * 120
  const pts = (q.fiveSamples ?? []).filter((s) => s.t >= p.start)
  const end = p.hit ? { t: p.hit, v: 100 } : { t: p.reset, v: p.atReset }
  const warn = p.hit !== null
  return (
    <figure style={{ margin: 0 }}>
      <svg
        width="100%"
        viewBox="0 0 400 140"
        role="img"
        aria-label={`Fenêtre de 5 h de ${hhmm(p.start)} à ${hhmm(p.reset)} : ${p.pct} % utilisés${warn ? `, limite estimée vers ${hhmm(p.hit!)}` : ''}`}
      >
        <line x1="10" y1="10" x2="390" y2="10" stroke="var(--line-strong)" strokeDasharray="3 3" />
        <line x1="10" y1="130" x2="390" y2="130" stroke="var(--line)" />
        <line x1={X(now)} y1="10" x2={X(now)} y2="130" stroke="var(--g550)" strokeWidth="1" />
        <text x="12" y="22" fontSize="10" fill="var(--g550)">limite</text>
        <text
          x={X(now) > 300 ? X(now) - 6 : X(now) + 6}
          y="126"
          fontSize="10"
          fill="var(--g550)"
          textAnchor={X(now) > 300 ? 'end' : 'start'}
        >
          maintenant · {hhmm(Date.now())}
        </text>
        {pts.length > 1 && (
          <polyline
            points={pts.map((s) => `${X(s.t).toFixed(1)},${Y(s.pct).toFixed(1)}`).join(' ')}
            fill="none"
            stroke="var(--gauge)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        <line
          x1={X(now)}
          y1={Y(p.pct)}
          x2={X(end.t)}
          y2={Y(end.v)}
          stroke={warn ? 'var(--clay-text)' : 'var(--g400)'}
          strokeWidth="2"
          strokeDasharray="5 4"
          strokeLinecap="round"
        />
        <circle cx={X(now)} cy={Y(p.pct)} r="4" fill="var(--gauge)" stroke="var(--white)" strokeWidth="2" />
        {warn && <circle cx={X(end.t)} cy={Y(100)} r="4" fill="var(--clay-text)" stroke="var(--white)" strokeWidth="2" />}
      </svg>
      <figcaption className="small muted" style={{ display: 'flex', padding: '0 10px' }}>
        <span style={{ flex: 1 }}>{hhmm(p.start)}</span>
        <span>{hhmm(p.reset)} reset</span>
      </figcaption>
    </figure>
  )
}

function Detail({ q, onClose, up = false }: { q: Quota; onClose: () => void; up?: boolean }) {
  const p = project(q)
  const five = pctOf(q.five?.pct)
  const week = pctOf(q.week?.pct)
  const models = (q.models ?? []).filter((m) => m.pct != null)
  const fewSamples = (q.fiveSamples ?? []).length < 3
  return (
    <div className={`usage-pop ${up ? 'up' : ''}`} role="dialog" aria-label="Usage de l’abonnement">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="h2" style={{ fontSize: 18 }}>Fenêtre 5 h</span>
        <span style={{ flex: 1 }} />
        <b style={{ fontSize: 16 }}>{five ?? '—'} %</b>
        <button type="button" className="btn ghost sm" aria-label="Fermer" onClick={onClose} style={{ marginLeft: 6 }}>✕</button>
      </div>
      {p ? (
        <>
          <span style={{ fontSize: 13, lineHeight: 1.45, color: 'var(--g600)' }}>
            {p.hit ? (
              <>
                À ce rythme, tu atteins la limite vers <b style={{ color: 'var(--clay-text)' }}>{hhmm(p.hit)}</b>, soit{' '}
                {Math.round((p.reset - p.hit) / 60000)} min avant le reset.
              </>
            ) : (
              <>Dans le rythme : environ {Math.round(p.atReset)} % au reset de {hhmm(p.reset)}.</>
            )}
            {fewSamples && ' Estimation sur la moyenne depuis le début de la fenêtre, la courbe se remplit au fil des minutes.'}
          </span>
          <Chart q={q} p={p} />
          <div className="small" style={{ display: 'flex', gap: 16, color: 'var(--g600)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 14, height: 2, background: 'var(--gauge)' }} />Consommé</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 14, borderTop: `2px dashed ${p.hit ? 'var(--clay-text)' : 'var(--g400)'}` }} />Projection</span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span aria-hidden="true" style={{ width: 14, borderTop: '1px dashed var(--line-strong)' }} />Limite</span>
          </div>
        </>
      ) : (
        <span className="muted">Données d’usage indisponibles pour l’instant.</span>
      )}
      <div className="small" style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 10, borderTop: '0.5px solid var(--line)', color: 'var(--g600)' }}>
        <span style={{ display: 'flex' }}>
          <span style={{ flex: 1 }}>Semaine</span>
          <b style={{ color: 'var(--slate)' }}>{week ?? '—'} %</b>
          {q.week?.resetsAt && <span style={{ marginLeft: 8 }}>· reset {dayHour(q.week.resetsAt)}</span>}
        </span>
        {models.map((m) => (
          <span key={m.name} style={{ display: 'flex' }}>
            <span style={{ flex: 1 }}>{m.name} · semaine</span>
            <b style={{ color: 'var(--slate)' }}>{pctOf(m.pct)} %</b>
          </span>
        ))}
        {q.extra?.enabled && (
          <span>
            Crédits d’usage activés · {((q.extra.used ?? 0) / 100).toLocaleString('fr-BE', { minimumFractionDigits: 2 })} {q.extra.currency === 'EUR' ? '€' : q.extra.currency ?? ''} utilisés
          </span>
        )}
        {q.updatedAt && <span className="muted">Mis à jour à {hhmm(q.updatedAt)} · données de /usage</span>}
      </div>
    </div>
  )
}

/** Puce compacte de la zone de saisie : anneau 5 h + pourcentage ; clic = détail (ouvert vers le haut). */
export function UsageChip({ down = false }: { down?: boolean } = {}) {
  const q = useStore((s) => s.quota)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const five = pctOf(q.five?.pct)
  const week = pctOf(q.week?.pct)
  const p = project(q)
  const warn = !!p?.hit || q.status === 'allowed_warning' || q.status === 'rejected'
  const label = `Usage : 5 h ${five ?? '—'} %, semaine ${week ?? '—'} %${p?.hit ? `, limite estimée vers ${hhmm(p.hit)}` : ''}`
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className={`cmp-usage ${warn ? 'warn' : ''}`} aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen(!open)}>
        <Icon name="quota" size={16} />
        {five ?? '—'} %
      </button>
      {open && <Detail q={q} onClose={() => setOpen(false)} up={!down} />}
    </div>
  )
}
