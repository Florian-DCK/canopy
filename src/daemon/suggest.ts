import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { CommandSuggestion } from '../shared/types'

// Suggestions de saisie : fichiers du projet (@) et skills / commandes (/).

const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next', 'AppData'])
const MAX_ENTRIES = 20_000
const MAX_DEPTH = 8
const TTL = 30_000

const cache = new Map<string, { at: number; files: string[] }>()

function gitFiles(cwd: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd, timeout: 5000, maxBuffer: 64 * 1024 * 1024, windowsHide: true }, (err, out) =>
      resolve(err ? null : out.split(/\r?\n/).filter(Boolean))
    )
  })
}

async function walk(root: string): Promise<string[]> {
  const out: string[] = []
  const rec = async (rel: string, depth: number) => {
    if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return
    let ents
    try {
      ents = await fs.readdir(join(root, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      if (out.length >= MAX_ENTRIES) return
      const path = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (SKIP.has(e.name) || e.name.startsWith('.')) continue
        await rec(path, depth + 1)
      } else if (e.isFile()) out.push(path)
    }
  }
  await rec('', 0)
  return out
}

export async function listFiles(projectId: string, root: string | undefined): Promise<string[]> {
  try {
    if (!root) return []
    const hit = cache.get(projectId)
    if (hit && Date.now() - hit.at < TTL) return hit.files
    const files = (await gitFiles(root)) ?? (await walk(root))
    const dirs = new Set<string>()
    for (const f of files) {
      const parts = f.split('/')
      for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/') + '/')
    }
    const all = [...dirs, ...files]
    cache.set(projectId, { at: Date.now(), files: all })
    return all
  } catch {
    return []
  }
}

const clip = (s: string) => (s.length > 140 ? s.slice(0, 139) + '…' : s)

function frontDescription(text: string): string | undefined {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)
  const d = m && /^description:\s*(.*)$/m.exec(m[1])
  if (!d) return undefined
  return d[1].trim().replace(/^["']|["']$/g, '') || undefined
}

async function skillsIn(dir: string): Promise<CommandSuggestion[]> {
  const out: CommandSuggestion[] = []
  try {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue
      try {
        const text = await fs.readFile(join(dir, e.name, 'SKILL.md'), 'utf8')
        out.push({ name: e.name, description: clip(frontDescription(text) ?? ''), kind: 'skill' })
      } catch {
        /* pas de SKILL.md */
      }
    }
  } catch {
    /* dossier absent */
  }
  return out
}

async function commandsIn(dir: string): Promise<CommandSuggestion[]> {
  const out: CommandSuggestion[] = []
  try {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (!e.isFile() || !e.name.endsWith('.md')) continue
      try {
        const text = await fs.readFile(join(dir, e.name), 'utf8')
        const first = text.replace(/^---\r?\n[\s\S]*?\r?\n---/, '').split(/\r?\n/).find((l) => l.trim())
        out.push({ name: e.name.slice(0, -3), description: clip(frontDescription(text) ?? first?.replace(/^#+\s*/, '').trim() ?? ''), kind: 'command' })
      } catch {
        /* illisible */
      }
    }
  } catch {
    /* dossier absent */
  }
  return out
}

export async function listCommands(query: any, root: string | undefined): Promise<CommandSuggestion[]> {
  try {
    if (query?.supportedCommands) {
      const list = (await query.supportedCommands()) as { name: string; description: string }[]
      return list.map((c) => ({ name: c.name, description: clip(c.description ?? ''), kind: 'command' as const }))
    }
  } catch {
    /* repli sur le disque */
  }
  try {
    const home = join(homedir(), '.claude')
    const proj = root ? join(root, '.claude') : null
    const parts = await Promise.all([
      skillsIn(join(home, 'skills')),
      proj ? skillsIn(join(proj, 'skills')) : [],
      commandsIn(join(home, 'commands')),
      proj ? commandsIn(join(proj, 'commands')) : []
    ])
    const seen = new Set<string>()
    const all: CommandSuggestion[] = [
      ...parts.flat(),
      { name: 'compact', description: 'résumer le contexte', kind: 'command' },
      { name: 'clear', description: 'repartir d’une conversation vide', kind: 'command' }
    ]
    return all.filter((c) => !seen.has(c.name) && !!seen.add(c.name))
  } catch {
    return []
  }
}
