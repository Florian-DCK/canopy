import './nav.css'
import { useEffect, useRef, useState, type RefObject } from 'react'
import { Icon } from '../../icons'
import { api, useStore } from '../../store'

// Navigation dans les longues sessions : actions par message, recherche, repères en marge.

/* ---------- Actions sur un message ---------- */

export function MsgActions({ sessionId, role, text, last }: { sessionId: string; role: 'user' | 'ai'; text: string; last?: boolean }) {
  const status = useStore((s) => s.sessions[sessionId]?.status)
  const setDraft = useStore((s) => s.setDraft)
  const lastUserText = useStore((s) => {
    const items = s.items[sessionId]
    for (let k = (items?.length ?? 0) - 1; k >= 0; k--) {
      const i = items![k]
      if (i.kind === 'user') return i.text
    }
    return undefined
  })
  const [copied, setCopied] = useState(false)
  const copy = () => {
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  const canRetry = role === 'ai' && last && status !== 'run' && status !== 'wait' && !!lastUserText
  return (
    <div className="msg-acts" role="toolbar" aria-label="Actions sur le message">
      <button type="button" aria-label="Copier" title={copied ? 'Copié' : 'Copier'} onClick={copy}>
        <Icon name={copied ? 'done' : 'copy'} size={15} />
      </button>
      {role === 'user' && (
        <button type="button" aria-label="Réutiliser" title="Réutiliser dans la saisie" onClick={() => setDraft(sessionId, text)}>
          <Icon name="edit" size={15} />
        </button>
      )}
      {canRetry && (
        <button type="button" aria-label="Relancer" title="Relancer" onClick={() => void api.send(sessionId, lastUserText!)}>
          <Icon name="restart" size={15} />
        </button>
      )}
    </div>
  )
}

/* ---------- Recherche dans le fil ---------- */

/** Texte sans casse ni accents, avec pour chaque caractère replié l'index du caractère d'origine. */
function fold(s: string): { f: string; map: number[] } {
  let f = ''
  const map: number[] = []
  for (let k = 0; k < s.length; k++) {
    const c = s[k].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
    for (let j = 0; j < c.length; j++) map.push(k)
    f += c
  }
  return { f, map }
}

function findRanges(root: HTMLElement, q: string): Range[] {
  const needle = fold(q.trim()).f
  if (!needle) return []
  const out: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue ?? ''
    if (!text.trim()) continue
    const { f, map } = fold(text)
    for (let at = f.indexOf(needle); at !== -1; at = f.indexOf(needle, at + needle.length)) {
      const r = new Range()
      r.setStart(n, map[at])
      r.setEnd(n, map[at + needle.length - 1] + 1)
      out.push(r)
    }
  }
  return out
}

export function FindBar({ scope, onClose }: { scope: RefObject<HTMLElement | null>; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [dq, setDq] = useState('')
  const [cur, setCur] = useState(0)
  const [ranges, setRanges] = useState<Range[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.select(), [])
  useEffect(() => {
    const t = setTimeout(() => setDq(q), 120)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    const root = scope.current
    const r = root && dq ? findRanges(root, dq) : []
    setRanges(r)
    setCur(0)
  }, [dq, scope])
  useEffect(() => {
    if (!('highlights' in CSS)) return
    CSS.highlights.set('atl-find', new Highlight(...ranges))
    const r = ranges[cur]
    if (r) CSS.highlights.set('atl-find-cur', new Highlight(r))
    else CSS.highlights.delete('atl-find-cur')
    const el = scope.current
    if (r && el) {
      const rect = r.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      el.scrollBy({ top: rect.top - box.top - box.height / 2, behavior: 'smooth' })
    }
  }, [ranges, cur, scope])
  useEffect(
    () => () => {
      if ('highlights' in CSS) {
        CSS.highlights.delete('atl-find')
        CSS.highlights.delete('atl-find-cur')
      }
    },
    []
  )

  const step = (d: number) => ranges.length && setCur((c) => (c + d + ranges.length) % ranges.length)
  return (
    <div className="findbar" role="search">
      <Icon name="search" size={15} />
      <input
        ref={input}
        value={q}
        autoFocus
        placeholder="Chercher dans la session"
        aria-label="Chercher dans la session"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
      />
      <span className="find-n" aria-live="polite">{dq ? (ranges.length ? `${cur + 1} / ${ranges.length}` : '0 résultat') : ''}</span>
      <button type="button" aria-label="Précédent" title="Précédent (Maj+Entrée)" onClick={() => step(-1)}>
        <Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} />
      </button>
      <button type="button" aria-label="Suivant" title="Suivant (Entrée)" onClick={() => step(1)}>
        <Icon name="chevron" size={14} />
      </button>
      <button type="button" aria-label="Fermer" title="Fermer (Échap)" onClick={onClose}>
        <Icon name="close" size={14} />
      </button>
    </div>
  )
}

/* ---------- Repères dans la marge ---------- */

type Mark = { top: number; kind: 'user' | 'perm' | 'err'; el: Element }

export function ScrollMarks({ scroller }: { scroller: RefObject<HTMLElement | null> }) {
  const [marks, setMarks] = useState<Mark[]>([])
  const [box, setBox] = useState({ top: 0, height: 0 })
  useEffect(() => {
    const root = scroller.current
    if (!root) return
    const compute = () => {
      const base = root.getBoundingClientRect().top - root.scrollTop
      const total = root.scrollHeight || 1
      const next: Mark[] = []
      root.querySelectorAll('.msg-user, .perm, .err-card').forEach((el) => {
        const kind = el.classList.contains('msg-user') ? 'user' : el.classList.contains('perm') ? 'perm' : 'err'
        next.push({ top: ((el.getBoundingClientRect().top - base) / total) * 100, kind, el })
      })
      setMarks(next)
      setBox((b) => (b.top === root.offsetTop && b.height === root.clientHeight ? b : { top: root.offsetTop, height: root.clientHeight }))
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        compute()
      }, 250)
    }
    compute()
    const ro = new ResizeObserver(schedule)
    ro.observe(root)
    const mo = new MutationObserver(schedule)
    mo.observe(root, { childList: true, subtree: true })
    return () => {
      ro.disconnect()
      mo.disconnect()
      if (timer) clearTimeout(timer)
    }
  }, [scroller])
  return (
    <div className="scroll-marks" style={{ top: box.top, height: box.height }}>
      {marks.map((m, k) => (
        <button
          key={k}
          type="button"
          tabIndex={-1}
          aria-label={m.kind === 'user' ? 'Aller à ce message' : m.kind === 'perm' ? 'Aller à l’autorisation en attente' : 'Aller à l’erreur'}
          className={`mark ${m.kind}`}
          style={{ top: `${m.top}%` }}
          onClick={() => m.el.scrollIntoView({ block: 'center', behavior: 'smooth' })}
        />
      ))}
    </div>
  )
}

/* ---------- Retour en bas ---------- */

export function JumpDown({ waiting, onClick }: { waiting: boolean; onClick: () => void }) {
  return (
    <div className="jump-anchor">
      <button type="button" className={`jump-pill ${waiting ? 'wait' : ''}`} onClick={onClick}>
        <Icon name={waiting ? 'wait' : 'chevron'} size={15} />
        {waiting ? 'Autorisation en attente' : 'Revenir en bas'}
      </button>
    </div>
  )
}

/* ---------- Message précédent / suivant ---------- */

export function jumpUserMessage(scroller: HTMLElement | null, dir: -1 | 1) {
  if (!scroller) return
  const top = scroller.getBoundingClientRect().top
  const els = [...scroller.querySelectorAll('.msg-user')]
  const target = dir > 0 ? els.find((e) => e.getBoundingClientRect().top > top + 8) : [...els].reverse().find((e) => e.getBoundingClientRect().top < top - 8)
  target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}
