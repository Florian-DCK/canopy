import { useCallback, useEffect, useMemo, useState } from 'react'
import type { DbRows, DbSummary, DbTable, MediaItem } from '../../../shared/types'
import { Icon } from '../icons'
import { fmtSize } from '../media'
import { api, useStore } from '../store'
import { chartable, DbChart } from './DbChart'
import { DbDiagram, toMermaid } from './DbDiagram'
import { dbSnapshots, diffDb, fmtCell, fmtN, hhmm, isNumType, RowsTable, toCsv } from './DbMedia'

// Visionneuse de base (planche 45) : données, schéma, SQL en lecture seule, comparer avec la photo
// prise quand la base est entrée dans le fil. Rien n'écrit dans la base ; « Joindre » ajoute à ta saisie.

type Tab = 'data' | 'schema' | 'sql' | 'compare'
const TABS: [Tab, string][] = [['data', 'Données'], ['schema', 'Schéma'], ['sql', 'SQL'], ['compare', 'Comparer']]
const PAGE = 100
const qi = (s: string) => `"${s.replace(/"/g, '""')}"`

export function DbViewer({ m, all, compareId, readOnly, onClose }: { m: MediaItem; all: MediaItem[]; compareId?: string; readOnly: boolean; onClose: () => void }) {
  const insertDraft = useStore((s) => s.insertDraft)
  const attachMedia = useStore((s) => s.attach)
  const snaps = useMemo(() => dbSnapshots(m, all), [m, all])
  // Photo de référence pour « Comparer » : celle demandée, sinon la première de la session.
  const base = (compareId ? all.find((x) => x.id === compareId) : undefined)?.db ?? snaps[0]?.db ?? m.db
  const [tab, setTab] = useState<Tab>(m.query ? 'sql' : compareId ? 'compare' : 'data')
  const [live, setLive] = useState<DbSummary | null>(m.db ?? null)
  const [table, setTable] = useState<string | undefined>()
  const [find, setFind] = useState('')

  const refresh = useCallback(() => {
    api.dbSummary(m.id).then((s) => {
      setLive(s)
      setTable((t) => (t && s.tables.some((x) => x.name === t) ? t : [...s.tables].sort((a, b) => (b.count ?? 0) - (a.count ?? 0))[0]?.name))
    })
  }, [m.id])
  useEffect(refresh, [refresh])

  const T = live?.tables.find((t) => t.name === table)
  const diff = useMemo(() => (base && live && !live.error ? diffDb(base, live) : null), [base, live])
  const tagOf = (name: string) =>
    diff?.added.some((t) => t.name === name) ? 'nouvelle' : diff?.changed.some((t) => t.name === name) ? 'modifiée' : ''
  const newCols = new Set(diff?.changed.find((t) => t.name === table)?.added ?? (diff?.added.some((t) => t.name === table) ? T?.columns.map((c) => c.name) : []))

  const attach = (text: string) => {
    insertDraft(m.sessionId, text)
    onClose()
  }

  const tables = (live?.tables ?? []).filter((t) => !find || t.name.toLowerCase().includes(find.toLowerCase()) || t.columns.some((c) => c.name.toLowerCase().includes(find.toLowerCase())))
  const max = Math.max(1, ...(live?.tables ?? []).map((t) => t.count ?? 0))

  return (
    <div className="viewer dbv" role="dialog" aria-label={`Visionneuse de base — ${m.name}`}>
      <header className="viewer-bar">
        <span style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>
            {m.name}
            <span className="v-muted" style={{ fontWeight: 400 }}> · {[fmtSize(m.size), live?.format === 'csv' ? `CSV (« ${live.sep === '\t' ? 'tab' : live.sep} »)` : live?.format === 'xlsx' ? 'Excel' : 'SQLite', 'lecture seule', live ? `lue à ${hhmm(live.at)}` : ''].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="mono v-muted" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.path}</span>
        </span>
        <div className="v-seg" role="tablist" aria-label="Vue">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>
          ))}
        </div>
        <button type="button" className="v-btn" onClick={refresh}>Actualiser</button>
        <button type="button" className="v-btn" onClick={() => api.showMediaInFolder(m.id)}>Ouvrir le dossier</button>
        <button type="button" className="v-btn" onClick={() => api.openMedia(m.id)}>Ouvrir avec…</button>
        {!readOnly && <button type="button" className="v-btn primary" onClick={() => attach(`Base \`${m.path}\`${table ? `, table \`${table}\`` : ''}.`)}>Joindre → session</button>}
        <button type="button" className="v-btn" aria-label="Fermer (Échap)" onClick={onClose}>✕</button>
      </header>

      {live?.error ? (
        <div className="dbv-msg">Lecture impossible : {live.error}</div>
      ) : (
        <div className="dbv-main">
          <aside className="dbv-side" aria-label="Tables">
            <label className="dbv-find">
              <Icon name="search" size={13} />
              <span className="sr-only">Chercher une table ou une colonne</span>
              <input type="search" placeholder="Table ou colonne…" value={find} onChange={(e) => setFind(e.target.value)} />
            </label>
            <span className="dbv-cap">Tables · {live?.tables.length ?? '…'}</span>
            <div className="dbv-tables" role="listbox" aria-label="Tables">
              {tables.map((t) => (
                <button key={t.name} type="button" role="option" aria-selected={t.name === table} onClick={() => setTable(t.name)}>
                  <span className="dbv-tline">
                    <span className="mono dbv-tname">{t.name}</span>
                    {tagOf(t.name) && <span className={`dbv-ttag ${tagOf(t.name) === 'nouvelle' ? 'add' : 'mod'}`}>{tagOf(t.name)}</span>}
                    <span className="v-muted">{fmtN(t.count)}</span>
                  </span>
                  <span className="dbv-bar"><span style={{ width: `${Math.max(2, Math.round(Math.sqrt((t.count ?? 0) / max) * 100))}%` }} /></span>
                </button>
              ))}
            </div>
            <span style={{ flex: 1 }} />
            <p className="dbv-note">Lecture seule. Pour modifier des données, demande-le à Claude : le changement passe par une commande que tu vois dans le fil.</p>
          </aside>

          {tab === 'data' && T && <DataTab key={T.name} m={m} T={T} live={live!} readOnly={readOnly} newCols={newCols} attach={attach} goTable={setTable} />}
          {tab === 'schema' && T && <SchemaTab T={T} live={live!} newCols={newCols} isNew={tagOf(T.name) === 'nouvelle'} readOnly={readOnly} attach={(t) => attach(t)} goTable={setTable} mName={m.name} path={m.path} />}
          {tab === 'sql' && (
            <SqlTab
              m={m}
              all={all}
              table={T}
              readOnly={readOnly}
              attach={attach}
              attachImage={(dataUrl, name) => {
                attachMedia(m.sessionId, { dataUrl, name })
                onClose()
              }}
            />
          )}
          {tab === 'compare' && base && live && <CompareTab base={base} live={live} />}
          {!T && tab !== 'sql' && tab !== 'compare' && <div className="dbv-msg">{live ? 'Aucune table.' : 'Lecture…'}</div>}
        </div>
      )}
    </div>
  )
}

/* ---------- Données ---------- */

function DataTab({ m, T, live, readOnly, newCols, attach, goTable }: { m: MediaItem; T: DbTable; live: DbSummary; readOnly: boolean; newCols: Set<string>; attach: (t: string) => void; goTable: (t: string) => void }) {
  const [order, setOrder] = useState<{ col?: string; desc: boolean }>({ desc: false })
  const [whereText, setWhereText] = useState('')
  const [where, setWhere] = useState('')
  const [offset, setOffset] = useState(0)
  const [rows, setRows] = useState<DbRows | null>(null)
  const [sel, setSel] = useState<number | null>(null)
  const [refs, setRefs] = useState<{ t: string; col: string; n: number | null }[]>([])

  useEffect(() => {
    let alive = true
    api.dbPage(m.id, { table: T.name, offset, limit: PAGE, order: order.col, desc: order.desc, where }).then((r) => alive && setRows(r))
    return () => {
      alive = false
    }
  }, [m.id, T.name, offset, order, where, live])

  const row = sel != null ? rows?.rows[sel] : undefined
  // Lignes qui pointent vers celle-ci (clés étrangères des autres tables).
  const incoming = useMemo(() => live.tables.flatMap((t) => t.fks.filter((f) => f.table === T.name).map((f) => ({ t: t.name, col: f.from, to: f.to }))), [live, T.name])
  useEffect(() => {
    if (!row || !rows) return setRefs([])
    let alive = true
    Promise.all(
      incoming.map(async (r) => {
        const v = row[rows.columns.indexOf(r.to)]
        if (v == null) return { t: r.t, col: r.col, n: 0 }
        const res = await api.dbQuery(m.id, `select count(*) from ${qi(r.t)} where ${qi(r.col)} = ${typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`}`)
        return { t: r.t, col: r.col, n: res.error ? null : Number(res.rows[0]?.[0]) }
      })
    ).then((x) => alive && setRefs(x))
    return () => {
      alive = false
    }
  }, [row, rows, incoming, m.id])

  const total = where ? rows?.total ?? null : T.count
  const types = T.columns.map((c) => c.type)
  const sortBy = (c: string) => {
    setOrder((o) => ({ col: c, desc: o.col === c ? !o.desc : false }))
    setOffset(0)
    setSel(null)
  }
  const applyWhere = () => {
    setWhere(whereText)
    setOffset(0)
    setSel(null)
  }
  const n = rows?.rows.length ?? 0

  return (
    <>
      <div className="dbv-pane">
        <div className="dbv-tools">
          <label className="dbv-where">
            <span className="mono v-muted">WHERE</span>
            <input
              type="text"
              aria-label="Filtre SQL"
              placeholder={T.columns[1] ? `${T.columns[1].name} is not null` : 'condition SQL'}
              value={whereText}
              onChange={(e) => setWhereText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && applyWhere()}
              onBlur={applyWhere}
            />
          </label>
          {order.col && <span className="small v-muted">Tri : <span className="dbv-strong">{order.col} {order.desc ? 'décroissant' : 'croissant'}</span></span>}
          <button type="button" className="v-btn" disabled={!rows || !!rows.error} onClick={() => rows && navigator.clipboard.writeText(toCsv(rows.columns, rows.rows))}>Copier en CSV</button>
        </div>
        <div className="dbv-grid">
          {rows?.error ? (
            <div className="dbv-msg">{rows.error}</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col" className="dbv-rn"><span className="sr-only">Ligne</span></th>
                  {T.columns.map((c, i) => (
                    <th key={c.name} scope="col" aria-sort={order.col === c.name ? (order.desc ? 'descending' : 'ascending') : 'none'} className={isNumType(types[i]) ? 'num' : ''}>
                      <button type="button" onClick={() => sortBy(c.name)}>
                        <span>
                          {c.name} <span className="v-muted">{order.col === c.name ? (order.desc ? '↓' : '↑') : ''}</span>
                          {newCols.has(c.name) && <span className="dbv-new"> nouvelle</span>}
                        </span>
                        <span className="dbv-type">{c.type.toLowerCase() || '—'}</span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows?.rows.map((r, k) => (
                  <tr key={k} className={k === sel ? 'on' : ''} onClick={() => setSel(k === sel ? null : k)}>
                    <td className="dbv-rn">{offset + k + 1}</td>
                    {r.map((v, i) => (
                      <td key={i} className={(isNumType(types[i]) ? 'num ' : '') + (v == null ? 'null' : '')}>{fmtCell(v)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="dbv-pager">
          <span style={{ flex: 1 }}>{n ? `${fmtN(offset + 1)}–${fmtN(offset + n)}` : '0'} sur {total == null ? '?' : fmtN(total)} lignes{where ? ' (filtrées)' : ''}</span>
          <button type="button" aria-label="Page précédente" disabled={offset === 0} onClick={() => (setOffset(Math.max(0, offset - PAGE)), setSel(null))}>‹</button>
          <span>Page {Math.floor(offset / PAGE) + 1}</span>
          <button type="button" aria-label="Page suivante" disabled={n < PAGE} onClick={() => (setOffset(offset + PAGE), setSel(null))}>›</button>
        </div>
      </div>

      {row && rows && (
        <aside className="dbv-detail" aria-label="Détail de la ligne">
          <span className="dbv-detail-head">
            <b>{T.name} · {fmtCell(row[0])}</b>
            <button type="button" className="v-btn" aria-label="Fermer le détail" onClick={() => setSel(null)}>✕</button>
          </span>
          <div className="dbv-fields">
            {rows.columns.map((c, i) => (
              <span key={c} className="dbv-field">
                <span className="v-muted">{c}</span>
                <span className={`mono ${row[i] == null ? 'null' : ''}`}>{fmtCell(row[i])}</span>
              </span>
            ))}
          </div>
          {(T.fks.length > 0 || refs.length > 0) && <span className="dbv-cap">Lignes liées</span>}
          {T.fks.map((f) => (
            <button key={f.from} type="button" className="dbv-link" onClick={() => goTable(f.table)}>
              <span className="mono">{f.from} → {f.table}</span>
              <span className="v-muted">{fmtCell(row[rows.columns.indexOf(f.from)])}</span>
            </button>
          ))}
          {refs.map((r) => (
            <button key={r.t + r.col} type="button" className="dbv-link" onClick={() => goTable(r.t)}>
              <span className="mono">{r.t}.{r.col}</span>
              <span className="v-muted">{r.n == null ? '?' : `${fmtN(r.n)} ligne${r.n > 1 ? 's' : ''}`}</span>
            </button>
          ))}
          <span style={{ flex: 1 }} />
          {!readOnly && (
            <button
              type="button"
              className="v-btn primary"
              onClick={() => attach(`Ligne de \`${T.name}\` dans \`${m.path}\` :\n\`\`\`json\n${JSON.stringify(Object.fromEntries(rows.columns.map((c, i) => [c, row[i]])), null, 2)}\n\`\`\``)}
            >
              Joindre cette ligne à ta saisie
            </button>
          )}
        </aside>
      )}
    </>
  )
}

/* ---------- Schéma ---------- */

function SchemaTab({ T, live, newCols, isNew, readOnly, attach, goTable, mName, path }: { T: DbTable; live: DbSummary; newCols: Set<string>; isNew: boolean; readOnly: boolean; attach: (t: string) => void; goTable: (t: string) => void; mName: string; path: string }) {
  const [diagram, setDiagram] = useState(false)
  const fkCols = new Set(T.fks.map((f) => f.from))
  const unique = new Set(T.indexes.filter((i) => i.unique && !i.cols.includes(',')).map((i) => i.cols))
  const incoming = live.tables.flatMap((t) => t.fks.filter((f) => f.table === T.name).map((f) => ({ from: `${t.name}.${f.from}`, to: `${T.name}.${f.to}`, go: t.name })))
  const outgoing = T.fks.map((f) => ({ from: `${T.name}.${f.from}`, to: `${f.table}.${f.to}`, go: f.table }))
  const keyOf = (c: DbTable['columns'][number]) => [c.pk ? 'PK' : '', fkCols.has(c.name) ? 'FK' : '', unique.has(c.name) ? 'UNIQUE' : ''].filter(Boolean).join(' · ')
  return (
    <div className="dbv-schema">
      <div className="dbv-schema-main">
        <span className="dbv-title">
          <span className="mono">{diagram ? `${live.tables.length} tables` : T.name}</span>
          <span className="small v-muted" style={{ flex: 1 }}>{diagram ? 'Clique une table pour voir ses relations' : `${T.columns.length} colonnes · ${fmtN(T.count)} lignes${isNew ? ' · nouvelle depuis la photo' : ''}`}</span>
          <span className="v-seg" role="group" aria-label="Affichage du schéma">
            <button type="button" aria-pressed={!diagram} onClick={() => setDiagram(false)}>Table</button>
            <button type="button" aria-pressed={diagram} onClick={() => setDiagram(true)}>Diagramme</button>
          </span>
        </span>
        {diagram ? <DbDiagram s={live} path={path} selected={T.name} onSelect={goTable} /> : (
        <table className="dbv-cols">
          <thead>
            <tr><th scope="col">Colonne</th><th scope="col">Type</th><th scope="col">Vide permis</th><th scope="col">Défaut</th><th scope="col">Clé</th></tr>
          </thead>
          <tbody>
            {T.columns.map((c) => (
              <tr key={c.name} className={isNew || newCols.has(c.name) ? 'new' : ''}>
                <td className="mono">{c.name}</td>
                <td className="mono v-soft">{c.type || '—'}</td>
                <td className="v-soft">{c.notnull || c.pk ? 'non' : 'oui'}</td>
                <td className="mono v-soft">{c.dflt ?? '—'}</td>
                <td>{newCols.has(c.name) && !isNew ? <span className="dbv-new">NOUVELLE</span> : <span className="v-soft small">{keyOf(c)}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>
      <div className="dbv-schema-side">
        <span className="dbv-cap">Relations</span>
        {[...outgoing, ...incoming].map((r) => (
          <button key={r.from + r.to} type="button" className="dbv-rel" onClick={() => goTable(r.go)}>
            <span className="mono">{r.from}</span>
            <span aria-hidden="true" className="v-muted">→</span>
            <span className="mono" style={{ textAlign: 'right' }}>{r.to}</span>
          </button>
        ))}
        {!outgoing.length && !incoming.length && <span className="small v-muted">Aucune clé étrangère.</span>}
        <span className="dbv-cap" style={{ marginTop: 8 }}>Index</span>
        {T.indexes.filter((i) => !i.name.startsWith('sqlite_autoindex')).map((i) => (
          <span key={i.name} className="dbv-idx"><span className="mono">{i.name}</span><span className="v-muted">{i.unique ? 'unique · ' : ''}{i.cols}</span></span>
        ))}
        {!T.indexes.some((i) => !i.name.startsWith('sqlite_autoindex')) && <span className="small v-muted">Aucun index secondaire.</span>}
        <span style={{ flex: 1 }} />
        {T.sql && <button type="button" className="v-btn" onClick={() => navigator.clipboard.writeText(T.sql!)}>Copier le CREATE TABLE</button>}
        {!readOnly && diagram && (
          <button type="button" className="v-btn primary" onClick={() => attach(`Schéma de ${mName} (Mermaid) :\n\`\`\`mermaid\n${toMermaid(live)}\n\`\`\``)}>
            Joindre tout le schéma
          </button>
        )}
        {!readOnly && !diagram && T.sql && <button type="button" className="v-btn primary" onClick={() => attach(`Schéma de \`${T.name}\` (${mName}) :\n\`\`\`sql\n${T.sql}\n\`\`\``)}>Joindre le schéma</button>}
      </div>
    </div>
  )
}

/* ---------- SQL ---------- */

function SqlTab({ m, all, table, readOnly, attach, attachImage }: { m: MediaItem; all: MediaItem[]; table?: DbTable; readOnly: boolean; attach: (t: string) => void; attachImage: (dataUrl: string, name: string) => void }) {
  const p = m.path.toLowerCase()
  const fromSession = useMemo(() => [...new Set(all.filter((x) => x.query && x.path.toLowerCase() === p).map((x) => x.query!))], [all, p])
  const presets = [
    ...(table ? [{ label: `Aperçu de ${table.name}`, sql: `select *\n  from ${qi(table.name)}\n limit 100;` }] : []),
    ...(table && table.columns[0] ? [{ label: 'Valeurs les plus fréquentes', sql: `select ${qi(table.columns[Math.min(1, table.columns.length - 1)].name)}, count(*) as n\n  from ${qi(table.name)}\n group by 1\n order by n desc\n limit 20;` }] : []),
    ...fromSession.map((q, i) => ({ label: `Requête de Claude ${fromSession.length > 1 ? i + 1 : ''}`.trim(), sql: q }))
  ]
  const [sql, setSql] = useState(m.query ?? presets[0]?.sql ?? '')
  const [res, setRes] = useState<DbRows | null>(null)
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<'table' | 'chart'>('table')
  const canChart = !!res && !res.error && !res.refused && !!chartable(res)
  const run = () => {
    if (!sql.trim()) return
    setBusy(true)
    api.dbQuery(m.id, sql).then((r) => (setRes(r), setBusy(false)))
  }
  useEffect(() => {
    if (m.query) run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="dbv-sql">
      {presets.length > 0 && (
        <div className="dbv-presets">
          <span className="small v-muted">Exemples</span>
          {presets.map((x) => (
            <button key={x.label + x.sql} type="button" aria-pressed={sql === x.sql} onClick={() => (setSql(x.sql), setRes(null))}>{x.label}</button>
          ))}
        </div>
      )}
      <div className="dbv-editor">
        <label htmlFor="dbq" className="sr-only">Requête SQL</label>
        <textarea
          id="dbq"
          spellCheck={false}
          value={sql}
          onChange={(e) => setSql(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.preventDefault(), run())
          }}
        />
        <div className="dbv-editor-foot">
          <span style={{ flex: 1 }}>Lecture seule · 1 000 lignes au plus</span>
          <button type="button" className="v-btn primary" disabled={busy} onClick={run}>Exécuter · Ctrl+Entrée</button>
        </div>
      </div>
      {res?.refused ? (
        <div role="alert" className="dbv-refused">
          <Icon name="lock" size={18} />
          <span><b>Refusé : la visionneuse ne modifie pas la base.</b><br />Si c’est voulu, demande-le à Claude : la commande passera par le fil, avec ta validation.</span>
        </div>
      ) : res?.error ? (
        <div role="alert" className="dbv-sqlerr mono">{res.error}</div>
      ) : res ? (
        <div className="dbv-result">
          {canChart && (
            <div className="dbv-result-tools">
              <div className="v-seg" role="group" aria-label="Affichage du résultat">
                <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Tableau</button>
                <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Graphique</button>
              </div>
            </div>
          )}
          {canChart && view === 'chart' ? <DbChart data={res} onAttach={readOnly ? undefined : attachImage} /> : <div className="dbv-result-rows"><RowsTable data={res} /></div>}
          <div className="dbv-pager">
            <span style={{ flex: 1 }}>{fmtN(res.rows.length)} ligne{res.rows.length > 1 ? 's' : ''}{res.truncated ? ' (limite atteinte)' : ''} · {res.ms} ms · lecture seule</span>
            <button type="button" className="v-btn" onClick={() => navigator.clipboard.writeText(toCsv(res.columns, res.rows))}>Copier en CSV</button>
            {!readOnly && (
              <button
                type="button"
                className="v-btn primary"
                onClick={() => attach(`Résultat de cette requête sur \`${m.path}\` (${res.rows.length} lignes${res.rows.length > 50 ? ', 50 premières' : ''}) :\n\`\`\`sql\n${sql.trim()}\n\`\`\`\n\`\`\`csv\n${toCsv(res.columns, res.rows.slice(0, 50))}\n\`\`\``)}
              >
                Joindre le résultat
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="dbv-idle">Exécute la requête pour voir le résultat ici.</div>
      )}
    </div>
  )
}

/* ---------- Comparer ---------- */

function CompareTab({ base, live }: { base: DbSummary; live: DbSummary }) {
  const d = diffDb(base, live)
  const added = new Set(d.added.map((t) => t.name))
  const changed = new Map(d.changed.map((t) => [t.name, t]))
  const removed = new Set(d.removed.map((t) => t.name))
  const counted = new Map([...d.changed, ...d.counts].map((t) => [t.name, t]))
  const nothing = !d.added.length && !d.removed.length && !d.changed.length && !d.counts.length
  const total = (s: DbSummary) => (s.estimated ? '?' : fmtN(s.tables.reduce((a, t) => a + (t.count ?? 0), 0)))
  const side = (s: DbSummary, after: boolean) =>
    s.tables.map((t) => {
      const c = changed.get(t.name)
      const k = counted.get(t.name)
      const tag = after ? (added.has(t.name) ? 'nouvelle' : c ? 'modifiée' : k ? (k.after! > k.before! ? `+${fmtN(k.after! - k.before!)}` : `−${fmtN(k.before! - k.after!)}`) : '') : removed.has(t.name) ? 'supprimée' : ''
      return (
        <div key={t.name} className={`dbv-cmp-t ${after && added.has(t.name) ? 'new' : !after && removed.has(t.name) ? 'gone' : ''}`}>
          <span className="dbv-cmp-line">
            <span className="mono" style={{ flex: 1 }}>{t.name}</span>
            {tag && <span className={`dbv-ttag ${tag === 'supprimée' || tag.startsWith('−') ? 'del' : tag.startsWith('+') ? '' : tag === 'nouvelle' ? 'add' : 'mod'}`}>{tag}</span>}
            <span className="v-muted dbv-cmp-n">{fmtN(t.count)}</span>
          </span>
          <span className="dbv-chips">
            {t.columns.map((col) => {
              const tone = after ? (added.has(t.name) || c?.added.includes(col.name) ? 'add' : c?.retyped.includes(col.name) ? 'mod' : '') : c?.removed.includes(col.name) || removed.has(t.name) ? 'del' : ''
              return <span key={col.name} className={`dbv-chip mono ${tone}`}>{col.name}</span>
            })}
          </span>
        </div>
      )
    })
  return (
    <div className="dbv-compare">
      <div className="dbv-compare-head">
        <span className="dbv-pill">{hhmm(base.at)} · photo prise quand la base est entrée dans le fil</span>
        <span className="v-muted">→</span>
        <span className="dbv-pill">{hhmm(live.at)} · maintenant</span>
        <span style={{ flex: 1 }} />
        <span className="small v-muted">Seuls le schéma et les comptes sont gardés en photo, pas les données.</span>
      </div>
      {nothing && <div className="dbv-msg small">Aucun changement depuis {hhmm(base.at)}.</div>}
      <div className="dbv-compare-cols">
        <div className="dbv-cmp-col">
          <div className="dbv-cmp-head"><b>Avant · {hhmm(base.at)}</b><span className="v-muted">{base.tables.length} tables · {total(base)} lignes</span></div>
          {side(base, false)}
        </div>
        <div className="dbv-cmp-col">
          <div className="dbv-cmp-head"><b>Maintenant · {hhmm(live.at)}</b><span className="v-muted">{live.tables.length} tables · {total(live)} lignes</span></div>
          {side(live, true)}
        </div>
      </div>
    </div>
  )
}
