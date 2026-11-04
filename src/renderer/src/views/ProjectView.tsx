import { useEffect, useMemo } from 'react'
import { HistoryRow } from './HistoryView'
import { treeOf } from '../derive'
import { useStore } from '../store'
import { Tile, TopBar } from '../ui'
import { newSession, TreeView } from './Cockpit'

export function ProjectView({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.projects.find((p) => p.id === projectId))
  const sessions = useStore((s) => s.sessions)
  const items = useStore((s) => s.items)
  const go = useStore((s) => s.go)
  const history = useStore((s) => s.history)
  const loadHistory = useStore((s) => s.loadHistory)
  useEffect(() => {
    void loadHistory()
  }, [loadHistory, projectId])
  const openIds = new Set(Object.values(sessions).map((s) => s.sdkSessionId))
  const past = history.filter((h) => h.projectId === projectId && !openIds.has(h.sdkSessionId)).slice(0, 8)

  const mine = useMemo(() => Object.values(sessions).filter((s) => s.projectId === projectId), [sessions, projectId])
  const trees = mine.sort((a, b) => a.startedAt - b.startedAt).map((s) => treeOf(s, items[s.id] ?? []))

  // Fil : derniers outils et demandes de ce projet, toutes sessions confondues.
  const feed = mine
    .flatMap((s) =>
      (items[s.id] ?? [])
        .filter((i) => i.kind === 'tool' || i.kind === 'permission' || i.kind === 'result')
        .map((i) => ({ i, s }))
    )
    .sort((a, b) => b.i.at - a.i.at)
    .slice(0, 40)

  if (!project) return null
  return (
    <div className="main">
      <TopBar>
        <button type="button" className="btn ghost sm" onClick={() => go({ name: 'cockpit' })}>
          ← Cockpit
        </button>{' '}
        <b>{project.name}</b>
      </TopBar>
      <div className="cols">
        <div className="scroll">
          <div className="page">
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <Tile project={project} size={56} />
              <div style={{ flex: 1 }}>
                <h1 className="h1">{project.name}</h1>
                <p className="sub mono" style={{ fontSize: 13 }}>
                  {project.path}
                  {project.branch ? ` · ${project.branch}` : ''}
                </p>
              </div>
              <button type="button" className="btn primary" onClick={() => newSession(project.id)}>
                Nouvelle session
              </button>
            </div>
            {trees.length === 0 && <p className="muted">Aucune session sur ce projet pour l’instant.</p>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
              {trees.map((t) => (
                <TreeView key={t.session.id} tree={t} />
              ))}
            </div>
            {past.length > 0 && (
              <section style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                <h2 className="h2">Sessions passées</h2>
                <div className="band" style={{ flexDirection: 'column' }}>
                  {past.map((h) => (
                    <HistoryRow key={h.sdkSessionId} h={h} showProject={false} />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
        <aside className="panel" style={{ width: 360 }} aria-labelledby="feed">
          <div style={{ padding: '28px 24px 14px', borderBottom: '0.5px solid var(--line)' }}>
            <h2 id="feed" className="h2">Fil du projet</h2>
          </div>
          <div className="scroll" style={{ padding: '8px 0' }}>
            {feed.length === 0 && <div className="empty">Les actions des agents apparaîtront ici.</div>}
            {feed.map(({ i, s }) => (
              <button
                key={i.id}
                type="button"
                onClick={() => go({ name: 'session', sessionId: s.id })}
                style={{ display: 'flex', gap: 12, padding: '8px 24px', border: 'none', background: 'transparent', width: '100%', textAlign: 'left' }}
              >
                <span className="small muted" style={{ width: 40, flex: 'none' }}>
                  {new Date(i.at).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span
                    style={{
                      fontSize: 13,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      ...(i.kind === 'permission' && i.state === 'pending' ? { color: 'var(--clay-text)', fontWeight: 500 } : {})
                    }}
                  >
                    {i.kind === 'tool' ? `${i.name} ${i.summary}` : i.kind === 'permission' ? `Demande : ${i.tool} ${i.summary}` : i.kind === 'result' ? i.text : ''}
                  </span>
                  <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.title}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}
