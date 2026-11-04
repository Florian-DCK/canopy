import { useEffect, useMemo, useState } from 'react'
import type { CheckItem, ChecklistSummary } from '../../../shared/checklist'
import '../checklists.css'
import { markSeen, useChecklists } from '../checklists'
import { ago } from '../derive'
import { Icon } from '../icons'
import { resumeFromHistory, useStore } from '../store'
import { TopBar } from '../ui'
import { CheckBox, ProgressRing } from './session/ChecklistCard'
import { Menu, MenuItem } from './session/Chrome'

/** Titre d'une session liée : sessions ouvertes d'abord, puis historique. */
function useSessionTitle() {
  const sessions = useStore((s) => s.sessions)
  const history = useStore((s) => s.history)
  return (sdk: string) => Object.values(sessions).find((x) => x.sdkSessionId === sdk)?.title ?? history.find((h) => h.sdkSessionId === sdk)?.title
}

const nextState = (s: CheckItem['state']) => (s === 'done' ? 'todo' : 'done')

function ItemRow({ item, onSet, onEdit, onRemove }: { item: CheckItem; onSet: (s: CheckItem['state']) => void; onEdit: (text: string) => void; onRemove: () => void }) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(item.text)
  const finish = (save: boolean) => {
    setEditing(false)
    if (save && text.trim() && text.trim() !== item.text) onEdit(text.trim())
    else setText(item.text)
  }
  return (
    <div className={`cl-item ${item.state} ${item.depth ? 'sub' : ''}`}>
      <CheckBox state={item.state} label={item.text} onClick={() => onSet(nextState(item.state))} onContextMenu={() => onSet(item.state === 'work' ? 'todo' : 'work')} />
      {editing ? (
        <input
          className="cl-text-in"
          autoFocus
          value={text}
          aria-label="Texte de l’élément"
          onChange={(e) => setText(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish(true)
            if (e.key === 'Escape') finish(false)
          }}
        />
      ) : (
        <span className="cl-text" onDoubleClick={() => { setText(item.text); setEditing(true) }}>{item.text}</span>
      )}
      <span className="cl-hover">
        {item.state !== 'work' && (
          <button type="button" className="btn text sm" onClick={() => onSet('work')}>en cours</button>
        )}
        <button type="button" className="icon-btn sm" aria-label="Supprimer l’élément" title="Supprimer" onClick={onRemove}>
          <Icon name="close" size={14} />
        </button>
      </span>
      {item.at && (
        <span className="cl-meta">
          <Icon name={item.by === 'claude' ? 'claude' : 'user'} size={13} className={item.by === 'claude' ? 'claude' : ''} />
          {item.by === 'claude' ? 'Claude' : 'toi'} · {new Date(item.at).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })}
        </span>
      )}
    </div>
  )
}

/** Éléments de premier niveau, chacun suivi de ses sous-éléments. */
type Block = { item: CheckItem; kids: CheckItem[] }
function toBlocks(items: CheckItem[]): Block[] {
  const out: Block[] = []
  for (const i of items) {
    if (i.depth === 1 && out.length) out[out.length - 1].kids.push(i)
    else out.push({ item: i, kids: [] })
  }
  return out
}

function Detail({ id }: { id: string }) {
  const c = useChecklists((s) => s.byId[id])
  const summary = useChecklists((s) => s.summaries.find((x) => x.id === id))
  const fetch = useChecklists((s) => s.fetch)
  const update = useChecklists((s) => s.update)
  const remove = useChecklists((s) => s.remove)
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  const history = useStore((s) => s.history)
  const go = useStore((s) => s.go)
  const titleOf = useSessionTitle()
  const [renaming, setRenaming] = useState(false)
  const [title, setTitle] = useState('')
  const [draft, setDraft] = useState('')
  useEffect(() => {
    void fetch(id)
  }, [id, fetch])

  const sections = useMemo(() => {
    const items = c?.items ?? []
    const blocks = toBlocks(items)
    if (items.some((i) => i.section)) {
      const m = new Map<string, Block[]>()
      for (const b of blocks) m.set(b.item.section ?? '', [...(m.get(b.item.section ?? '') ?? []), b])
      return [...m.entries()].map(([label, bs]) => ({ label, blocks: bs }))
    }
    return (['done', 'work', 'todo'] as const)
      .map((st) => ({ label: st === 'done' ? 'Fait' : st === 'work' ? 'En cours' : 'À faire', blocks: blocks.filter((b) => b.item.state === st) }))
      .filter((g) => g.blocks.length)
  }, [c])

  if (!c) return <div className="cl-empty">{summary ? 'Chargement…' : 'Checklist introuvable.'}</div>
  const project = projects.find((p) => p.id === c.projectId)
  const total = c.items.length
  const done = c.items.filter((i) => i.state === 'done').length
  const working = c.items.filter((i) => i.state === 'work').length
  const linked = c.sessions.map((sdk) => ({ sdk, open: Object.values(sessions).find((x) => x.sdkSessionId === sdk), hist: history.find((h) => h.sdkSessionId === sdk) }))
  const first = linked.find((l) => l.open) ?? linked.find((l) => l.hist)
  const firstTitle = first && (first.open?.title ?? first.hist?.title)
  const linkable = Object.values(sessions).filter((s) => s.projectId === c.projectId && s.sdkSessionId && !c.sessions.includes(s.sdkSessionId))
  const set = (itemId: string, state: CheckItem['state']) => void update(c.id, [{ op: 'set', itemId, state }])

  return (
    <div className="cl-detail">
      <div>
        <div className="cl-path">
          {project?.name ?? c.projectId} · {c.path}
        </div>
        <div className="cl-title-row">
          {renaming ? (
            <input
              className="cl-title cl-title-in"
              autoFocus
              value={title}
              aria-label="Titre de la checklist"
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => {
                setRenaming(false)
                if (title.trim() && title.trim() !== c.title) void update(c.id, [{ op: 'title', title: title.trim() }])
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') setRenaming(false)
              }}
            />
          ) : (
            <h1 className="cl-title">{c.title}</h1>
          )}
          <ProgressRing done={done} total={total} size={34} />
          <Menu label="Plus d’actions" button={<Icon name="more" size={18} />}>
            {(close) => (
              <>
                <MenuItem icon="edit" onClick={() => { setTitle(c.title); setRenaming(true); close() }}>Renommer</MenuItem>
                <MenuItem
                  icon="close"
                  danger
                  onClick={() => {
                    close()
                    if (window.confirm(`Supprimer la checklist « ${c.title} » ? Le fichier sera supprimé du projet.`)) {
                      void remove(c.id)
                      go({ name: 'checklists' })
                    }
                  }}
                >
                  Supprimer
                </MenuItem>
              </>
            )}
          </Menu>
        </div>
        <div className="cl-prog">
          {done} sur {total}
          {working > 0 && ` · ${working} en cours`}
        </div>
      </div>

      <div className="cl-acts">
        {first && (
          <button
            type="button"
            className="btn"
            onClick={() => (first.open ? go({ name: 'session', sessionId: first.open.id }) : first.hist && void resumeFromHistory(first.hist))}
          >
            <Icon name="conversation" size={15} /> Ouvrir « {firstTitle} »
          </button>
        )}
        <Menu label="Lier une session" className="btn" align="left" button={<><Icon name="link" size={15} />Lier une session</>}>
          {(close) =>
            linkable.length ? (
              linkable.map((s) => (
                <MenuItem key={s.id} icon="conversation" onClick={() => { void update(c.id, [{ op: 'link', sessionId: s.sdkSessionId! }]); close() }}>
                  {s.title}
                </MenuItem>
              ))
            ) : (
              <div className="small muted" style={{ padding: '8px 10px' }}>Aucune session ouverte de ce projet à lier.</div>
            )
          }
        </Menu>
        {linked.length > 1 && <span className="small muted">{linked.length} sessions liées</span>}
        {linked.map((l) => !l.open && !l.hist && <span key={l.sdk} className="small muted" title={l.sdk}>session {titleOf(l.sdk) ?? l.sdk.slice(0, 8)}</span>)}
      </div>

      {sections.map((g) => (
        <section key={g.label}>
          {g.label && <div className="cl-sec-h">{g.label}</div>}
          {g.blocks.map((b) =>
            [b.item, ...b.kids].map((i) => (
              <ItemRow
                key={i.id}
                item={i}
                onSet={(st) => set(i.id, st)}
                onEdit={(text) => void update(c.id, [{ op: 'edit', itemId: i.id, text }])}
                onRemove={() => void update(c.id, [{ op: 'remove', itemId: i.id }])}
              />
            ))
          )}
        </section>
      ))}
      <div className="cl-add">
        <Icon name="plus" size={16} />
        <input
          value={draft}
          placeholder="Ajouter un élément…"
          aria-label="Ajouter un élément"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || !draft.trim()) return
            void update(c.id, [{ op: 'add', text: draft.trim() }])
            setDraft('')
          }}
        />
      </div>
    </div>
  )
}

function Card({ c, active, onClick }: { c: ChecklistSummary; active: boolean; onClick: () => void }) {
  const titleOf = useSessionTitle()
  const names = c.sessions.map(titleOf).filter(Boolean) as string[]
  return (
    <button type="button" className="cl-card" aria-current={active} onClick={onClick}>
      <ProgressRing done={c.done} total={c.total} size={26} />
      <span className="cl-card-txt">
        <span className="cl-card-t">{c.title}</span>
        <span className="cl-card-m">
          <span>{c.done} / {c.total}</span>
          {names.length > 0 && <span title={names.join(', ')}>· {names[0]}{names.length > 1 ? ` +${names.length - 1}` : ''}</span>}
          <span>· {ago(c.updatedAt)}</span>
        </span>
      </span>
    </button>
  )
}

export function ChecklistsView({ id }: { id?: string }) {
  const summaries = useChecklists((s) => s.summaries)
  const load = useChecklists((s) => s.load)
  const create = useChecklists((s) => s.create)
  const projects = useStore((s) => s.projects)
  const loadHistory = useStore((s) => s.loadHistory)
  const hasHistory = useStore((s) => s.history.length > 0)
  const go = useStore((s) => s.go)
  const [q, setQ] = useState('')
  const [seg, setSeg] = useState<'run' | 'all'>('run')
  const [creating, setCreating] = useState(false)
  const [title, setTitle] = useState('')
  const [pid, setPid] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => {
    void load()
    if (!hasHistory) void loadHistory()
    markSeen()
    return markSeen
  }, [load, loadHistory, hasHistory])

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = summaries
      .filter((c) => (seg === 'all' || c.done < c.total || c.id === id) && (!needle || c.title.toLowerCase().includes(needle)))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const m = new Map<string, ChecklistSummary[]>()
    for (const c of rows) m.set(c.projectId, [...(m.get(c.projectId) ?? []), c])
    return [...m.entries()]
  }, [summaries, q, seg, id])
  const current = id ?? groups[0]?.[1][0]?.id

  const submit = async () => {
    const projectId = pid || projects[0]?.id
    if (!title.trim() || !projectId) return
    try {
      const c = await create(projectId, title.trim())
      setCreating(false)
      setTitle('')
      setErr('')
      go({ name: 'checklists', id: c.id })
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
    }
  }

  return (
    <div className="main">
      <TopBar>
        Canopy / <b>Checklists</b>
      </TopBar>
      <div className="cl-page">
        <aside className="cl-left" aria-label="Liste des checklists">
          <div className="cl-left-top">
            <input className="cl-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrer…" aria-label="Filtrer les checklists" />
            <div className="seg" role="group" aria-label="Filtre">
              <button type="button" aria-pressed={seg === 'run'} onClick={() => setSeg('run')}>En cours</button>
              <button type="button" aria-pressed={seg === 'all'} onClick={() => setSeg('all')}>Toutes</button>
            </div>
            {creating ? (
              <div className="cl-new">
                <input
                  className="cl-input"
                  autoFocus
                  value={title}
                  placeholder="Titre de la checklist"
                  aria-label="Titre de la nouvelle checklist"
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void submit()
                    if (e.key === 'Escape') setCreating(false)
                  }}
                />
                <select className="select" value={pid || projects[0]?.id || ''} aria-label="Projet" onChange={(e) => setPid(e.target.value)}>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {err && <span className="small" style={{ color: 'var(--st-err)' }}>{err}</span>}
                <div className="cl-new-acts">
                  <button type="button" className="btn clay sm" disabled={!title.trim() || !projects.length} onClick={() => void submit()}>Créer</button>
                  <button type="button" className="btn text sm" onClick={() => setCreating(false)}>Annuler</button>
                </div>
              </div>
            ) : (
              <button type="button" className="btn" onClick={() => setCreating(true)}>
                <Icon name="plus" size={15} /> Nouvelle checklist
              </button>
            )}
          </div>
          <div className="scroll">
            {groups.length === 0 && <div className="cl-empty">{summaries.length ? 'Aucune checklist ne correspond.' : 'Pas encore de checklist.'}</div>}
            {groups.map(([projectId, rows]) => {
              const p = projects.find((x) => x.id === projectId)
              return (
                <section key={projectId} className="cl-group">
                  <div className="cl-group-h">
                    <span className="cl-dot" style={{ background: p?.color ?? 'var(--g400)' }} />
                    {p?.name ?? projectId}
                  </div>
                  {rows.map((c) => (
                    <Card key={c.id} c={c} active={c.id === current} onClick={() => go({ name: 'checklists', id: c.id })} />
                  ))}
                </section>
              )
            })}
          </div>
        </aside>
        <div className="cl-right">
          {current ? <Detail key={current} id={current} /> : <div className="cl-empty">Choisis une checklist, ou crée-en une.</div>}
        </div>
      </div>
    </div>
  )
}
