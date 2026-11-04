import { useEffect, useState } from 'react'
import type { ChecklistSummary } from '../../../../shared/checklist'
import type { SessionMeta } from '../../../../shared/types'
import '../../checklists.css'
import { useChecklists } from '../../checklists'
import { Icon } from '../../icons'
import { useStore } from '../../store'
import { CheckBox, ProgressRing } from './ChecklistCard'

const SHOWN = 5

/** Checklists du projet de la session : celles liées à la session d'abord, puis les plus récentes. */
export function useSessionChecklists(session: SessionMeta) {
  const summaries = useChecklists((s) => s.summaries)
  const sdk = session.sdkSessionId
  const isLinked = (c: ChecklistSummary) => !!sdk && c.sessions.includes(sdk)
  return summaries
    .filter((c) => c.projectId === session.projectId)
    .map((c) => ({ ...c, linked: isLinked(c) }))
    .sort((a, b) => Number(b.linked) - Number(a.linked) || b.updatedAt - a.updatedAt)
}

function DockCard({ id, initialOpen }: { id: string; initialOpen: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const [draft, setDraft] = useState('')
  const c = useChecklists((s) => s.byId[id])
  const summary = useChecklists((s) => s.summaries.find((x) => x.id === id))
  const fetch = useChecklists((s) => s.fetch)
  const update = useChecklists((s) => s.update)
  const go = useStore((s) => s.go)
  const updatedAt = summary?.updatedAt
  useEffect(() => {
    void fetch(id)
  }, [id, updatedAt, fetch])
  if (!summary) return null
  const todo = (c?.items ?? []).filter((i) => i.state !== 'done')
  const shown = todo.slice(0, SHOWN)
  return (
    <div className={`cl-dcard ${open ? 'open' : ''}`}>
      <button type="button" className="cl-dhead" aria-expanded={open} onClick={() => setOpen(!open)}>
        <ProgressRing done={summary.done} total={summary.total} size={18} />
        <b title={summary.title}>{summary.title}</b>
        <span className="small muted">{summary.done}/{summary.total}</span>
        <Icon name="chevron" size={14} className="a-chev" />
      </button>
      {open && (
        <div className="cl-dbody">
          {shown.map((i) => (
            <div key={i.id} className={`cl-item ${i.state}`}>
              <CheckBox
                state={i.state}
                label={i.text}
                onClick={() => void update(id, [{ op: 'set', itemId: i.id, state: 'done' }])}
                onContextMenu={() => void update(id, [{ op: 'set', itemId: i.id, state: i.state === 'work' ? 'todo' : 'work' }])}
              />
              <span className="cl-text">{i.text}</span>
            </div>
          ))}
          {todo.length > SHOWN && (
            <button type="button" className="cl-more" onClick={() => go({ name: 'checklists', id })}>
              + {todo.length - SHOWN} autre{todo.length - SHOWN > 1 ? 's' : ''} · tout voir
            </button>
          )}
          {c && todo.length === 0 && <div className="small muted" style={{ padding: '4px 6px' }}>Tout est fait.</div>}
          <div className="cl-add">
            <Icon name="plus" size={14} />
            <input
              value={draft}
              placeholder="Ajouter…"
              aria-label="Ajouter un élément"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !draft.trim()) return
                void update(id, [{ op: 'add', text: draft.trim() }])
                setDraft('')
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export function ChecklistDock({ session }: { session: SessionMeta }) {
  const lists = useSessionChecklists(session)
  return (
    <div className="cl-dock">
      {lists.length === 0 && <div className="empty">Les checklists du projet apparaîtront ici.</div>}
      {lists.map((c, n) => (
        <DockCard key={c.id} id={c.id} initialOpen={c.linked || (n === 0 && lists.length === 1)} />
      ))}
    </div>
  )
}
