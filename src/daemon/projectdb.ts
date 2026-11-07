import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { isDbFile } from './db'

// Base locale d'un projet (planche 46) : trouvée dans sa config (Prisma, Drizzle, .env, knex, Django),
// pour que Canopy en prenne la photo avant une commande qui la modifie, même si personne ne l'a citée.
// Seules les URL `file:` (SQLite) sont retenues ; une base distante n'est jamais ouverte d'office.

export type ProjectDb = { file: string; foundBy: string }

const read = (f: string) => {
  try {
    return readFileSync(f, 'utf8')
  } catch {
    return ''
  }
}

/** Valeur d'une variable dans .env / .env.local (sans jamais la remonter ailleurs que pour un chemin de fichier). */
function envVar(root: string, name: string): string | undefined {
  for (const f of ['.env.local', '.env']) {
    const m = new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\r\\n]+)`, 'm').exec(read(join(root, f)))
    if (m) return m[1].trim()
  }
  return undefined
}

/** `file:./dev.db` → chemin absolu ; sinon undefined (postgres://, mysql://…). */
function fileUrl(url: string | undefined, base: string): string | undefined {
  if (!url) return undefined
  const m = /^file:(?:\/\/)?(.+?)(?:\?.*)?$/.exec(url.trim())
  return m ? resolve(base, m[1]) : /\.(sqlite3?|db)$/i.test(url) && !/:\/\//.test(url) ? resolve(base, url) : undefined
}

export function findProjectDbs(root: string): ProjectDb[] {
  const out: ProjectDb[] = []
  const add = (file: string | undefined, foundBy: string) => {
    if (file && existsSync(file) && isDbFile(file) && !out.some((x) => x.file.toLowerCase() === file.toLowerCase())) out.push({ file, foundBy })
  }

  // Prisma : l'URL relative se lit depuis le dossier du schéma.
  for (const p of ['prisma/schema.prisma', 'schema.prisma']) {
    const src = read(join(root, p))
    if (!src || !/provider\s*=\s*"sqlite"/.test(src)) continue
    const url = /url\s*=\s*"([^"]+)"/.exec(src)?.[1] ?? (/url\s*=\s*env\("([^"]+)"\)/.exec(src)?.[1] ? envVar(root, /url\s*=\s*env\("([^"]+)"\)/.exec(src)![1]) : undefined)
    add(fileUrl(url, dirname(join(root, p))), p)
  }

  // Drizzle : dbCredentials.url, ou un fichier .db cité dans la config.
  for (const p of ['drizzle.config.ts', 'drizzle.config.js', 'drizzle.config.mjs']) {
    const src = read(join(root, p))
    if (!src) continue
    const lit = /url\s*:\s*['"`]([^'"`]+)['"`]/.exec(src)?.[1]
    const env = /url\s*:\s*process\.env\.(\w+)/.exec(src)?.[1]
    add(fileUrl(lit ?? (env ? envVar(root, env) : undefined), root), p)
  }

  // knex / Django.
  const knex = /filename\s*:\s*['"`]([^'"`]+)['"`]/.exec(read(join(root, 'knexfile.js')) || read(join(root, 'knexfile.ts')))?.[1]
  if (knex) add(resolve(root, knex), 'knexfile')
  for (const p of readdirSafe(root).filter((d) => existsSync(join(root, d, 'settings.py')))) {
    const n = /['"]NAME['"]\s*:\s*(?:BASE_DIR\s*\/\s*)?['"]([^'"]+\.sqlite3?)['"]/.exec(read(join(root, p, 'settings.py')))?.[1]
    if (n) add(resolve(root, n), `${p}/settings.py`)
  }

  // .env seul.
  add(fileUrl(envVar(root, 'DATABASE_URL'), root), '.env (DATABASE_URL)')

  // Dernier recours : un seul fichier de base à la racine, dans data/, db/ ou prisma/.
  if (!out.length) {
    const found = ['', 'data', 'db', 'prisma'].flatMap((d) =>
      readdirSafe(join(root, d)).filter((f) => /\.(sqlite3?|db)$/i.test(f)).map((f) => join(root, d, f))
    ).filter((f) => isDbFile(f))
    if (found.length === 1) add(found[0], relative(root, found[0]).replace(/\\/g, '/'))
  }
  return out
}

function readdirSafe(d: string): string[] {
  try {
    return readdirSync(d)
  } catch {
    return []
  }
}

/** Commande susceptible de modifier la base du projet (migration, seed, push…). */
export const touchesDb = (cmd: string) =>
  /\bprisma\s+(migrate|db\s+(push|seed|execute))|\bdrizzle-kit\s+(push|migrate)|\b(npm|pnpm|yarn|bun)\s+(run\s+)?(seed|migrate|db[:\w-]*)\b|\bknex\s+(migrate|seed)|manage\.py\s+(migrate|loaddata|flush)|\bsqlite3\b|\bpython\S*\s+-m\s+sqlite3\b|\btsx?\s+\S*(seed|migrat)/i.test(cmd)
