import type { SceneBlock, SceneItem } from '../../../shared/scene'
import type { FileDiff } from '../../../shared/types'
import { Icon } from '../icons'
import { mediaUrl } from '../media'
import type { StageEntry } from './runtime'

// Scène du mode voix (planches 29 et 30) : ce qui s'affiche à droite du soleil.

const CLAY = '#D57151'
const fmt = (v: number, unit?: string) => `${String(Math.round(v * 100) / 100).replace('.', ',')}${unit ? ` ${unit}` : ''}`
const shown = (it: SceneItem, unit?: string) => it.display ?? (it.value !== undefined ? fmt(it.value, unit) : '')

function Bars({ b }: { b: SceneBlock }) {
  const items = b.items ?? []
  const mx = Math.max(...items.map((i) => i.value ?? 0), 1)
  return (
    <div className="sc-card sc-pad sc-bars">
      {items.map((it, k) => (
        <div key={k} className="sc-bar-row">
          <span className="sc-bar-l">{it.label}</span>
          <span className="sc-bar-track"><span className="sc-bar-fill" style={{ width: `${((it.value ?? 0) / mx) * 100}%`, opacity: k === items.length - 1 ? 1 : 0.55 }} /></span>
          <span className="sc-bar-v">{shown(it, b.unit)}</span>
        </div>
      ))}
    </div>
  )
}

function Line({ b }: { b: SceneBlock }) {
  const items = b.items ?? []
  const W = 760
  const H = 300
  const P = 48
  const mx = Math.max(...items.map((i) => i.value ?? 0), 1) * 1.1
  const x = (k: number) => P + (items.length > 1 ? (k * (W - 2 * P)) / (items.length - 1) : (W - 2 * P) / 2)
  const y = (v: number) => H - P - (v / mx) * (H - 2 * P)
  const d = items.map((it, k) => `${k ? 'L' : 'M'} ${x(k)} ${y(it.value ?? 0)}`).join(' ')
  return (
    <div className="sc-card sc-pad">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="sc-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={CLAY} stopOpacity="0.35" />
            <stop offset="1" stopColor={CLAY} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1={P} x2={W - P} y1={H - P} y2={H - P} stroke="rgba(240,238,230,0.12)" />
        {items.length > 1 && <path d={`${d} L ${x(items.length - 1)} ${H - P} L ${x(0)} ${H - P} Z`} fill="url(#sc-area)" />}
        <path d={d} fill="none" stroke={CLAY} strokeWidth="3" strokeLinejoin="round" />
        {items.map((it, k) => (
          <g key={k}>
            <circle cx={x(k)} cy={y(it.value ?? 0)} r="5" fill={CLAY} />
            <text x={x(k)} y={y(it.value ?? 0) - 14} fill="#F0EEE6" fontSize="13" textAnchor="middle">{shown(it, b.unit)}</text>
            <text x={x(k)} y={H - P + 22} fill="#A3A199" fontSize="12" textAnchor="middle">{it.label}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

const DONUT = [CLAY, '#5B9BE6', '#7FB38A', '#C9A227', '#A78BDB', 'rgba(240,238,230,0.25)']
function Donut({ b }: { b: SceneBlock }) {
  const items = b.items ?? []
  const total = items.reduce((n, i) => n + (i.value ?? 0), 0) || 1
  const r = 90
  const c = 2 * Math.PI * r
  let acc = 0
  return (
    <div className="sc-card sc-pad sc-donut">
      <svg viewBox="0 0 240 240" width="240" height="240">
        <circle cx="120" cy="120" r={r} fill="none" stroke="rgba(240,238,230,0.08)" strokeWidth="26" />
        {items.map((it, k) => {
          const len = ((it.value ?? 0) / total) * c
          const el = <circle key={k} cx="120" cy="120" r={r} fill="none" stroke={DONUT[k % DONUT.length]} strokeWidth="26" strokeDasharray={`0 ${acc} ${len} ${c}`} transform="rotate(-90 120 120)" />
          acc += len
          return el
        })}
        {b.center && <text x="120" y="130" fill="#F5F4EE" fontSize="40" textAnchor="middle" fontFamily="var(--serif)">{b.center}</text>}
      </svg>
      <div className="sc-legend">
        {items.map((it, k) => (
          <div key={k} className="sc-legend-row">
            <span className="sc-sw" style={{ background: DONUT[k % DONUT.length] }} />
            {it.label}
            <span style={{ flex: 1 }} />
            <span className="sc-strong">{shown(it, b.unit)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function Kpi({ b }: { b: SceneBlock }) {
  return (
    <div className="sc-kpis">
      {(b.items ?? []).map((it, k) => (
        <div key={k} className="sc-card sc-kpi">
          <span className="sc-big" style={k === 0 ? { color: CLAY } : undefined}>{shown(it, b.unit)}</span>
          <span className="sc-kpi-l">{it.label}</span>
          {it.note && <span className="sc-muted">{it.note}</span>}
        </div>
      ))}
    </div>
  )
}

function BeforeAfter({ b }: { b: SceneBlock }) {
  const [a, z] = b.items ?? []
  const mx = Math.max(a?.value ?? 0, z?.value ?? 0, 1)
  const side = (it: SceneItem | undefined, tag: string, col: string) =>
    it && (
      <div className="sc-ba">
        <span className="sc-tag">{tag}</span>
        <span className="sc-big" style={{ color: col }}>{shown(it, b.unit)}</span>
        {it.value !== undefined && <span className="sc-ba-track"><span style={{ width: `${(it.value / mx) * 100}%`, background: col }} /></span>}
        <span className="sc-muted">{it.note ?? it.label}</span>
      </div>
    )
  return (
    <div className="sc-card sc-pad sc-ba-wrap">
      {side(a, 'Avant', 'rgba(240,238,230,0.5)')}
      <span className="sc-arrow">→</span>
      {side(z, 'Après', CLAY)}
    </div>
  )
}

const DOT: Record<string, string> = { ok: '#7FB38A', done: '#7FB38A', ko: '#E5484D', warn: '#C9A227', work: '#5B9BE6', todo: 'rgba(240,238,230,0.3)' }
function List({ b }: { b: SceneBlock }) {
  return (
    <div className="sc-card sc-rows">
      {(b.items ?? []).map((it, k) => (
        <div key={k} className={`sc-row${it.status === 'ko' ? ' ko' : ''}`}>
          <span className="sc-dot" style={{ background: DOT[it.status ?? 'ok'] }} />
          <span>{it.label}</span>
          <span style={{ flex: 1 }} />
          <span className={it.status === 'ko' ? 'sc-ko' : 'sc-muted'}>{it.note ?? shown(it, b.unit)}</span>
        </div>
      ))}
    </div>
  )
}

function Table({ b }: { b: SceneBlock }) {
  return (
    <div className="sc-card">
      <table className="sc-table">
        {b.columns && (
          <thead>
            <tr>{b.columns.map((c, k) => <th key={k}>{c}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {(b.rows ?? []).map((r, k) => (
            <tr key={k}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Gauge({ b }: { b: SceneBlock }) {
  const max = b.max || 1
  const v = Math.max(0, Math.min(b.value ?? 0, max))
  const r = 100
  const half = Math.PI * r
  const arc = `M ${120 - r} 130 A ${r} ${r} 0 0 1 ${120 + r} 130`
  const col = v / max >= 0.8 ? '#7FB38A' : v / max >= 0.5 ? '#C9A227' : '#E5484D'
  return (
    <div className="sc-card sc-pad sc-gauge">
      <svg viewBox="0 0 240 150" width="280" height="175">
        <path d={arc} fill="none" stroke="rgba(240,238,230,0.08)" strokeWidth="22" strokeLinecap="round" />
        <path d={arc} fill="none" stroke={col} strokeWidth="22" strokeLinecap="round" strokeDasharray={`${(v / max) * half} ${half}`} />
        <text x="120" y="118" fill="#F5F4EE" fontSize="40" textAnchor="middle" fontFamily="var(--serif)">{`${fmt(v)} / ${fmt(max)}`}</text>
        {b.subtitle && <text x="120" y="142" fill="#8F8D86" fontSize="12" textAnchor="middle">{b.subtitle}</text>}
      </svg>
      {!!b.items?.length && (
        <div className="sc-issues">
          <span className="sc-muted">À regarder</span>
          {b.items.map((it, k) => (
            <div key={k} className="sc-issue">
              <span className="sc-dot" style={{ background: DOT[it.status ?? 'ko'] }} />
              <span>{it.label}</span>
              <span style={{ flex: 1 }} />
              <span className="sc-ko">{it.note}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Plan({ b }: { b: SceneBlock }) {
  return (
    <div className="sc-card sc-rows">
      {(b.items ?? []).map((it, k) => (
        <div key={k} className={`sc-row sc-step ${it.status ?? 'todo'}`}>
          <span className="sc-box">{it.status === 'done' && <Icon name="done" size={12} />}</span>
          <span>{it.label}</span>
        </div>
      ))}
    </div>
  )
}

export function SceneView({ b }: { b: SceneBlock }) {
  switch (b.type) {
    case 'bar': return <Bars b={b} />
    case 'line': return <Line b={b} />
    case 'donut': return <Donut b={b} />
    case 'kpi': return <Kpi b={b} />
    case 'before_after': return <BeforeAfter b={b} />
    case 'list': return <List b={b} />
    case 'table': return <Table b={b} />
    case 'gauge': return <Gauge b={b} />
    case 'plan': return <Plan b={b} />
    case 'clear': return null
  }
}

function Diff({ d }: { d: FileDiff }) {
  return (
    <div className="sc-card sc-diff">
      {d.lines.slice(0, 60).map((l, k) => (
        <div key={k} className={`sc-dl ${l.t === '+' ? 'add' : l.t === '-' ? 'del' : ''}`}>
          <span className="sc-dl-s">{l.t === '-' ? '−' : l.t}</span>
          <span className="sc-dl-t">{l.s}</span>
        </div>
      ))}
    </div>
  )
}

/** Titre et précisions sous le bloc. */
export function stageInfo(e: StageEntry): { title: string; meta: string } {
  switch (e.kind) {
    case 'video': return { title: e.media.name, meta: 'Vidéo' }
    case 'image': return { title: e.media.name, meta: `${e.media.source === 'screenshot' ? 'Capture' : e.media.source === 'read' ? 'Fichier lu' : 'Image'}${e.media.width ? ` · ${e.media.width} × ${e.media.height}` : ''}` }
    case 'diff': return { title: e.diff.path.split(/[\\/]/).pop() ?? e.diff.path, meta: `${e.diff.path} · +${e.diff.added} −${e.diff.removed}` }
    case 'artifact': return { title: e.title ?? 'Artefact', meta: 'Artefact claude.ai' }
    case 'scene': return { title: e.block.title, meta: e.block.subtitle ?? '' }
  }
}

export function StageBody({ e }: { e: StageEntry }) {
  switch (e.kind) {
    case 'video': return <video className="sc-img" src={mediaUrl(e.media.id)} controls autoPlay muted playsInline />
    case 'image': return <img className="sc-img" src={mediaUrl(e.media.id)} alt={e.media.name} draggable={false} />
    case 'diff': return <Diff d={e.diff} />
    case 'artifact': return <div className="sc-card sc-pad sc-art"><Icon name="artifact" size={28} /><span>{e.title ?? 'Artefact publié'}</span><span className="sc-muted">{e.url}</span></div>
    case 'scene': return <SceneView b={e.block} />
  }
}
