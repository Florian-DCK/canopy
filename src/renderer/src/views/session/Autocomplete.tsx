import { useEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import type { CommandSuggestion } from '../../../../shared/types'
import { Icon, type IconName } from '../../icons'
import { api } from '../../store'
import './autocomplete.css'

// Saisie : « @ » ouvre les fichiers du projet, « / » en tout début de message les skills et commandes.

type Entry = { key: string; label: string; detail: string; icon: IconName; section?: string; insert: string }

const MAX = 8
const REFRESH = 30_000
const IMG = /\.(png|jpe?g|gif|webp)$/i

const filesCache = new Map<string, Promise<string[]>>()
const cmdCache = new Map<string, { at: number; list: CommandSuggestion[] }>()

const loadFiles = (projectId: string) => {
  let p = filesCache.get(projectId)
  if (!p) {
    p = api.listFiles(projectId).catch(() => [])
    filesCache.set(projectId, p)
  }
  return p
}

/** Score : nom qui commence par la requête > nom qui contient > sous-séquence dans le chemin. */
function score(path: string, q: string): number {
  if (!q) return 1
  const p = path.toLowerCase()
  const name = p.replace(/\/$/, '').split('/').pop() ?? p
  if (name.startsWith(q)) return 4
  if (name.includes(q)) return 3
  if (p.includes(q)) return 2
  let i = 0
  for (const c of p) if (c === q[i] && ++i === q.length) return 1
  return 0
}

function searchFiles(files: string[], query: string): Entry[] {
  const q = query.toLowerCase()
  const scored: { f: string; s: number }[] = []
  for (const f of files) {
    const s = score(f, q)
    if (s) scored.push({ f, s })
  }
  scored.sort((a, b) => b.s - a.s || a.f.length - b.f.length)
  return scored.slice(0, MAX).map(({ f }) => {
    const dir = f.endsWith('/')
    const clean = dir ? f.slice(0, -1) : f
    const cut = clean.lastIndexOf('/')
    return {
      key: f,
      label: clean.slice(cut + 1) + (dir ? '/' : ''),
      detail: cut >= 0 ? clean.slice(0, cut) : '',
      icon: dir ? 'files' : IMG.test(f) ? 'media' : 'read',
      insert: `@${f} `
    }
  })
}

function searchCommands(list: CommandSuggestion[], query: string): Entry[] {
  const q = query.toLowerCase()
  const starts = list.filter((c) => c.name.toLowerCase().startsWith(q))
  const rest = list.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))
  const hits = [...starts, ...rest]
  const toEntry = (c: CommandSuggestion): Entry => ({
    key: `${c.kind}:${c.name}`,
    label: `/${c.name}`,
    detail: c.description,
    icon: c.kind === 'skill' ? 'model' : c.name === 'compact' ? 'context' : 'plug',
    section: c.kind === 'skill' ? 'Skills' : 'Commandes',
    insert: `/${c.name} `
  })
  // Sections regroupées : skills d'abord, puis commandes, ordre de pertinence conservé dans chaque groupe.
  const skills = hits.filter((c) => c.kind === 'skill').map(toEntry)
  const cmds = hits.filter((c) => c.kind !== 'skill').map(toEntry)
  return [...skills, ...cmds].slice(0, MAX)
}

type Trigger = { kind: 'file'; start: number; query: string } | { kind: 'cmd'; query: string }

function triggerAt(text: string, cursor: number): Trigger | null {
  const before = text.slice(0, cursor)
  const cmd = /^\/(\S*)$/.exec(before)
  if (cmd) return { kind: 'cmd', query: cmd[1] }
  const at = /(^|\s)@(\S*)$/.exec(before)
  if (at) return { kind: 'file', start: cursor - at[2].length - 1, query: at[2] }
  return null
}

export function useAutocomplete({
  text,
  setText,
  sessionId,
  projectId,
  inputRef
}: {
  text: string
  setText: (t: string) => void
  sessionId: string
  projectId: string
  inputRef: RefObject<HTMLTextAreaElement | null>
}) {
  const [cursor, setCursor] = useState(0)
  const [entries, setEntries] = useState<Entry[]>([])
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [focused, setFocused] = useState(false)
  const blurTimer = useRef<number>(0)

  const trig = focused && !dismissed ? triggerAt(text, cursor) : null
  const kind = trig?.kind
  const query = trig?.query ?? ''
  const tstart = trig?.kind === 'file' ? trig.start : -1

  useEffect(() => {
    if (!kind) {
      setEntries([])
      return
    }
    let live = true
    if (kind === 'file') {
      void loadFiles(projectId).then((f) => live && setEntries(searchFiles(f, query)))
    } else {
      const hit = cmdCache.get(sessionId)
      const fresh = hit && Date.now() - hit.at < REFRESH
      if (hit) setEntries(searchCommands(hit.list, query))
      if (!fresh)
        void api
          .listCommands(sessionId)
          .catch(() => [] as CommandSuggestion[])
          .then((list) => {
            cmdCache.set(sessionId, { at: Date.now(), list })
            if (live) setEntries(searchCommands(list, query))
          })
    }
    return () => {
      live = false
    }
  }, [kind, query, sessionId, projectId])

  useEffect(() => setActive(0), [kind, query])
  useEffect(() => () => window.clearTimeout(blurTimer.current), [])

  const open = !!trig && entries.length > 0

  const insert = (e: Entry) => {
    const ta = inputRef.current
    const pos = ta?.selectionStart ?? cursor
    const next = trig?.kind === 'file' ? text.slice(0, tstart) + e.insert + text.slice(pos) : e.insert
    const caret = trig?.kind === 'file' ? tstart + e.insert.length : e.insert.length
    setText(next)
    setCursor(caret)
    requestAnimationFrame(() => {
      ta?.focus()
      ta?.setSelectionRange(caret, caret)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open) return false
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length)
      return true
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
      e.preventDefault()
      insert(entries[Math.min(active, entries.length - 1)])
      return true
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setDismissed(true)
      return true
    }
    return false
  }

  /** Props à étaler sur le textarea (en plus de onKeyDown appelé en premier). */
  const inputProps = {
    onSelect: (e: { currentTarget: HTMLTextAreaElement }) => setCursor(e.currentTarget.selectionStart),
    onFocus: () => {
      window.clearTimeout(blurTimer.current)
      setFocused(true)
    },
    onBlur: () => {
      blurTimer.current = window.setTimeout(() => setFocused(false), 150)
    },
    onChangeText: () => setDismissed(false)
  }

  const menu = open ? (
    <div className="ac-menu" role="listbox" aria-label={kind === 'file' ? 'Fichiers' : 'Skills et commandes'}>
      {entries.map((en, i) => (
        <div key={en.key}>
          {en.section && en.section !== entries[i - 1]?.section && <div className="ac-sec">{en.section}</div>}
          <div
            role="option"
            aria-selected={i === active}
            className={`ac-row ${i === active ? 'on' : ''}`}
            onMouseDown={(ev) => {
              ev.preventDefault()
              insert(en)
            }}
            onMouseEnter={() => setActive(i)}
          >
            <Icon name={en.icon} size={15} />
            <span className="ac-name">{en.label}</span>
            <span className="ac-detail">{en.detail}</span>
          </div>
        </div>
      ))}
    </div>
  ) : null

  return { menu, onKeyDown, inputProps }
}
