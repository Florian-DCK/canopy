import '../session.css'
import '../tiles.css'
import { useEffect, useState } from 'react'
import type { Item, SessionMeta } from '../../../shared/types'
import { BrowserTabView } from '../browser/View'
import { hostOf, useBrowser } from '../browser/store'
import { Icon, type IconName } from '../icons'
import { addProjectDialog, useStore } from '../store'
import { fxClass, useFx } from '../fx'
import { addHint, dragSession, DRAG_TYPE, MAX_TILES, newSessionInTile, resolve, useTiles, type DragData } from '../tiles'
import { InTitleBar } from '../titlebar'
import { Tile } from '../ui'
import { ArtifactFrame, useArtifactTabs, useArtifactTitle, type SessionArtifact } from './Artifacts'
import { Composer } from './Composer'
import { Menu, MenuItem, StatusPill, WorkPanel } from './session/Chrome'
import { FocusChat } from './SessionView'

// Mosaïque (planche 15) : 1 à 4 sessions à la fois, chacune avec sa saisie ; la disposition suit leur nombre.
// Un seul panneau de travail, pour la case active.

const NO_ITEMS: Item[] = []

function readDrag(e: React.DragEvent): DragData | null {
  try {
    return JSON.parse(e.dataTransfer.getData(DRAG_TYPE))
  } catch {
    return null
  }
}

export function TilesView() {
  const t = useTiles()
  const sessions = useStore((s) => s.sessions)
  const projects = useStore((s) => s.projects)
  // Cases dont la session existe encore, avec leur position dans la mosaïque.
  const items = t.cells.map((c, i) => ({ c, i, s: resolve(c, sessions) })).filter((x) => x.s)
  const activeSession = resolve(t.cells[t.active], sessions)
  const inGrid = new Set(items.map((x) => x.s!.id))
  const others = Object.values(sessions)
    .filter((s) => !inGrid.has(s.id))
    .sort((a, b) => b.updatedAt - a.updatedAt)
  // Pendant un glisser, une case de plus apparaît pour ajouter (tant qu'il reste de la place).
  const [adding, setAdding] = useState(false)
  const canAdd = items.length < MAX_TILES
  const n = Math.max(1, items.length + (adding && canAdd ? 1 : 0))

  useEffect(() => {
    const stop = () => setAdding(false)
    window.addEventListener('dragend', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragend', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])

  // Ctrl+1…4 : aller à une case (et à sa saisie).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey || !/^[1-4]$/.test(e.key)) return
      const st = useTiles.getState()
      const all = useStore.getState().sessions
      const vis = st.cells.map((c, i) => ({ c, i })).filter((x) => resolve(x.c, all))
      const hit = vis[Number(e.key) - 1]
      if (!hit) return
      e.preventDefault()
      st.setActive(hit.i)
      document.getElementById(`composer-tile-${hit.i}`)?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="main tl">
      <InTitleBar side="left">
        <div className="tl-head">
          <b className="tl-title">Mosaïque</b>
          <span className="small muted">{items.length} session{items.length > 1 ? 's' : ''}</span>
          <Menu label="Ajouter une session" className="btn sm" align="left" button={<><Icon name="plus" size={14} />Ajouter une session</>}>
            {(done) => (
              <>
                {others.length > 0 && <div className="menu-h">Sessions ouvertes</div>}
                {others.map((s) => {
                  const p = projects.find((x) => x.id === s.projectId)
                  return (
                    <button key={s.id} type="button" className="menu-item tl-pick" onClick={() => { t.add(s.id); done() }}>
                      {p && <Tile project={p} size={18} />}
                      <span className="tl-pick-t">{s.title}</span>
                      <StatusPill session={s} compact />
                    </button>
                  )
                })}
                <div className="menu-h">Nouvelle session dans</div>
                {projects.map((p) => (
                  <MenuItem key={p.id} icon="plus" onClick={() => { void newSessionInTile(p.id); done() }}>{p.name}</MenuItem>
                ))}
                <MenuItem icon="files" onClick={() => { done(); void addProjectDialog().then((pr) => pr && newSessionInTile(pr.id)) }}>Ajouter un projet (dossier)…</MenuItem>
                <MenuItem icon="history" onClick={() => { useStore.getState().go({ name: 'history' }); done() }}>Reprendre depuis l’historique…</MenuItem>
                <div className="menu-hint">{addHint(items.length)} Ailleurs dans Canopy, Ctrl+clic sur une session l’ajoute ici.</div>
              </>
            )}
          </Menu>
        </div>
      </InTitleBar>

      <div className="tl-body">
        <div
          className={`tl-grid n${n}`}
          onDragOver={(e) => {
            if (canAdd && !adding && e.dataTransfer.types.includes(DRAG_TYPE)) setAdding(true)
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setAdding(false)
          }}
        >
          {items.map(({ c, i, s }) => (
            <TileCell key={i} i={i} session={s} view={c.view} active={i === t.active} panel={t.panel && i === t.active} others={others} />
          ))}
          {items.length === 0 && !adding && <TileCell i={0} active={false} panel={false} view="session" others={others} />}
          {adding && canAdd && <AddCell at={t.cells.length} />}
        </div>
        {t.panel && activeSession && <TilePanel session={activeSession} />}
      </div>
    </div>
  )
}

/** Case fantôme affichée pendant un glisser : y déposer une session l'ajoute à la mosaïque. */
function AddCell({ at }: { at: number }) {
  const [over, setOver] = useState(false)
  return (
    <section
      className={`tl-cell tl-add${over ? ' over' : ''}`}
      aria-label="Ajouter à la mosaïque"
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const d = readDrag(e)
        if (!d) return
        e.preventDefault()
        const st = useTiles.getState()
        if (d.from !== undefined && d.view === undefined) return // une case déplacée vers la case vide : rien à faire
        st.place(at, { sessionId: d.sessionId, sdk: useStore.getState().sessions[d.sessionId]?.sdkSessionId, view: d.view ?? 'session' })
        if (d.from !== undefined && d.view !== undefined && st.cells[d.from]?.view === d.view) useTiles.getState().setView(d.from, 'session')
      }}
    >
      <div className="tl-drop">Déposer ici — ajouter à la mosaïque</div>
    </section>
  )
}

function TilePanel({ session }: { session: SessionMeta }) {
  const items = useStore((s) => s.items[session.id] ?? NO_ITEMS)
  const project = useStore((s) => s.projects.find((p) => p.id === session.projectId))
  const toggle = useTiles((s) => s.togglePanel)
  const active = useTiles((s) => s.active)
  return (
    <div className="tl-panel">
      <div className="tl-panel-h">
        {project && <Tile project={project} size={18} />}
        <b className="tl-panel-t" title={project ? `${project.name} — ${session.title}` : session.title}>{session.title}</b>
        <button type="button" className="icon-btn sm" aria-label="Fermer le panneau" title="Fermer le panneau" onClick={() => toggle(active)}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <WorkPanel session={session} items={items} width={340} />
    </div>
  )
}

function TileCell({ i, session, view, active, panel, others }: { i: number; session?: SessionMeta; view: string; active: boolean; panel: boolean; others: SessionMeta[] }) {
  const t = useTiles()
  const [over, setOver] = useState(false)
  const drop = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      setOver(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false)
    },
    onDrop: (e: React.DragEvent) => {
      setOver(false)
      const d = readDrag(e)
      if (!d) return
      e.preventDefault()
      if (d.from !== undefined && d.from !== i && d.view === undefined) t.swap(d.from, i)
      else if (d.from !== i) {
        t.place(i, { sessionId: d.sessionId, sdk: useStore.getState().sessions[d.sessionId]?.sdkSessionId, view: d.view ?? 'session' })
        // Vue détachée : la case d'origine repasse sur le fil (un navigateur ne s'affiche qu'à un endroit).
        if (d.from !== undefined && d.view !== undefined && useTiles.getState().cells[d.from]?.view === d.view) t.setView(d.from, 'session')
      }
    }
  }
  const fresh = useFx((f) => f.fresh)
  const fx = fxClass(session, fresh)
  const cls = `tl-cell${active ? ' active' : ''}${fx ? ' ' + fx : ''}${over ? ' over' : ''}`
  return (
    <section className={cls} aria-label={session ? session.title : 'Mosaïque vide'} onMouseDownCapture={() => !active && t.setActive(i)} {...drop}>
      {session ? <Filled i={i} session={session} view={view} panel={panel} /> : <Empty i={i} others={others} />}
      {over && <div className="tl-drop">{session ? `Déposer ici — remplace « ${session.title} »` : 'Déposer ici'}</div>}
    </section>
  )
}

function Empty({ i, others }: { i: number; others: SessionMeta[] }) {
  const place = useTiles((s) => s.place)
  const projects = useStore((s) => s.projects)
  return (
    <div className="tl-empty">
      <h2 className="h2">Mosaïque vide</h2>
      <p className="small muted">Glisse une session depuis le cockpit ou la liste, ou choisis-en une :</p>
      <div className="tl-empty-list">
        {others.slice(0, 6).map((s) => {
          const p = projects.find((x) => x.id === s.projectId)
          return (
            <button key={s.id} type="button" className="tl-pick" onClick={() => place(i, { sessionId: s.id, sdk: s.sdkSessionId, view: 'session' })}>
              {p && <Tile project={p} size={20} />}
              <span className="tl-pick-t">{s.title}</span>
              <StatusPill session={s} compact />
            </button>
          )
        })}
        <Menu label="Nouvelle session" className="tl-pick muted" align="left" button={<><Icon name="plus" size={15} />Nouvelle session…</>}>
          {(done) => (
            <>
              {projects.map((p) => (
                <MenuItem key={p.id} icon="plus" onClick={() => { void newSessionInTile(p.id, i); done() }}>{p.name}</MenuItem>
              ))}
              <MenuItem icon="files" onClick={() => { done(); void addProjectDialog().then((pr) => pr && newSessionInTile(pr.id, i)) }}>Ajouter un projet (dossier)…</MenuItem>
            </>
          )}
        </Menu>
      </div>
    </div>
  )
}

/** Onglet de vue d'une case : icône seule quand la case est étroite, le nom passe dans l'infobulle. */
function ViewTab({ i, sessionId, k, on, icon, label }: { i: number; sessionId: string; k: string; on: boolean; icon: IconName; label: string }) {
  const setView = useTiles((s) => s.setView)
  return (
    <button
      type="button"
      role="tab"
      aria-selected={on}
      className="tl-vtab"
      aria-label={label}
      title={`${label} — glisser sur une autre case pour l’y afficher`}
      draggable
      onDragStart={(e) => dragSession(e, { sessionId, view: k, from: i })}
      onClick={() => setView(i, k)}
    >
      <Icon name={icon} size={14} />
      <span className="tl-vtab-l">{label}</span>
    </button>
  )
}

function ArtLabel({ a }: { a: SessionArtifact }) {
  return <>{useArtifactTitle(a)}</>
}

function ArtViewTab({ a, ...p }: { a: SessionArtifact; i: number; sessionId: string; on: boolean }) {
  return <ViewTab {...p} k={a.url} icon="artifact" label={useArtifactTitle(a)} />
}

function Filled({ i, session, view, panel }: { i: number; session: SessionMeta; view: string; panel: boolean }) {
  const t = useTiles()
  const project = useStore((s) => s.projects.find((p) => p.id === session.projectId))
  const go = useStore((s) => s.go)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const { tabs } = useArtifactTabs(session.id)
  const browser = useBrowser((s) => s.tabs[session.id])
  // Une vue disparue (navigateur fermé, artefact retiré) : retour au fil.
  const art = tabs.find((a) => a.url === view)
  const cur = view === 'browser' ? (browser ? 'browser' : 'session') : view === 'session' || !art ? 'session' : view
  const expand = () => {
    setActiveTab(session.id, cur)
    go({ name: 'session', sessionId: session.id })
  }
  return (
    <>
      <div className="tl-cell-h" draggable onDragStart={(e) => dragSession(e, { sessionId: session.id, from: i })} onDoubleClick={expand} title="Glisser pour déplacer · double-clic pour agrandir">
        {project && <Tile project={project} size={18} />}
        <b className="tl-name" title={project ? `${project.name} — ${session.title}` : session.title}>{session.title}</b>
        {(tabs.length > 0 || browser) && (
          <span className="tl-vtabs" role="tablist" aria-label="Vues de la session">
            <ViewTab i={i} sessionId={session.id} k="session" on={cur === 'session'} icon="conversation" label="Conversation" />
            {browser && <ViewTab i={i} sessionId={session.id} k="browser" on={cur === 'browser'} icon="web" label={hostOf(browser.url)} />}
            {tabs.map((a) => (
              <ArtViewTab key={a.url} a={a} i={i} sessionId={session.id} on={cur === a.url} />
            ))}
          </span>
        )}
        <StatusPill session={session} compact />
        <span className="tl-acts">
          <button type="button" className="icon-btn sm" aria-pressed={panel} aria-label="Panneau de travail" title="Panneau de travail" onClick={() => t.togglePanel(i)}>
            <Icon name="panel" size={15} />
          </button>
          <button type="button" className="icon-btn sm" aria-label="Agrandir" title="Agrandir (double-clic sur l’en-tête)" onClick={expand}>
            <Icon name="expand" size={15} />
          </button>
          <button type="button" className="icon-btn sm" aria-label="Retirer de la grille" title="Retirer de la grille (la session continue)" onClick={() => t.remove(i)}>
            <Icon name="close" size={15} />
          </button>
        </span>
      </div>
      <div className="tl-cell-b">
        {cur === 'session' && <FocusChat sessionId={session.id} inputId={`composer-tile-${i}`} />}
        {cur !== 'session' && (
          <div className="tl-view">
            <div className="tl-view-main">
              {cur === 'browser' ? (
                <BrowserTabView sessionId={session.id} embedded />
              ) : (
                <>
                  <div className="art-bar">
                    <span className="art-live"><span className="art-live-dot" aria-hidden="true" />en direct</span>
                    <span className="art-meta">{art && <ArtLabel a={art} />}{art?.version ? ` · v${art.version}` : ''}</span>
                  </div>
                  <div className="art-stage">
                    <ArtifactFrame url={cur} version={art?.version} />
                  </div>
                </>
              )}
            </div>
            {!session.readOnly && <Composer sessionId={session.id} inputId={`composer-tile-${i}`} onSent={() => undefined} />}
          </div>
        )}
      </div>
    </>
  )
}
