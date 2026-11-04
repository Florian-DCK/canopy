// « Outils de Claude » (planche 20) : réglages persistants des skills et serveurs MCP.
// Les mesures (coût en contexte, état des serveurs) viennent d'une session ouverte : voir Sessions.toolsInventory.
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const CLAUDE_DIR = join(homedir(), '.claude')
const SETTINGS = join(CLAUDE_DIR, 'settings.json')
const CLAUDE_JSON = join(homedir(), '.claude.json')

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

/** Écriture atomique : un fichier lu par Claude Code ne doit jamais être vu à moitié écrit. */
function writeJson(file: string, data: unknown) {
  const tmp = `${file}.canopy-tmp`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

/** Skills désactivés par l'utilisateur (`skillOverrides` à « off » dans ~/.claude/settings.json). */
export function disabledSkills(): string[] {
  const o = readJson(SETTINGS).skillOverrides ?? {}
  return Object.keys(o).filter((k) => o[k] === 'off')
}

export function setSkillEnabled(name: string, enabled: boolean) {
  const s = readJson(SETTINGS)
  const o = { ...(s.skillOverrides ?? {}) }
  if (enabled) delete o[name]
  else o[name] = 'off'
  s.skillOverrides = o
  writeJson(SETTINGS, s)
}

/** Clé de projet dans ~/.claude.json : chemin avec des barres obliques, tel que Claude Code l'écrit. */
const projectKey = (path: string) => path.replace(/\\/g, '/')

/** Serveurs MCP coupés pour un projet (`disabledMcpServers` de ~/.claude.json). */
export function disabledMcp(projectPath: string): string[] {
  const projects = readJson(CLAUDE_JSON).projects ?? {}
  const key = Object.keys(projects).find((k) => k.toLowerCase() === projectKey(projectPath).toLowerCase())
  return key ? (projects[key].disabledMcpServers ?? []) : []
}

export function setMcpDisabled(projectPath: string, name: string, disabled: boolean) {
  const d = readJson(CLAUDE_JSON)
  d.projects ??= {}
  const key = Object.keys(d.projects).find((k) => k.toLowerCase() === projectKey(projectPath).toLowerCase()) ?? projectKey(projectPath)
  const p = (d.projects[key] ??= {})
  const list: string[] = p.disabledMcpServers ?? []
  p.disabledMcpServers = disabled ? [...new Set([...list, name])] : list.filter((x) => x !== name)
  writeJson(CLAUDE_JSON, d)
}
