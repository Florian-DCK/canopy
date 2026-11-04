import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { HistoryEntry, Item, Project, SessionMeta } from '../../../../shared/types'
import { UI_PANEL_EVENT, type UiPanelDetail } from '../../../../shared/ui'
import { ago, contextWindowOf } from '../../derive'
import { Icon, Ring, STATUS_ICON, type IconName } from '../../icons'
import { guessLocalUrl } from '../../browser/agent'
import { hostOf, useBrowser } from '../../browser/store'
import { api, resumeFromHistory, useStore } from '../../store'
import { fxClass, useFx } from '../../fx'
import { dragSession, openOrTile } from '../../tiles'
import { InTitleBar } from '../../titlebar'
import { Tile } from '../../ui'
import { useArtifactTabs, useArtifactTitle, type SessionArtifact } from '../Artifacts'
import { newSession } from '../Cockpit'
import { MediaPanel } from '../Media'
import { ChecklistDock, useSessionChecklists } from './ChecklistDock'
import { DiffCount, isOutside, type Tool } from './Thread'

// En-tête unique, liste des sessions et panneau de travail (planche 1).

export const STATUS_WORD: Record<string, string> = { run: 'Au travail', wait: 'Attend ta réponse', idle: 'Terminé', error: 'Erreur' }

/** Largeur d'un élément, suivie en direct. */
export function useWidth(ref: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(1200)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setW(el.clientWidth)
    const ro = new ResizeObserver(() => setW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

/** Menu léger : bouton + liste, fermé au clic dehors ou Échap. */
export function Menu({ label, button, className, align = 'right', disabled, children }: { label: string; button: ReactNode; className?: string; align?: 'left' | 'right'; disabled?: boolean; children: (close: () => void) => ReactNode }) {
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
  return (
    <div ref={ref} className="menu-wrap">
      <button type="button" className={className ?? 'icon-btn'} aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} disabled={disabled} onClick={() => setOpen(!open)}>
        {button}
      </button>
      {open && (
        <div className={`menu ${align}`} role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon, children, onClick, checked, danger }: { icon?: IconName; children: ReactNode; onClick: () => void; checked?: boolean; danger?: boolean }) {
  return (
    <button type="button" role={checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={checked} className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick}>
      {icon && <Icon name={icon} size={16} />}
      <span className="menu-txt">{children}</span>
    </button>
  )
}

export function StatusPill({ session, compact }: { session: SessionMeta; compact: boolean }) {
  if (session.readOnly)
    return (
      <span className="s-pill" title="Cette session tourne dans un terminal : Canopy l’affiche sans la piloter">
        <Icon name="readonly" size={15} />
        {!compact && 'Lecture seule'}
      </span>
    )
  const word = STATUS_WORD[session.status]
  // Les états courants se disent par l'icône ; « attend ta réponse » garde ses mots.
  const showWord = session.status === 'wait' || (!compact && session.status !== 'idle')
  return (
    <span className={`s-pill st-${session.status}`} title={word}>
      <Icon name={STATUS_ICON[session.status]} size={15} label={showWord ? undefined : word} />
      {showWord && word}
    </span>
  )
}

function ArtTabLabel({ a }: { a: SessionArtifact }) {
  return <>{useArtifactTitle(a)}</>
}

/** Une seule barre : projet, titre, statut, vues, actions. */
export function SessionHeader({
  session,
  project,
  leftOpen,
  rightOpen,
  onToggle,
  narrow
}: {
  session: SessionMeta
  project: Project
  leftOpen: boolean
  rightOpen: boolean
  onToggle: (side: 'left' | 'right') => void
  narrow: boolean
}) {
  const { tabs, active, fresh } = useArtifactTabs(session.id)
  const setActive = useStore((s) => s.setActiveTab)
  const close = useStore((s) => s.closeArtTab)
  const go = useStore((s) => s.go)

  // Ctrl+1 : conversation, Ctrl+2… : artefacts.
  useEffect(() => {
    if (!tabs.length) return
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || !/^[1-9]$/.test(e.key)) return
      const n = Number(e.key)
      const key = n === 1 ? 'session' : tabs[n - 2]?.url
      if (!key) return
      e.preventDefault()
      setActive(session.id, key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tabs, session.id, setActive])

  const inConvo = active === 'session'
  const browser = useBrowser((s) => s.tabs[session.id])
  const nRemarks = useBrowser((s) => s.remarks[session.id]?.length ?? 0)
  const openBrowser = () => {
    if (!useBrowser.getState().tabs[session.id]) useBrowser.getState().open(session.id, guessLocalUrl(session.id))
    setActive(session.id, 'browser')
  }
  const closeBrowser = () => {
    if (active === 'browser') setActive(session.id, 'session')
    useBrowser.getState().close(session.id)
  }
  return (
    <>
    <InTitleBar side="left">
    <div className="s-head">
      <button
        type="button"
        className="icon-btn"
        aria-pressed={active === 'browser' ? browser?.chat !== false : leftOpen && inConvo}
        disabled={!inConvo && active !== 'browser'}
        aria-label={active === 'browser' ? 'Afficher ou masquer la conversation (page en plein écran)' : 'Liste des sessions (Ctrl+B)'}
        title={active === 'browser' ? 'Afficher ou masquer la conversation (page en plein écran)' : 'Liste des sessions (Ctrl+B)'}
        onClick={() => (active === 'browser' ? useBrowser.getState().patch(session.id, { chat: browser?.chat === false }) : onToggle('left'))}
      >
        <Icon name="sessions" size={18} />
      </button>
      <button type="button" className="s-crumb" title={`${project.name} — ${project.path}`} onClick={() => go({ name: 'project', projectId: project.id })}>
        <Tile project={project} size={22} />
        {!narrow && <span className="s-proj">{project.name} /</span>}
      </button>
      <b className="s-title" title={session.title}>{session.title}</b>
      <StatusPill session={session} compact={narrow} />

      {(tabs.length > 0 || !!browser) &&
        (narrow ? (
          <Menu
            label="Changer de vue"
            className="chip-btn"
            align="left"
            button={<><Icon name={inConvo ? 'conversation' : active === 'browser' ? 'web' : 'artifact'} size={15} />Vue<Icon name="chevron" size={13} /></>}
          >
            {(done) => (
              <>
                <MenuItem icon="conversation" checked={inConvo} onClick={() => { setActive(session.id, 'session'); done() }}>Conversation</MenuItem>
                {browser && <MenuItem icon="web" checked={active === 'browser'} onClick={() => { setActive(session.id, 'browser'); done() }}>{hostOf(browser.url)}</MenuItem>}
                {tabs.map((a) => (
                  <MenuItem key={a.url} icon="artifact" checked={active === a.url} onClick={() => { setActive(session.id, a.url); done() }}>
                    <ArtTabLabel a={a} />
                  </MenuItem>
                ))}
              </>
            )}
          </Menu>
        ) : (
          <div className="s-tabs" role="tablist" aria-label="Vues de la session">
            <button type="button" role="tab" aria-selected={inConvo} className="s-tab" title="Conversation (Ctrl+1)" onClick={() => setActive(session.id, 'session')}>
              <Icon name="conversation" size={15} />Conversation
            </button>
            {browser && (
              <div role="tab" aria-selected={active === 'browser'} className="s-tab art" title={browser.url}>
                <button type="button" className="s-tab-main" onClick={() => setActive(session.id, 'browser')}>
                  <Icon name={browser.loading ? 'run' : 'web'} size={15} />
                  <span className="s-tab-label">{hostOf(browser.url)}</span>
                  {nRemarks > 0 && <span className="s-tab-v">· {nRemarks} remarque{nRemarks > 1 ? 's' : ''}</span>}
                  {browser.errors > 0 && <span className="s-tab-v err">· {browser.errors} erreur{browser.errors > 1 ? 's' : ''}</span>}
                </button>
                <button type="button" className="s-tab-x" aria-label="Fermer le navigateur" title="Fermer le navigateur" onClick={closeBrowser}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            )}
            {tabs.map((a, k) => (
              <div key={a.url} role="tab" aria-selected={active === a.url} className="s-tab art" title={`${a.url} (Ctrl+${k + 2})`}>
                <button type="button" className="s-tab-main" onClick={() => setActive(session.id, a.url)}>
                  <Icon name="artifact" size={15} />
                  <span className="s-tab-label"><ArtTabLabel a={a} /></span>
                  {a.version && <span className="s-tab-v">v{a.version}</span>}
                  {fresh(a) && <span className="s-fresh" aria-label="nouvelle version" />}
                </button>
                <button type="button" className="s-tab-x" aria-label="Fermer la vue" title="Fermer la vue" onClick={() => close(session.id, a.url, a.at)}>
                  <Icon name="close" size={13} />
                </button>
              </div>
            ))}
          </div>
        ))}

    </div>
    </InTitleBar>
    <InTitleBar side="right">
      <Menu label="Plus d’actions" button={<Icon name="more" size={18} />}>
        {(done) => (
          <>
            {session.sdkSessionId && (
              <MenuItem icon="copy" onClick={() => { void navigator.clipboard.writeText(session.sdkSessionId!); done() }}>Copier l’identifiant de session</MenuItem>
            )}
            <MenuItem icon="web" onClick={() => { openBrowser(); done() }}>{browser ? 'Afficher le navigateur' : 'Ouvrir le navigateur'}</MenuItem>
            <MenuItem icon="plus" onClick={() => { void newSession(project.id); done() }}>Nouvelle session dans {project.name}</MenuItem>
            {session.status === 'run' && <MenuItem icon="stop" onClick={() => { void api.interrupt(session.id); done() }}>Arrêter le tour en cours</MenuItem>}
            <MenuItem icon="close" danger onClick={() => { void api.closeSession(session.id); done() }}>Fermer la session</MenuItem>
          </>
        )}
      </Menu>
      <button
        type="button"
        className="icon-btn"
        aria-pressed={rightOpen && inConvo}
        disabled={!inConvo}
        aria-label="Panneau de travail (Ctrl+Alt+B)"
        title="Panneau de travail (Ctrl+Alt+B)"
        onClick={() => onToggle('right')}
      >
        <Icon name="panel" size={18} />
      </button>
    </InTitleBar>
    </>
  )
}

/* ---------- Liste des sessions ---------- */

export function SessionList({ project, current, width }: { project: Project; current: string; width: number }) {
  const all = useStore((s) => s.sessions)
  const go = useStore((s) => s.go)
  const history = useStore((s) => s.history)
  const loadHistory = useStore((s) => s.loadHistory)
  useEffect(() => {
    if (!history.length) void loadHistory()
  }, [history.length, loadHistory])
  const open = Object.values(all).filter((s) => s.projectId === project.id).sort((a, b) => b.updatedAt - a.updatedAt)
  const openIds = new Set(open.map((s) => s.sdkSessionId).filter(Boolean))
  const recent = history.filter((h) => h.projectId === project.id && !openIds.has(h.sdkSessionId)).slice(0, 8)
  const fresh = useFx((f) => f.fresh)
  return (
    <aside className="side" aria-label="Sessions du projet" style={{ width }}>
      <div className="scroll side-scroll">
        <div className="side-h">Ouvertes</div>
        {open.map((s) => (
          <button key={s.id} type="button" className={`side-item ${fxClass(s, fresh)}`} aria-current={s.id === current} draggable onDragStart={(e) => dragSession(e, { sessionId: s.id })} onClick={(e) => openOrTile(e, s.id)} title={`${s.title} — ${STATUS_WORD[s.status]} · Ctrl+clic : Mosaïque`}>
            <Icon name={s.readOnly ? 'readonly' : STATUS_ICON[s.status]} size={15} className={`st-${s.status}`} />
            <span className="side-t">{s.title}</span>
            <span className="side-ago">{ago(s.updatedAt)}</span>
          </button>
        ))}
        {recent.length > 0 && <div className="side-h">Récentes</div>}
        {recent.map((h: HistoryEntry) => (
          <button key={h.sdkSessionId} type="button" className="side-item dim" onClick={() => void resumeFromHistory(h)} title={`Reprendre « ${h.title} »`}>
            <Icon name="history" size={15} />
            <span className="side-t">{h.title}</span>
            <span className="side-ago">{ago(h.lastModified)}</span>
          </button>
        ))}
      </div>
      <button type="button" className="side-new" onClick={() => void newSession(project.id)}>
        <Icon name="plus" size={15} /> Nouvelle session
      </button>
    </aside>
  )
}

/* ---------- Panneau de travail ---------- */

type FileEntry = { path: string; added: number; removed: number; edits: Tool[] }

export function WorkPanel({ session, items, width }: { session: SessionMeta; items: Item[]; width: number }) {
  const [tab, setTab] = useState<'files' | 'media' | 'lists' | 'ctx'>('lists')
  // Claude choisit l'onglet (outil interface).
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<UiPanelDetail>).detail
      if (d.sessionId === session.id && d.tab) setTab(d.tab)
    }
    window.addEventListener(UI_PANEL_EVENT, on)
    return () => window.removeEventListener(UI_PANEL_EVENT, on)
  }, [session.id])
  const nLists = useSessionChecklists(session).length
  const mediaCount = useStore((s) => s.media[session.id]?.length ?? 0)
  const [showOut, setShowOut] = useState(false)
  const files = useMemo(() => {
    const m = new Map<string, FileEntry>()
    for (const i of items) {
      if (i.kind !== 'tool' || !i.diff) continue
      const e = m.get(i.diff.path) ?? { path: i.diff.path, added: 0, removed: 0, edits: [] }
      e.added += i.diff.added
      e.removed += i.diff.removed
      e.edits.push(i)
      m.set(i.diff.path, e)
    }
    return [...m.values()].sort((a, b) => b.edits[b.edits.length - 1].at - a.edits[a.edits.length - 1].at)
  }, [items])
  const inside = files.filter((f) => !isOutside(f.path))
  const outside = files.filter((f) => isOutside(f.path))
  const [sel, setSel] = useState<string | null>(null)
  const shown = files.find((f) => f.path === sel) ?? inside[0]
  const win = contextWindowOf(session)
  const pct = session.contextTokens ? Math.min(100, Math.round((session.contextTokens / win) * 100)) : 0

  const tabBtn = (k: typeof tab, icon: IconName, label: string, n?: number) => (
    <button type="button" role="tab" aria-selected={tab === k} className="p-tab" title={label} onClick={() => setTab(k)}>
      {k === 'ctx' ? <Ring pct={pct / 100} size={15} /> : <Icon name={icon} size={15} />}
      <span className="p-tab-l">{label}</span>
      {n !== undefined && <span className="p-tab-n">{n}</span>}
    </button>
  )

  const fileRow = (f: FileEntry) => {
    const parts = f.path.split(/[\\/]/)
    const name = parts.pop()
    return (
      <button key={f.path} type="button" className="f-row" aria-pressed={shown?.path === f.path} onClick={() => setSel(f.path)} title={f.path}>
        <Icon name={f.edits.some((e) => e.name === 'Write') && f.removed === 0 ? 'write' : 'edit'} size={15} />
        <span className="f-txt">
          <span className="f-name">{name}</span>
          <span className="f-dir">{parts.join('/') || '.'}</span>
        </span>
        <DiffCount added={f.added} removed={f.removed} />
      </button>
    )
  }

  return (
    <aside className="panel" aria-label="Panneau de travail" style={{ width }}>
      <div className="p-tabs" role="tablist" aria-label="Panneau">
        {tabBtn('files', 'files', 'Fichiers', inside.length)}
        {tabBtn('media', 'media', 'Médias', mediaCount)}
        {tabBtn('lists', 'todo', 'Checklists', nLists)}
        {tabBtn('ctx', 'context', `Contexte ${pct} %`)}
      </div>
      <div className="scroll">
        {tab === 'media' && <MediaPanel sessionId={session.id} />}
        {tab === 'lists' && <ChecklistDock session={session} />}
        {tab === 'files' &&
          (files.length === 0 ? (
            <div className="empty">Les fichiers que la session modifie apparaîtront ici, avec leurs changements.</div>
          ) : (
            <div className="f-list">
              {inside.length > 0 && <div className="side-h">Modifiés par cette session</div>}
              {inside.map(fileRow)}
              {shown && <DiffView f={shown} projectId={session.projectId} />}
              {outside.length > 0 && (
                <button type="button" className="f-out" aria-expanded={showOut} onClick={() => setShowOut(!showOut)}>
                  <Icon name="chevron" size={13} className="a-chev" />
                  Hors projet (fichiers temporaires) · {outside.length}
                </button>
              )}
              {showOut && outside.map(fileRow)}
            </div>
          ))}
        {tab === 'ctx' && (
          <div className="ctx">
            <div className="ctx-ring">
              <Ring pct={pct / 100} size={64} />
              <span>
                <b>{pct} %</b>
                <span className="muted">{session.contextTokens ? `${Math.round(session.contextTokens / 1000)}k sur ${Math.round(win / 1000)}k` : 'Pas encore mesuré'}</span>
              </span>
            </div>
            <dl className="ctx-dl">
              <dt>Modèle</dt>
              <dd>{session.model ?? 'défaut'}</dd>
              {session.sdkSessionId && (
                <>
                  <dt>Session Claude Code</dt>
                  <dd className="mono ctx-id">
                    {session.sdkSessionId}
                    <button type="button" className="icon-btn sm" aria-label="Copier l’identifiant" title="Copier l’identifiant" onClick={() => void navigator.clipboard.writeText(session.sdkSessionId!)}>
                      <Icon name="copy" size={14} />
                    </button>
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}
      </div>
    </aside>
  )
}

const DIFF_EDITS = 3
const DIFF_LINES = 120

/** Les dernières modifications du fichier, plus récentes d'abord (plafonnées : un Write peut faire des milliers de lignes). */
type DLine = { t: '+' | '-' | ' '; s: string }

/** Côte à côte : '-' à gauche, '+' à droite, appariés dans l'ordre ; le contexte des deux côtés. */
function sideRows(lines: DLine[]): [DLine | null, DLine | null][] {
  const rows: [DLine | null, DLine | null][] = []
  let k = 0
  while (k < lines.length) {
    if (lines[k].t === ' ') {
      rows.push([lines[k], lines[k]])
      k++
      continue
    }
    const m: DLine[] = []
    const p: DLine[] = []
    for (; k < lines.length && lines[k].t !== ' '; k++) (lines[k].t === '-' ? m : p).push(lines[k])
    for (let i = 0; i < Math.max(m.length, p.length); i++) rows.push([m[i] ?? null, p[i] ?? null])
  }
  return rows
}

function DiffView({ f, projectId }: { f: FileEntry; projectId: string }) {
  const [all, setAll] = useState(false)
  const [mode, setModeState] = useState<'unified' | 'split'>(() => {
    try {
      return localStorage.getItem('atelier.diff.mode') === 'split' ? 'split' : 'unified'
    } catch {
      return 'unified'
    }
  })
  const setMode = (m: 'unified' | 'split') => {
    setModeState(m)
    try {
      localStorage.setItem('atelier.diff.mode', m)
    } catch {
      /* stockage indisponible */
    }
  }
  const edits = [...f.edits].reverse()
  const shown = all ? edits : edits.slice(0, DIFF_EDITS)
  return (
    <div className="f-diff">
      <div className="diff-head">
        <div className="seg" role="group" aria-label="Mode d’affichage du diff">
          <button type="button" aria-pressed={mode === 'unified'} onClick={() => setMode('unified')}>Unifié</button>
          <button type="button" aria-pressed={mode === 'split'} onClick={() => setMode('split')}>Côte à côte</button>
        </div>
        <span style={{ flex: 1 }} />
        <button type="button" className="diff-vscode" title="Ouvrir le fichier dans VS Code" onClick={() => void api.openInEditor(projectId, f.path)}>
          <Icon name="external" size={13} /> VS Code
        </button>
      </div>
      {shown.map((e) => {
        const lines = e.diff!.lines
        const cut = all ? lines : lines.slice(0, DIFF_LINES)
        return (
          <div key={e.id}>
            <div className="f-hunk">@@ {e.name} · {new Date(e.at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}</div>
            {mode === 'split'
              ? sideRows(cut).map(([a, b], k) => (
                  <div key={k} className="d-split">
                    <div className={a && a.t === '-' ? 'm' : ''}>{a?.s}</div>
                    <div className={b && b.t === '+' ? 'p' : ''}>{b?.s}</div>
                  </div>
                ))
              : cut.map((l, k) => (
                  <div key={k} className={l.t === '+' ? 'p' : l.t === '-' ? 'm' : ''}>
                    {l.t} {l.s}
                  </div>
                ))}
            {cut.length < lines.length && <div className="f-hunk">… {lines.length - cut.length} lignes de plus</div>}
          </div>
        )
      })}
      {!all && (edits.length > DIFF_EDITS || edits.some((e) => e.diff!.lines.length > DIFF_LINES)) && (
        <button type="button" className="f-out" onClick={() => setAll(true)}>
          <Icon name="chevron" size={13} /> Tout afficher ({edits.length} modification{edits.length > 1 ? 's' : ''})
        </button>
      )}
    </div>
  )
}
