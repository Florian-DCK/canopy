import { useEffect, useMemo, useState } from 'react'
import type { HistoryEntry } from '../../../shared/types'
import { resumeFromHistory, useStore } from '../store'
import { openOrTile, resumeIntoTiles } from '../tiles'
import { Tile, TopBar } from '../ui'
import { MOD, mod } from '../platform'

const dayLabel = (t: number) => {
  const d = new Date(t)
  const today = new Date()
  const y = new Date()
  y.setDate(today.getDate() - 1)
  if (d.toDateString() === today.toDateString()) return 'Aujourd’hui'
  if (d.toDateString() === y.toDateString()) return 'Hier'
  return d.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function HistoryRow({ h, showProject = true }: { h: HistoryEntry; showProject?: boolean }) {
  const project = useStore((s) => s.projects.find((p) => p.id === h.projectId))
  const open = useStore((s) => Object.values(s.sessions).find((x) => x.sdkSessionId === h.sdkSessionId))
  const [busy, setBusy] = useState(false)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px', borderBottom: '0.5px solid var(--line)' }}>
      <span className="small muted" style={{ width: 44, flex: 'none', fontVariantNumeric: 'tabular-nums' }}>
        {new Date(h.lastModified).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}
      </span>
      {showProject && project && <Tile project={project} size={26} />}
      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span style={{ fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.title}</span>
        <span className="small muted">
          {showProject && project ? project.name : ''}
          {h.branch ? `${showProject ? ' · ' : ''}${h.branch}` : ''}
        </span>
      </span>
      {open ? (
        <button type="button" className="btn sm" title={`${MOD}+clic : ajouter à la Mosaïque`} onClick={(e) => openOrTile(e, open.id)}>Ouverte</button>
      ) : (
        <button
          type="button"
          className="btn sm"
          disabled={busy}
          title={`${MOD}+clic : reprendre dans la Mosaïque`}
          onClick={async (e) => {
            const tile = mod(e)
            setBusy(true)
            try {
              if (tile) await resumeIntoTiles(h)
              else await resumeFromHistory(h)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Ouverture…' : 'Reprendre'}
        </button>
      )}
    </div>
  )
}

export function HistoryView() {
  const history = useStore((s) => s.history)
  const loading = useStore((s) => s.historyLoading)
  const load = useStore((s) => s.loadHistory)
  const projects = useStore((s) => s.projects)
  const [q, setQ] = useState('')
  const [pid, setPid] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const rows = history.filter((h) => (!pid || h.projectId === pid) && (!needle || h.title.toLowerCase().includes(needle)))
    const out: { label: string; rows: HistoryEntry[] }[] = []
    for (const h of rows) {
      const label = dayLabel(h.lastModified)
      if (out.at(-1)?.label !== label) out.push({ label, rows: [] })
      out.at(-1)!.rows.push(h)
    }
    return out
  }, [history, q, pid])

  return (
    <div className="main">
      <TopBar>
        Canopy / <b>Historique</b>
      </TopBar>
      <div className="scroll">
        <div className="page" style={{ maxWidth: 1000 }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <h1 className="h1">Historique</h1>
              <p className="sub">Toutes les sessions Claude Code de tes projets, y compris celles lancées depuis le terminal.</p>
            </div>
            <button type="button" className="btn" onClick={() => load()} disabled={loading}>{loading ? 'Chargement…' : 'Actualiser'}</button>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <label htmlFor="hq" className="small muted" style={{ position: 'absolute', left: -9999 }}>Rechercher</label>
            <input
              id="hq"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Rechercher dans les titres…"
              style={{ flex: '1 1 320px', height: 42, borderRadius: 11, border: '0.5px solid var(--line-strong)', background: 'var(--white)', padding: '0 14px' }}
            />
            <label htmlFor="hp" className="small muted" style={{ position: 'absolute', left: -9999 }}>Projet</label>
            <select id="hp" className="select" style={{ height: 42, borderRadius: 11 }} value={pid} onChange={(e) => setPid(e.target.value)}>
              <option value="">Tous les projets</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            Si une session tourne encore dans un terminal, ferme-la là-bas avant de la reprendre ici.
          </p>
          {!loading && groups.length === 0 && <p className="muted">Aucune session trouvée.</p>}
          {groups.map((g) => (
            <section key={g.label} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <h2 className="h2" style={{ textTransform: 'capitalize' }}>{g.label}</h2>
              <div className="band" style={{ flexDirection: 'column' }}>
                {g.rows.map((h) => (
                  <HistoryRow key={h.sdkSessionId} h={h} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
