import { useEffect, useState } from 'react'
import type { AgentDraft, AgentFile, ToolsInventory } from '../../../shared/types'
import { Icon } from '../icons'
import { api } from '../store'

// Onglet « Agents » de la page Outils de Claude (planche 38) : les agents custom, lisibles comme des fiches
// (quand Claude s'en sert, modèle, outils, consignes), modifiables, créés en les décrivant, coupés par projet.

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')}k` : String(n))
const MODELS: [string | undefined, string][] = [['haiku', 'Haiku'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], [undefined, 'Comme la session']]
const READ_ONLY = new Set(['Read', 'Grep', 'Glob', 'WebSearch', 'WebFetch'])
const modelLabel = (m?: string) => MODELS.find(([v]) => v === m)?.[1] ?? m ?? 'Comme la session'
const toolsLabel = (t?: string[]) => (!t?.length ? 'Tous les outils' : t.every((x) => READ_ONLY.has(x)) ? `Lecture seule · ${t.length}` : t.slice(0, 4).join(' · ') + (t.length > 4 ? ` +${t.length - 4}` : ''))
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)

/** Ce que l'éditeur affiche : un agent existant, une fiche neuve, ou un agent intégré (lecture seule). */
export type AgentSel = { kind: 'file'; agent: AgentFile } | { kind: 'new'; draft: AgentDraft & { scope: AgentFile['scope'] }; why?: string } | { kind: 'describe' } | { kind: 'builtin'; name: string; source: string; tokens: number }

function Mark({ name, size = 28 }: { name: string; size?: number }) {
  const h = hue(name)
  return (
    <span className="ag-mark" style={{ width: size, height: size, background: `hsl(${h} 45% 50% / 0.14)`, color: `hsl(${h} 45% 40%)` }} aria-hidden="true">
      {name[0]?.toUpperCase()}
    </span>
  )
}

export function AgentsPane({ agents, inv, filter, sel, onSel, onToggle }: { agents: AgentFile[] | null; inv: ToolsInventory | null; filter: string; sel: AgentSel | null; onSel: (s: AgentSel) => void; onToggle: (a: AgentFile) => void }) {
  if (!agents) return <div className="empty">Lecture des agents…</div>
  const q = filter.trim().toLowerCase()
  const match = (s: string) => !q || s.toLowerCase().includes(q)
  const tokens = (name: string) => inv?.agents.find((a) => a.name === name)?.tokens ?? 0
  const own = agents.filter((a) => a.scope === 'user' && match(`${a.name} ${a.description}`))
  const proj = agents.filter((a) => a.scope === 'project' && match(`${a.name} ${a.description}`))
  const builtins = (inv?.agents ?? []).filter((a) => !agents.some((f) => f.name === a.name) && match(a.name))
  const cur = sel?.kind === 'file' ? sel.agent.path : sel?.kind === 'builtin' ? `b:${sel.name}` : ''
  const row = (a: AgentFile) => (
    <div key={a.path} role="listitem" className={`tools-row ${cur === a.path ? 'on' : ''} ${a.enabled ? '' : 'off'}`}>
      <button type="button" role="switch" aria-checked={a.enabled} aria-label={`${a.enabled ? 'Couper' : 'Activer'} ${a.name} pour ce projet`} className="tools-switch" onClick={() => onToggle(a)}>
        <span />
      </button>
      <button type="button" className="ag-row" onClick={() => onSel({ kind: 'file', agent: a })}>
        <Mark name={a.name} />
        <span className="ag-txt"><b>{a.name}</b><span>{a.description}</span></span>
        <span className="ag-chip">{modelLabel(a.model)}</span>
        <span className="ag-tools">{toolsLabel(a.tools)}</span>
        <span className="ag-tok">{tokens(a.name) ? k(tokens(a.name)) : '—'}</span>
      </button>
    </div>
  )
  return (
    <>
      <div className="ag-head">
        <span className="small muted">Des Claude spécialisés, que Claude appelle quand la tâche correspond.</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm" onClick={() => onSel({ kind: 'describe' })}><Icon name="plus" size={14} />Nouvel agent</button>
      </div>
      {[['Les miens · tous projets', own], ['Ce projet', proj]].map(([title, list]) => (
        <section key={title as string} className="ag-group">
          <div className="side-h">{title as string}</div>
          <div className="tools-table" role="list" aria-label={title as string}>
            {(list as AgentFile[]).length === 0 ? <div className="empty">Aucun agent{q ? ' pour ce filtre' : ''}.</div> : (list as AgentFile[]).map(row)}
          </div>
        </section>
      ))}
      {builtins.length > 0 && (
        <section className="ag-group">
          <div className="side-h">Intégrés et plugins</div>
          <div className="tools-table" role="list" aria-label="Intégrés et plugins">
            {builtins.map((b) => (
              <div key={b.name} role="listitem" className={`tools-row ${cur === `b:${b.name}` ? 'on' : ''}`}>
                <span className="tools-switch ghost" aria-hidden="true" />
                <button type="button" className="ag-row" onClick={() => onSel({ kind: 'builtin', name: b.name, source: b.source, tokens: b.tokens })}>
                  <Mark name={b.name} />
                  <span className="ag-txt"><b>{b.name}</b><span>{b.source === 'plugin' ? 'Plugin' : 'Intégré à Claude Code'}</span></span>
                  <span />
                  <span />
                  <span className="ag-tok">{b.tokens ? k(b.tokens) : '—'}</span>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}

function Seg<T>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <span className="seg ag-seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={l} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>
      ))}
    </span>
  )
}

/** Panneau de droite : décrire un nouvel agent, ou sa fiche. */
export function AgentSide({ sel, projectId, projectName, onSel, onChanged }: { sel: AgentSel; projectId: string; projectName: string; onSel: (s: AgentSel | null) => void; onChanged: (keep?: AgentFile) => void }) {
  if (sel.kind === 'describe') return <Describe projectName={projectName} onDraft={(draft, why) => onSel({ kind: 'new', draft, why })} onBlank={(scope) => onSel({ kind: 'new', draft: { name: '', description: '', prompt: '', scope } })} />
  if (sel.kind === 'builtin')
    return (
      <aside className="tools-side" aria-label={`Agent ${sel.name}`}>
        <div className="tools-detail">
          <span className="side-h">Agent · {sel.source === 'plugin' ? 'plugin' : 'intégré'}</span>
          <h2 className="tools-name">{sel.name}</h2>
          <p className="small muted">Fourni par {sel.source === 'plugin' ? 'un plugin' : 'Claude Code'} : il ne se modifie pas ici. Pour un agent qui fait la même chose à ta façon, crée-en un et décris-le.</p>
          <dl className="tools-facts"><div><dt>Coût au démarrage</dt><dd>{sel.tokens ? `${sel.tokens} tokens` : '—'}</dd></div></dl>
        </div>
      </aside>
    )
  const key = sel.kind === 'file' ? sel.agent.path : `new:${sel.draft.name}:${sel.why ?? ''}`
  return <Sheet key={key} sel={sel} projectId={projectId} projectName={projectName} onSel={onSel} onChanged={onChanged} />
}

function Describe({ projectName, onDraft, onBlank }: { projectName: string; onDraft: (d: AgentDraft & { scope: AgentFile['scope'] }, why: string) => void; onBlank: (scope: AgentFile['scope']) => void }) {
  const [text, setText] = useState('')
  const [scope, setScope] = useState<AgentFile['scope']>('user')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    setErr('')
    try {
      const d = await api.draftAgent(text)
      onDraft({ ...d, scope }, d.why)
    } catch (e) {
      setErr(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  return (
    <aside className="tools-side" aria-label="Nouvel agent">
      <div className="tools-detail ag-describe">
        <span className="side-h">Nouvel agent</span>
        <h2 className="tools-name">Décris ce qu’il doit faire</h2>
        <p className="small muted">Claude rédige la fiche : consignes, outils au plus juste, le modèle le moins cher qui suffit. Tu la relis avant de l’enregistrer.</p>
        <label className="sr-only" htmlFor="ag-describe">Description de l’agent</label>
        <textarea id="ag-describe" rows={5} value={text} placeholder="Ex. : un agent qui prépare mes comptes rendus de réunion à partir de la transcription Teams : décisions, actions avec qui et quand, et rien d’autre." onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && void go()} />
        <div className="ag-field"><span>Portée</span><Seg<AgentFile['scope']> label="Portée" value={scope} options={[['user', 'Moi · tous projets'], ['project', `Ce projet · ${projectName}`]]} onChange={setScope} /></div>
        {err && <p className="tools-err">{err}</p>}
        <div className="tools-acts">
          <button type="button" className="btn clay sm" disabled={busy || !text.trim()} onClick={() => void go()}>{busy ? 'Claude rédige la fiche…' : 'Rédiger la fiche'}</button>
          <button type="button" className="btn sm" disabled={busy} onClick={() => onBlank(scope)}>Partir d’une fiche vide</button>
        </div>
      </div>
    </aside>
  )
}

function Sheet({ sel, projectId, projectName, onSel, onChanged }: { sel: Extract<AgentSel, { kind: 'file' | 'new' }>; projectId: string; projectName: string; onSel: (s: AgentSel | null) => void; onChanged: (keep?: AgentFile) => void }) {
  const base = sel.kind === 'file' ? sel.agent : sel.draft
  const [a, setA] = useState<AgentDraft & { scope: AgentFile['scope'] }>({ name: base.name, description: base.description, model: base.model, tools: base.tools, prompt: base.prompt, scope: base.scope })
  const [tools, setTools] = useState((base.tools ?? []).join(', '))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  useEffect(() => setConfirm(false), [a])
  const isNew = sel.kind === 'new'
  const list = tools.split(',').map((t) => t.trim()).filter(Boolean)
  const dirty = isNew || JSON.stringify({ ...a, tools: list.length ? list : undefined }) !== JSON.stringify({ name: base.name, description: base.description, model: base.model, tools: base.tools?.length ? base.tools : undefined, prompt: base.prompt, scope: base.scope })
  const run = async (f: () => Promise<void>) => {
    setErr('')
    setBusy(true)
    try {
      await f()
    } catch (e) {
      setErr(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setBusy(false)
    }
  }
  const save = () =>
    run(async () => {
      if (!a.name.trim() || !a.description.trim() || !a.prompt.trim()) throw new Error('Il faut un nom, quand Claude s’en sert et des consignes.')
      const saved = await api.saveAgent(projectId, { ...a, tools: list.length ? list : undefined }, sel.kind === 'file' ? sel.agent.path : undefined)
      onChanged(saved)
    })
  const readOnly = list.length > 0 && list.every((t) => READ_ONLY.has(t))
  return (
    <aside className="tools-side ag-side" aria-label={`Fiche de ${a.name || 'l’agent'}`}>
      <div className="ag-sheet">
        <div className="ag-title">
          <Mark name={a.name || '?'} size={32} />
          <label className="sr-only" htmlFor="ag-name">Nom</label>
          <input id="ag-name" className="ag-name" value={a.name} placeholder="nom-de-l-agent" onChange={(e) => setA({ ...a, name: e.target.value })} />
        </div>
        {sel.kind === 'new' && sel.why && <p className="ag-why">{sel.why}</p>}
        <label className="ag-field">
          <span>Quand Claude s’en sert</span>
          <textarea rows={3} value={a.description} onChange={(e) => setA({ ...a, description: e.target.value })} />
          <small>C’est ce texte que Claude lit pour décider de l’appeler : précis et concret.</small>
        </label>
        <div className="ag-field"><span>Modèle</span><Seg label="Modèle" value={a.model} options={MODELS} onChange={(model) => setA({ ...a, model })} /></div>
        <label className="ag-field">
          <span>Outils permis</span>
          <input value={tools} placeholder="Tous les outils de la session" onChange={(e) => setTools(e.target.value)} />
          <small>{!list.length ? 'Vide : il a tous les outils de la session.' : readOnly ? 'Lecture seule : il ne peut rien modifier.' : 'Séparés par des virgules (Read, Grep, Edit, Bash…).'}</small>
        </label>
        <div className="ag-field">
          <span>Portée</span>
          <Seg<AgentFile['scope']> label="Portée" value={a.scope} options={[['user', 'Moi · tous projets'], ['project', `Ce projet · ${projectName}`]]} onChange={(scope) => setA({ ...a, scope })} />
          {sel.kind === 'file' && <small className="mono" title={sel.agent.path}>{sel.agent.path}</small>}
        </div>
        <label className="ag-field ag-prompt">
          <span>Consignes <small>≈ {Math.round(a.prompt.length / 3.6)} tokens</small></span>
          <textarea value={a.prompt} onChange={(e) => setA({ ...a, prompt: e.target.value })} />
        </label>
        {err && <p className="tools-err">{err}</p>}
        <div className="tools-acts">
          <button type="button" className="btn clay sm" disabled={busy || !dirty} onClick={() => void save()}>{isNew ? 'Créer l’agent' : 'Enregistrer'}</button>
          {sel.kind === 'file' && (
            <>
              <button type="button" className="btn sm" disabled={busy} onClick={() => onSel({ kind: 'new', draft: { ...a, name: `${a.name}-copie`, tools: list.length ? list : undefined } })}>Dupliquer</button>
              <button
                type="button"
                className={`btn sm ${confirm ? 'danger' : ''}`}
                disabled={busy}
                onClick={() =>
                  confirm
                    ? void run(async () => {
                        await api.deleteAgent(sel.agent.path)
                        onChanged()
                        onSel(null)
                      })
                    : setConfirm(true)
                }
              >
                {confirm ? 'Confirmer la suppression' : 'Supprimer'}
              </button>
            </>
          )}
          {isNew && <button type="button" className="btn sm" onClick={() => onSel({ kind: 'describe' })}>Annuler</button>}
        </div>
        {sel.kind === 'file' && confirm && <small className="muted">Le fichier est gardé à côté en .bak : rien n’est perdu.</small>}
      </div>
    </aside>
  )
}
