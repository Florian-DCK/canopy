import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { VaultEntry } from '../shared/types'

// Coffre (planche 39) : les secrets que tu donnes à Claude sans qu'il les voie. Chiffrés par Windows avec ton compte
// (safeStorage → DPAPI), rangés par projet ou en global. Ils ne passent jamais par le moteur ni par la conversation :
// le processus principal les écrit directement là où le projet les lit (.env.local), et Claude ne connaît que leur nom.

type Stored = { v: string; at: number; usedAt?: number; where?: string }
type VaultFile = { global: Record<string, Stored>; projects: Record<string, Record<string, Stored>> }

const file = () => join(app.getPath('userData'), 'vault.json')
const key = (projectPath: string) => projectPath.replace(/\\/g, '/').toLowerCase()

function load(): VaultFile {
  try {
    return JSON.parse(readFileSync(file(), 'utf8'))
  } catch {
    return { global: {}, projects: {} }
  }
}
function save(v: VaultFile) {
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(v), 'utf8')
  renameSync(tmp, file())
}

export const validName = (n: string) => /^[A-Z][A-Z0-9_]{1,63}$/.test(n)

export function vaultList(projectPath?: string): VaultEntry[] {
  const v = load()
  const out: VaultEntry[] = []
  for (const [name, s] of Object.entries(v.global)) out.push({ name, scope: 'global', at: s.at, usedAt: s.usedAt, where: s.where })
  for (const [p, entries] of Object.entries(v.projects)) {
    if (projectPath && p !== key(projectPath)) continue
    for (const [name, s] of Object.entries(entries)) out.push({ name, scope: 'project', project: p, at: s.at, usedAt: s.usedAt, where: s.where })
  }
  return out.sort((a, b) => (b.usedAt ?? b.at) - (a.usedAt ?? a.at))
}

export function vaultStore(name: string, value: string, scope: 'project' | 'global', projectPath: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Chiffrement Windows indisponible : le secret n’est pas gardé.')
  const v = load()
  const enc = safeStorage.encryptString(value).toString('base64')
  const entry: Stored = { v: enc, at: Date.now() }
  if (scope === 'global') v.global[name] = entry
  else (v.projects[key(projectPath)] ??= {})[name] = entry
  save(v)
}

/** Valeur d'un secret : celui du projet d'abord, sinon le global. Reste dans le processus principal. */
export function vaultGet(name: string, projectPath: string): string | null {
  const v = load()
  const s = v.projects[key(projectPath)]?.[name] ?? v.global[name]
  if (!s) return null
  try {
    return safeStorage.decryptString(Buffer.from(s.v, 'base64'))
  } catch {
    return null
  }
}

export function vaultDelete(name: string, scope: 'project' | 'global', projectPath?: string) {
  const v = load()
  if (scope === 'global') delete v.global[name]
  else if (projectPath) delete v.projects[key(projectPath)]?.[name]
  save(v)
}

function touch(name: string, projectPath: string, where: string) {
  const v = load()
  const s = v.projects[key(projectPath)]?.[name] ?? v.global[name]
  if (!s) return
  s.usedAt = Date.now()
  s.where = where
  save(v)
}

/**
 * Sert un secret au projet : écrit NAME="valeur" dans .env.local (le remplace s'il y est déjà) et s'assure que
 * .env.local est ignoré par git. Rend le fichier écrit, relatif au projet.
 */
export function serveToEnv(name: string, value: string, projectPath: string): string {
  const env = join(projectPath, '.env.local')
  const line = `${name}=${JSON.stringify(value)}`
  const cur = existsSync(env) ? readFileSync(env, 'utf8') : ''
  const re = new RegExp(`^${name}=.*$`, 'm')
  const next = re.test(cur) ? cur.replace(re, line) : `${cur}${cur && !cur.endsWith('\n') ? '\n' : ''}${line}\n`
  writeFileSync(env, next, 'utf8')
  const gi = join(projectPath, '.gitignore')
  if (existsSync(gi)) {
    const g = readFileSync(gi, 'utf8')
    if (!/^\.env\.local$|^\.env\*?$|^\.env\.\*$|^\*\.local$/m.test(g)) writeFileSync(gi, `${g}${g.endsWith('\n') ? '' : '\n'}.env.local\n`, 'utf8')
  }
  touch(name, projectPath, '.env.local')
  return '.env.local'
}
