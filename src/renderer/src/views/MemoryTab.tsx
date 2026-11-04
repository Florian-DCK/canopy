import { useState } from 'react'
import type { MemoryItem, MemoryList, ToolsInventory } from '../../../shared/types'
import { ago } from '../derive'
import { Icon } from '../icons'
import { api, useStore } from '../store'
import { MdText } from './session/Thread'

// Onglet « Mémoire » de la page Outils de Claude (planche 21) : ce qui est chargé à chaque session,
// puis les souvenirs du projet, avec leurs signaux (doublon, hors index).

export const MEM_TYPE: Record<string, { label: string; cls: string }> = {
  user: { label: 'Sur toi', cls: 'user' },
  feedback: { label: 'Retour', cls: 'feedback' },
  project: { label: 'Projet', cls: 'project' },
  reference: { label: 'Référence', cls: 'reference' }
}
const typeOf = (t: string) => MEM_TYPE[t] ?? { label: t, cls: 'project' }
const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n))
/** Nom lisible d'un dossier de projets Claude Code (« C--Users-fdonc » → « fdonc »). */
const dirLabel = (d: string) => d.split('-').filter(Boolean).pop() ?? d

export function MemoryPane({ mem, inv, filter, sel, onSel, projectName }: { mem: MemoryList | null; inv: ToolsInventory | null; filter: string; sel?: string; onSel: (file: string) => void; projectName: string }) {
  const [type, setType] = useState<string>('all')
  if (!mem) return <div className="empty">Lecture des souvenirs…</div>
  const q = filter.trim().toLowerCase()
  const items = mem.items.filter((m) => (type === 'all' || m.type === type) && (!q || `${m.name} ${m.description} ${m.body}`.toLowerCase().includes(q)))
  const always = inv?.memoryFiles ?? []
  const count = (t: string) => mem.items.filter((m) => m.type === t).length
  return (
    <>
      {always.length > 0 && (
        <section className="mem-always" aria-label="Chargé à chaque session">
          <div className="side-h">Chargé à chaque session · {k(always.reduce((n, f) => n + f.tokens, 0))} tokens</div>
          <div className="mem-cards">
            {always.map((f) => (
              <div key={f.path} className="mem-card" title={f.path}>
                <span><b>{f.path.split(/[\\/]/).pop()}</b><span className="mem-tok">{k(f.tokens)}</span></span>
                <span className="mono mem-path">{f.path}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      <div className="mem-types" role="group" aria-label="Type de souvenir">
        {[['all', 'Tout', mem.items.length], ...Object.entries(MEM_TYPE).map(([t, v]) => [t, v.label, count(t)])].map(([t, label, n]) => (
          <button key={t} type="button" aria-pressed={type === t} onClick={() => setType(String(t))}>
            {label} <span className="muted">{n}</span>
          </button>
        ))}
      </div>
      <div className="side-h">Souvenirs de {projectName} · lus quand ils servent</div>
      <div className="tools-table" role="list" aria-label="Souvenirs">
        {items.length === 0 && <div className="empty">Aucun souvenir{type !== 'all' || q ? ' pour ce filtre' : ' pour ce projet'}.</div>}
        {items.map((m) => (
          <div key={m.file} role="listitem" className={`tools-row ${sel === m.file ? 'on' : ''}`}>
            <button type="button" className="mem-row" onClick={() => onSel(m.file)}>
              <span className={`mem-type ${typeOf(m.type).cls}`}>{typeOf(m.type).label}</span>
              <span className="mem-txt"><b>{m.name}</b><span>{m.description}</span></span>
              <span className="mem-flag">
                {!m.inIndex && <span className="bad">pas dans l’index</span>}
                {m.dupIn.length > 0 && <span className="warn">aussi dans {m.dupIn.map(dirLabel).join(', ')}</span>}
              </span>
              <span className="mem-date">{ago(m.mtime)}</span>
            </button>
          </div>
        ))}
      </div>
    </>
  )
}

export function MemoryDetail({ m, projectId, onChanged }: { m: MemoryItem; projectId: string; onChanged: () => void }) {
  const projects = useStore((s) => s.projects)
  const [edit, setEdit] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)
  const [err, setErr] = useState('')
  const run = async (f: () => Promise<void>) => {
    setErr('')
    try {
      await f()
      onChanged()
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }
  return (
    <div className="tools-detail">
      <span className="side-h">Souvenir · {typeOf(m.type).label}</span>
      <h2 className="tools-name">{m.name}</h2>
      {edit === null ? (
        <div className="mem-body msg-ai"><MdText text={m.body} /></div>
      ) : (
        <textarea className="mem-edit mono" value={edit} onChange={(e) => setEdit(e.target.value)} aria-label="Contenu du souvenir" rows={14} />
      )}
      <span className="mono mem-path">{m.file} · modifié {ago(m.mtime)}</span>
      {err && <p className="tools-err">{err}</p>}
      <div className="tools-acts">
        {edit === null ? (
          <>
            <button type="button" className="btn sm" onClick={() => setEdit(m.raw)}><Icon name="edit" size={14} />Modifier</button>
            {moving ? (
              <select
                className="mem-move"
                aria-label="Projet de destination"
                defaultValue=""
                onChange={(e) => e.target.value && void run(() => api.moveMemory(projectId, m.file, e.target.value))}
              >
                <option value="" disabled>Déplacer vers…</option>
                {projects.filter((p) => p.id !== projectId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (
              <button type="button" className="btn sm" onClick={() => setMoving(true)}>Déplacer vers…</button>
            )}
            <button
              type="button"
              className="btn text sm bg-stop"
              onClick={() => window.confirm(`Oublier « ${m.name} » ? Le fichier part dans ~/.claude/memory-trash, récupérable.`) && void run(() => api.forgetMemory(projectId, m.file))}
            >
              Oublier
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn primary sm" onClick={() => void run(async () => { await api.writeMemory(projectId, m.file, edit); setEdit(null) })}>Enregistrer</button>
            <button type="button" className="btn text sm" onClick={() => setEdit(null)}>Annuler</button>
          </>
        )}
      </div>
    </div>
  )
}
