import type { Item, SessionMeta } from '../../shared/types'

export type NodeStatus = 'run' | 'wait' | 'done' | 'error' | 'next'

export type Kid = { id: string; agent: string; task: string; status: NodeStatus; last?: string }

export type Tree = {
  session: SessionMeta
  status: SessionMeta['status']
  label: string
  last?: string
  kids: Kid[]
  pending: Extract<Item, { kind: 'permission' }>[]
}

export const STATUS_LABEL: Record<string, string> = {
  run: 'En cours',
  wait: 'Attend ta réponse',
  idle: 'Terminé',
  done: 'Terminé',
  error: 'Erreur',
  next: 'Prévu'
}

type Tool = Extract<Item, { kind: 'tool' }>

/** Arbre d'une session : sous-agents s'il y en a, sinon les étapes du dernier TodoWrite. */
export function treeOf(session: SessionMeta, items: Item[]): Tree {
  const tools = items.filter((i): i is Tool => i.kind === 'tool')
  const pending = items.filter(
    (i): i is Extract<Item, { kind: 'permission' }> => i.kind === 'permission' && i.state === 'pending'
  )
  const lastOf = (parent: string | null) => {
    for (let k = tools.length - 1; k >= 0; k--)
      if (tools[k].parent === parent) return `${tools[k].name} ${tools[k].summary}`.trim()
    return undefined
  }

  let kids: Kid[] = tools
    .filter((t) => t.subagent)
    .map((t) => ({
      id: t.id,
      agent: t.subagent!.type,
      task: t.subagent!.description || t.summary,
      status: pending.some((p) => p.parent === t.id)
        ? 'wait'
        : t.status === 'running'
          ? 'run'
          : t.status === 'error'
            ? 'error'
            : 'done',
      last: lastOf(t.id)
    }))

  if (!kids.length) {
    const todo = [...tools].reverse().find((t) => t.todos && t.parent === null)
    kids = (todo?.todos ?? []).map((td, i) => ({
      id: `${todo!.id}-${i}`,
      agent: `Étape ${i + 1}`,
      task: td.content,
      status: td.status === 'completed' ? 'done' : td.status === 'in_progress' ? 'run' : 'next'
    }))
  }

  const started = items.some((i) => i.kind === 'user')
  const label = session.readOnly
    ? 'Dans un terminal · lecture'
    : !started && session.status === 'idle'
      ? 'Prête'
      : STATUS_LABEL[session.status]
  return { session, status: session.status, label, last: lastOf(null), kids, pending }
}

export function ago(t: number): string {
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'à l’instant'
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`
}

/** Fenêtre de contexte : celle remontée par le SDK, sinon une estimation. */
export const contextWindowOf = (s: { contextTokens?: number; contextWindow?: number }) =>
  s.contextWindow ?? ((s.contextTokens ?? 0) > 200_000 ? 1_000_000 : 200_000)
