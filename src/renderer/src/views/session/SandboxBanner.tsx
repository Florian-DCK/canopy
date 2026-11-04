import { useMemo, useState } from 'react'
import type { Item, Project, SessionMeta } from '../../../../shared/types'
import { api, openSession, useStore } from '../../store'

// Bac à sable (planche 35) : une conversation sans projet qui se met à parler d'un projet connu propose de continuer
// là-bas ; le transfert ouvre une session dans le projet avec l'échange en contexte.

const KEY = 'atelier.sandbox'
type Memo = { dismissed: Record<string, string[]>; moved: Record<string, { projectId: string; sessionId: string }> }
function load(): Memo {
  try {
    return { dismissed: {}, moved: {}, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return { dismissed: {}, moved: {} }
  }
}
function save(m: Memo) {
  try {
    localStorage.setItem(KEY, JSON.stringify(m))
  } catch {
    /* stockage indisponible */
  }
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Mots qui désignent un projet : son nom, les morceaux de son nom, le nom de son dossier (4 lettres au moins). */
function wordsOf(p: Project): string[] {
  const parts = [p.name, ...p.name.split(/[/·|-]+/), p.path.split(/[\\/]/).filter(Boolean).pop() ?? '']
  return [...new Set(parts.map((x) => norm(x.trim())).filter((x) => x.length >= 4))]
}

/** Le projet dont parle la conversation (dans tes messages), s'il y en a un. */
function detect(items: Item[], projects: Project[]): Project | undefined {
  const said = norm(items.filter((i) => i.kind === 'user').map((i) => (i as { text: string }).text).join('\n'))
  if (!said) return undefined
  return projects.find((p) => !p.sandbox && wordsOf(p).some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(said)))
}

/** L'échange jusqu'ici, pour la nouvelle session du projet (les derniers 12 000 caractères). */
function transcript(items: Item[]): string {
  const lines: string[] = []
  for (const i of items) {
    if (i.kind === 'user') lines.push(`Utilisateur : ${i.text.replace(/^🎙\s*/, '')}`)
    else if (i.kind === 'text' && !i.parent) lines.push(`Claude : ${i.text}`)
  }
  const all = lines.join('\n\n')
  return all.length > 12_000 ? `…${all.slice(-12_000)}` : all
}

export function SandboxBanner({ session, project, items }: { session: SessionMeta; project: Project; items: Item[] }) {
  const projects = useStore((s) => s.projects)
  const [memo, setMemo] = useState(load)
  const [busy, setBusy] = useState(false)
  const target = useMemo(() => (project.sandbox ? detect(items, projects) : undefined), [project.sandbox, items, projects])
  const moved = memo.moved[session.id]
  const movedTo = moved && projects.find((p) => p.id === moved.projectId)

  const update = (fn: (m: Memo) => void) => {
    const m = load()
    fn(m)
    save(m)
    setMemo(m)
  }

  if (!project.sandbox) return null
  if (moved && movedTo)
    return (
      <div className="sb-moved">
        <span className="sb-arrow">↗</span>
        <span>Continuée dans <b>{movedTo.name}</b>, avec l’échange en contexte.</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm" onClick={() => {
          const s = useStore.getState().sessions[moved.sessionId]
          if (s) openSession(s)
        }}>Ouvrir</button>
      </div>
    )
  if (!target || memo.dismissed[session.id]?.includes(target.id)) return null

  const transfer = async () => {
    setBusy(true)
    try {
      const meta = await api.createSession(target.id)
      const prompt = [
        `Suite d’une conversation commencée dans le bac à sable de Canopy${session.cwd ? ` (fichiers créés : ${session.cwd})` : ''}.`,
        'Voici l’échange jusqu’ici :',
        '',
        transcript(items),
        '',
        'Reprends à partir de là, dans ce projet. Si des fichiers du bac à sable servent ici, copie-les dans le projet. Commence par un résumé en deux phrases de ce qui a été dit, puis demande-moi par quoi continuer.'
      ].join('\n')
      await api.send(meta.id, prompt)
      update((m) => (m.moved[session.id] = { projectId: target.id, sessionId: meta.id }))
      openSession(meta)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sb-suggest" role="status">
      <span>Cette conversation parle du projet <b>{target.name}</b>. La continuer là-bas, avec son dossier et sa mémoire ?</span>
      <span style={{ flex: 1 }} />
      <button type="button" className="btn sm primary" disabled={busy} onClick={() => void transfer()}>{busy ? 'Transfert…' : `Continuer dans ${target.name}`}</button>
      <button type="button" className="btn sm" onClick={() => update((m) => (m.dismissed[session.id] = [...(m.dismissed[session.id] ?? []), target.id]))}>Rester ici</button>
    </div>
  )
}
