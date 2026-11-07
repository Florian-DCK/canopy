import { createHash } from 'node:crypto'
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DbColumn, DbPageOpts, DbRows, DbSummary, DbTable } from '../shared/types'
import { readSheets } from './office'

// Lecture seule des bases citées dans une session (planches 44 et 45) : SQLite par node:sqlite,
// CSV/TSV chargé dans une base en mémoire pour passer par le même chemin. Rien ici n'écrit dans un fichier.
// Utilisé par le démon (photo du schéma) et par le processus principal (lignes, requêtes de la visionneuse).

const CSV_EXT = ['.csv', '.tsv']
export const DB_EXT = ['.sqlite', '.sqlite3', '.db', '.xlsx', ...CSV_EXT]
/** Au-delà, pas de count(*) (trop lent) : les comptes restent inconnus. */
const COUNT_MAX_BYTES = 200 * 1024 * 1024
const CSV_MAX_BYTES = 50 * 1024 * 1024
const MAX_ROWS = 1000
/** Contenu gardé dans la photo : tables de 1 000 lignes au plus, 1 Mo au plus pour toute la base. */
const KEEP_ROWS = 1000
const KEEP_BYTES = 1_000_000

const isCsv = (file: string) => CSV_EXT.includes(extname(file).toLowerCase())
const isXlsx = (file: string) => extname(file).toLowerCase() === '.xlsx'
const q = (id: string) => `"${id.replace(/"/g, '""')}"`

/** Vrai si le fichier est bien une base SQLite (un .db peut être autre chose, ex. Thumbs.db). */
export function isDbFile(file: string): boolean {
  if (isCsv(file) || isXlsx(file)) return true
  try {
    const fd = openSync(file, 'r')
    const buf = Buffer.alloc(16)
    readSync(fd, buf, 0, 16, 0)
    closeSync(fd)
    return buf.toString('latin1') === 'SQLite format 3\0'
  } catch {
    return false
  }
}

/* ---------- CSV → base en mémoire (gardée tant que le fichier ne change pas) ---------- */

const csvCache = new Map<string, { mtime: number; db: DatabaseSync; sep?: string }>()

function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (cell += '"'), i++
      else if (c === '"') quoted = false
      else cell += c
    } else if (c === '"' && cell === '') quoted = true
    else if (c === sep) row.push(cell), (cell = '')
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell), rows.push(row), (row = []), (cell = '')
    } else cell += c
  }
  if (cell !== '' || row.length) row.push(cell), rows.push(row)
  return rows.filter((r) => r.length > 1 || r[0] !== '')
}

type Cell = string | number | null

/** Feuilles d'un fichier tabulaire : une pour un CSV/TSV, une par feuille pour un classeur Excel. */
function sheetsOf(file: string): { sheets: { name: string; rows: Cell[][] }[]; sep?: string } {
  if (isXlsx(file)) return { sheets: readSheets(file) }
  const text = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  const first = text.split(/\r?\n/, 1)[0]
  const sep = extname(file).toLowerCase() === '.tsv' ? '\t' : [',', ';', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]
  return { sheets: [{ name: basename(file, extname(file)), rows: parseCsv(text, sep) }], sep }
}

/** CSV, TSV ou Excel → base en mémoire (une table par feuille), gardée tant que le fichier ne change pas. */
function memDb(file: string): { db: DatabaseSync; sep?: string } {
  const st = statSync(file)
  const hit = csvCache.get(file)
  if (hit && hit.mtime === st.mtimeMs) return hit
  if (st.size > CSV_MAX_BYTES) throw new Error(`Fichier trop gros pour l'aperçu (${Math.round(st.size / 1024 / 1024)} Mo, limite 50 Mo)`)
  const { sheets, sep } = sheetsOf(file)
  const db = new DatabaseSync(':memory:')
  for (const sh of sheets) {
    const rows = sh.rows.filter((r) => r.some((v) => v !== null && v !== ''))
    if (!rows.length) continue
    // Première ligne = en-têtes si elle n'a que du texte ; sinon col1, col2…
    const width = Math.max(...rows.map((r) => r.length))
    const hasHead = rows[0].every((v) => v === null || typeof v === 'string')
    const seen = new Set<string>()
    const names = Array.from({ length: width }, (_, i) => {
      let n = (hasHead ? String(rows[0][i] ?? '').trim() : '') || `col${i + 1}`
      while (seen.has(n.toLowerCase())) n += '_'
      seen.add(n.toLowerCase())
      return n
    })
    const body = hasHead ? rows.slice(1) : rows
    const types = names.map((_, i) => {
      let t: 'INTEGER' | 'REAL' | 'TEXT' = 'INTEGER'
      for (const r of body) {
        const v = r[i]
        if (v === null || v === undefined || v === '') continue
        const sv = String(v).trim()
        if (t === 'INTEGER' && !/^-?\d{1,15}$/.test(sv)) t = 'REAL'
        if (t === 'REAL' && !/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(sv)) return 'TEXT'
      }
      return t
    })
    db.exec(`create table ${q(sh.name)} (${names.map((n, i) => `${q(n)} ${types[i]}`).join(', ')})`)
    const ins = db.prepare(`insert into ${q(sh.name)} values (${names.map(() => '?').join(', ')})`)
    db.exec('begin')
    for (const r of body)
      ins.run(
        ...names.map((_, i) => {
          const v = r[i]
          if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return null
          return types[i] === 'TEXT' ? String(v) : Number(v)
        })
      )
    db.exec('commit')
  }
  const entry = { mtime: st.mtimeMs, db, sep }
  hit?.db.close()
  csvCache.set(file, entry)
  if (csvCache.size > 8) {
    const [k, v] = csvCache.entries().next().value!
    v.db.close()
    csvCache.delete(k)
  }
  return entry
}

/** Ouvre la base en lecture seule ; `fn` reçoit la connexion, fermée ensuite (sauf CSV, en cache). */
function withDb<T>(file: string, fn: (db: DatabaseSync, sep?: string) => T): T {
  if (isCsv(file) || isXlsx(file)) {
    const { db, sep } = memDb(file)
    return fn(db, sep)
  }
  const db = new DatabaseSync(file, { readOnly: true, timeout: 2000 })
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

const tableNames = (db: DatabaseSync) =>
  (db.prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name").all() as { name: string }[]).map((r) => r.name)

/* ---------- Photo : tables, colonnes, clés, index, comptes ---------- */

export function summarize(file: string): DbSummary {
  const at = Date.now()
  const format = isCsv(file) ? 'csv' : isXlsx(file) ? 'xlsx' : 'sqlite'
  try {
    const big = statSync(file).size > COUNT_MAX_BYTES
    let budget = KEEP_BYTES
    return withDb(file, (db, sep) => {
      const tables: DbTable[] = tableNames(db).map((name) => {
        const columns: DbColumn[] = (db.prepare(`pragma table_info(${q(name)})`).all() as any[]).map((c) => ({
          name: c.name,
          type: String(c.type || ''),
          notnull: !!c.notnull,
          dflt: c.dflt_value == null ? null : String(c.dflt_value),
          pk: Number(c.pk) || 0
        }))
        const fks = (db.prepare(`pragma foreign_key_list(${q(name)})`).all() as any[]).map((f) => ({ from: f.from, table: f.table, to: f.to ?? 'rowid' }))
        // Les index implicites (sqlite_autoindex_*, d'une contrainte UNIQUE) restent : ils disent qu'une colonne est unique.
        const indexes = (db.prepare(`pragma index_list(${q(name)})`).all() as any[])
          .map((i) => ({
            name: String(i.name),
            unique: !!i.unique,
            cols: (db.prepare(`pragma index_info(${q(i.name)})`).all() as any[]).map((c) => c.name).join(', ')
          }))
        let count: number | null = null
        if (!big) {
          try {
            count = Number((db.prepare(`select count(*) as n from ${q(name)}`).get() as any).n)
          } catch {
            /* table virtuelle illisible : compte inconnu */
          }
        }
        const sql = (db.prepare("select sql from sqlite_master where type = 'table' and name = ?").get(name) as any)?.sql ?? undefined
        // Petite table avec clé primaire : contenu par clé (ligne par ligne dans l'avant · après) et empreinte.
        let rows: DbTable['rows']
        let digest: string | undefined
        const pk = columns.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => columns.indexOf(c))
        if (count !== null && count <= KEEP_ROWS && pk.length) {
          try {
            const st = db.prepare(`select * from ${q(name)}`)
            st.setReturnArrays(true)
            const byKey: Record<string, unknown[]> = {}
            const h = createHash('sha1')
            for (const r of st.iterate() as Iterable<unknown[]>) {
              const vals = r.map(cell)
              const line = JSON.stringify(vals)
              h.update(line)
              byKey[JSON.stringify(pk.map((i) => vals[i]))] = vals
              budget -= line.length
            }
            digest = h.digest('hex').slice(0, 16)
            if (budget > 0) rows = { cols: columns.map((c) => c.name), byKey }
          } catch {
            /* illisible : pas de détail ligne par ligne */
          }
        }
        return { name, count, columns, fks, indexes, sql, rows, digest }
      })
      return { format, tables, at, estimated: big || undefined, sep }
    })
  } catch (e) {
    return { format, tables: [], at, error: (e as Error).message }
  }
}

/** Empreinte comparable de deux photos (schéma + comptes). */
export const signature = (s: DbSummary) =>
  JSON.stringify(s.tables.map((t) => [t.name, t.count, t.digest, t.columns.map((c) => `${c.name}:${c.type}:${c.notnull}:${c.pk}`)]))

/* ---------- Lignes et requêtes ---------- */

function cell(v: unknown): unknown {
  if (v instanceof Uint8Array) return `‹blob ${v.byteLength} o›`
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'string' && v.length > 2000) return v.slice(0, 2000) + '…'
  return v
}

function collect(db: DatabaseSync, sql: string, params: (string | number)[], limit: number): Omit<DbRows, 'ms'> {
  const st = db.prepare(sql)
  st.setReturnArrays(true)
  const columns = st.columns().map((c) => c.name)
  const rows: unknown[][] = []
  let truncated = false
  for (const r of st.iterate(...params) as Iterable<unknown[]>) {
    if (rows.length >= limit) {
      truncated = true
      break
    }
    rows.push(r.map(cell))
  }
  return { columns, rows, truncated: truncated || undefined }
}

export function page(file: string, o: DbPageOpts): DbRows {
  const t0 = Date.now()
  try {
    return withDb(file, (db) => {
      if (!tableNames(db).includes(o.table)) throw new Error(`Table inconnue : ${o.table}`)
      const cols = (db.prepare(`pragma table_info(${q(o.table)})`).all() as any[]).map((c) => c.name as string)
      const where = o.where?.trim() ? ` where ${o.where.trim().replace(/;+\s*$/, '')}` : ''
      const order = o.order && cols.includes(o.order) ? ` order by ${q(o.order)} ${o.desc ? 'desc' : 'asc'}` : ''
      const limit = Math.min(500, Math.max(1, o.limit ?? 100))
      const offset = Math.max(0, o.offset ?? 0)
      const r = collect(db, `select * from ${q(o.table)}${where}${order} limit ? offset ?`, [limit, offset], limit)
      const total = where ? Number((db.prepare(`select count(*) as n from ${q(o.table)}${where}`).get() as any).n) : undefined
      return { ...r, total, truncated: undefined, ms: Date.now() - t0 }
    })
  } catch (e) {
    return { columns: [], rows: [], ms: Date.now() - t0, error: (e as Error).message }
  }
}

/** Première instruction d'une requête, commentaires retirés. */
const firstWord = (sql: string) => sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, ' ').trim().split(/[\s(]/)[0]?.toLowerCase() ?? ''

/** Une requête de lecture (SELECT, WITH, PRAGMA, EXPLAIN, VALUES). */
export const isReadQuery = (sql: string) => ['select', 'with', 'pragma', 'explain', 'values'].includes(firstWord(sql))

export function query(file: string, sql: string, limit = MAX_ROWS): DbRows {
  const t0 = Date.now()
  if (!isReadQuery(sql))
    return { columns: [], rows: [], ms: 0, refused: true, error: 'La visionneuse ne modifie pas la base : demande-le à Claude, la commande passera par le fil.' }
  try {
    return withDb(file, (db) => ({ ...collect(db, sql.trim().replace(/;+\s*$/, ''), [], Math.min(limit, MAX_ROWS)), ms: Date.now() - t0 }))
  } catch (e) {
    return { columns: [], rows: [], ms: Date.now() - t0, error: (e as Error).message }
  }
}
