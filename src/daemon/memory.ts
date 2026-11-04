// Mémoire de Claude (planche 21) : les souvenirs d'un projet sont des fichiers Markdown dans
// ~/.claude/projects/<dossier du projet>/memory/, indexés par MEMORY.md (une ligne par souvenir).
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { MemoryList } from '../shared/types'
import { CLAUDE_DIR } from './tooling'

const PROJECTS = join(CLAUDE_DIR, 'projects')
const TRASH = join(CLAUDE_DIR, 'memory-trash')
const tokens = (s: string) => Math.round(s.length / 4)

/** Dossier de mémoire d'un projet, tel que Claude Code le nomme (chaque caractère non alphanumérique devient « - »). */
export function memoryDir(projectPath: string): string {
  const slug = projectPath.replace(/[^a-zA-Z0-9]/g, '-')
  let dirs: string[] = []
  try {
    dirs = readdirSync(PROJECTS)
  } catch {
    /* pas encore de projets */
  }
  const hit = dirs.find((d) => d.toLowerCase() === slug.toLowerCase())
  return join(PROJECTS, hit ?? slug, 'memory')
}

function parse(raw: string): { name?: string; description?: string; type?: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!m) return { body: raw }
  const fm = m[1]
  const get = (k: string) => new RegExp(`^\\s*${k}:\\s*(.*)$`, 'm').exec(fm)?.[1]?.trim().replace(/^["']|["']$/g, '')
  return { name: get('name'), description: get('description'), type: get('type'), body: m[2].trim() }
}

const safeFile = (file: string) => {
  const f = basename(file)
  if (!f.endsWith('.md') || f === 'MEMORY.md') throw new Error('Fichier de mémoire invalide')
  return f
}

export function listMemory(projectPath: string): MemoryList {
  const dir = memoryDir(projectPath)
  const indexPath = join(dir, 'MEMORY.md')
  const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
  let files: string[] = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
  } catch {
    /* pas de mémoire */
  }
  // Même fichier, même contenu, dans un autre projet : un doublon.
  const others: { project: string; dir: string }[] = []
  try {
    for (const d of readdirSync(PROJECTS)) {
      const md = join(PROJECTS, d, 'memory')
      if (md.toLowerCase() !== dir.toLowerCase() && existsSync(md)) others.push({ project: d, dir: md })
    }
  } catch {
    /* rien */
  }
  const items = files.map((file) => {
    const full = join(dir, file)
    const raw = readFileSync(full, 'utf8')
    const p = parse(raw)
    const dupIn = others.filter((o) => {
      try {
        return readFileSync(join(o.dir, file), 'utf8') === raw
      } catch {
        return false
      }
    }).map((o) => o.project)
    return {
      file,
      name: p.name ?? file.replace(/\.md$/, ''),
      description: p.description ?? '',
      type: p.type ?? 'project',
      body: p.body,
      raw,
      mtime: statSync(full).mtimeMs,
      inIndex: index.includes(`(${file})`),
      dupIn
    }
  })
  return { dir, index: { lines: index.split('\n').filter((l) => l.trim()).length, tokens: tokens(index) }, items: items.sort((a, b) => b.mtime - a.mtime) }
}

export function writeMemory(projectPath: string, file: string, raw: string) {
  writeFileSync(join(memoryDir(projectPath), safeFile(file)), raw, 'utf8')
}

/** Retire la ligne d'un souvenir de MEMORY.md (et la renvoie, pour un déplacement). */
function unindex(dir: string, file: string): string | undefined {
  const indexPath = join(dir, 'MEMORY.md')
  if (!existsSync(indexPath)) return undefined
  const lines = readFileSync(indexPath, 'utf8').split('\n')
  const k = lines.findIndex((l) => l.includes(`(${file})`))
  if (k < 0) return undefined
  const [line] = lines.splice(k, 1)
  writeFileSync(indexPath, lines.join('\n'), 'utf8')
  return line
}

/** Oublier : le fichier part dans ~/.claude/memory-trash (récupérable), sa ligne quitte l'index. */
export function forgetMemory(projectPath: string, file: string) {
  const dir = memoryDir(projectPath)
  const f = safeFile(file)
  const day = new Date().toISOString().slice(0, 10)
  const dest = join(TRASH, day, basename(join(dir, '..')))
  mkdirSync(dest, { recursive: true })
  renameSync(join(dir, f), join(dest, f))
  unindex(dir, f)
}

/** Déplacer un souvenir vers un autre projet, avec sa ligne d'index. */
export function moveMemory(fromPath: string, file: string, toPath: string) {
  const from = memoryDir(fromPath)
  const to = memoryDir(toPath)
  const f = safeFile(file)
  if (existsSync(join(to, f))) throw new Error('Un souvenir du même nom existe déjà dans ce projet')
  mkdirSync(to, { recursive: true })
  renameSync(join(from, f), join(to, f))
  const line = unindex(from, f) ?? `- [${f.replace(/\.md$/, '')}](${f})`
  const indexPath = join(to, 'MEMORY.md')
  const cur = existsSync(indexPath) ? readFileSync(indexPath, 'utf8').replace(/\s*$/, '\n') : ''
  writeFileSync(indexPath, cur + line + '\n', 'utf8')
}
