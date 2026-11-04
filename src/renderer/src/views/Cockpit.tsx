import '../cockpit.css'
import { useEffect, useMemo, useState } from 'react'
import type { ExternalSession, HistoryEntry, SessionMeta } from '../../../shared/types'
import { ago, type Tree } from '../derive'
import { Icon } from '../icons'
import { thumbUrl } from '../media'
import { addProjectDialog, api, openExternal, openSession, resumeFromHistory, useStore } from '../store'
import { useLastImage } from './Media'
import { Icons, Tile, TopBar } from '../ui'
import { fxClass, useFx } from '../fx'
import { dragHistory, dragSession, openOrTile, resumeIntoTiles } from '../tiles'

export async function newSession(projectId: string) {
  openSession(await api.createSession(projectId))
}

export function TreeView({ tree }: { tree: Tree }) {
  const open = (e: { ctrlKey: boolean; metaKey: boolean }) => openOrTile(e, tree.session.id)
  const firstPending = tree.pending[0]
  const last = useLastImage(tree.session.id)
  const fresh = useFx((f) => f.fresh)
  return (
    <div className="tree">
      <button type="button" className={`root ${tree.status === 'wait' ? 'wait' : ''} ${fxClass(tree.session, fresh)}`} onClick={open} draggable onDragStart={(e) => dragSession(e, { sessionId: tree.session.id })} title="Ctrl+clic : ajouter à la Mosaïque" style={last ? { paddingTop: 0, overflow: 'hidden' } : undefined}>
        {last && (
          <span style={{ position: 'relative', display: 'block', height: 120, margin: '0 -14px 4px', background: 'var(--g150)' }}>
            <img src={thumbUrl(last.id)} alt={`Dernière vue : ${last.name}`} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            <span className="thumb-label" style={{ top: 8, bottom: 'auto' }}>
              Dernière vue · {last.name} · {ago(last.at)}
            </span>
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={`dot ${tree.status}`} aria-hidden="true" />
          <span style={{ fontSize: 12, fontWeight: 600 }}>{tree.kids.some((k) => !k.agent.startsWith('Étape')) ? 'Orchestrateur' : 'Session'}</span>
          {tree.session.model && <span className="tag">{tree.session.model.replace(/^claude-/, '')}</span>}
          <span style={{ flex: 1 }} />
          <span className="small muted" style={{ whiteSpace: 'nowrap' }}>{ago(tree.session.startedAt)}</span>
        </span>
        <span className="task">{tree.session.title}</span>
        <span className={`small ${tree.status === 'wait' ? '' : 'muted'}`} style={tree.status === 'wait' ? { color: 'var(--clay-text)', fontWeight: 600 } : undefined}>
          {tree.label}
          {tree.last && tree.status !== 'wait' ? ` · ${tree.last}` : ''}
        </span>
      </button>
      {tree.kids.length > 0 && (
        <>
          <span className="branch-h" aria-hidden="true" />
          <div className="kids">
            {tree.kids.map((k) => (
              <div className="kid" key={k.id}>
                <span className={`pill ${k.status}`} title={k.last ? `${k.task} — ${k.last}` : k.task}>
                  <span className={`dot ${k.status}`} aria-hidden="true" />
                  <b style={{ fontWeight: 600 }}>{k.agent}</b>
                  <span className="t">{k.task}</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      {firstPending && (
        <button type="button" className="btn clay sm" style={{ marginLeft: 12 }} onClick={open}>
          Répondre
        </button>
      )}
    </div>
  )
}


// ---------- Cockpit (planche 22) : une ligne par projet, sa session à voir en premier, les autres dépliables ----------

type Entry =
  | { kind: 'open'; key: string; title: string; at: number; s: SessionMeta }
  | { kind: 'external'; key: string; title: string; at: number; x: ExternalSession }
  | { kind: 'history'; key: string; title: string; at: number; h: HistoryEntry }

const RANK: Record<string, number> = { wait: 0, run: 1, error: 2, idle: 3 }
const SHOWN = 5

const stateOf = (e: Entry): { word: string; cls: string } =>
  e.kind === 'external'
    ? { word: 'Dans un terminal', cls: 'ext' }
    : e.kind === 'history'
      ? { word: 'Fermée', cls: 'past' }
      : { word: e.s.status === 'wait' ? 'T’attend' : e.s.status === 'run' ? 'Au travail' : e.s.status === 'error' ? 'Erreur' : 'Terminée', cls: e.s.status }

export function Cockpit() {
  const projects = useStore((s) => s.projects)
  const sessions = useStore((s) => s.sessions)
  const history = useStore((s) => s.history)
  const loadHistory = useStore((s) => s.loadHistory)
  const external = useStore((s) => s.external)
  const go = useStore((s) => s.go)
  const fresh = useFx((f) => f.fresh)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    if (!history.length) void loadHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return projects
      .map((p) => {
        const live = Object.values(sessions)
          .filter((s) => s.projectId === p.id)
          .sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || b.updatedAt - a.updatedAt)
        const liveSdk = new Set(live.map((s) => s.sdkSessionId).filter(Boolean))
        const entries: Entry[] = [
          ...live.map((s): Entry => ({ kind: 'open', key: s.id, title: s.title, at: s.updatedAt, s })),
          ...external.filter((x) => x.projectId === p.id && !liveSdk.has(x.sdkSessionId)).map((x): Entry => ({ kind: 'external', key: `x:${x.sdkSessionId}`, title: x.title, at: x.lastModified, x })),
          ...history
            .filter((h) => h.projectId === p.id && !liveSdk.has(h.sdkSessionId) && !external.some((x) => x.sdkSessionId === h.sdkSessionId))
            .sort((a, b) => b.lastModified - a.lastModified)
            .map((h): Entry => ({ kind: 'history', key: `h:${h.sdkSessionId}`, title: h.title, at: h.lastModified, h }))
        ].filter((e) => !needle || e.title.toLowerCase().includes(needle))
        return { p, entries, last: Math.max(0, ...entries.map((e) => e.at)) }
      })
      .filter((r) => !needle || r.entries.length || r.p.sandbox)
      // Le bac à sable reste tout en haut ; les projets ensuite, du plus récent au plus ancien.
      .sort((a, b) => Number(!!b.p.sandbox) - Number(!!a.p.sandbox) || b.last - a.last)
  }, [projects, sessions, history, external, q])

  const openEntry = async (e: Entry, ev: { ctrlKey: boolean; metaKey: boolean }) => {
    if (e.kind === 'open') return openOrTile(ev, e.s.id)
    setBusy(e.key)
    try {
      if (e.kind === 'external') await openExternal(e.x)
      else if (ev.ctrlKey || ev.metaKey) await resumeIntoTiles(e.h)
      else await resumeFromHistory(e.h)
    } finally {
      setBusy(null)
    }
  }
  const drag = (e: Entry) => (ev: React.DragEvent) => (e.kind === 'open' ? dragSession(ev, { sessionId: e.s.id }) : e.kind === 'history' ? dragHistory(ev, e.h) : undefined)
  const strays = external.filter((x) => !x.projectId)

  return (
    <div className="main">
      <TopBar>
        Canopy / <b>Cockpit</b>
      </TopBar>
      <div className="scroll">
        <div className="ck">
          <div className="ck-head">
            <h1 className="h1">Projets</h1>
            <label className="ck-search">
              <span className="sr-only">Chercher une session</span>
              <Icon name="search" size={15} />
              <input value={q} placeholder="Chercher une session…" onChange={(e) => setQ(e.target.value)} />
            </label>
            <button type="button" className="btn primary" onClick={() => void addProjectDialog()}>{Icons.plus}Projet</button>
          </div>
          <p className="small muted ck-hint">Glisse une session sur l’icône Mosaïque de la barre de gauche (ou Ctrl+clic) pour l’ajouter à la mosaïque sans quitter cette page.</p>

          {projects.length === 0 && (
            <div className="band" style={{ padding: 28, flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
              <h2 className="h2">Ajoute ton premier projet</h2>
              <p className="muted" style={{ margin: 0 }}>Un projet = un dossier de ton disque. Les sessions Claude Code y tournent avec ta config habituelle.</p>
              <button type="button" className="btn primary" onClick={() => void addProjectDialog()}>Ajouter un projet</button>
            </div>
          )}

          <div className="ck-list">
            {rows.map(({ p, entries }) => {
              const top = entries[0]
              const rest = entries.slice(1, SHOWN + 1)
              const older = entries.length - 1 - rest.length
              const isOpen = !!open[p.id] || !!q.trim()
              const st = top && stateOf(top)
              return (
                <section key={p.id} className={`ck-row ${p.sandbox ? 'sandbox ' : ''}${top?.kind === 'open' ? fxClass(top.s, fresh) : ''} ${st?.cls === 'wait' ? 'wait' : ''} ${top && top.kind !== 'open' ? 'quiet' : ''}`} aria-label={p.name}>
                  <div className="ck-line">
                    <span className="ck-proj">
                      <Tile project={p} size={26} />
                      <b>{p.name}</b>
                    </span>
                    {top ? (
                      <>
                        <span className={`ck-state ${st!.cls}`}><i aria-hidden="true" />{st!.word}</span>
                        <button type="button" className="ck-title" draggable={top.kind !== 'external'} onDragStart={drag(top)} disabled={busy === top.key} title={`${top.title} — Ctrl+clic : Mosaïque`} onClick={(ev) => void openEntry(top, ev)}>
                          {busy === top.key ? 'Ouverture…' : top.title}
                        </button>
                        <span className="ck-ago">{ago(top.at)}</span>
                      </>
                    ) : (
                      <span className="ck-none muted">Aucune session pour l’instant</span>
                    )}
                    {entries.length > 1 ? (
                      <button type="button" className="ck-more" aria-expanded={isOpen} onClick={() => setOpen({ ...open, [p.id]: !open[p.id] })}>
                        <Icon name="chevron" size={13} className="a-chev" />
                        {entries.length - 1} autre{entries.length > 2 ? 's' : ''}
                      </button>
                    ) : (
                      <span />
                    )}
                    <button type="button" className="icon-btn" aria-label={`Nouvelle session dans ${p.name}`} title={`Nouvelle session dans ${p.name}`} onClick={() => void newSession(p.id)}>
                      <Icon name="plus" size={16} />
                    </button>
                  </div>
                  {isOpen && rest.length > 0 && (
                    <div className="ck-rest">
                      {rest.map((e) => {
                        const s = stateOf(e)
                        return (
                          <button key={e.key} type="button" className="ck-sub" draggable={e.kind !== 'external'} onDragStart={drag(e)} disabled={busy === e.key} title={`${e.title} — Ctrl+clic : Mosaïque`} onClick={(ev) => void openEntry(e, ev)}>
                            <span className={`ck-state ${s.cls}`}><i aria-hidden="true" />{s.word}</span>
                            <span className="ck-sub-t">{busy === e.key ? 'Ouverture…' : e.title}</span>
                            <span className="ck-ago">{ago(e.at)}</span>
                          </button>
                        )
                      })}
                      {older > 0 && (
                        <button type="button" className="ck-older" onClick={() => go({ name: 'history' })}>
                          Voir les {older} plus anciennes dans l’historique →
                        </button>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
          </div>

          {strays.length > 0 && (
            <div className="ck-strays">
              <span className="side-h">Sessions dans un terminal, hors projets</span>
              {[...new Map(strays.map((x) => [x.cwd.toLowerCase(), x])).values()].map((x) => (
                <span key={x.cwd} className="ck-stray">
                  <span className="mono">{x.cwd}</span>
                  <span className="muted">{x.title}</span>
                  <button type="button" className="btn sm" onClick={() => void api.addProjectPath(x.cwd).then(() => useStore.getState().loadProjects())}>Ajouter ce projet</button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
