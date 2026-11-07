import { useEffect, useMemo, useState } from 'react'
import type { DbRows, DbSummary, DbTable, MediaItem } from '../../../shared/types'
import { Icon } from '../icons'
import { fmtSize } from '../media'
import { api, useStore } from '../store'
import './db.css'

// Bases de données dans le fil (planche 44) : carte avec tables et aperçu, carte « avant · après »
// quand une commande a changé la base, carte de résultat quand l'agent lance un SELECT.

export const fmtN = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('fr-BE'))
export const hhmm = (t: number) => new Date(t).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })
const totalRows = (s: DbSummary) => (s.estimated ? null : s.tables.reduce((a, t) => a + (t.count ?? 0), 0))
const plural = (n: number, one: string, many = one + 's') => `${fmtN(n)} ${n > 1 ? many : one}`

/** Photos d'une même base dans la session, dans l'ordre (les cartes de requête n'en sont pas). */
export function dbSnapshots(m: MediaItem, all: MediaItem[]): MediaItem[] {
  const p = m.path.toLowerCase()
  return all.filter((x) => x.kind === 'db' && !x.query && x.db && x.path.toLowerCase() === p)
}

export type TableDiff = { name: string; added: string[]; removed: string[]; retyped: string[]; before: number | null; after: number | null }
export type DbDiff = { added: DbTable[]; removed: DbTable[]; changed: TableDiff[]; counts: TableDiff[]; same: string[] }

/** Ce qui a changé entre deux photos : tables, colonnes, comptes. */
export function diffDb(a: DbSummary, b: DbSummary): DbDiff {
  const A = new Map(a.tables.map((t) => [t.name, t]))
  const B = new Map(b.tables.map((t) => [t.name, t]))
  const d: DbDiff = { added: [], removed: [], changed: [], counts: [], same: [] }
  for (const t of b.tables) if (!A.has(t.name)) d.added.push(t)
  for (const t of a.tables) if (!B.has(t.name)) d.removed.push(t)
  for (const t of b.tables) {
    const o = A.get(t.name)
    if (!o) continue
    const oc = new Map(o.columns.map((c) => [c.name, c]))
    const nc = new Map(t.columns.map((c) => [c.name, c]))
    const x: TableDiff = {
      name: t.name,
      added: t.columns.filter((c) => !oc.has(c.name)).map((c) => c.name),
      removed: o.columns.filter((c) => !nc.has(c.name)).map((c) => c.name),
      retyped: t.columns.filter((c) => oc.has(c.name) && oc.get(c.name)!.type !== c.type).map((c) => c.name),
      before: o.count,
      after: t.count
    }
    if (x.added.length || x.removed.length || x.retyped.length) d.changed.push(x)
    else if (x.before !== x.after || (o.digest && t.digest && o.digest !== t.digest)) d.counts.push(x)
    else d.same.push(t.name)
  }
  return d
}

export type RowDiff = {
  name: string
  added: unknown[][]
  removed: unknown[][]
  modified: { row: unknown[]; changes: { col: string; a: unknown; b: unknown }[] }[]
}

/** Ligne par ligne, pour les petites tables dont la photo garde le contenu (même clé primaire des deux côtés). */
export function rowDiffs(a: DbSummary, b: DbSummary): RowDiff[] {
  const out: RowDiff[] = []
  for (const t of b.tables) {
    const o = a.tables.find((x) => x.name === t.name)
    if (!o?.rows || !t.rows || o.digest === t.digest) continue
    const common = t.rows.cols.filter((c) => o.rows!.cols.includes(c))
    const ia = common.map((c) => o.rows!.cols.indexOf(c))
    const ib = common.map((c) => t.rows!.cols.indexOf(c))
    const r: RowDiff = { name: t.name, added: [], removed: [], modified: [] }
    for (const [k, row] of Object.entries(t.rows.byKey)) {
      const old = o.rows.byKey[k]
      if (!old) r.added.push(row)
      else {
        const changes = common.map((col, j) => ({ col, a: old[ia[j]], b: row[ib[j]] })).filter((c) => JSON.stringify(c.a) !== JSON.stringify(c.b))
        if (changes.length) r.modified.push({ row, changes })
      }
    }
    for (const [k, row] of Object.entries(o.rows.byKey)) if (!t.rows.byKey[k]) r.removed.push(row)
    if (r.added.length || r.removed.length || r.modified.length) out.push(r)
  }
  return out
}

const rowLabel = (row: unknown[]) => row.slice(0, 4).map((v) => fmtCell(v)).join(' · ')

const delta = (t: TableDiff) => {
  if (t.before == null || t.after == null || t.before === t.after) return ''
  const n = t.after - t.before
  return `${n > 0 ? '+' : '−'}${fmtN(Math.abs(n))} ligne${Math.abs(n) > 1 ? 's' : ''} dans ${t.name}`
}

export const isNumType = (t: string) => /int|real|num|float|double|dec/i.test(t)

export function fmtCell(v: unknown): string {
  if (v === null || v === undefined) return 'NULL'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6)
  return String(v)
}

export function toCsv(columns: string[], rows: unknown[][]): string {
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [columns.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
}

function DbBadge({ label }: { label: string }) {
  return (
    <span className="dbc-badge">
      <Icon name="database" size={12} />
      {label}
    </span>
  )
}

/** Petit tableau de lignes (aperçu, résultat de requête). */
export function RowsTable({ data, types, max }: { data: DbRows; types?: string[]; max?: number }) {
  const rows = max ? data.rows.slice(0, max) : data.rows
  const num = (i: number) => (types ? isNumType(types[i] ?? '') : rows.some((r) => typeof r[i] === 'number'))
  return (
    <table className="dbc-table">
      <thead>
        <tr>
          {data.columns.map((c, i) => (
            <th key={i} scope="col" className={num(i) ? 'num' : ''}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, k) => (
          <tr key={k}>
            {r.map((v, i) => (
              <td key={i} className={(num(i) ? 'num ' : '') + (v == null ? 'null' : '')} title={v == null ? undefined : String(v)}>{fmtCell(v)}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Carte d'une base dans le fil : selon le cas, photo, avant · après, ou résultat de requête. */
export function DbCard({ m, all }: { m: MediaItem; all: MediaItem[] }) {
  if (m.query) return <DbQueryCard m={m} />
  const snaps = dbSnapshots(m, all)
  const prev = snaps[snaps.findIndex((x) => x.id === m.id) - 1]
  if (prev?.db && m.db && !m.db.error) return <DbDiffCard prev={prev} m={m} />
  return <DbSummaryCard m={m} />
}

function DbSummaryCard({ m }: { m: MediaItem }) {
  const open = useStore((s) => s.openViewer)
  const s = m.db!
  const tables = useMemo(() => [...s.tables].sort((a, b) => (b.count ?? 0) - (a.count ?? 0)), [s])
  const [sel, setSel] = useState(tables[0]?.name)
  const [prev, setPrev] = useState<DbRows | null>(null)
  const max = Math.max(1, ...tables.map((t) => t.count ?? 0))
  const cur = tables.find((t) => t.name === sel)

  useEffect(() => {
    if (!sel) return
    let live = true
    api.dbPage(m.id, { table: sel, limit: 5 }).then((r) => live && setPrev(r))
    return () => {
      live = false
    }
  }, [m.id, sel])

  if (s.error)
    return (
      <div className="dbc-card dbc-error">
        <span className="dbc-err-head"><Icon name="database" size={16} /><span className="mono">{m.name}</span></span>
        <span className="small muted">Lecture impossible : {s.error}</span>
      </div>
    )

  const total = totalRows(s)
  const shown = tables.slice(0, 6)
  return (
    <div className="dbc-card">
      <div className="dbc-body">
        <div className="dbc-tables" role="listbox" aria-label={`Tables de ${m.name}`}>
          <DbBadge label={s.format === 'csv' ? 'CSV' : s.format === 'xlsx' ? 'Excel' : 'SQLite'} />
          {shown.map((t) => (
            <button key={t.name} type="button" role="option" aria-selected={t.name === sel} className="dbc-tab" onClick={() => setSel(t.name)}>
              <span className="dbc-tab-line">
                <span className="mono dbc-tab-name">{t.name}</span>
                <span className="dbc-count">{fmtN(t.count)}</span>
              </span>
              <span className="dbc-bar"><span style={{ width: `${Math.max(2, Math.round(Math.sqrt((t.count ?? 0) / max) * 100))}%` }} /></span>
            </button>
          ))}
          {tables.length > shown.length && <span className="small muted dbc-more">+{tables.length - shown.length} autres tables</span>}
        </div>
        <div className="dbc-preview">
          <div className="dbc-preview-head">
            <span className="mono">{sel}</span>
            {cur && <span>· {cur.columns.length} colonnes · 5 premières lignes</span>}
          </div>
          <div className="dbc-preview-rows">
            {prev?.error ? <span className="small muted">{prev.error}</span> : prev ? <RowsTable data={prev} types={cur?.columns.map((c) => c.type)} /> : null}
            {prev && !prev.error && !prev.rows.length && <span className="small muted dbc-empty">Table vide.</span>}
          </div>
        </div>
      </div>
      <div className="dbc-foot">
        <span className="dbc-foot-text">
          <span className="mono">{m.name} <span className="muted">· {fmtSize(m.size)}</span></span>
          <span className="small muted">
            {[plural(s.tables.length, 'table'), total == null ? 'comptes non calculés (grosse base)' : plural(total, 'ligne'), 'lecture seule', `photo prise à ${hhmm(s.at)}`, m.foundBy && `repérée par ${m.foundBy}`].filter(Boolean).join(' · ')}
          </span>
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" className="btn sm" onClick={() => api.openMedia(m.id)}>Ouvrir avec…</button>
        <button type="button" className="btn sm primary" onClick={() => open({ sessionId: m.sessionId, mediaId: m.id, mode: 'single' })}>Ouvrir</button>
      </div>
    </div>
  )
}

function DbDiffCard({ prev, m }: { prev: MediaItem; m: MediaItem }) {
  const open = useStore((s) => s.openViewer)
  const d = useMemo(() => diffDb(prev.db!, m.db!), [prev, m])
  const lost = [...d.changed, ...d.counts].filter((t) => t.before != null && t.after != null && t.after < t.before)
  const removedCols = d.changed.reduce((a, t) => a + t.removed.length, 0)
  const safe = !d.removed.length && !removedCols && !lost.length
  const counts = d.counts.map(delta).filter(Boolean)
  const head = [
    d.added.length && plural(d.added.length, 'table ajoutée', 'tables ajoutées'),
    d.removed.length && plural(d.removed.length, 'table supprimée', 'tables supprimées'),
    d.changed.length && plural(d.changed.length, 'modifiée', 'modifiées'),
    d.counts.length + d.same.length && `${fmtN(d.counts.length + d.same.length)} schéma${d.counts.length + d.same.length > 1 ? 's' : ''} identique${d.counts.length + d.same.length > 1 ? 's' : ''}`
  ].filter(Boolean)
  const openCmp = () => open({ sessionId: m.sessionId, mediaId: m.id, compareId: prev.id, mode: 'side' })
  const rd = useMemo(() => rowDiffs(prev.db!, m.db!), [prev, m])
  const [view, setView] = useState<'rows' | 'schema'>(rd.length && !d.added.length && !d.changed.length && !d.removed.length ? 'rows' : 'schema')
  return (
    <div className="dbc-card">
      <div className="dbc-diff-head">
        <DbBadge label={m.foundBy ? 'Base du projet' : 'Avant · après'} />
        <span><b>{m.name}</b> <span className="muted">· {prev.baseline ? 'photo avant la commande → après' : `${hhmm(prev.db!.at)} → ${hhmm(m.db!.at)}`}</span></span>
        <span style={{ flex: 1 }} />
        {rd.length > 0 ? (
          <span className="dbc-seg" role="tablist" aria-label="Niveau de détail">
            <button type="button" role="tab" aria-selected={view === 'rows'} onClick={() => setView('rows')}>Lignes</button>
            <button type="button" role="tab" aria-selected={view === 'schema'} onClick={() => setView('schema')}>Schéma</button>
          </span>
        ) : (
          <span className="small muted">{head.join(' · ')}</span>
        )}
      </div>
      {view === 'rows' && rd.length > 0 && (
        <div className="dbc-diff">
          {rd.map((r) => (
            <div key={r.name} className="dbc-rows">
              <span className="dbc-diff-line">
                <span className="mono">{r.name}</span>
                {r.added.length > 0 && <span className="dbc-n add">+{plural(r.added.length, 'ligne')}</span>}
                {r.modified.length > 0 && <span className="dbc-n mod">{plural(r.modified.length, 'modifiée', 'modifiées')}</span>}
                {r.removed.length > 0 && <span className="dbc-n del">{plural(r.removed.length, 'supprimée', 'supprimées')}</span>}
              </span>
              {r.added.slice(0, 3).map((row, i) => <span key={`a${i}`} className="dbc-row add mono"><span>+</span>{rowLabel(row)}</span>)}
              {r.modified.slice(0, 3).map((x, i) => (
                <span key={`m${i}`} className="dbc-row mod mono">
                  <span>~</span>
                  <span className="dbc-row-key">{rowLabel(x.row.slice(0, 2))}</span>
                  {x.changes.slice(0, 2).map((c) => (
                    <span key={c.col} className="dbc-row-chg">{c.col} <s>{fmtCell(c.a)}</s> → <b>{fmtCell(c.b)}</b></span>
                  ))}
                  {x.changes.length > 2 && <span>+{x.changes.length - 2}</span>}
                </span>
              ))}
              {r.removed.slice(0, 3).map((row, i) => <span key={`r${i}`} className="dbc-row del mono"><span>−</span>{rowLabel(row)}</span>)}
              {(r.added.length > 3 || r.modified.length > 3 || r.removed.length > 3) && (
                <span className="small muted">
                  {(() => {
                    const n = Math.max(0, r.added.length - 3) + Math.max(0, r.modified.length - 3) + Math.max(0, r.removed.length - 3)
                    return `… et ${n} autre${n > 1 ? 's' : ''} ligne${n > 1 ? 's' : ''}`
                  })()}
                </span>
              )}
            </div>
          ))}
          <div className="dbc-diff-rest small muted" style={{ paddingLeft: 16 }}>Détail ligne par ligne pour les tables de moins de 1 000 lignes avec une clé primaire : Canopy garde leur contenu dans la photo.</div>
        </div>
      )}
      {(view === 'schema' || !rd.length) && <div className="dbc-diff">
        {d.added.map((t) => (
          <DiffRow key={t.name} tag="Nouvelle" tone="add" name={t.name} rows={`${plural(t.count ?? 0, 'ligne')}`} chips={t.columns.map((c) => ({ v: `${c.name} ${c.type}`.trim(), tone: 'add' }))} />
        ))}
        {d.changed.map((t) => {
          const keep = (m.db!.tables.find((x) => x.name === t.name)?.columns ?? []).filter((c) => !t.added.includes(c.name) && !t.retyped.includes(c.name))
          return (
            <DiffRow
              key={t.name}
              tag="Modifiée"
              tone="mod"
              name={t.name}
              rows={t.before === t.after ? `${plural(t.after ?? 0, 'ligne')}, inchangé` : `${fmtN(t.before)} → ${fmtN(t.after)} lignes`}
              chips={[
                ...t.added.map((v) => ({ v: `+ ${v}`, tone: 'add' })),
                ...t.removed.map((v) => ({ v: `− ${v}`, tone: 'del' })),
                ...t.retyped.map((v) => ({ v: `~ ${v} (type)`, tone: 'mod' })),
                ...keep.slice(0, 3).map((c) => ({ v: c.name, tone: '' })),
                ...(keep.length > 3 ? [{ v: `…${keep.length - 3} autres`, tone: '' }] : [])
              ]}
            />
          )
        })}
        {d.removed.map((t) => (
          <DiffRow key={t.name} tag="Supprimée" tone="del" name={t.name} rows={`${plural(t.count ?? 0, 'ligne')} avant`} chips={[]} />
        ))}
        {(d.same.length > 0 || counts.length > 0) && (
          <div className="dbc-diff-rest small muted">
            {[...d.counts.map((t) => t.name), ...d.same].join(', ')} : schéma identique{counts.length ? ` · ${counts.join(' · ')}` : ''}
          </div>
        )}
      </div>}
      <div className="dbc-foot">
        <span className={`small ${safe ? 'muted' : 'dbc-warn'}`} style={{ flex: 1 }}>
          {safe
            ? m.foundBy
              ? `Rien n’a été supprimé · base repérée par ${m.foundBy}`
              : 'Rien n’a été supprimé.'
            : [d.removed.length && 'des tables ont disparu', removedCols && 'des colonnes ont disparu', ...lost.map(delta)].filter(Boolean).join(' · ')}
        </span>
        <button type="button" className="btn sm" onClick={() => open({ sessionId: m.sessionId, mediaId: m.id, mode: 'single' })}>Ouvrir</button>
        <button type="button" className="btn sm primary" onClick={openCmp}>Comparer en détail</button>
      </div>
    </div>
  )
}

function DiffRow({ tag, tone, name, rows, chips }: { tag: string; tone: string; name: string; rows: string; chips: { v: string; tone: string }[] }) {
  return (
    <div className="dbc-diff-row">
      <span className="dbc-diff-line">
        <span className={`dbc-tag ${tone}`}>{tag}</span>
        <span className="mono">{name}</span>
        <span style={{ flex: 1 }} />
        <span className="small muted">{rows}</span>
      </span>
      {chips.length > 0 && (
        <span className="dbc-chips">
          {chips.map((c, i) => (
            <span key={i} className={`dbc-chip mono ${c.tone}`}>{c.v}</span>
          ))}
        </span>
      )}
    </div>
  )
}

function DbQueryCard({ m }: { m: MediaItem }) {
  const open = useStore((s) => s.openViewer)
  const [r, setR] = useState<DbRows | null>(null)
  useEffect(() => {
    let live = true
    api.dbQuery(m.id, m.query!, 200).then((x) => live && setR(x))
    return () => {
      live = false
    }
  }, [m.id, m.query])
  return (
    <div className="dbc-card dbc-query">
      <div className="dbc-query-head">
        <Icon name="database" size={14} />
        <span className="mono dbc-query-sql" title={m.query}>{m.query!.replace(/\s+/g, ' ')}</span>
      </div>
      <div className="dbc-query-rows">
        {!r ? null : r.error ? <span className="small muted">{r.error}</span> : <RowsTable data={r} max={50} />}
      </div>
      {r && !r.error && (
        <div className="dbc-foot">
          <span className="small muted" style={{ flex: 1 }}>
            {[plural(r.rows.length, 'ligne') + (r.truncated ? ' (tronqué)' : ''), r.rows.length > 50 ? '50 affichées' : '', `${r.ms} ms`, `relu par Canopy dans ${m.name}`, 'lecture seule'].filter(Boolean).join(' · ')}
          </span>
          <button type="button" className="btn sm" onClick={() => navigator.clipboard.writeText(toCsv(r.columns, r.rows))}>Copier en CSV</button>
          <button type="button" className="btn ghost sm" onClick={() => open({ sessionId: m.sessionId, mediaId: m.id, mode: 'single' })}>Reprendre dans l’éditeur SQL</button>
        </div>
      )}
    </div>
  )
}

/** Base glissée dans ta saisie (planche 46) : rappel compact dans ton message, la visionneuse au clic. */
export function DbAttach({ m }: { m: MediaItem }) {
  const open = useStore((s) => s.openViewer)
  const s = m.db
  const total = s && !s.error ? totalRows(s) : null
  return (
    <button type="button" className="dbc-attach" onClick={() => open({ sessionId: m.sessionId, mediaId: m.id, mode: 'single' })}>
      <span className="dbc-attach-ico"><Icon name="database" size={19} /></span>
      <span className="dbc-attach-text">
        <span className="mono">{m.name}</span>
        <span className="small muted">
          {s?.error ? 'lecture impossible' : [s && plural(s.tables.length, 'table'), total != null && plural(total, 'ligne'), fmtSize(m.size)].filter(Boolean).join(' · ')}
        </span>
      </span>
      <span className="small dbc-attach-open">Ouvrir</span>
    </button>
  )
}
