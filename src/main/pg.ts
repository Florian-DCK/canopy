import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'
import type { DbRows } from '../shared/types'
import { isReadQuery } from '../daemon/db'
import { getPgProjects, setPgProjects } from './settings'

// Postgres relu par Canopy (planche 46) : seulement les requêtes de lecture que Claude a lancées avec psql,
// seulement après ton autorisation (pour la session ou pour le projet), avec l'URL prise dans .env.local / .env.
// L'URL n'est jamais renvoyée au renderer : seulement l'hôte masqué et le nom de la base.

const sessionAllowed = new Set<string>()
const MAX_ROWS = 1000

function envValue(root: string, name: string): string | undefined {
  if (!/^\w+$/.test(name)) return undefined
  for (const f of ['.env.local', '.env']) {
    try {
      const m = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*["']?([^"'\\r\\n]+)`, 'm').exec(readFileSync(join(root, f), 'utf8'))
      if (m) return m[1].trim()
    } catch {
      /* fichier absent */
    }
  }
  return process.env[name]
}

/** db.abcdefgh.supabase.co → db.••••.supabase.co */
const maskHost = (h: string) => h.split('.').map((p, i, a) => (i > 0 && i < a.length - 2 && p.length > 3 ? '••••' : p)).join('.')

function target(root: string, env: string): { url?: string; host?: string; database?: string; error?: string } {
  const url = envValue(root, env)
  if (!url) return { error: `${env} introuvable dans .env.local ou .env.` }
  try {
    const u = new URL(url)
    if (!/^postgres(ql)?:$/.test(u.protocol)) return { error: `${env} n’est pas une URL postgres://.` }
    return { url, host: maskHost(u.hostname), database: u.pathname.replace(/^\//, '') || 'postgres' }
  } catch {
    return { error: `${env} n’est pas une URL valide.` }
  }
}

const allowedOf = (sessionId: string, projectId: string): 'session' | 'project' | null =>
  getPgProjects().includes(projectId) ? 'project' : sessionAllowed.has(sessionId) ? 'session' : null

export function pgInfo(root: string, sessionId: string, projectId: string, env: string) {
  const t = target(root, env)
  return { host: t.host, database: t.database, allowed: allowedOf(sessionId, projectId), error: t.error }
}

export function pgAllow(sessionId: string, projectId: string, scope: 'session' | 'project' | null) {
  const projects = getPgProjects().filter((p) => p !== projectId)
  sessionAllowed.delete(sessionId)
  if (scope === 'session') sessionAllowed.add(sessionId)
  setPgProjects(scope === 'project' ? [...projects, projectId] : projects)
}

export async function pgQuery(root: string, sessionId: string, projectId: string, env: string, sql: string): Promise<DbRows> {
  const t0 = Date.now()
  if (!allowedOf(sessionId, projectId)) return { columns: [], rows: [], ms: 0, error: 'Lecture non autorisée.' }
  if (!isReadQuery(sql)) return { columns: [], rows: [], ms: 0, refused: true, error: 'Seules les requêtes de lecture sont relues.' }
  const t = target(root, env)
  if (!t.url) return { columns: [], rows: [], ms: 0, error: t.error }
  const client = new pg.Client({ connectionString: t.url, connectionTimeoutMillis: 5000, statement_timeout: 5000, query_timeout: 6000 })
  try {
    await client.connect()
    // Transaction en lecture seule, annulée à la fin : rien ne peut être écrit, même par une fonction appelée.
    await client.query('begin read only')
    const r = await client.query({ text: `select * from (${sql.trim().replace(/;+\s*$/, '')}) as _canopy limit ${MAX_ROWS + 1}`, rowMode: 'array' })
    await client.query('rollback')
    const rows = (r.rows as unknown[][]).map((row) => row.map((v) => (v instanceof Date ? v.toISOString() : typeof v === 'object' && v !== null ? JSON.stringify(v) : typeof v === 'bigint' ? String(v) : v)))
    return { columns: r.fields.map((f) => f.name), rows: rows.slice(0, MAX_ROWS), truncated: rows.length > MAX_ROWS || undefined, ms: Date.now() - t0 }
  } catch (e) {
    return { columns: [], rows: [], ms: Date.now() - t0, error: (e as Error).message }
  } finally {
    client.end().catch(() => {})
  }
}
