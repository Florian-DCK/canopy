import { useEffect, useState, type ReactNode } from 'react'
import type { Project, ThemeMode } from '../../shared/types'
import { api, useStore, type View } from './store'
import { NotifButton } from './NotifSettings'
import { lastSeen, useChecklists } from './checklists'
import { Icon } from './icons'
import { InTitleBar } from './titlebar'
import { dropOnTiles, isTileDrag, resolve, useTiles } from './tiles'
import { fxOfGroup, useFx } from './fx'
import { CanopyMark } from './voice/CanopyMark'
import { useVoice } from './voice/runtime'
import { markOf } from './voice/VoiceView'

const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

export const Icons = {
  grid: (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  chat: (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <path d="M4 5h16v11H9l-5 4z" />
    </svg>
  ),
  folder: (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  ),
  clock: (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  plus: (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" {...stroke} strokeWidth={2}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  send: (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" {...stroke} strokeWidth={2}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

export function Tile({ project, size = 48 }: { project: Project; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="tile"
      style={{ width: size, height: size, background: project.color, fontSize: size / 2, borderRadius: size * 0.27 }}
    >
      {(project.name.match(/\p{L}/u)?.[0] ?? project.name.slice(0, 1)).toUpperCase()}
    </span>
  )
}

const THEME_NEXT: Record<ThemeMode, ThemeMode> = { system: 'dark', dark: 'light', light: 'system' }
const THEME_LABEL: Record<ThemeMode, string> = { system: 'Thème : système', dark: 'Thème : sombre', light: 'Thème : clair' }
const THEME_ICON: Record<ThemeMode, ReactNode> = {
  system: (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  ),
  dark: (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
    </svg>
  ),
  light: (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" {...stroke}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </svg>
  )
}

function ThemeToggle() {
  const [mode, setMode] = useState<ThemeMode>('system')
  useEffect(() => {
    void api.getTheme().then(setMode)
  }, [])
  const next = THEME_NEXT[mode]
  return (
    <button
      type="button"
      aria-label={`${THEME_LABEL[mode]} — passer en ${THEME_LABEL[next].split(' : ')[1]}`}
      title={`${THEME_LABEL[mode]} (clic : ${THEME_LABEL[next].split(' : ')[1]})`}
      onClick={() => {
        setMode(next)
        void api.setTheme(next)
      }}
    >
      {THEME_ICON[mode]}
    </button>
  )
}

export function Rail() {
  const view = useStore((s) => s.view)
  const go = useStore((s) => s.go)
  const sessions = useStore((s) => s.sessions)
  const summaries = useChecklists((s) => s.summaries)
  const fresh = view.name !== 'checklists' && summaries.some((c) => c.updatedAt > lastSeen())
  const waiting = Object.values(sessions).some((s) => s.status === 'wait')
  const tilesWaiting = useTiles((t) => view.name !== 'tiles' && t.cells.some((c) => resolve(c, sessions)?.status === 'wait'))
  const doneFresh = useFx((f) => f.fresh)
  const cells = useTiles((t) => t.cells)
  const tilesFx = view.name === 'tiles' ? '' : fxOfGroup(cells.map((c) => resolve(c, sessions)), doneFresh)
  const last = Object.values(sessions).sort((a, b) => b.updatedAt - a.updatedAt)[0]
  const [dropping, setDropping] = useState<'' | 'over' | 'ok'>('')
  const btn = (label: string, icon: ReactNode, v: View | null, active: boolean, badge = false, blue = false, fx = '', drop?: object) => (
    <button
      type="button"
      {...drop}
      className={fx || undefined}
      aria-label={label}
      title={label}
      aria-current={active ? 'page' : undefined}
      disabled={!v}
      onClick={() => v && go(v)}
    >
      {icon}
      {badge && <span className={`badge${blue ? ' blue' : ''}`} />}
    </button>
  )
  return (
    <nav className="rail" aria-label="Navigation principale">
      {btn('Cockpit', Icons.grid, { name: 'cockpit' }, view.name === 'cockpit' || view.name === 'project', waiting)}
      {btn('Dernière session', Icons.chat, last ? { name: 'session', sessionId: last.id } : null, view.name === 'session')}
      {btn('Mosaïque (Ctrl+clic sur une session pour l’ajouter)', <Icon name="tiles" size={20} />, { name: 'tiles' }, view.name === 'tiles', tilesWaiting, false, `${tilesFx} ${dropping ? `drop-${dropping}` : ''}`.trim(), {
        onDragOver: (e: React.DragEvent) => {
          if (!isTileDrag(e)) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          setDropping('over')
        },
        onDragLeave: () => setDropping(''),
        onDrop: (e: React.DragEvent) => {
          e.preventDefault()
          if (dropOnTiles(e)) {
            setDropping('ok')
            setTimeout(() => setDropping(''), 900)
          } else setDropping('')
        }
      })}
      {btn('Historique', Icons.clock, { name: 'history' }, view.name === 'history')}
      {btn('Projets', Icons.folder, { name: 'projects' }, view.name === 'projects')}
      {btn('Checklists', <Icon name="todo" size={20} />, { name: 'checklists' }, view.name === 'checklists', fresh, true)}
      {btn('Outils de Claude (skills, MCP, agents)', <Icon name="plug" size={20} />, { name: 'tools' }, view.name === 'tools')}
      {btn('Mode voix', <VoiceRailMark />, { name: 'voice' }, view.name === 'voice')}
      <span style={{ flex: 1 }} />
      <NotifButton />
      {btn('Paramètres', <Icon name="settings" size={20} />, { name: 'settings' }, view.name === 'settings')}
      <ThemeToggle />
    </nav>
  )
}

/** Fil d'Ariane de la vue, affiché dans la barre de fenêtre (l'usage y est déjà, à droite). */
export function TopBar({ children }: { children: ReactNode; usage?: boolean }) {
  return (
    <InTitleBar side="left">
      <div className="crumb tb-crumb">{children}</div>
    </InTitleBar>
  )
}

/** Bouton du mode voix : le logo, vivant pendant une conversation. */
function VoiceRailMark() {
  const phase = useVoice((v) => v.phase)
  const speech = useVoice((v) => v.speech)
  return <CanopyMark state={phase === 'off' ? 'rest' : markOf(phase, speech)} size={22} />
}
