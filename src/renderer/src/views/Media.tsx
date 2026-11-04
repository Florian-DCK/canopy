import { useEffect, useMemo, useRef, useState } from 'react'
import type { Item, MediaItem } from '../../../shared/types'
import { commentFor, fmtSize, groupSeries, mediaUrl, seriesOf, thumbUrl } from '../media'
import { Icon } from '../icons'
import { api, useStore, type ViewerMode } from '../store'

// Références stables pour les sélecteurs zustand (un nouveau [] à chaque rendu boucle).
const NO_MEDIA: MediaItem[] = []
const NO_ITEMS: Item[] = []
const useSessionMedia = (sessionId: string) => useStore((s) => s.media[sessionId] ?? NO_MEDIA)

function PlayBadge({ size = 52 }: { size?: number }) {
  return (
    <span aria-hidden="true" className="play" style={{ width: size, height: size }}>
      <svg width={size * 0.38} height={size * 0.38} viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="#141413" /></svg>
    </span>
  )
}

/** Vignette d'un média ; clic = visionneuse. */
export function Thumb({ m, w, h, label = true }: { m: MediaItem; w: number; h: number; label?: boolean }) {
  const open = useStore((s) => s.openViewer)
  return (
    <button
      type="button"
      className="thumb"
      style={{ width: w, height: h }}
      aria-label={`Ouvrir ${m.name}`}
      title={m.name}
      onClick={() => open({ sessionId: m.sessionId, mediaId: m.id, mode: 'single' })}
    >
      {m.kind === 'image' ? (
        <img src={thumbUrl(m.id)} alt="" loading="lazy" draggable={false} />
      ) : (
        <>
          <video src={`${mediaUrl(m.id)}#t=0.1`} preload="metadata" muted />
          <PlayBadge size={Math.min(52, h * 0.45)} />
        </>
      )}
      {label && <span className="thumb-label mono">{m.name}</span>}
    </button>
  )
}

/** Images jointes à ton message : vignettes dans la bulle, visionneuse au clic. */
export function AttachedMedia({ sessionId, itemId, names }: { sessionId: string; itemId: string; names?: string[] }) {
  const all = useSessionMedia(sessionId)
  const mine = useMemo(() => all.filter((m) => m.itemId === itemId), [all, itemId])
  if (!mine.length)
    return names?.length ? <div className="msg-att">{names.map((n) => <span key={n}><Icon name="attach" size={13} />{n}</span>)}</div> : null
  return (
    <div className="msg-thumbs">
      {mine.map((m) => (
        <Thumb key={m.id} m={m} w={mine.length > 1 ? 96 : 180} h={mine.length > 1 ? 66 : 120} label={false} />
      ))}
    </div>
  )
}

/** Médias rattachés à un élément du fil (outil ou texte). */
export function InlineMedia({ sessionId, itemId }: { sessionId: string; itemId: string }) {
  const all = useSessionMedia(sessionId)
  const open = useStore((s) => s.openViewer)
  const mine = useMemo(() => all.filter((m) => m.itemId === itemId), [all, itemId])
  if (!mine.length) return null

  // Plusieurs médias cités ensemble : grille.
  if (mine.length > 1)
    return (
      <div className="media-grid">
        {mine.map((m) => (
          <Thumb key={m.id} m={m} w={160} h={110} />
        ))}
      </div>
    )

  const m = mine[0]
  const series = seriesOf(m, all)
  const idx = series.findIndex((x) => x.id === m.id)
  const inSeries = series.length > 1
  const isLatest = idx === series.length - 1

  // Vue ancienne d'une série : miniature discrète, la dernière vue porte la série.
  if (inSeries && !isLatest)
    return (
      <div className="media-row compact">
        <Thumb m={m} w={64} h={40} label={false} />
        <span className="small muted">
          Vue {idx + 1} / {series.length} de la série
        </span>
      </div>
    )

  if (m.kind === 'video')
    return (
      <div className="media-card" style={{ width: 360 }}>
        <Thumb m={m} w={360} h={200} label={false} />
        <span className="media-meta">
          <span className="mono" style={{ flex: 1 }}>{m.name}</span>
          <span className="muted">{fmtSize(m.size)}</span>
        </span>
      </div>
    )

  return (
    <div className="media-row">
      <div className="media-card" style={{ width: inSeries ? 200 : 280 }}>
        <Thumb m={m} w={inSeries ? 200 : 280} h={inSeries ? 112 : 170} label={false} />
        <span className="media-meta">
          <span className="mono" style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</span>
          <span className="muted">{[m.width && `${m.width}×${m.height}`, fmtSize(m.size)].filter(Boolean).join(' · ')}</span>
        </span>
      </div>
      {inSeries && (
        <span style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
          <button type="button" className="btn sm" onClick={() => open({ sessionId, mediaId: m.id, mode: 'single' })}>
            Série {series[0] ? seriesLabelOf(series[0]) : ''} · {series.length} vues
          </button>
          <button
            type="button"
            className="btn ghost sm"
            onClick={() => open({ sessionId, mediaId: m.id, compareId: series[idx - 1].id, mode: 'side' })}
          >
            Comparer avec la vue précédente
          </button>
        </span>
      )}
    </div>
  )
}

const seriesLabelOf = (m: MediaItem) => groupSeries([m])[0].label

/** Onglet Médias du panneau : par série, dans l'ordre. */
export function MediaPanel({ sessionId }: { sessionId: string }) {
  const all = useSessionMedia(sessionId)
  const open = useStore((s) => s.openViewer)
  const groups = useMemo(() => groupSeries(all).reverse(), [all])
  if (!all.length)
    return <div className="empty">Les images et vidéos que la session lit, produit ou cite apparaîtront ici.</div>
  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 18 }}>
      {groups.map((g) => (
        <section key={g.key} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <b style={{ fontWeight: 600 }}>{g.items.length > 1 ? `Série ${g.label}` : g.items[0].name}</b>
            {g.items.length > 1 && <span className="small muted">{g.items.length} vues</span>}
            <span style={{ flex: 1 }} />
            {g.items.length > 1 && (
              <button type="button" className="btn ghost sm" onClick={() => open({ sessionId, mediaId: g.items.at(-1)!.id, mode: 'single' })}>
                Tout voir
              </button>
            )}
          </span>
          <div className="media-grid tight">
            {g.items.slice(-8).map((m) => (
              <Thumb key={m.id} m={m} w={84} h={56} label={false} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}

/** Dernière image de la session (carte du cockpit). */
export function useLastImage(sessionId: string): MediaItem | undefined {
  const all = useSessionMedia(sessionId)
  return useMemo(() => [...all].reverse().find((m) => m.kind === 'image'), [all])
}

function Frame({ m, zoom }: { m: MediaItem; zoom: number }) {
  if (m.kind === 'video') return null
  const style =
    zoom === 0
      ? { maxWidth: '100%', maxHeight: '100%' }
      : { width: (m.width ?? 800) * (zoom === 1 ? 1 : 1.5), maxWidth: 'none' as const }
  return <img src={mediaUrl(m.id)} alt={m.name} style={{ ...style, objectFit: 'contain', borderRadius: 6 }} draggable={false} />
}

/** Visionneuse plein écran : image (zoom), vidéo, comparaison côte à côte ou au curseur. */
export function ViewerOverlay() {
  const v = useStore((s) => s.viewer)
  const close = useStore((s) => s.closeViewer)
  const openV = useStore((s) => s.openViewer)
  const attach = useStore((s) => s.attach)
  const all = useStore((s) => (v ? s.media[v.sessionId] ?? NO_MEDIA : NO_MEDIA))
  const items = useStore((s) => (v ? s.items[v.sessionId] ?? NO_ITEMS : NO_ITEMS))
  const readOnly = useStore((s) => (v ? !!s.sessions[v.sessionId]?.readOnly : true))
  const [zoom, setZoom] = useState(0)
  const [pos, setPos] = useState(50)
  const videoRef = useRef<HTMLVideoElement>(null)

  const cur = all.find((m) => m.id === v?.mediaId)
  const series = cur ? seriesOf(cur, all) : []
  const strip = series.length > 1 ? series : all
  const idx = strip.findIndex((m) => m.id === cur?.id)
  const other = v?.compareId ? all.find((m) => m.id === v.compareId) : undefined
  const comparing = !!other && v?.mode !== 'single' && cur?.kind === 'image'

  useEffect(() => {
    if (!v) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowRight' && idx < strip.length - 1) go(strip[idx + 1])
      else if (e.key === 'ArrowLeft' && idx > 0) go(strip[idx - 1])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  useEffect(() => setZoom(0), [v?.mediaId])

  if (!v || !cur) return null

  function go(m: MediaItem, withShift = false) {
    if (!v) return
    if (withShift) openV({ ...v, compareId: m.id, mode: v.mode === 'single' ? 'side' : v.mode })
    else openV({ ...v, mediaId: m.id, compareId: v.compareId === m.id ? undefined : v.compareId })
  }
  const setMode = (mode: ViewerMode) => {
    const prev = idx > 0 ? strip[idx - 1] : strip[idx + 1]
    openV({ ...v, mode, compareId: mode === 'single' ? v.compareId : v.compareId ?? prev?.id })
  }
  const capture = () => {
    if (cur.kind === 'video' && videoRef.current) {
      const vid = videoRef.current
      const c = document.createElement('canvas')
      c.width = vid.videoWidth
      c.height = vid.videoHeight
      c.getContext('2d')!.drawImage(vid, 0, 0)
      attach(v.sessionId, { dataUrl: c.toDataURL('image/png'), name: `${cur.name} @ ${vid.currentTime.toFixed(1)} s` })
    } else attach(v.sessionId, { mediaId: cur.id, name: cur.name })
    close()
    setTimeout(() => document.getElementById('composer')?.focus(), 0)
  }
  const A = comparing ? other! : undefined

  return (
    <div className="viewer" role="dialog" aria-label={`Visionneuse — ${cur.name}`}>
      <header className="viewer-bar">
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {series.length > 1 ? `Série ${seriesLabelOf(cur)} · ` : ''}
            {comparing ? `${A!.name} ↔ ${cur.name}` : cur.name}
            <span className="v-muted" style={{ fontWeight: 400 }}> · {idx + 1} / {strip.length}</span>
          </span>
          <span className="mono v-muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cur.path}</span>
        </span>
        {cur.kind === 'image' && strip.length > 1 && (
          <div className="v-seg" role="group" aria-label="Mode d’affichage">
            {(['single', 'side', 'slider'] as ViewerMode[]).map((m) => (
              <button key={m} type="button" aria-pressed={v.mode === m} onClick={() => setMode(m)}>
                {m === 'single' ? 'Une vue' : m === 'side' ? 'Côte à côte' : 'Curseur'}
              </button>
            ))}
          </div>
        )}
        {cur.kind === 'image' && !comparing && (
          <div className="v-seg" role="group" aria-label="Zoom">
            {['Ajusté', '100 %', '150 %'].map((l, k) => (
              <button key={l} type="button" aria-pressed={zoom === k} onClick={() => setZoom(k)}>{l}</button>
            ))}
          </div>
        )}
        <button type="button" className="v-btn" onClick={() => navigator.clipboard.writeText(cur.path)}>Copier le chemin</button>
        <button type="button" className="v-btn" onClick={() => api.showMediaInFolder(cur.id)}>Ouvrir le dossier</button>
        <button type="button" className="v-btn" onClick={() => api.openMedia(cur.id)}>Ouvrir avec…</button>
        {!readOnly && <button type="button" className="v-btn primary" onClick={capture}>{cur.kind === 'video' ? 'Capture → session' : 'Joindre → session'}</button>}
        <button type="button" className="v-btn" aria-label="Fermer (Échap)" onClick={close}>✕</button>
      </header>

      <div className="viewer-stage">
        {idx > 0 && <button type="button" className="v-nav left" aria-label="Précédent" onClick={() => go(strip[idx - 1])}>‹</button>}
        {cur.kind === 'video' ? (
          <video ref={videoRef} src={mediaUrl(cur.id)} controls autoPlay loop style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: 8 }} />
        ) : comparing && v.mode === 'side' ? (
          <div className="v-side">
            {[A!, cur].map((m, k) => (
              <figure key={m.id}>
                <figcaption><b>{k ? 'B' : 'A'}</b> <span className="mono">{m.name}</span> <span className="v-muted">· {new Date(m.at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</span></figcaption>
                <div className="v-side-img"><img src={mediaUrl(m.id)} alt={m.name} draggable={false} /></div>
                {commentFor(m, items as Item[]) && <p className="v-comment">« {commentFor(m, items as Item[])!.slice(0, 400)} »</p>}
              </figure>
            ))}
          </div>
        ) : comparing && v.mode === 'slider' ? (
          <div className="v-slider">
            <div className="v-slider-stage">
              <div className="v-slider-frame">
                <img src={mediaUrl(cur.id)} alt={cur.name} draggable={false} />
                <div className="v-slider-top" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
                  <img src={mediaUrl(A!.id)} alt={A!.name} draggable={false} />
                </div>
                <span className="v-slider-handle" style={{ left: `${pos}%` }} />
              </div>
            </div>
            <span className="small v-muted" style={{ display: 'flex' }}><span style={{ flex: 1 }}>◀ A · {A!.name}</span><span>{cur.name} · B ▶</span></span>
            <label htmlFor="cmp" className="sr-only">Position du curseur</label>
            <input id="cmp" type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} style={{ width: '100%', accentColor: '#F0EEE6' }} />
          </div>
        ) : (
          <div className="v-frame" style={{ overflow: zoom ? 'auto' : 'hidden' }}>
            <Frame m={cur} zoom={zoom} />
          </div>
        )}
        {idx < strip.length - 1 && <button type="button" className="v-nav right" aria-label="Suivant" onClick={() => go(strip[idx + 1])}>›</button>}
      </div>

      <footer className="viewer-foot">
        <span className="small v-muted" style={{ width: 260, lineHeight: 1.5 }}>
          {[cur.width && `${cur.width} × ${cur.height}`, fmtSize(cur.size), cur.source === 'read' ? 'lu par Read' : cur.source === 'screenshot' ? 'capture' : cur.source === 'mention' ? 'cité' : 'outil'].filter(Boolean).join(' · ')}
          <br />← → naviguer{strip.length > 1 && cur.kind === 'image' ? ' · Maj+clic = vue A' : ''} · Échap fermer
        </span>
        <div className="v-strip" role="tablist" aria-label="Médias">
          {strip.slice(Math.max(0, idx - 10), idx + 11).map((m) => (
            <button
              key={m.id}
              type="button"
              role="tab"
              aria-selected={m.id === cur.id}
              title={m.name}
              className={m.id === cur.id ? 'on' : m.id === other?.id && comparing ? 'a' : ''}
              onClick={(e) => go(m, e.shiftKey)}
            >
              {m.kind === 'image' ? <img src={thumbUrl(m.id)} alt="" loading="lazy" /> : <PlayBadge size={22} />}
            </button>
          ))}
        </div>
        <span style={{ width: 260 }} />
      </footer>
    </div>
  )
}
