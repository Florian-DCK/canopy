import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import type { MediaItem } from '../../../shared/types'
import { Icon } from '../icons'
import { fmtSize } from '../media'
import { api, useStore } from '../store'
import { extOf, fmtDim, fmtInt, snapshot, type Look, type ModelStats, type ViewName } from './model'
import { makeSync, ModelView, type ModelApi } from './ModelView'

const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n > 1 ? many : one}`
const isDark = () => window.matchMedia('(prefers-color-scheme: dark)').matches

/** « 12 480 triangles · 3 matériaux · 1 animation · 2,25 m de haut » */
export function statsLine(s: ModelStats) {
  return [
    plural(s.triangles, 'triangle', 'triangles'),
    plural(s.materials.length, 'matériau', 'matériaux'),
    s.animations.length ? plural(s.animations.length, 'animation', 'animations') : '',
    s.meters ? `${fmtDim(s.size[1])} m de haut` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}

/** Vignette figée d'un modèle (un seul contexte WebGL pour toutes). */
export function ModelSnap({ m, w, h }: { m: MediaItem; w: number; h: number }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    let live = true
    snapshot(m, w, h).then((u) => live && setSrc(u))
    return () => {
      live = false
    }
  }, [m.id, w, h])
  return (
    <span className="model-snap">
      {src ? <img src={src} alt="" draggable={false} /> : <Icon name="cube" size={Math.min(28, h * 0.45)} />}
      {h >= 36 && <span className="model-pill sm">3D</span>}
    </span>
  )
}

/** Carte d'un modèle dans le fil : aperçu qui tourne, qu'on fait pivoter ; double-clic ou « Ouvrir » = visionneuse. */
export function ModelCard({ m, w, h }: { m: MediaItem; w: number; h: number }) {
  const open = useStore((s) => s.openViewer)
  const [stats, setStats] = useState<ModelStats | null>(null)
  const [play, setPlay] = useState(true)
  const openIt = () => open({ sessionId: m.sessionId, mediaId: m.id, mode: 'single' })
  return (
    <div className="media-card model-card" style={{ width: w }}>
      <div className="model-stage" style={{ height: h }}>
        <ModelView m={m} theme={isDark() ? 'dark' : 'light'} autoRotate play={play} grid onReady={setStats} onDoubleClick={openIt} style={{ width: '100%', height: '100%' }} />
        <span className="model-pill">
          <Icon name="cube" size={13} />
          3D · {extOf(m.name).toUpperCase()}
        </span>
        {!!stats?.animations.length && (
          <button type="button" className="model-anim" aria-pressed={play} onClick={() => setPlay(!play)}>
            {play ? '❚❚' : '▶'} {stats.animations[0].name}
          </button>
        )}
        <span className="model-hint">Glisser pour tourner · double-clic pour ouvrir</span>
      </div>
      <div className="model-meta">
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
          <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.path}>
            {m.name} <span className="muted" style={{ fontFamily: 'inherit' }}>· {fmtSize(m.size)}</span>
          </span>
          <span className="muted small">{stats ? statsLine(stats) : ' '}</span>
        </span>
        <button type="button" className="btn ghost sm" onClick={() => api.openMedia(m.id)}>Ouvrir avec…</button>
        <button type="button" className="btn primary sm" onClick={openIt}>Ouvrir</button>
      </div>
    </div>
  )
}

const LOOKS: [Look, string][] = [
  ['rendu', 'Rendu'],
  ['argile', 'Argile'],
  ['fil', 'Fil de fer'],
  ['normales', 'Normales']
]

/** Sélecteur de rendu (barre de la visionneuse). */
export function LookSeg({ look, setLook }: { look: Look; setLook: (l: Look) => void }) {
  return (
    <div className="v-seg" role="group" aria-label="Rendu">
      {LOOKS.map(([k, l]) => (
        <button key={k} type="button" aria-pressed={look === k} onClick={() => setLook(k)}>{l}</button>
      ))}
    </div>
  )
}

const VIEW_BTNS: [ViewName, string][] = [
  ['face', 'Face'],
  ['cote', 'Côté'],
  ['dessus', 'Dessus'],
  ['troisQuarts', '3⁄4']
]

/** Scène de la visionneuse pour un modèle : vue seule (outils, animation, panneau Scène) ou comparaison A/B. */
export function ModelStage({ m, other, look, apiRef, onStats }: { m: MediaItem; other?: MediaItem; look: Look; apiRef: MutableRefObject<ModelApi | null>; onStats: (s: ModelStats) => void }) {
  const [grid, setGrid] = useState(true)
  const [axes, setAxes] = useState(true)
  const [dims, setDims] = useState(false)
  const [auto, setAuto] = useState(false)
  const [play, setPlay] = useState(true)
  const [panel, setPanel] = useState(true)
  const [sel, setSel] = useState<string | null>(null)
  const [hidden, setHidden] = useState<Record<string, boolean>>({})
  const [stats, setStats] = useState<ModelStats | null>(null)
  const [statsA, setStatsA] = useState<ModelStats | null>(null)
  const [time, setTime] = useState<{ t: number; d: number } | null>(null)
  const sync = useMemo(makeSync, [m.id, other?.id])

  useEffect(() => {
    setSel(null)
    setHidden({})
    setStats(null)
  }, [m.id])

  useEffect(() => {
    const t = setInterval(() => setTime(apiRef.current?.time() ?? null), 100)
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, [contenteditable="true"]')) return
      if (e.key === 'f' || e.key === 'F') apiRef.current?.frame()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(t)
      window.removeEventListener('keydown', onKey)
    }
  }, [apiRef])

  const ready = (s: ModelStats) => {
    setStats(s)
    onStats(s)
  }
  const toggles: [string, boolean, (v: boolean) => void][] = [
    ['Grille', grid, setGrid],
    ['Axes', axes, setAxes],
    ['Cotes', dims, setDims],
    ['Tourner', auto, setAuto]
  ]

  if (other)
    return (
      <div className="m3">
        <div className="m3-pair">
          {[other, m].map((x, k) => (
            <div key={x.id} className="m3-half">
              <ModelView m={x} look={look} grid play sync={sync} zoom axes={false} apiRef={k ? apiRef : undefined} capture={!!k} onReady={k ? ready : setStatsA} style={{ position: 'absolute', inset: 0 }} />
              <span className="m3-tag">
                <b>{k ? 'B' : 'A'}</b> <span className="mono">{x.name}</span>
                {(k ? stats : statsA) && <span className="v-muted"> · {fmtInt((k ? stats : statsA)!.triangles)} tri</span>}
              </span>
            </div>
          ))}
        </div>
        <aside className="m3-panel" aria-label="Différences">
          <span className="m3-h">De A à B</span>
          {stats && statsA ? <Diffs a={statsA} b={stats} /> : <span className="v-muted small">Chargement…</span>}
          <span className="m3-sep" />
          <span className="small">Caméra commune : tourner l’une tourne l’autre. Le rendu choisi en haut s’applique aux deux.</span>
        </aside>
      </div>
    )

  const anim = stats?.animations[0]
  return (
    <div className="m3">
      <div className="m3-main">
        <ModelView m={m} look={look} theme="dark" zoom grid={grid} axes={axes} dims={dims} autoRotate={auto} play={play} selected={sel} hidden={hidden} capture apiRef={apiRef} onReady={ready} style={{ position: 'absolute', inset: 0 }} />
        <div className="m3-tools" role="toolbar" aria-label="Vue">
          <button type="button" onClick={() => apiRef.current?.frame()}>Cadrer <span className="v-muted">F</span></button>
          <span className="m3-sep" />
          {VIEW_BTNS.map(([v, l]) => (
            <button key={v} type="button" onClick={() => apiRef.current?.setView(v)}>{l}</button>
          ))}
          <span className="m3-sep" />
          {toggles.map(([l, on, set]) => (
            <button key={l} type="button" aria-pressed={on} onClick={() => set(!on)}>{l}</button>
          ))}
        </div>
        {dims && stats && (
          <span className="m3-dims mono">
            {stats.size.map(fmtDim).join(' × ')}
            {stats.meters ? ' m' : ''}
          </span>
        )}
        {anim && time && (
          <div className="m3-anim">
            <button type="button" aria-label={play ? 'Pause' : 'Lire'} onClick={() => setPlay(!play)}>{play ? '❚❚' : '▶'}</button>
            <span>{anim.name}</span>
            <input
              type="range"
              aria-label="Position dans l’animation"
              min={0}
              max={time.d || 1}
              step={0.01}
              value={time.t}
              onChange={(e) => {
                setPlay(false)
                apiRef.current?.seek(Number(e.target.value))
              }}
            />
            <span className="mono v-muted" style={{ width: 86 }}>
              {time.t.toLocaleString('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} / {time.d.toLocaleString('fr-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s
            </span>
          </div>
        )}
        <span className="m3-hint">
          Glisser : tourner · Clic droit : déplacer
          <br />
          Molette : zoom · F : cadrer · Échap : fermer
        </span>
        <button type="button" className="m3-panel-toggle" aria-pressed={panel} onClick={() => setPanel(!panel)}>{panel ? 'Masquer la scène' : 'Scène'}</button>
      </div>
      {panel && stats && (
        <aside className="m3-panel" aria-label="Scène">
          <section>
            <span className="m3-h">Pièces · {stats.parts.length}</span>
            <div className="m3-parts">
              {stats.parts.map((p) => (
                <span key={p.id} className="m3-part" data-on={sel === p.id}>
                  <button type="button" aria-pressed={sel === p.id} onClick={() => setSel(sel === p.id ? null : p.id)} style={{ opacity: hidden[p.id] ? 0.45 : 1 }}>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                    <span className="v-muted">{fmtInt(p.triangles)}</span>
                  </button>
                  <button type="button" className="m3-eye" aria-label={(hidden[p.id] ? 'Afficher ' : 'Masquer ') + p.name} aria-pressed={!hidden[p.id]} onClick={() => setHidden({ ...hidden, [p.id]: !hidden[p.id] })}>
                    <Icon name={hidden[p.id] ? 'eye-off' : 'readonly'} size={15} />
                  </button>
                </span>
              ))}
            </div>
          </section>
          {stats.materials.length > 0 && (
            <section>
              <span className="m3-h">Matériaux · {stats.materials.length}</span>
              {stats.materials.slice(0, 12).map((mt, i) => (
                <span key={i} className="m3-row">
                  <span className="m3-ball" style={{ background: mt.color ? `radial-gradient(circle at 35% 30%, #fff8, ${mt.color} 55%, #0006)` : 'var(--g550)' }} />
                  {mt.name}
                </span>
              ))}
            </section>
          )}
          {stats.textures.length > 0 && (
            <section>
              <span className="m3-h">Textures · {stats.textures.length}</span>
              {stats.textures.slice(0, 12).map((t, i) => (
                <span key={i} className="m3-row small">
                  <span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.name}</span>
                  {t.w && <span className="v-muted">{t.w}×{t.h}</span>}
                </span>
              ))}
            </section>
          )}
          <section className="small">
            <span className="m3-h">Infos</span>
            <span className="m3-kv"><span className="v-muted">Géométrie</span>{fmtInt(stats.triangles)} triangles · {fmtInt(stats.vertices)} sommets</span>
            <span className="m3-kv"><span className="v-muted">Dimensions</span>{stats.size.map(fmtDim).join(' × ')}{stats.meters ? ' m' : ''}</span>
            <span className="m3-kv"><span className="v-muted">Animation</span>{stats.animations.length ? stats.animations.map((a) => `${a.name} · ${fmtDim(a.duration)} s`).join(', ') : 'aucune'}</span>
            <span className="m3-kv"><span className="v-muted">Fichier</span>{extOf(m.name).toUpperCase()} · {fmtSize(m.size)}</span>
          </section>
        </aside>
      )}
    </div>
  )
}

function Diffs({ a, b }: { a: ModelStats; b: ModelStats }) {
  const d = (x: number, y: number, f: (n: number) => string, unit = '') => `${y - x >= 0 ? '+' : '−'}${f(Math.abs(y - x))}${unit} (${f(x)} → ${f(y)}${unit})`
  const rows: [string, string][] = [
    ['Triangles', d(a.triangles, b.triangles, fmtInt)],
    ['Pièces', d(a.parts.length, b.parts.length, fmtInt)],
    ['Matériaux', d(a.materials.length, b.materials.length, fmtInt)],
    ['Hauteur', d(a.size[1], b.size[1], fmtDim, b.meters ? ' m' : '')],
    ['Animations', d(a.animations.length, b.animations.length, fmtInt)]
  ]
  return (
    <>
      {rows.map(([k, v]) => (
        <span key={k} className="m3-kv small"><span className="v-muted">{k}</span>{v}</span>
      ))}
    </>
  )
}
