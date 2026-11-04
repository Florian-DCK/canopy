import { useEffect, useRef, useState } from 'react'
import type { AskQuestion, Item } from '../../../../shared/types'
import '../../questions.css'
import { Icon } from '../../icons'
import { api } from '../../store'

// Questions de Claude (planches 17 et 18) : bloquantes (AskUserQuestion, Claude attend) ou sans attente
// (outil question de Canopy, Claude continue). 1 à 4 questions de 2 à 4 options, « Autre… » toujours proposé.

type Q = Extract<Item, { kind: 'question' }>

/** Réponse d'une question : options cochées (indices) et/ou texte libre. */
type Pick = { opts: number[]; other?: string }

const answerOf = (q: AskQuestion, p?: Pick): string => {
  if (!p) return ''
  const labels = p.opts.map((k) => q.options[k]?.label).filter(Boolean)
  if (p.other?.trim()) labels.push(p.other.trim())
  return labels.join(', ')
}

export function QuestionCard({ item, sessionId }: { item: Q; sessionId: string }) {
  if (item.state !== 'pending') return <QuestionDone item={item} />
  return <QuestionLive item={item} sessionId={sessionId} />
}

function QuestionDone({ item }: { item: Q }) {
  const [open, setOpen] = useState(false)
  const n = item.questions.length
  const title =
    item.state === 'answered'
      ? `Tu as répondu à ${n > 1 ? `${n} questions` : 'la question'}`
      : item.state === 'chat'
        ? 'Tu as choisi de répondre dans le fil'
        : `Question passée${item.fallback ? ` · Claude a gardé « ${item.fallback} »` : ''}`
  return (
    <div className={`q-done ${open ? 'open' : ''}`}>
      <button type="button" className="q-done-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={item.state === 'answered' ? 'done' : 'chevron'} size={14} className={item.state === 'answered' ? 'st-ok' : 'a-chev'} />
        <b>{title}</b>
        {!open && item.state === 'answered' && <span className="q-done-peek">{item.questions.map((q) => item.answers?.[q.question]).filter(Boolean).join(' · ')}</span>}
      </button>
      {open && (
        <div className="q-done-list">
          {item.questions.map((q) => (
            <div key={q.question} className="q-done-row">
              <span className="q-chip">{q.header || 'Question'}</span>
              <span>
                <span className="muted">{q.question}</span>
                <br />
                {item.answers?.[q.question] || <span className="muted">sans réponse</span>}
                {item.notes?.[q.question] && <span className="muted"> · précision : « {item.notes[q.question]} »</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function QuestionLive({ item, sessionId }: { item: Q; sessionId: string }) {
  const qs = item.questions
  const [step, setStep] = useState(0)
  const [picks, setPicks] = useState<Record<number, Pick>>({})
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [noteOpen, setNoteOpen] = useState<Record<number, boolean>>({})
  const [otherOpen, setOtherOpen] = useState<Record<number, boolean>>({})
  const [focus, setFocus] = useState(-1)
  const [sending, setSending] = useState(false)
  const ref = useRef<HTMLElement>(null)
  const q = qs[step]
  const waiting = item.mode === 'wait'
  const last = step === qs.length - 1
  const done = (k: number) => answerOf(qs[k], picks[k]) !== ''

  // La carte d'une question bloquante prend le focus : 1 à 4 répondent tout de suite.
  useEffect(() => {
    if (item.blocking) ref.current?.focus()
  }, [item.blocking])

  if (!q) return null
  const cur = picks[step] ?? { opts: [] }
  const toggle = (k: number) => {
    const opts = q.multiSelect ? (cur.opts.includes(k) ? cur.opts.filter((x) => x !== k) : [...cur.opts, k]) : [k]
    setPicks({ ...picks, [step]: { ...cur, opts, other: q.multiSelect ? cur.other : undefined } })
    if (!q.multiSelect) setOtherOpen({ ...otherOpen, [step]: false })
  }
  const submit = async (action: 'answer' | 'skip' | 'chat') => {
    setSending(true)
    const answers: Record<string, string> = {}
    const noteMap: Record<string, string> = {}
    qs.forEach((x, k) => {
      const a = answerOf(x, picks[k])
      if (a) answers[x.question] = a
      if (notes[k]?.trim()) noteMap[x.question] = notes[k].trim()
    })
    try {
      await api.answerQuestion(sessionId, item.id, { action, answers, notes: noteMap })
    } finally {
      setSending(false)
    }
    if (action === 'chat') document.getElementById('composer')?.focus()
  }
  const next = () => (last ? void submit('answer') : setStep(step + 1))
  const preview = q.options[focus >= 0 ? focus : (cur.opts[0] ?? -1)]?.preview

  return (
    <section
      ref={ref}
      id={`q-${item.id}`}
      tabIndex={-1}
      className={`q-card ${waiting ? 'wait' : 'async'}`}
      role="group"
      aria-label={item.blocking ? 'Question de Claude' : 'Question sans attente'}
      onKeyDown={(e) => {
        const t = e.target as HTMLElement
        if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
        if (/^[1-5]$/.test(e.key)) {
          const k = Number(e.key) - 1
          e.preventDefault()
          if (k < q.options.length) toggle(k)
          else setOtherOpen({ ...otherOpen, [step]: true })
        } else if (e.key === 'Enter' && done(step)) {
          e.preventDefault()
          next()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          void submit('chat')
        } else if (e.key === 'ArrowRight' && step < qs.length - 1) {
          setStep(step + 1)
        } else if (e.key === 'ArrowLeft' && step > 0) setStep(step - 1)
      }}
    >
      <div className="q-head">
        <Icon name={waiting ? 'wait' : 'run'} size={16} className={waiting ? 'clay' : 'st-run'} />
        <b>
          {waiting
            ? qs.length > 1
              ? `Claude a ${qs.length} questions`
              : 'Claude a une question'
            : 'Question en suspens · Claude continue en attendant'}
        </b>
      </div>

      {qs.length > 1 && (
        <div className="q-steps" role="tablist" aria-label="Questions">
          {qs.map((x, k) => (
            <button key={k} type="button" role="tab" aria-selected={k === step} className="q-step" onClick={() => setStep(k)}>
              <span className={done(k) ? 'st-ok' : 'q-step-n'}>{done(k) ? '✓' : k + 1}</span>
              {x.header || `Question ${k + 1}`}
            </button>
          ))}
        </div>
      )}

      <div className="q-body">
        <div className="q-main">
          <div className="q-text">{q.question}</div>
          <div className="q-hint">{q.multiSelect ? 'Plusieurs réponses possibles' : 'Une seule réponse'}</div>
          <div className="q-opts" role={q.multiSelect ? 'group' : 'radiogroup'} aria-label={q.question}>
            {q.options.map((o, k) => {
              const on = cur.opts.includes(k)
              return (
                <button
                  key={k}
                  type="button"
                  role={q.multiSelect ? 'checkbox' : 'radio'}
                  aria-checked={on}
                  className={`q-opt ${on ? 'on' : ''}`}
                  onClick={() => toggle(k)}
                  onMouseEnter={() => setFocus(k)}
                  onMouseLeave={() => setFocus(-1)}
                  onFocus={() => setFocus(k)}
                >
                  <span className="q-key" aria-hidden="true">{k + 1}</span>
                  <span className="q-opt-t">
                    <span className="q-label">{o.label}</span>
                    {o.description && <span className="q-desc">{o.description}</span>}
                  </span>
                  {!waiting && item.fallback === o.label && <span className="q-default">par défaut</span>}
                </button>
              )
            })}
            {otherOpen[step] || cur.other ? (
              <label className="q-other">
                <span className="q-key" aria-hidden="true">{q.options.length + 1}</span>
                <span className="sr-only">Ta réponse</span>
                <input
                  autoFocus
                  value={cur.other ?? ''}
                  placeholder="Ta réponse…"
                  onChange={(e) => setPicks({ ...picks, [step]: { opts: q.multiSelect ? cur.opts : [], other: e.target.value } })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && done(step)) {
                      e.preventDefault()
                      next()
                    }
                  }}
                />
              </label>
            ) : (
              <button type="button" className="q-opt other" onClick={() => setOtherOpen({ ...otherOpen, [step]: true })}>
                <span className="q-key" aria-hidden="true">{q.options.length + 1}</span>
                <span className="q-opt-t"><span className="q-label">Autre…</span><span className="q-desc">écris ta propre réponse</span></span>
              </button>
            )}
          </div>
          {noteOpen[step] ? (
            <textarea className="q-note" rows={2} value={notes[step] ?? ''} placeholder="Une précision pour Claude…" aria-label="Précision" onChange={(e) => setNotes({ ...notes, [step]: e.target.value })} />
          ) : (
            <button type="button" className="btn text sm q-note-btn" onClick={() => setNoteOpen({ ...noteOpen, [step]: true })}>+ Ajouter une précision</button>
          )}
          {!waiting && (
            <p className="q-fallback">
              {item.fallback ? (
                <>Sans réponse, Claude part sur <b>{item.fallback}</b>. Si tu choisis autre chose, il l’apprend au prochain point d’étape et ajuste ce qu’il a déjà fait.</>
              ) : (
                <>Claude met cette partie de côté et avance sur le reste. S’il n’a plus rien d’autre à faire, la question passera en attente de ta réponse.</>
              )}
            </p>
          )}
        </div>
        {preview && (
          <aside className="q-preview" aria-label="Aperçu de l’option">
            <div className="q-preview-h">Aperçu · {q.options[focus >= 0 ? focus : cur.opts[0]]?.label}</div>
            <pre>{preview}</pre>
          </aside>
        )}
      </div>

      <div className="q-foot">
        <span className="q-keys">{q.multiSelect ? 'Clique ou 1–4 pour cocher' : `1–${q.options.length + 1} choisit`} · Entrée {last ? 'envoie' : 'passe à la suivante'} · Échap répond dans le fil</span>
        <button type="button" className="btn text" disabled={sending} onClick={() => void submit('skip')}>Passer</button>
        <button type="button" className="btn" disabled={sending} onClick={() => void submit('chat')}>Répondre dans le fil</button>
        <button type="button" className={`btn ${waiting ? 'clay' : 'primary'}`} disabled={sending || !done(step)} onClick={next}>
          {last ? (qs.length > 1 ? 'Envoyer les réponses' : 'Envoyer') : 'Suivante'}
        </button>
      </div>
    </section>
  )
}
