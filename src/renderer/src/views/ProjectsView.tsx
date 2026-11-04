import { api, useStore } from '../store'
import { Tile, TopBar } from '../ui'
import { newSession } from './Cockpit'

export function ProjectsView() {
  const projects = useStore((s) => s.projects)
  const load = useStore((s) => s.loadProjects)

  const add = async () => {
    if (await api.addProject()) await load()
  }
  const remove = async (id: string, name: string) => {
    if (!window.confirm(`Retirer « ${name} » de Canopy ? Le dossier n’est pas supprimé.`)) return
    await api.removeProject(id)
    await load()
  }

  return (
    <div className="main">
      <TopBar>
        Canopy / <b>Projets</b>
      </TopBar>
      <div className="scroll">
        <div className="page" style={{ maxWidth: 900 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <h1 className="h1">Projets</h1>
              <p className="sub">Un projet = un dossier. Les sessions y tournent avec ta config Claude Code.</p>
            </div>
            <button type="button" className="btn primary" onClick={add}>Ajouter un dossier</button>
          </div>
          <div className="band" style={{ flexDirection: 'column' }}>
            {projects.length === 0 && <div className="empty">Aucun projet pour l’instant.</div>}
            {projects.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '14px 18px', borderBottom: '0.5px solid var(--line)' }}>
                <Tile project={p} size={36} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 15, fontWeight: 500 }}>{p.name}</span>
                  <span className="mono small muted" style={{ overflowWrap: 'anywhere' }}>
                    {p.path}
                    {p.branch ? ` · ${p.branch}` : ''}
                  </span>
                </span>
                <button type="button" className="btn sm" onClick={() => newSession(p.id)}>+ Session</button>
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => {
                    const name = window.prompt('Nouveau nom du projet (le dossier ne change pas) :', p.name)
                    if (name && name.trim() && name.trim() !== p.name) void api.renameProject(p.id, name.trim()).then(() => load())
                  }}
                >
                  Renommer
                </button>
                <button type="button" className="btn ghost sm" onClick={() => remove(p.id, p.name)}>Retirer</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
