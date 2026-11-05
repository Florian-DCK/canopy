import { useCallback, useEffect, useRef, useState } from 'react'
import { UI_PANEL_EVENT, type UiPanelDetail } from '../../shared/ui'
import { mod } from './platform'

// Panneaux de la session, façon VS Code : ouverture/fermeture, largeur réglable, mémorisés.

export type Side = 'left' | 'right'
type Layout = { leftOpen: boolean; rightOpen: boolean; leftW: number; rightW: number }

const KEY = 'atelier.layout.session'
const DEFAULT: Layout = { leftOpen: true, rightOpen: true, leftW: 260, rightW: 400 }
export const LIMITS: Record<Side, { min: number; max: number; def: number }> = {
  left: { min: 180, max: 480, def: DEFAULT.leftW },
  right: { min: 280, max: 820, def: DEFAULT.rightW }
}

function load(): Layout {
  // Fenêtre de capture : panneaux imposés par l'URL (?panels=open|closed).
  const q = new URLSearchParams(location.search)
  if (q.get('capture') === '1' && q.get('panels')) {
    const open = q.get('panels') === 'open'
    return { ...DEFAULT, leftOpen: open, rightOpen: open }
  }
  try {
    return { ...DEFAULT, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return DEFAULT
  }
}

export function useSessionLayout() {
  const [l, setL] = useState<Layout>(load)
  const update = useCallback((p: Partial<Layout>) => {
    setL((cur) => {
      const next = { ...cur, ...p }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* stockage indisponible */
      }
      return next
    })
  }, [])
  const toggle = useCallback((side: Side) => setL((cur) => {
    const next = side === 'left' ? { ...cur, leftOpen: !cur.leftOpen } : { ...cur, rightOpen: !cur.rightOpen }
    try {
      localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* stockage indisponible */
    }
    return next
  }), [])

  // Claude ouvre ou ferme le panneau de travail (outil interface).
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<UiPanelDetail>).detail
      if (d.state) update({ rightOpen: d.state === 'open' })
    }
    window.addEventListener(UI_PANEL_EVENT, on)
    return () => window.removeEventListener(UI_PANEL_EVENT, on)
  }, [update])

  // Raccourcis VS Code : Ctrl+B (panneau gauche), Ctrl+Alt+B (panneau droit).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!mod(e) || e.shiftKey || e.key.toLowerCase() !== 'b') return
      e.preventDefault()
      toggle(e.altKey ? 'right' : 'left')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggle])

  return { ...l, update, toggle }
}

/**
 * Poignée de redimensionnement. Glisser = largeur ; glisser bien en dessous du minimum = fermer ;
 * double-clic = largeur par défaut ; flèches gauche/droite au clavier.
 */
export function Splitter({
  side,
  width,
  onWidth,
  onClose
}: {
  side: Side
  width: number
  onWidth: (w: number) => void
  onClose: () => void
}) {
  const start = useRef<{ x: number; w: number } | null>(null)
  const [drag, setDrag] = useState(false)
  const { min, max, def } = LIMITS[side]
  const clamp = (w: number) => Math.max(min, Math.min(max, Math.round(w)))
  const dir = side === 'left' ? 1 : -1

  return (
    <div
      className={`splitter ${drag ? 'drag' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={side === 'left' ? 'Redimensionner la liste des sessions' : 'Redimensionner le panneau de travail'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      title="Glisser pour redimensionner · double-clic : taille par défaut"
      onDoubleClick={() => onWidth(def)}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') onWidth(clamp(width - 16 * dir))
        else if (e.key === 'ArrowRight') onWidth(clamp(width + 16 * dir))
        else return
        e.preventDefault()
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId)
        start.current = { x: e.clientX, w: width }
        setDrag(true)
      }}
      onPointerMove={(e) => {
        if (!start.current) return
        const raw = start.current.w + (e.clientX - start.current.x) * dir
        if (raw < min - 90) {
          start.current = null
          setDrag(false)
          onClose()
          return
        }
        onWidth(clamp(raw))
      }}
      onPointerUp={() => {
        start.current = null
        setDrag(false)
      }}
    />
  )
}
