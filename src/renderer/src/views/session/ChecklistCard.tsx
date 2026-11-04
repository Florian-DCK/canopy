import type { CheckState, ChecklistToolSummary } from '../../../../shared/checklist'
import { TOOL_SUMMARY_RE } from '../../../../shared/checklist'
import '../../checklists.css'
import { Icon, Ring } from '../../icons'
import { useStore } from '../../store'
import { EventLine, type Tool } from './Thread'

/** Case d'état : à faire (contour gris), en cours (contour bleu + carré), fait (verte + coche). */
export function CheckBox({ state, onClick, onContextMenu, label }: { state: CheckState; onClick?: () => void; onContextMenu?: () => void; label?: string }) {
  return (
    <button
      type="button"
      className={`cl-box ${state} ${onClick ? '' : 'static'}`}
      role="checkbox"
      aria-checked={state === 'done' ? true : state === 'work' ? 'mixed' : false}
      aria-label={label}
      title={onContextMenu ? 'Clic : fait / à faire — clic droit : en cours' : undefined}
      onClick={onClick}
      onContextMenu={(e) => {
        if (!onContextMenu) return
        e.preventDefault()
        onContextMenu()
      }}
    >
      {state === 'done' && (
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M5.5 12.5l4.2 4.2L18.5 7.5" />
        </svg>
      )}
    </button>
  )
}

export function ProgressRing({ done, total, size = 22 }: { done: number; total: number; size?: number }) {
  const full = total > 0 && done >= total
  return (
    <span className={`cl-ring ${full ? 'full' : ''}`}>
      <Ring pct={total ? (full ? 1 : done / total) : 0} size={size} />
    </span>
  )
}

const TAG: Record<NonNullable<ChecklistToolSummary['changes']>[number]['change'], { label: string; cls: string; state: CheckState }> = {
  added: { label: '+ ajouté', cls: 'ok', state: 'todo' },
  done: { label: '✓ fait', cls: 'ok', state: 'done' },
  work: { label: 'en cours', cls: 'run', state: 'work' },
  undone: { label: 'décoché', cls: '', state: 'todo' },
  edited: { label: 'modifié', cls: '', state: 'todo' },
  removed: { label: 'retiré', cls: '', state: 'todo' }
}

function parse(t: Tool): ChecklistToolSummary | null {
  const m = t.result && TOOL_SUMMARY_RE.exec(t.result.split('\n', 1)[0])
  if (!m) return null
  try {
    return JSON.parse(m[1]) as ChecklistToolSummary
  } catch {
    return null
  }
}

/** Appel de l'outil checklist de Claude, dans le fil. */
export function ChecklistToolCard({ t }: { t: Tool }) {
  const go = useStore((s) => s.go)
  const sum = parse(t)
  if (t.status === 'running' && !t.result) return <EventLine icon="run">Checklist…</EventLine>
  if (!sum) return <EventLine icon="todo" tone={t.status === 'error' ? 'err' : undefined}>{t.status === 'error' ? 'Checklist : erreur' : 'Checklist'}</EventLine>
  if (sum.action === 'read' || sum.action === 'list')
    return (
      <EventLine icon="todo">
        {sum.action === 'list' ? 'A listé les checklists' : <>A lu <b>{sum.title}</b> · {sum.total} élément{sum.total > 1 ? 's' : ''}, {sum.done} fait{sum.done > 1 ? 's' : ''}</>}
      </EventLine>
    )
  const changes = sum.changes ?? []
  const verb = sum.action === 'create' ? 'A créé' : changes.length > 0 && changes.every((c) => c.change === 'done') ? 'A coché' : 'A modifié'
  return (
    <div className="cl-tcard">
      <div className="cl-thead">
        <Icon name="todo" size={15} />
        <span>{verb}</span>
        <b title={sum.title}>{sum.title}</b>
        <ProgressRing done={sum.done} total={sum.total} size={18} />
        <span>{sum.done}/{sum.total}</span>
        <button type="button" className="icon-btn sm" aria-label="Ouvrir la checklist" title="Ouvrir la checklist" onClick={() => go({ name: 'checklists', id: sum.id })}>
          <Icon name="external" size={14} />
        </button>
      </div>
      {changes.map((c, k) => {
        const tag = TAG[c.change]
        return (
          <div key={k} className={`cl-trow ${c.change}`}>
            <CheckBox state={tag.state} />
            <span className="cl-text">{c.text}</span>
            <span className={`cl-tag ${tag.cls}`}>{tag.label}</span>
          </div>
        )
      })}
    </div>
  )
}
