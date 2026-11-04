import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import type { PermissionModeUI, Project } from '../shared/types'
import { dataFile } from './paths'

// Couleurs de pastille (palette secondaire douce de la DA) ; texte ardoise dessus.
const COLORS = ['#CBCADB', '#6A9BCC', '#BCD1CA', '#EBCECE', '#E3DACC', '#C46686', '#788C5D']

const file = () => dataFile('projects.json')

function readBranch(path: string): string | undefined {
  try {
    const head = readFileSync(join(path, '.git', 'HEAD'), 'utf8').trim()
    return head.startsWith('ref: refs/heads/') ? head.slice(16) : head.slice(0, 7)
  } catch {
    return undefined
  }
}

let cache: Project[] | null = null

function load(): Project[] {
  if (cache) return cache
  try {
    cache = existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Project[]) : []
  } catch {
    cache = []
  }
  return cache
}

function save() {
  writeFileSync(file(), JSON.stringify(load(), null, 2), 'utf8')
}

export function listProjects(): Project[] {
  return load().map((p) => ({ ...p, branch: readBranch(p.path) }))
}

export function getProject(id: string): Project | undefined {
  return load().find((p) => p.id === id)
}

// Dossiers « conteneurs » : leur nom n'apprend rien sur le projet qu'ils contiennent.
const CONTAINERS = new Set(['users', 'documents', 'desktop', 'bureau', 'downloads', 'téléchargements', 'onedrive', 'home', 'projects', 'projets', 'repos', 'repo', 'git', 'github', 'dev', 'code', 'src', 'sources', 'work', 'workspace', 'sites', 'apps', 'packages'])

/** Nom par défaut : le dossier, précédé de son parent quand celui-ci dit quelque chose (« Batibouw / quiz »). */
export function defaultName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  const last = parts.at(-1) ?? basename(path)
  const parent = parts.length > 2 ? parts.at(-2) : undefined // jamais la racine du disque
  return parent && !CONTAINERS.has(parent.toLowerCase()) ? `${parent} / ${last}` : last
}

export function addProject(path: string): Project {
  const existing = load().find((p) => p.path.toLowerCase() === path.toLowerCase())
  if (existing) return { ...existing, branch: readBranch(existing.path) }
  const p: Project = { id: randomUUID(), name: defaultName(path), path, color: COLORS[load().length % COLORS.length] }
  load().push(p)
  save()
  return { ...p, branch: readBranch(path) }
}

/** Renomme un projet (le nom affiché ; le dossier ne change pas). */
export function renameProject(id: string, name: string): Project | undefined {
  const p = load().find((x) => x.id === id)
  const clean = name.trim()
  if (!p || !clean) return p
  p.name = clean
  save()
  return { ...p, branch: readBranch(p.path) }
}

export function removeProject(id: string) {
  cache = load().filter((p) => p.id !== id)
  save()
}

const MODES: PermissionModeUI[] = ['default', 'acceptEdits', 'auto', 'plan']

/**
 * Mode d'autorisation de départ d'une session : `permissions.defaultMode` de la config Claude Code,
 * dans l'ordre de priorité du CLI (projet local, projet, utilisateur). Faute de réglage : « default ».
 */
export function defaultPermissionMode(projectPath: string): PermissionModeUI {
  const files = [join(projectPath, '.claude', 'settings.local.json'), join(projectPath, '.claude', 'settings.json'), join(homedir(), '.claude', 'settings.json')]
  for (const f of files) {
    try {
      const mode = JSON.parse(readFileSync(f, 'utf8'))?.permissions?.defaultMode
      if (MODES.includes(mode)) return mode
    } catch {
      /* absent ou illisible : fichier suivant */
    }
  }
  return 'default'
}

/** Bac à sable (planche 35) : le « projet » des conversations sans projet, dans Documents\Canopy\Bac à sable. */
export function ensureSandbox(): Project {
  const path = join(homedir(), 'Documents', 'Canopy', 'Bac à sable')
  mkdirSync(path, { recursive: true })
  const list = load()
  let p = list.find((x) => x.sandbox) ?? list.find((x) => x.path.toLowerCase() === path.toLowerCase())
  if (!p) {
    p = { id: randomUUID(), name: 'Bac à sable', path, color: '#EBCECE', sandbox: true }
    list.unshift(p)
    save()
  } else if (!p.sandbox) {
    p.sandbox = true
    save()
  }
  return p
}
