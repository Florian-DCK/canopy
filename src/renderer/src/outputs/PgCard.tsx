import { useCallback, useEffect, useState } from 'react'
import type { DbRows, Item } from '../../../shared/types'
import { RowsTable, toCsv } from '../db/DbMedia'
import { api, useStore } from '../store'
import './outputs.css'

// Requête psql de Claude relue par Canopy (planche 46) : il faut l'autoriser une fois (session ou projet).
// L'URL reste dans .env ; ici on ne voit que l'hôte masqué. Transaction en lecture seule, 5 s au plus.

type Tool = Extract<Item, { kind: 'tool' }>
type Info = { host?: string; database?: string; allowed: 'session' | 'project' | null; error?: string }

export function PgCard({ t, sessionId }: { t: Tool; sessionId: string }) {
  const projectId = useStore((s) => s.sessions[sessionId]?.projectId ?? '')
  const { sql, env } = t.pg!
  const [info, setInfo] = useState<Info | null>(null)
  const [res, setRes] = useState<DbRows | null>(null)
  const [skip, setSkip] = useState(false)

  const load = useCallback(async () => {
    const i = await api.pgInfo(sessionId, projectId, env)
    setInfo(i)
    if (i.allowed && !i.error) setRes(await api.pgQuery(sessionId, projectId, env, sql))
  }, [sessionId, projectId, env, sql])
  useEffect(() => {
    if (projectId) void load()
  }, [load, projectId])

  const allow = async (scope: 'session' | 'project' | null) => {
    await api.pgAllow(sessionId, projectId, scope)
    setRes(null)
    void load()
  }

  if (!info || skip || info.error) return null
  const badge = <span className="out-badge">Postgres</span>

  if (!info.allowed)
    return (
      <div className="out-card">
        <div className="out-head">
          {badge}
          <span style={{ fontSize: 13.5 }}><b style={{ fontWeight: 600 }}>{info.host}</b> <span className="muted">/ {info.database}</span></span>
        </div>
        <p className="out-pg-text">
          Claude a lu cette base avec <span className="mono">psql</span>. Canopy peut relire ses requêtes pour les afficher en tableau, avec <span className="mono">{env}</span> de .env.local (jamais affiché), en lecture seule.
        </p>
        <div className="out-foot" style={{ borderTop: 'none' }}>
          <button type="button" className="btn sm primary" onClick={() => allow('session')}>Autoriser pour cette session</button>
          <button type="button" className="btn sm" onClick={() => allow('project')}>Toujours pour ce projet</button>
          <span style={{ flex: 1 }} />
          <button type="button" className="btn sm ghost" onClick={() => setSkip(true)}>Garder le texte brut</button>
        </div>
      </div>
    )

  return (
    <div className="out-card">
      <div className="out-head">
        {badge}
        <span className="mono out-url" title={sql}>{sql.replace(/\s+/g, ' ')}</span>
      </div>
      <div className="out-pg-rows">
        {!res ? <span className="small muted">Lecture…</span> : res.error ? <span className="small out-bad">{res.error}</span> : <RowsTable data={res} max={50} />}
      </div>
      <div className="out-foot">
        <span className="small muted" style={{ flex: 1 }}>
          {[res && !res.error && `${res.rows.length} ligne${res.rows.length > 1 ? 's' : ''}${res.truncated ? ' (limite atteinte)' : ''}`, res && `${res.ms} ms`, info.host, 'lecture seule', info.allowed === 'project' ? 'autorisé pour ce projet' : 'autorisé pour cette session'].filter(Boolean).join(' · ')}
        </span>
        {res && !res.error && <button type="button" className="btn sm" onClick={() => navigator.clipboard.writeText(toCsv(res.columns, res.rows))}>Copier en CSV</button>}
        <button type="button" className="btn sm ghost" onClick={() => allow(null)}>Retirer l’accès</button>
      </div>
    </div>
  )
}
