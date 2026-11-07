import { useMemo, useState } from 'react'
import type { Item, TestFailure, TestReport } from '../../../shared/types'
import { api, useStore } from '../store'
import './outputs.css'

// Résultats de tests dans le fil (planche 49) : compteurs, barre, échecs dépliables (attendu, reçu,
// ligne en cause), et ce qui a changé depuis le passage précédent du même lanceur.

type Tool = Extract<Item, { kind: 'tool' }>
const NO_ITEMS: Item[] = []
const RUNNER: Record<TestReport['runner'], string> = { vitest: 'Vitest', jest: 'Jest', playwright: 'Playwright', pytest: 'pytest', cargo: 'cargo test', go: 'go test' }
const keyOf = (f: TestFailure) => `${f.suite ?? ''} › ${f.name}`
const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? 's' : ''}`

export function TestCard({ t, sessionId }: { t: Tool; sessionId: string }) {
  const r = t.tests!
  const items = useStore((s) => s.items[sessionId] ?? NO_ITEMS)
  const projectId = useStore((s) => s.sessions[sessionId]?.projectId ?? '')
  const readOnly = useStore((s) => !!s.sessions[sessionId]?.readOnly)
  const insertDraft = useStore((s) => s.insertDraft)
  const [open, setOpen] = useState(0)

  // Passage précédent du même lanceur dans la session.
  const prev = useMemo(() => {
    const runs = items.filter((x): x is Tool => x.kind === 'tool' && !!x.tests && x.tests.runner === r.runner)
    const i = runs.findIndex((x) => x.id === t.id)
    return i > 0 ? runs[i - 1].tests! : undefined
  }, [items, t.id, r.runner])
  const now = new Set(r.failures.map(keyOf))
  const before = new Set(prev?.failures.map(keyOf) ?? [])
  const fixed = prev ? prev.failures.filter((f) => !now.has(keyOf(f))) : []
  const broken = prev ? r.failures.filter((f) => !before.has(keyOf(f))) : []

  const total = r.passed + r.failed + r.skipped
  const unit = r.unit ?? 'test'
  return (
    <div className="out-card">
      <div className="out-head">
        <span className="out-badge">{RUNNER[r.runner]}</span>
        <span className="out-title">
          {r.failed ? <b className="out-bad">{plural(r.failed, 'échec')}</b> : <b className="out-good">Tout passe</b>}
          <span className="muted">
            {' · '}
            {[plural(r.passed, r.unit ? 'paquet ok' : 'passé'), r.skipped && plural(r.skipped, 'ignoré'), r.files ? `${plural(total, unit)} dans ${plural(r.files, 'fichier')}` : ''].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span style={{ flex: 1 }} />
        {r.duration && <span className="small muted">{r.duration}</span>}
      </div>
      <div className="out-bar" aria-hidden="true">
        <span className="good" style={{ flex: r.passed }} />
        {r.failed > 0 && <span className="bad" style={{ flex: r.failed }} />}
        {r.skipped > 0 && <span className="skip" style={{ flex: r.skipped }} />}
      </div>

      {r.failures.length > 0 && (
        <div className="out-fails">
          {r.failures.map((f, i) => (
            <div key={i} className="out-fail">
              <button type="button" className="out-fail-head" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
                <span className="out-x" aria-hidden="true">✕</span>
                <span className="out-fail-name">
                  {f.suite && <span className="muted">{f.suite} › </span>}
                  {f.name}
                </span>
                {f.file && <span className="mono small muted">{f.file}{f.line ? `:${f.line}` : ''}</span>}
                <span className="small muted" aria-hidden="true">{open === i ? '▾' : '▸'}</span>
              </button>
              {open === i && (
                <div className="out-fail-body">
                  {f.message && <span className="out-msg">{f.message}</span>}
                  {(f.expected || f.received) && (
                    <div className="out-er">
                      <span className="exp"><b>Attendu</b><span className="mono">{f.expected ?? '—'}</span></span>
                      <span className="got"><b>Reçu</b><span className="mono">{f.received ?? '—'}</span></span>
                    </div>
                  )}
                  {f.snippet && <pre className="out-snip mono">{f.snippet}</pre>}
                  <span className="out-actions">
                    {f.file && projectId && (
                      <button type="button" className="btn sm" onClick={() => api.openInEditor(projectId, f.file!, f.line)}>
                        Ouvrir {f.file}{f.line ? `:${f.line}` : ''}
                      </button>
                    )}
                    {!readOnly && (
                      <button
                        type="button"
                        className="btn sm primary"
                        onClick={() => insertDraft(sessionId, `Corrige le test « ${keyOf(f).replace(/^ › /, '')} »${f.file ? ` (${f.file}${f.line ? `:${f.line}` : ''})` : ''} : ${f.message}`)}
                      >
                        Demander à Claude de corriger
                      </button>
                    )}
                  </span>
                </div>
              )}
            </div>
          ))}
          {r.failed > r.failures.length && <div className="out-more small muted">+{r.failed - r.failures.length} autres échecs dans la sortie complète</div>}
        </div>
      )}

      {prev && (fixed.length > 0 || broken.length > 0 || prev.failed !== r.failed) && (
        <div className="out-since">
          <span className="small muted">Depuis le passage précédent</span>
          {fixed.map((f) => (
            <span key={keyOf(f)} className="out-chg good"><b>Réparé</b><span>{keyOf(f).replace(/^ › /, '')}</span></span>
          ))}
          {broken.map((f) => (
            <span key={keyOf(f)} className="out-chg bad"><b>Cassé</b><span>{keyOf(f).replace(/^ › /, '')}</span></span>
          ))}
          {!broken.length && <span className="small muted">Aucun test nouvellement cassé.</span>}
        </div>
      )}

      {r.failed > 0 && !readOnly && (
        <div className="out-foot">
          <span className="small muted" style={{ flex: 1 }}>Les tests réussis sont repliés · lu dans la sortie de la commande</span>
          <button type="button" className="btn sm primary" onClick={() => insertDraft(sessionId, `Relance les tests qui échouent (${r.failures.map((f) => f.name).slice(0, 5).join(', ')}).`)}>
            Relancer les échecs
          </button>
        </div>
      )}
    </div>
  )
}
