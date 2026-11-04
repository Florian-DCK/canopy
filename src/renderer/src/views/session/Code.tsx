import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { Item } from '../../../../shared/types'
import { Icon } from '../../icons'
import './code.css'

// Blocs de code des réponses et sorties d'outils : en-tête, copie, repli des longues sorties.

const FOLD = 20

/** Bouton « Copier » : devient « Copié » 1,5 s. */
function CopyBtn({ get }: { get: () => string }) {
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!done) return
    const id = setTimeout(() => setDone(false), 1500)
    return () => clearTimeout(id)
  }, [done])
  return (
    <button
      type="button"
      className="code-copy"
      onClick={() => {
        void navigator.clipboard.writeText(get()).then(() => setDone(true))
      }}
    >
      <Icon name={done ? 'done' : 'copy'} size={14} />
      {done ? 'Copié' : 'Copier'}
    </button>
  )
}

function langOf(children: ReactNode): string {
  for (const c of Children.toArray(children)) {
    if (isValidElement<{ className?: string }>(c)) {
      const m = /language-([\w+#-]+)/.exec(c.props.className ?? '')
      if (m) return m[1]
    }
  }
  return 'texte'
}

/** Composant `pre` de react-markdown. */
export function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [lines, setLines] = useState(0)
  const [open, setOpen] = useState(false)
  // Pendant le flux, le code grandit : on recompte à chaque rendu.
  useLayoutEffect(() => {
    const n = (ref.current?.textContent ?? '').replace(/\n$/, '').split('\n').length
    if (n !== lines) setLines(n)
  })
  const folded = lines > FOLD && !open
  return (
    <div className="code">
      <div className="code-head">
        <span className="code-lang">{langOf(children)}</span>
        <CopyBtn get={() => ref.current?.textContent ?? ''} />
      </div>
      <pre ref={ref} className={folded ? 'folded' : ''}>{children}</pre>
      {folded && (
        <button type="button" className="code-more" onClick={() => setOpen(true)}>
          <Icon name="chevron" size={14} /> {lines - FOLD} lignes de plus
        </button>
      )}
    </div>
  )
}

/** Sortie d'un outil : carte pour les commandes, bloc simple sinon, repliée si longue. */
export function ToolOutput({ t }: { t: Extract<Item, { kind: 'tool' }> }) {
  const [open, setOpen] = useState(false)
  const text = (t.result ?? '').replace(/\n+$/, '')
  const all = text.split('\n')
  const isCmd = t.name === 'Bash' || t.name === 'PowerShell'
  const err = t.status === 'error'
  const keep = isCmd && !err ? 3 : FOLD
  const hidden = all.length - keep
  const shown = open || hidden <= 0 ? all : isCmd && !err ? all.slice(-keep) : all.slice(0, keep)
  const more =
    hidden > 0 && !open ? (
      <button type="button" className="code-more" onClick={() => setOpen(true)}>
        <Icon name="chevron" size={14} /> {isCmd && !err ? `Voir les ${all.length} lignes` : `${hidden} lignes de plus`}
      </button>
    ) : null
  if (!isCmd)
    return (
      <>
        <div className="tool-out">{shown.join('\n')}</div>
        {more}
      </>
    )
  return (
    <div className={`cmd-card ${err ? 'err' : ''}`}>
      <div className="cmd-head">
        <Icon name="bash" size={14} />
        <span className="cmd-line">{t.summary}</span>
        <span className={`cmd-st ${err ? 'err' : 'ok'}`}>
          <Icon name={err ? 'error' : 'done'} size={14} />
          {err ? 'échec' : 'réussi'}
        </span>
      </div>
      <pre className="cmd-out">{shown.join('\n')}</pre>
      {more}
    </div>
  )
}
