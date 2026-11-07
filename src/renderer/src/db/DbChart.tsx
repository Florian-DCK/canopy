import { useMemo, useRef, useState, type ReactElement } from 'react'
import type { DbRows } from '../../../shared/types'
import { fmtCell } from './DbMedia'

// Graphique d'un résultat SQL (planche 47) : courbe pour une date, barres pour du texte,
// nuage pour deux nombres. Rendu en SVG ; copiable ou joignable à la session en PNG.

export type Shape = 'line' | 'bar' | 'scatter'
const W = 900
const H = 380
const PAD = { l: 64, r: 20, t: 16, b: 44 }
const ACCENT = '#8fb8e8'

const isNum = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)))
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}(-\d{2})?([ T]\d{2}:\d{2}(:\d{2})?)?/.test(v) && !Number.isNaN(Date.parse(v))

/** Colonnes qu'on peut tracer, et le choix par défaut. */
export function chartable(r: DbRows) {
  const numeric = r.columns.map((_, i) => i).filter((i) => r.rows.length > 0 && r.rows.every((row) => row[i] == null || isNum(row[i])))
  if (!numeric.length || r.rows.length < 2) return null
  const y = numeric.find((i) => i > 0) ?? numeric[0]
  const x = r.columns.findIndex((_, i) => i !== y)
  if (x < 0) return null
  return { numeric, x, y }
}

function autoShape(r: DbRows, x: number): Shape {
  const vals = r.rows.map((row) => row[x])
  if (vals.every((v) => v == null || isDate(v))) return 'line'
  if (vals.every((v) => v == null || isNum(v))) return 'scatter'
  return 'bar'
}

const nice = (n: number) => {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(1e-9, n))))
  return [1, 2, 2.5, 5, 10].map((k) => k * p).find((k) => k >= n) ?? n
}
const fmtN = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} M` : Math.abs(n) >= 1e4 ? `${(n / 1e3).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} k` : n.toLocaleString('fr-BE', { maximumFractionDigits: 2 }))

export function DbChart({ data, onAttach }: { data: DbRows; onAttach?: (dataUrl: string, name: string) => void }) {
  const c = chartable(data)!
  const [x, setX] = useState(c.x)
  const [y, setY] = useState(c.y)
  const [shape, setShape] = useState<Shape>(() => autoShape(data, c.x))
  const svgRef = useRef<SVGSVGElement>(null)
  const [msg, setMsg] = useState('')

  const pts = useMemo(() => {
    const rows = data.rows.filter((r) => r[y] != null).slice(0, shape === 'bar' ? 40 : 2000)
    return rows.map((r) => ({ xv: r[x], yv: Number(r[y]), label: fmtCell(r[x]) }))
  }, [data, x, y, shape])

  const ys = pts.map((p) => p.yv)
  const yMax = nice(Math.max(0, ...ys)) || 1
  const yMin = Math.min(0, ...ys)
  const sy = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - PAD.t - PAD.b)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => yMin + k * (yMax - yMin))

  let body: ReactElement
  if (shape === 'bar') {
    const bw = (W - PAD.l - PAD.r) / Math.max(1, pts.length)
    body = (
      <>
        {pts.map((p, i) => (
          <g key={i}>
            <rect x={PAD.l + i * bw + bw * 0.15} y={sy(Math.max(0, p.yv))} width={bw * 0.7} height={Math.abs(sy(p.yv) - sy(0))} rx={3} fill={ACCENT}>
              <title>{`${p.label} : ${fmtN(p.yv)}`}</title>
            </rect>
            {pts.length <= 16 && (
              <text x={PAD.l + i * bw + bw / 2} y={H - PAD.b + 16} textAnchor="middle" fontSize="11" fill="#a3a198" fontFamily="JetBrains Mono Variable, Consolas, monospace">
                {p.label.length > 12 ? p.label.slice(0, 11) + '…' : p.label}
              </text>
            )}
          </g>
        ))}
      </>
    )
  } else {
    const xsNum = pts.map((p) => (shape === 'line' && isDate(p.xv) ? Date.parse(String(p.xv)) : Number(p.xv)))
    const ordered = shape === 'line' ? pts.map((p, i) => ({ ...p, xn: xsNum[i] })).sort((a, b) => a.xn - b.xn) : pts.map((p, i) => ({ ...p, xn: xsNum[i] }))
    const x0 = Math.min(...ordered.map((p) => p.xn))
    const x1 = Math.max(...ordered.map((p) => p.xn))
    const sx = (v: number) => PAD.l + ((v - x0) / (x1 - x0 || 1)) * (W - PAD.l - PAD.r)
    const line = ordered.map((p) => `${sx(p.xn).toFixed(1)},${sy(p.yv).toFixed(1)}`).join(' ')
    body = (
      <>
        {shape === 'line' && <polyline points={`${sx(x0)},${sy(yMin)} ${line} ${sx(x1)},${sy(yMin)}`} fill="rgba(143,184,232,0.12)" stroke="none" />}
        {shape === 'line' && <polyline points={line} fill="none" stroke={ACCENT} strokeWidth={2.5} strokeLinejoin="round" />}
        {ordered.length <= 200 &&
          ordered.map((p, i) => (
            <circle key={i} cx={sx(p.xn)} cy={sy(p.yv)} r={shape === 'line' ? 3.5 : 4} fill={shape === 'line' ? '#141413' : ACCENT} stroke={ACCENT} strokeWidth={2}>
              <title>{`${p.label} : ${fmtN(p.yv)}`}</title>
            </circle>
          ))}
        <text x={PAD.l} y={H - PAD.b + 18} fontSize="11" fill="#a3a198" fontFamily="JetBrains Mono Variable, Consolas, monospace">{ordered[0]?.label}</text>
        <text x={W - PAD.r} y={H - PAD.b + 18} fontSize="11" fill="#a3a198" textAnchor="end" fontFamily="JetBrains Mono Variable, Consolas, monospace">{ordered[ordered.length - 1]?.label}</text>
      </>
    )
  }

  /** PNG du graphique, sur fond sombre (pour la presse-papiers ou ta saisie). */
  const toPng = async (): Promise<Blob | null> => {
    const svg = svgRef.current
    if (!svg) return null
    const clone = svg.cloneNode(true) as SVGSVGElement
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('width', String(W * 2))
    clone.setAttribute('height', String(H * 2))
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
    const img = new Image()
    await new Promise((ok, ko) => ((img.onload = ok), (img.onerror = ko), (img.src = url)))
    const cv = document.createElement('canvas')
    cv.width = W * 2
    cv.height = H * 2
    const g = cv.getContext('2d')!
    g.fillStyle = '#1a1918'
    g.fillRect(0, 0, cv.width, cv.height)
    g.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
    return new Promise((ok) => cv.toBlob(ok, 'image/png'))
  }
  const copy = async () => {
    const b = await toPng()
    if (!b) return
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
    setMsg('Image copiée.')
    setTimeout(() => setMsg(''), 1500)
  }
  const attach = async () => {
    const b = await toPng()
    if (!b || !onAttach) return
    const r = new FileReader()
    r.onload = () => onAttach(String(r.result), `graphique · ${data.columns[y]} par ${data.columns[x]}.png`)
    r.readAsDataURL(b)
  }

  return (
    <div className="dbv-chart">
      <div className="dbv-chart-stage">
        <span className="small v-soft">{data.columns[y]} par {data.columns[x]}{shape === 'bar' && data.rows.length > 40 ? ' · 40 premières lignes' : ''}</span>
        <svg ref={svgRef} role="img" aria-label={`${data.columns[y]} par ${data.columns[x]}`} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', maxHeight: 460 }}>
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke="rgba(240,238,230,0.08)" />
              <text x={PAD.l - 8} y={sy(t) + 4} fontSize="11" fill="#a3a198" textAnchor="end" fontFamily="JetBrains Mono Variable, Consolas, monospace">{fmtN(t)}</text>
            </g>
          ))}
          {body}
        </svg>
      </div>
      <aside className="dbv-chart-side" aria-label="Réglages du graphique">
        <span className="dbv-cap">Graphique</span>
        <span className="dbv-field-l">Forme</span>
        <div className="v-seg" role="group" aria-label="Forme">
          {(['line', 'bar', 'scatter'] as Shape[]).map((s) => (
            <button key={s} type="button" aria-pressed={shape === s} onClick={() => setShape(s)}>{s === 'line' ? 'Courbe' : s === 'bar' ? 'Barres' : 'Nuage'}</button>
          ))}
        </div>
        <label className="dbv-field-l" htmlFor="dbx">Axe horizontal</label>
        <select id="dbx" className="dbv-select" value={x} onChange={(e) => setX(Number(e.target.value))}>
          {data.columns.map((c, i) => <option key={i} value={i}>{c}</option>)}
        </select>
        <label className="dbv-field-l" htmlFor="dby">Valeur</label>
        <select id="dby" className="dbv-select" value={y} onChange={(e) => setY(Number(e.target.value))}>
          {c.numeric.map((i) => <option key={i} value={i}>{data.columns[i]}</option>)}
        </select>
        <p className="dbv-note">Canopy choisit tout seul : une date → courbe, du texte → barres, deux nombres → nuage.</p>
        <span style={{ flex: 1 }} />
        {msg && <span className="small v-muted">{msg}</span>}
        <button type="button" className="v-btn" onClick={copy}>Copier l’image</button>
        {onAttach && <button type="button" className="v-btn primary" onClick={attach}>Joindre le graphique</button>}
      </aside>
    </div>
  )
}
