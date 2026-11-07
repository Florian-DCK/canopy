import { isReadQuery } from './db'

// `psql "$DATABASE_URL" -c "select …"` (planche 46) : la variable d'environnement et la requête de lecture.
// Une URL écrite en clair dans la commande n'est pas reprise : Canopy ne relit que par une variable du projet.
export function psqlSelect(cmd: string): { sql: string; env: string } | null {
  if (!/(^|[\s;&|(])psql(\.exe)?\s/.test(cmd)) return null
  const env = /\$env:(\w+)/i.exec(cmd) ?? /["']?\$(?:\{(\w+)\}|(\w+))["']?/.exec(cmd)
  const sql = /(?:-c|--command)(?:\s+|=)(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(cmd)
  if (!env || !sql) return null
  const text = (sql[1] ?? sql[2]).replace(/\\(["\\$`])/g, '$1').trim()
  return isReadQuery(text) && !/;\s*\S/.test(text.replace(/;+\s*$/, '')) ? { sql: text, env: env[1] ?? env[2] } : null
}
