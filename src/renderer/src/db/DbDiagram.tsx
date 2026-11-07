import { useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import type { DbSummary, DbTable } from '../../../shared/types'
import { fmtN } from './DbMedia'

// Schéma en diagramme (planche 47) : les tables en boîtes, reliées par leurs clés étrangères.
// Disposition automatique en colonnes (les tables référencées à droite), boîtes déplaçables,
// positions gardées par base dans le navigateur de Canopy.

const BW = 220
const HEAD = 34
const ROW = 22
const MAX_COLS = 12
const GAP_X = 110
const GAP_Y = 36

type Pos = Record<string, { x: number; y: number }>
const boxH = (t: DbTable) => HEAD + Math.min(t.columns.length, MAX_COLS) * ROW + (t.columns.length > MAX_COLS ? ROW : 0) + 6

/** Niveau = plus longue chaîne de clés étrangères vers les tables référencées (0 = ne référence rien). */
function autoLayout(s: DbSummary): Pos {
  const by = new Map(s.tables.map((t) => [t.name, t]))
  const level = new Map<string, number>()
  const depth = (n: string, seen: Set<string>): number => {
    if (level.has(n)) return level.get(n)!
    if (seen.has(n)) return 0
    seen.add(n)
    const t = by.get(n)
    const d = t ? Math.max(0, ...t.fks.filter((f) => by.has(f.table) && f.table !== n).map((f) => depth(f.table, seen) + 1)) : 0
    level.set(n, d)
    return d
  }
  s.tables.forEach((t) => depth(t.name, new Set()))
  const max = Math.max(0, ...level.values())
  const cols: string[][] = Array.from({ length: max + 1 }, () => [])
  for (const t of s.tables) cols[max - level.get(t.name)!].push(t.name)
  const pos: Pos = {}
  cols.forEach((names, c) => {
    let y = 24
    for (const n of names) {
      pos[n] = { x: 24 + c * (BW + GAP_X), y }
      y += boxH(by.get(n)!) + GAP_Y
    }
  })
  return pos
}

const storeKey = (path: string) => `canopy.dbdiagram.${path.toLowerCase()}`

export function DbDiagram({ s, path, selected, onSelect }: { s: DbSummary; path: string; selected?: string; onSelect: (t: string) => void }) {
  const base = useMemo(() => autoLayout(s), [s])
  const [pos, setPos] = useState<Pos>(() => {
    try {
      return { ...base, ...(JSON.parse(localStorage.getItem(storeKey(path)) ?? '{}') as Pos) }
    } catch {
      return base
    }
  })
  const drag = useRef<{ n: string; dx: number; dy: number } | null>(null)
  const save = (p: Pos) => {
    try {
      localStorage.setItem(storeKey(path), JSON.stringify(p))
    } catch {
      /* stockage indisponible : la disposition n'est simplement pas gardée */
    }
  }
  const P = (n: string) => pos[n] ?? base[n] ?? { x: 0, y: 0 }

  const links = s.tables.flatMap((t) =>
    t.fks
      .filter((f) => s.tables.some((x) => x.name === f.table))
      .map((f) => {
        const a = P(t.name)
        const b = P(f.table)
        const i = Math.min(t.columns.findIndex((c) => c.name === f.from), MAX_COLS)
        const ay = a.y + HEAD + Math.max(0, i) * ROW + ROW / 2
        const by = b.y + HEAD / 2
        const right = a.x + BW / 2 < b.x + BW / 2
        const ax = right ? a.x + BW : a.x
        const bx = right ? b.x : b.x + BW
        const mid = (ax + bx) / 2
        const on = selected === t.name || selected === f.table
        return { key: `${t.name}.${f.from}`, d: `M${ax},${ay} C${mid},${ay} ${mid},${by} ${bx},${by}`, on }
      })
  )
  const w = Math.max(...s.tables.map((t) => P(t.name).x + BW)) + 40
  const h = Math.max(...s.tables.map((t) => P(t.name).y + boxH(t))) + 40

  const down = (n: string) => (e: RPointerEvent) => {
    const p = P(n)
    drag.current = { n, dx: e.clientX - p.x, dy: e.clientY - p.y }
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
  }
  const move = (e: RPointerEvent) => {
    const d = drag.current
    if (!d) return
    setPos((p) => ({ ...p, [d.n]: { x: Math.max(0, e.clientX - d.dx), y: Math.max(0, e.clientY - d.dy) } }))
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    setPos((p) => (save(p), p))
  }
  const reset = () => {
    setPos(base)
    try {
      localStorage.removeItem(storeKey(path))
    } catch {
      /* rien à faire */
    }
  }

  return (
    <div className="dbv-diagram" onPointerMove={move} onPointerUp={up}>
      <div className="dbv-diagram-canvas" style={{ width: w, height: h }}>
        <svg aria-hidden="true" width={w} height={h} style={{ position: 'absolute', inset: 0 }}>
          {links.map((l) => (
            <path key={l.key} d={l.d} fill="none" stroke={l.on ? '#8fb8e8' : 'rgba(240,238,230,0.2)'} strokeWidth={l.on ? 1.8 : 1.2} />
          ))}
        </svg>
        {s.tables.map((t) => {
          const p = P(t.name)
          const fk = new Set(t.fks.map((f) => f.from))
          return (
            <div key={t.name} className={`dbv-box ${selected === t.name ? 'on' : ''}`} style={{ left: p.x, top: p.y, width: BW }}>
              <button type="button" className="dbv-box-head" onPointerDown={down(t.name)} onClick={() => onSelect(t.name)} aria-pressed={selected === t.name}>
                <span className="mono">{t.name}</span>
                <span className="v-muted">{fmtN(t.count)}</span>
              </button>
              {t.columns.slice(0, MAX_COLS).map((c) => (
                <span key={c.name} className="dbv-box-col mono">
                  <span className={c.pk ? 'pk' : fk.has(c.name) ? 'fk' : ''}>{c.pk ? 'PK' : fk.has(c.name) ? 'FK' : ''}</span>
                  <span className="dbv-box-n">{c.name}</span>
                  <span className="v-muted">{c.type.toLowerCase()}</span>
                </span>
              ))}
              {t.columns.length > MAX_COLS && <span className="dbv-box-col v-muted">+{t.columns.length - MAX_COLS} colonnes</span>}
            </div>
          )
        })}
      </div>
      <div className="dbv-legend">
        <span><b className="pk">PK</b> clé primaire</span>
        <span><b className="fk">FK</b> clé étrangère</span>
        <span>Glisser une table pour la déplacer</span>
        <button type="button" className="v-btn" onClick={reset}>Ranger</button>
      </div>
    </div>
  )
}

/** Schéma au format Mermaid (erDiagram), pour le joindre à la session. */
export function toMermaid(s: DbSummary): string {
  const id = (n: string) => n.replace(/[^\w]/g, '_')
  const lines = ['erDiagram']
  for (const t of s.tables) {
    lines.push(`  ${id(t.name)} {`)
    const fk = new Set(t.fks.map((f) => f.from))
    for (const c of t.columns) lines.push(`    ${(c.type || 'any').replace(/[^\w]/g, '_')} ${id(c.name)}${c.pk ? ' PK' : fk.has(c.name) ? ' FK' : ''}`)
    lines.push('  }')
  }
  for (const t of s.tables) for (const f of t.fks) lines.push(`  ${id(f.table)} ||--o{ ${id(t.name)} : "${f.from}"`)
  return lines.join('\n')
}
