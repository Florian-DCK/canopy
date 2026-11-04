import { useMemo, useState } from 'react'
import type { ExternalSession, Project } from '../../../shared/types'
import { ago, treeOf, type Tree } from '../derive'
import { thumbUrl } from '../media'
import { addProjectDialog, api, openExternal, openSession, useStore } from '../store'
import { useLastImage } from './Media'
import { Icons, Tile, TopBar } from '../ui'
import { fxClass, useFx } from '../fx'
import { dragSession, openOrTile } from '../tiles'

export async function newSession(projectId: string) {
  openSession(await api.createSession(projectId))
}

export function TreeView({ tree }: { tree: Tree }) {
  const open = (e: { ctrlKey: boolean; metaKey: boolean }) => openOrTile(e, tree.session.id)
  const firstPending = tree.pending[0]
  const last = useLastImage(tree.session.id)
  const fresh = useFx((f) => f.fresh)
  return (
    <div className="tree">
      <button type="button" className={`root ${tree.status === 'wait' ? 'wait' : ''} ${fxClass(tree.session, fresh)}`} onClick={open} draggable onDragStart={(e) => dragSession(e, { sessionId: tree.session.id })} title="Ctrl+clic : ajouter à la Mosaïque" style={last ? { paddingTop: 0, overflow: 'hidden' } : undefined}>
        {last && (
          <span style={{ position: 'relative', display: 'block', height: 120, margin: '0 -14px 4px', background: 'var(--g150)' }}>
            <img src={thumbUrl(last.id)} alt={`Dernière vue : ${last.name}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <span className="thumb-label" style={{ top: 8, bottom: 'auto' }}>
              Dernière vue · {last.name} · {ago(last.at)}
            </span>
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`dot ${tree.status}`} aria-hidden="true" />
          <span style={{ fontSize: 12, fontWeight: 600 }}>{tree.kids.some((k) => !k.agent.startsWith('Étape')) ? 'Orchestrateur' : 'Session'}</span>
          {tree.session.model && <span className="tag">{tree.session.model.replace(/^claude-/, '')}</span>}
          <span style={{ flex: 1 }} />
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{ago(tree.session.startedAt)}</span>
        </span>
        <span className="task">{tree.session.title}</span>
        <span className={`small ${tree.status === 'wait' ? '' : 'muted'}`} style={tree.status === 'wait' ? { color: 'var(--clay-text)', fontWeight: 600 } : undefined}>
          {tree.label}
          {tree.last && tree.status !== 'wait' ? ` · ${tree.last}` : ''}
        </span>
      </button>
      {tree.kids.length > 0 && (
        <>
          <span className="branch-h" aria-hidden="true" />
          <div className="kids">
            {tree.kids.map((k) => (
              <div className="kid" key={k.id}>
                <span className={`pill ${k.status}`} title={k.last ? `${k.task} — ${k.last}` : k.task}>
                  <span className={`dot ${k.status}`} aria-hidden="true" />
                  <b style={{ fontWeight: 600 }}>{k.agent}</b>
                  <span className="t">{k.task}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {firstPending && (
        <button type="button" className="btn clay sm" style={{ marginLeft: 12 }} onClick={open}>
          Répondre
        </button>
      )}
    </div>
  )
}

export function Cockpit() {
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  const items = useStore((s) => s.items)
  const go = useStore((s) => s.go)

  const external = useStore((s) => s.external)

  const bands = useMemo(() => {
    const rows: BandData[] = projects.map((p) => ({
      p,
      registered: true,
      trees: Object.values(sessions)
        .filter((s) => s.projectId === p.id)
        .sort((a, b) => a.startedAt - b.startedAt)
        .map((s) => treeOf(s, items[s.id] ?? [])),
      externals: external.filter((x) => x.projectId === p.id),
      alert: false
    }))
    // Dossiers pas encore ajoutés : une bande par dossier de travail.
    const byCwd = new Map<string, BandData>()
    for (const x of external.filter((x) => !x.projectId)) {
      const key = x.cwd.toLowerCase()
      if (!byCwd.has(key)) {
        const name = x.cwd.split(/[\\/]/).filter(Boolean).pop() ?? x.cwd
        byCwd.set(key, {
          p: { id: `ext:${key}`, name, path: x.cwd, color: '#B0AEA5' }, // gris chaud moyen : lisible en clair comme en sombre
          registered: false,
          trees: [],
          externals: [],
          alert: false
        })
      }
      byCwd.get(key)!.externals.push(x)
    }
    return [...rows, ...byCwd.values()]
      .map((r) => ({ ...r, alert: r.trees.some((t) => t.status === 'wait') }))
      .filter((r) => r.trees.length || r.externals.length)
      .sort((a, b) => Number(b.alert) - Number(a.alert) || Number(b.registered) - Number(a.registered))
  }, [projects, sessions, items, external])

  const idle = projects.filter((p) => !bands.some((b) => b.p.id === p.id))
  const all = Object.values(sessions)
  const waiting = all.filter((s) => s.status === 'wait').length
  const running = all.filter((s) => s.status === 'run').length

  return (
    <div className="main">
      <TopBar>
        Canopy / <b>Cockpit</b>
      </TopBar>
      <div className="scroll">
        <div className="page">
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px' }}>
              <h1 className="h1">
                {bands.length ? `${bands.length} projet${bands.length > 1 ? 's' : ''} actif${bands.length > 1 ? 's' : ''}` : 'Rien ne tourne'}
              </h1>
              <p className="sub">
                {all.length} session{all.length > 1 ? 's' : ''} dans Canopy · {running} en cours
                {external.length > 0 && ` · ${external.length} active${external.length > 1 ? 's' : ''} ailleurs`}
                {waiting > 0 && (
                  <>
                    {' · '}
                    <span style={{ color: 'var(--clay-text)' }}>
                      {waiting} attend{waiting > 1 ? 'ent' : ''} ta réponse
                    </span>
                  </>
                )}
              </p>
            </div>
            <div role="list" aria-label="Projets actifs" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {bands.map(({ p, alert }) => (
                <span role="listitem" key={p.id} className="btn" style={{ paddingLeft: 6, fontWeight: 500 }}>
                  <Tile project={p} size={24} />
                  {p.name}
                  {alert && <span className="dot wait" aria-label="attend ta réponse" />}
                </span>
              ))}
              <button type="button" className="btn ghost" onClick={() => void addProjectDialog()} title="Choisir un dossier à ajouter comme projet">
                {Icons.plus}
                Projet
              </button>
            </div>
          </div>

          {projects.length === 0 && (
            <div className="band" style={{ padding: 28, flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
              <h2 className="h2">Ajoute ton premier projet</h2>
              <p className="muted" style={{ margin: 0 }}>Un projet = un dossier de ton disque. Les sessions Claude Code y tournent avec ta config habituelle.</p>
              <button type="button" className="btn primary" onClick={() => void addProjectDialog()}>
                Ajouter un projet
              </button>
            </div>
          )}

          {bands.map((b) => (
            <Band key={b.p.id} data={b} />
          ))}

          {idle.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 13 }} className="muted">
              <span>{bands.length ? 'Sans session :' : 'Tes projets :'}</span>
              {idle.map((p) => (
                <button key={p.id} type="button" className="btn ghost sm" onClick={() => newSession(p.id)} title="Nouvelle session">
                  <Tile project={p} size={18} />
                  {p.name}
                  {Icons.plus}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

type BandData = { p: Project; registered: boolean; trees: Tree[]; externals: ExternalSession[]; alert: boolean }

/** Carte d'une session qui tourne hors de Canopy (terminal, VS Code…). */
function ExternalCard({ x }: { x: ExternalSession }) {
  const [busy, setBusy] = useState(false)
  const active = Date.now() - x.lastModified < 45_000
  return (
    <button
      type="button"
      className="root"
      disabled={busy}
      title="Ouvrir en lecture"
      onClick={async () => {
        setBusy(true)
        try {
          await openExternal(x)
        } finally {
          setBusy(false)
        }
      }}
      style={{ borderStyle: 'dashed' }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span className={`dot ${active ? 'run' : ''}`} aria-hidden="true" />
        <span style={{ fontSize: 12, fontWeight: 600 }}>Terminal</span>
        <span className="tag">hors Canopy</span>
        <span style={{ flex: 1 }} />
        <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{ago(x.lastModified)}</span>
      </span>
      <span className="task">{x.title}</span>
      <span className="small" style={{ color: active ? 'var(--blue-text)' : 'var(--g550)' }}>
        {busy ? 'Ouverture…' : active ? 'Actif à l’instant · ouvrir en lecture' : `Calme depuis ${ago(x.lastModified)} · ouvrir en lecture`}
      </span>
    </button>
  )
}

function Band({ data }: { data: BandData }) {
  const { p, trees, externals, alert, registered } = data
  const go = useStore((s) => s.go)
  const loadProjects = useStore((s) => s.loadProjects)
  const agents = trees.reduce((n, t) => n + t.kids.filter((k) => !k.agent.startsWith('Étape')).length, 0)
  const count = trees.length + externals.length
  return (
    <section className={`band ${alert ? 'alert' : ''}`} aria-label={p.name} style={registered ? undefined : { borderStyle: 'dashed' }}>
      <div className="band-head">
        <Tile project={p} />
        <span style={{ fontFamily: 'var(--serif)', fontSize: 24, fontWeight: 500, lineHeight: 1.2, overflowWrap: 'anywhere' }}>{p.name}</span>
        <span className="small" style={{ color: 'var(--g600)' }}>
          {count} session{count > 1 ? 's' : ''}
          {externals.length ? ` · ${externals.length} hors Canopy` : ''}
          {agents ? ` · ${agents} sous-agent${agents > 1 ? 's' : ''}` : ''}
        </span>
        {registered ? (
          p.branch && <span className="mono small muted">{p.branch}</span>
        ) : (
          <span className="mono small muted" style={{ overflowWrap: 'anywhere' }}>{p.path}</span>
        )}
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {registered ? (
            <>
              <button type="button" className="btn sm" onClick={() => go({ name: 'project', projectId: p.id })}>
                Ouvrir
              </button>
              <button type="button" className="btn sm" onClick={() => newSession(p.id)}>
                + Session
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                await api.addProjectPath(p.path)
                await loadProjects()
              }}
            >
              Ajouter ce projet
            </button>
          )}
        </span>
      </div>
      <div className="band-trees">
        {trees.map((t) => (
          <TreeView key={t.session.id} tree={t} />
        ))}
        {externals.map((x) => (
          <ExternalCard key={x.sdkSessionId} x={x} />
        ))}
      </div>
    </section>
  )
}
