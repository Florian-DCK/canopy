import { SecretCard } from './SecretCard'
import { createContext, memo, useContext, useMemo, useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import type { Item, PermissionModeUI, SessionMeta } from '../../../../shared/types'
import { Icon, MODE_ICON, toolIcon, toolLabel, type IconName } from '../../icons'
import { remarkCallouts } from '../../markdown'
import * as reg from '../../browser/registry'
import { hostOf, localUrlIn, useBrowser } from '../../browser/store'
import { api, useStore } from '../../store'
import { ArtifactCard } from '../Artifacts'
import { TestCard } from '../../outputs/TestCard'
import { HttpCard } from '../../outputs/HttpCard'
import { PgCard } from '../../outputs/PgCard'
import { AttachedMedia, InlineMedia } from '../Media'
import { MsgActions } from './Nav'
import { CodeBlock, ToolOutput } from './Code'
import { ChecklistToolCard } from './ChecklistCard'
import { QuestionCard } from './QuestionCard'

// Fil de la session (planches 1 et 2) : messages, groupes d'actions repliés, cartes de décision
// (autorisation, plan), sous-agents, lignes fines pour les événements.

export type Tool = Extract<Item, { kind: 'tool' }>
type Perm = Extract<Item, { kind: 'permission' }>

// Liens : toujours dans le navigateur par défaut (target _blank → setWindowOpenHandler), jamais dans la fenêtre.
// Les liens vers un serveur local s'ouvrent dans le navigateur intégré de la session.
const SessionCtx = createContext('')
function openInBrowser(sessionId: string, url: string) {
  useBrowser.getState().open(sessionId, url)
  const wv = reg.entry(sessionId)?.el
  if (wv) {
    useBrowser.getState().patch(sessionId, { url })
    void wv.loadURL(url)
  }
  useStore.getState().setActiveTab(sessionId, 'browser')
}
function Link({ href, children }: { href?: string; children?: ReactNode }) {
  const sid = useContext(SessionCtx)
  const local = !!href && !!localUrlIn(href)
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={local && sid ? 'Ouvrir dans le navigateur de la session' : undefined}
      onClick={(e) => {
        if (!local || !sid || !href) return
        e.preventDefault()
        openInBrowser(sid, href)
      }}
    >
      {children}
    </a>
  )
}
const MD_COMPONENTS = { pre: CodeBlock, a: Link }

/** Carte sous la commande qui a lancé un serveur local : l'ouvrir dans l'onglet navigateur. */
function ServerCard({ sessionId, tools }: { sessionId: string; tools: Tool[] }) {
  const open = useBrowser((s) => !!s.tabs[sessionId])
  const url = tools.map((t) => (t.result && /^(Bash|PowerShell|BashOutput)$/.test(t.name) ? localUrlIn(t.result) : undefined)).filter(Boolean).at(-1)
  if (!url || open) return null
  return (
    <div className="srv-card">
      <Icon name="web" size={18} />
      <span>
        <b>Le serveur tourne sur {hostOf(url)}</b>
        <small>détecté dans la sortie de la commande</small>
      </span>
      <button type="button" className="btn primary sm" onClick={() => openInBrowser(sessionId, url)}>Ouvrir le navigateur</button>
    </div>
  )
}

/** Markdown complet (GFM : gras, titres, listes, tableaux, code, citations, cases à cocher). */
export function rich(text: string): ReactNode {
  return (
    <Markdown remarkPlugins={[remarkGfm, remarkCallouts]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={MD_COMPONENTS}>
      {text}
    </Markdown>
  )
}

/** Markdown d'un message, recalculé seulement si son texte change. */
export const MdText = memo(function MdText({ text }: { text: string }) {
  return <>{rich(text)}</>
})

export const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')}`
}

/** Fichier hors du projet : chemin absolu (hors dossier du projet) ou dossier temporaire. */
const isOutside = (p: string) => /^[a-zA-Z]:[\\/]|^[\\/]/.test(p) || /AppData[\\/]Local[\\/]Temp|[\\/]scratchpad[\\/]/i.test(p)

/** « +12 −3 », sans afficher les zéros. */
export function DiffCount({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="t-diff">
      {added > 0 && <span className="add">+{added}</span>}
      {added > 0 && removed > 0 && ' '}
      {removed > 0 && <span className="del">−{removed}</span>}
    </span>
  )
}

/* ---------- Actions ---------- */

function ToolRow({ t }: { t: Tool }) {
  const [open, setOpen] = useState(false)
  const tone = t.status === 'error' ? 'err' : t.status === 'running' ? 'run' : ''
  return (
    <>
      <button type="button" className={`t-row ${tone}`} onClick={() => t.result && setOpen(!open)} aria-expanded={t.result ? open : undefined} title={t.name}>
        <Icon name={t.status === 'running' ? 'run' : t.status === 'error' ? 'error' : toolIcon(t.name)} size={15} />
        <span className="t-name">{toolLabel(t.name)}</span>
        <span className="t-sum">{t.summary}</span>
        {t.diff && <DiffCount added={t.diff.added} removed={t.diff.removed} />}
      </button>
      {open && t.result && <ToolOutput t={t} />}
    </>
  )
}

/** Appels d'outils consécutifs, repliés en une ligne : une icône par outil avec son nombre. */
function ActionGroup({ tools, sessionId }: { tools: Tool[]; sessionId: string }) {
  const [open, setOpen] = useState(false)
  const running = tools.find((t) => t.status === 'running')
  const errors = tools.filter((t) => t.status === 'error').length
  const counts = useMemo(() => {
    const m = new Map<IconName, { n: number; names: Set<string> }>()
    for (const t of tools) {
      if (t.status === 'error') continue
      const k = toolIcon(t.name)
      const e = m.get(k) ?? { n: 0, names: new Set() }
      e.n++
      e.names.add(toolLabel(t.name))
      m.set(k, e)
    }
    return [...m.entries()]
  }, [tools])
  const added = tools.reduce((a, t) => a + (t.diff?.added ?? 0), 0)
  const removed = tools.reduce((a, t) => a + (t.diff?.removed ?? 0), 0)
  const span = tools.length > 1 ? tools[tools.length - 1].at - tools[0].at : 0
  const label = `${tools.length} action${tools.length > 1 ? 's' : ''}`
  return (
    <div className={`a-group ${open ? 'open' : ''}`}>
      <button type="button" className="a-sum" aria-expanded={open} aria-label={`${label}, ${open ? 'replier' : 'déplier'}`} onClick={() => setOpen(!open)}>
        <Icon name="chevron" size={14} className="a-chev" />
        {running ? (
          <span className="a-live">
            <Icon name="run" size={15} />
            <span className="t-name">{toolLabel(running.name)}</span>
            <span className="t-sum">{running.summary}</span>
          </span>
        ) : (
          <span className="a-counts">
            {counts.map(([k, e]) => (
              <span key={k} className="a-count" title={[...e.names].join(', ')}>
                <Icon name={k} size={15} />
                {e.n}
              </span>
            ))}
            {errors > 0 && (
              <span className="a-count err" title={`${errors} en erreur`}>
                <Icon name="error" size={15} />
                {errors}
              </span>
            )}
          </span>
        )}
        <span style={{ flex: 1 }} />
        {(added > 0 || removed > 0) && <DiffCount added={added} removed={removed} />}
        {span >= 1000 && <span className="a-time">{fmtDuration(span)}</span>}
      </button>
      {open && (
        <div className="a-list">
          {tools.map((t) => (
            <ToolRow key={t.id} t={t} />
          ))}
        </div>
      )}
      {tools.map((t) => (
        <InlineMedia key={t.id} sessionId={sessionId} itemId={t.id} />
      ))}
      {tools.map((t) => t.artifact && <ArtifactCard key={`a-${t.id}`} t={t} sessionId={sessionId} />)}
      {tools.map((t) => t.tests && <TestCard key={`t-${t.id}`} t={t} sessionId={sessionId} />)}
      {tools.map((t) => t.http && <HttpCard key={`h-${t.id}`} t={t} />)}
      {tools.map((t) => t.pg && <PgCard key={`p-${t.id}`} t={t} sessionId={sessionId} />)}
      <ServerCard sessionId={sessionId} tools={tools} />
    </div>
  )
}

/* ---------- Décisions ---------- */

const VERB: Record<string, string> = {
  Bash: 'exécuter une commande',
  PowerShell: 'exécuter une commande',
  Edit: 'modifier un fichier',
  MultiEdit: 'modifier un fichier',
  Write: 'créer un fichier',
  NotebookEdit: 'modifier un notebook',
  WebFetch: 'ouvrir une page web',
  WebSearch: 'chercher sur le web',
  Read: 'lire un fichier',
  Artifact: 'publier un artefact'
}

export function PermCard({ p, sessionId, agent }: { p: Perm; sessionId: string; agent?: string }) {
  const respond = (d: 'allow' | 'always' | 'deny') => api.respondPermission(sessionId, p.id, d)
  if (p.state !== 'pending')
    return (
      <div className={`p-done ${p.state}`}>
        <Icon name={p.state === 'allowed' ? 'done' : 'close'} size={14} />
        <span>{p.state === 'allowed' ? 'Autorisé' : 'Refusé'}</span>
        <span className="t-sum">· {toolLabel(p.tool)} {p.summary}</span>
      </div>
    )
  if (p.tool === 'ExitPlanMode') return <PlanCard p={p} sessionId={sessionId} />
  const who = agent ? `Le sous-agent ${agent}` : 'Claude'
  return (
    <div className="perm" role="group" aria-label="Demande d’autorisation">
      <div className="perm-head">
        <Icon name="wait" size={17} className="clay" />
        <b>{who} veut {VERB[p.tool] ?? `utiliser ${toolLabel(p.tool)}`}</b>
      </div>
      <div className="cmd">{p.summary || '(sans détail)'}</div>
      <div className="perm-acts">
        <button type="button" className="btn clay" onClick={() => respond('allow')}>Autoriser</button>
        {p.canAlways && <button type="button" className="btn" onClick={() => respond('always')}>Toujours pour ce projet</button>}
        <button type="button" className="btn text" onClick={() => respond('deny')}>Refuser</button>
        <span className="perm-keys"><kbd>Entrée</kbd> autoriser depuis la saisie vide</span>
      </div>
    </div>
  )
}

/** Fin d'une tâche de fond : statut, durée, résumé, et la sortie à la demande. */
function TaskCard({ t, sessionId }: { t: Extract<Item, { kind: 'task' }>; sessionId: string }) {
  const [out, setOut] = useState<string | null>(null)
  const ok = t.status === 'completed'
  const word = ok ? 'Tâche de fond terminée' : t.status === 'stopped' ? 'Tâche de fond arrêtée' : 'Tâche de fond en échec'
  return (
    <div className={`task-card ${t.status}`} role="status">
      <div className="task-h">
        <Icon name={ok ? 'done' : t.status === 'stopped' ? 'stop' : 'error'} size={15} />
        <b>{word}</b>
        <span className="task-label" title={t.label}>{t.label}</span>
        {t.durationMs !== undefined && <span className="task-dur">{fmtDuration(t.durationMs)}</span>}
      </div>
      {t.summary && <div className="task-sum">{t.summary}</div>}
      <button type="button" className="btn text sm" onClick={() => (out === null ? void api.taskOutput(sessionId, t.id).then(setOut) : setOut(null))}>
        {out === null ? 'Voir la sortie' : 'Masquer la sortie'}
      </button>
      {out !== null && <pre className="task-out">{out || '(sortie vide)'}</pre>}
    </div>
  )
}

/** Plan proposé (ExitPlanMode) : une décision, avec le mode de lancement au choix. */
function PlanCard({ p, sessionId }: { p: Perm; sessionId: string }) {
  const [all, setAll] = useState(false)
  const launch = async (mode: PermissionModeUI) => {
    await api.respondPermission(sessionId, p.id, 'allow')
    await api.setPermissionMode(sessionId, mode)
  }
  return (
    <div className="perm plan" role="group" aria-label="Plan à valider">
      <div className="perm-head">
        <Icon name="mode-plan" size={17} className="clay" />
        <b>Plan prêt — à toi de valider</b>
      </div>
      {p.detail && (
        <div className={`plan-body msg-ai ${all ? '' : 'clip'}`}>
          <MdText text={p.detail} />
          {!all && (
            <button type="button" className="plan-more" onClick={() => setAll(true)}>
              <Icon name="chevron" size={14} /> Lire tout le plan
            </button>
          )}
        </div>
      )}
      <div className="perm-acts">
        <button type="button" className="btn clay" onClick={() => void launch('auto')}><Icon name="mode-auto" size={15} />Lancer en Auto</button>
        <button type="button" className="btn" onClick={() => void launch('default')}><Icon name="mode-ask" size={15} />Lancer, demander avant</button>
        <button type="button" className="btn text" onClick={() => api.respondPermission(sessionId, p.id, 'deny')}>Continuer à planifier</button>
      </div>
    </div>
  )
}

/* ---------- Sous-agents ---------- */

function SubAgent({ t, kids }: { t: Tool; kids: Item[] }) {
  const [open, setOpen] = useState(false)
  const n = kids.filter((c) => c.kind === 'tool').length
  const st = t.status === 'running' ? 'run' : t.status === 'error' ? 'error' : 'done'
  return (
    <div className="sub">
      <button type="button" className="sub-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name="agent" size={16} />
        <b>{t.subagent!.type}</b>
        <span className="t-sum">{t.subagent!.description}</span>
        <span className="a-time">{n} action{n > 1 ? 's' : ''}</span>
        <Icon name={st} size={16} className={`st-${st}`} label={st === 'run' ? 'Au travail' : st === 'error' ? 'Erreur' : 'Terminé'} />
      </button>
      {open && (
        <div className="sub-body">
          {kids.map((c) =>
            c.kind === 'tool' ? <ToolRow key={c.id} t={c} /> : c.kind === 'text' ? <div key={c.id} className="msg-ai sub-text"><MdText text={c.text} /></div> : null
          )}
          {t.result && <div className="tool-out">{t.result}</div>}
        </div>
      )}
    </div>
  )
}

/* ---------- Événements ---------- */

function eventIcon(i: Extract<Item, { kind: 'event' }>): IconName {
  switch (i.event) {
    case 'compact': return 'context'
    case 'resume': return 'history'
    case 'readonly': return 'readonly'
    case 'model': return 'model'
    case 'background': return 'run'
    case 'mode': return /Auto/.test(i.text) ? MODE_ICON.auto : /Plan/.test(i.text) ? MODE_ICON.plan : /Accepter/.test(i.text) ? MODE_ICON.acceptEdits : MODE_ICON.default
  }
}

export function EventLine({ icon, tone, children }: { icon: IconName; tone?: string; children: ReactNode }) {
  return (
    <div className={`ev ${tone ?? ''}`} role="note">
      <Icon name={icon} size={15} />
      <span>{children}</span>
    </div>
  )
}

/* ---------- Plan de tâches épinglé ---------- */

export function TodoCard({ todos }: { todos: NonNullable<Tool['todos']> }) {
  const [open, setOpen] = useState(true)
  const done = todos.filter((t) => t.status === 'completed').length
  const cur = todos.find((t) => t.status === 'in_progress')
  return (
    <div className={`todo-card ${open ? 'open' : ''}`}>
      <button type="button" className="todo-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="todo" size={15} />
        {open || !cur ? <b>Plan de tâches</b> : (
          <span className="todo-cur"><Icon name="run" size={14} />{cur.content}</span>
        )}
        <span style={{ flex: 1 }} />
        <span className="todo-n">{done} / {todos.length}</span>
        <span className="todo-bar" aria-hidden="true"><span style={{ width: `${(done / todos.length) * 100}%` }} /></span>
        <Icon name="chevron" size={14} className="a-chev" />
      </button>
      {open && (
        <ul className="todo-list">
          {todos.map((t, k) => (
            <li key={k} className={t.status}>
              {t.status === 'completed' ? <Icon name="done" size={15} /> : t.status === 'in_progress' ? <Icon name="run" size={15} /> : <span className="todo-o" aria-hidden="true" />}
              <span>{t.content}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Dernier plan de tâches de l'agent principal, tant qu'il n'est pas terminé. */
export function useTodos(items: Item[], session: SessionMeta | undefined) {
  return useMemo(() => {
    for (let k = items.length - 1; k >= 0; k--) {
      const i = items[k]
      if (i.kind === 'tool' && i.todos && i.parent === null) {
        const finished = i.todos.every((t) => t.status === 'completed')
        return finished && session?.status !== 'run' ? undefined : i.todos
      }
    }
    return undefined
  }, [items, session?.status])
}

/* ---------- Fil ---------- */

const CHECKLIST_TOOL = 'mcp__atelier__checklist'

type Block =
  | { k: 'item'; item: Item }
  | { k: 'group'; id: string; tools: Tool[] }

/** Le fil ne se réaffiche que si ses éléments changent (pas à chaque frappe ni chaque seconde). */
export const Thread = memo(function Thread({
  sessionId,
  items,
  limit,
  onMore,
  writing
}: {
  sessionId: string
  items: Item[]
  limit: number
  onMore: () => void
  writing?: boolean
}) {
  // Fenêtre : seulement les `limit` derniers éléments de premier niveau (les sous-éléments suivent leur parent).
  const { start, hidden } = useMemo(() => {
    let seen = 0
    for (let k = items.length - 1; k >= 0; k--) {
      const i = items[k]
      if ('parent' in i && i.parent && i.kind !== 'permission') continue
      if (++seen > limit) {
        let total = seen - 1
        for (let j = k; j >= 0; j--) {
          const x = items[j]
          if (!('parent' in x && x.parent && x.kind !== 'permission')) total++
        }
        return { start: k + 1, hidden: total - (seen - 1) }
      }
    }
    return { start: 0, hidden: 0 }
  }, [items, limit])
  const subOf = useMemo(() => {
    const m: Record<string, Item[]> = {}
    for (const i of items) {
      const parent = 'parent' in i ? i.parent : null
      if (parent && i.kind !== 'permission') (m[parent] ??= []).push(i)
    }
    return m
  }, [items])
  // Regroupe les appels d'outils consécutifs de l'agent principal (hors sous-agents et plan de tâches).
  const blocks = useMemo(() => {
    const out: Block[] = []
    for (const i of items.slice(start)) {
      if ('parent' in i && i.parent && i.kind !== 'permission') continue
      if (i.kind === 'tool' && i.name === 'TodoWrite') continue
      if (i.kind === 'text' && !i.text.trim()) continue
      if (i.kind === 'tool' && !i.subagent && i.name !== CHECKLIST_TOOL) {
        const last = out[out.length - 1]
        if (last?.k === 'group') last.tools.push(i)
        else out.push({ k: 'group', id: i.id, tools: [i] })
        continue
      }
      out.push({ k: 'item', item: i })
    }
    return out
  }, [items, start])
  const agentName = (parent: string | null) => {
    const t = parent ? (items.find((i) => i.id === parent) as Tool | undefined) : undefined
    return t?.subagent?.type
  }
  // Curseur d'écriture : seulement sur le texte en train de s'écrire, quand c'est le dernier élément du fil.
  const tail = blocks[blocks.length - 1]
  const lastText = tail?.k === 'item' && tail.item.kind === 'text' ? tail : undefined

  return (
    <SessionCtx.Provider value={sessionId}>
      {hidden > 0 && (
        <button type="button" className="more-btn" onClick={onMore}>
          <Icon name="history" size={14} /> Messages précédents
        </button>
      )}
      {blocks.map((b) => {
        if (b.k === 'group') return <ActionGroup key={b.id} tools={b.tools} sessionId={sessionId} />
        const i = b.item
        switch (i.kind) {
          case 'user':
            return (
              <div key={i.id} className="msg-user">
                <MsgActions sessionId={sessionId} role="user" text={i.text} />
                {i.text}
                <AttachedMedia sessionId={sessionId} itemId={i.id} names={i.attachments} />
              </div>
            )
          case 'text':
            return (
              <div key={i.id} className="msg-block">
                <MsgActions sessionId={sessionId} role="ai" text={i.text} last={b === lastText} />
                <div className={`msg-ai ${writing && b === lastText ? 'streaming' : ''}`}><MdText text={i.text} /></div>
                <InlineMedia sessionId={sessionId} itemId={i.id} />
              </div>
            )
          case 'tool':
            return i.name === CHECKLIST_TOOL && !i.subagent ? <ChecklistToolCard key={i.id} t={i} /> : <SubAgent key={i.id} t={i} kids={subOf[i.id] ?? []} />
          case 'permission':
            return <PermCard key={i.id} p={i} sessionId={sessionId} agent={agentName(i.parent)} />
          case 'secret':
            return <SecretCard key={i.id} item={i} sessionId={sessionId} />
          case 'question':
            return <QuestionCard key={i.id} item={i} sessionId={sessionId} />
          case 'task':
            return <TaskCard key={i.id} t={i} sessionId={sessionId} />
          case 'result':
            return i.ok ? (
              <EventLine key={i.id} icon="done" tone="ok">
                {i.durationMs !== undefined
                  ? `Terminé · ${fmtDuration(i.durationMs)}${i.actions ? ` · ${i.actions} action${i.actions > 1 ? 's' : ''}` : ''}`
                  : i.text}
              </EventLine>
            ) : (
              <EventLine key={i.id} icon="error" tone="err">{i.text}</EventLine>
            )
          case 'event':
            return <EventLine key={i.id} icon={eventIcon(i)} tone={i.event === 'compact' ? 'warn' : undefined}>{i.text}</EventLine>
          case 'error':
            return (
              <div key={i.id} className="err-card" role="alert">
                <Icon name="error" size={17} />
                <span><b>La session s’est arrêtée.</b> {i.text}<br /><span className="muted">Rien n’est perdu : écris pour reprendre.</span></span>
              </div>
            )
        }
      })}
    </SessionCtx.Provider>
  )
})

export { isOutside }
