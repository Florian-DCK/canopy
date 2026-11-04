// Agents custom (planche 38) : les fichiers d'agents de Claude Code, lus et écrits tels quels.
// ~/.claude/agents/*.md (les miens, tous projets) et <projet>/.claude/agents/*.md (ce projet). Un en-tête YAML
// (name, description, tools, model) puis les consignes. Couper un agent pour un projet = règle native de Claude Code
// « Agent(nom) » refusée dans <projet>/.claude/settings.local.json : ça vaut aussi dans le terminal.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentDraft, AgentFile } from '../shared/types'
import { loadSdk } from './sessions'
import { CLAUDE_DIR } from './tooling'

const userDir = () => join(CLAUDE_DIR, 'agents')
const projectDir = (projectPath: string) => join(projectPath, '.claude', 'agents')
const localSettings = (projectPath: string) => join(projectPath, '.claude', 'settings.local.json')

/** En-tête YAML minimal : `clé: valeur` sur une ligne, valeurs éventuellement entre guillemets. */
function parse(raw: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw)
  if (!m) return { meta: {}, body: raw }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line)
    if (!kv) continue
    let v = kv[2].trim()
    if (/^".*"$/.test(v)) {
      try {
        v = JSON.parse(v)
      } catch {
        v = v.slice(1, -1)
      }
    } else if (/^'.*'$/.test(v)) v = v.slice(1, -1).replace(/''/g, "'")
    meta[kv[1]] = v
  }
  return { meta, body: m[2].replace(/^\s*\n/, '') }
}

/** Valeur YAML sur une ligne : entre guillemets JSON dès qu'un caractère pourrait gêner. */
const yaml = (v: string) => (/^[\w .,()À-ÿ'’-]*$/.test(v) && !/^\s|\s$/.test(v) ? v : JSON.stringify(v))

function readDir(dir: string, scope: AgentFile['scope'], disabled: Set<string>): AgentFile[] {
  if (!existsSync(dir)) return []
  const out: AgentFile[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.md')) continue
    const path = join(dir, f)
    try {
      const { meta, body } = parse(readFileSync(path, 'utf8'))
      const name = meta.name || f.replace(/\.md$/, '')
      out.push({
        name,
        description: meta.description ?? '',
        model: meta.model || undefined,
        tools: meta.tools ? meta.tools.split(',').map((t) => t.trim()).filter(Boolean) : undefined,
        prompt: body.trim(),
        scope,
        path,
        enabled: !disabled.has(name)
      })
    } catch {
      /* fichier illisible : ignoré */
    }
  }
  return out
}

function readJson(file: string): any {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return {}
  }
}

/** Agents coupés pour ce projet (règles « Agent(nom) » refusées). */
function disabledIn(projectPath: string): Set<string> {
  const deny: string[] = readJson(localSettings(projectPath)).permissions?.deny ?? []
  return new Set(deny.map((r) => /^Agent\((.+)\)$/.exec(r)?.[1]).filter((x): x is string => !!x))
}

export function listAgents(projectPath: string): AgentFile[] {
  const disabled = disabledIn(projectPath)
  const own = readDir(userDir(), 'user', disabled)
  const proj = readDir(projectDir(projectPath), 'project', disabled)
  // Un agent du projet porte le même nom qu'un des miens : c'est celui du projet qui gagne.
  return [...proj, ...own.filter((a) => !proj.some((p) => p.name === a.name))]
}

export function setAgentEnabled(projectPath: string, name: string, enabled: boolean) {
  const file = localSettings(projectPath)
  mkdirSync(join(projectPath, '.claude'), { recursive: true })
  const s = readJson(file)
  s.permissions ??= {}
  const rule = `Agent(${name})`
  const deny: string[] = (s.permissions.deny ?? []).filter((r: string) => r !== rule)
  if (!enabled) deny.push(rule)
  s.permissions.deny = deny
  const tmp = `${file}.canopy-tmp`
  writeFileSync(tmp, JSON.stringify(s, null, 2) + '\n', 'utf8')
  renameSync(tmp, file)
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'agent'

/** Enregistre (crée, modifie ou déplace) un agent ; l'ancien fichier est gardé en .bak s'il change de place. */
export function saveAgent(projectPath: string, a: AgentDraft & { scope: AgentFile['scope'] }, oldPath?: string): AgentFile {
  const name = slug(a.name)
  const dir = a.scope === 'user' ? userDir() : projectDir(projectPath)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${name}.md`)
  if (path !== oldPath && existsSync(path)) throw new Error(`Un agent « ${name} » existe déjà ${a.scope === 'user' ? 'chez toi' : 'dans ce projet'}.`)
  const head = [`name: ${name}`, `description: ${yaml(a.description.replace(/\s*\n\s*/g, ' ').trim())}`]
  if (a.tools?.length) head.push(`tools: ${a.tools.join(', ')}`)
  if (a.model && a.model !== 'inherit') head.push(`model: ${a.model}`)
  writeFileSync(path, `---\n${head.join('\n')}\n---\n\n${a.prompt.trim()}\n`, 'utf8')
  if (oldPath && oldPath !== path && existsSync(oldPath)) renameSync(oldPath, `${oldPath}.bak`)
  return { ...a, name, path, scope: a.scope, enabled: !disabledIn(projectPath).has(name) }
}

/** Supprime un agent : le fichier devient .bak (Claude Code l'ignore), rien n'est perdu. */
export function deleteAgent(path: string) {
  if (!/[\\/]\.claude[\\/]agents[\\/][^\\/]+\.md$/.test(path) || !existsSync(path)) throw new Error('Fichier d’agent introuvable.')
  renameSync(path, `${path}.bak`)
}

/** Claude rédige la fiche d'un agent à partir d'une description libre. */
export async function draftAgent(text: string): Promise<AgentDraft & { why: string }> {
  const { query } = await loadSdk()
  const prompt = `Tu conçois un sous-agent Claude Code à partir de cette demande de l'utilisateur :

« ${text.slice(0, 2000)} »

Réponds uniquement par un objet JSON, sans texte autour :
{"name": "nom-court-en-kebab-case", "description": "quand Claude doit l'appeler : une ou deux phrases concrètes, en français", "model": "haiku" | "sonnet" | "opus", "tools": ["outils strictement nécessaires parmi Read, Write, Edit, Grep, Glob, Bash, WebSearch, WebFetch"], "prompt": "consignes de l'agent, en français, à la deuxième personne, structurées, 10 à 30 lignes", "why": "une phrase : pourquoi ce modèle et ces outils"}

Choisis le modèle le moins cher qui suffit (haiku pour extraire ou trier, sonnet pour écrire ou relire, opus seulement pour raisonner longtemps) et le moins d'outils possible.`
  let out = ''
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ANTHROPIC_API_KEY
  for await (const m of query({ prompt, options: { model: 'sonnet', maxTurns: 1, allowedTools: [], persistSession: false, settingSources: [], env } as any })) {
    if ((m as any).type === 'result' && typeof (m as any).result === 'string') out = (m as any).result
  }
  const json = /\{[\s\S]*\}/.exec(out)?.[0]
  if (!json) throw new Error('Claude n’a pas rendu de fiche : réessaie.')
  const d = JSON.parse(json)
  return {
    name: slug(String(d.name ?? 'agent')),
    description: String(d.description ?? ''),
    model: ['haiku', 'sonnet', 'opus'].includes(d.model) ? d.model : 'sonnet',
    tools: Array.isArray(d.tools) ? d.tools.map(String) : undefined,
    prompt: String(d.prompt ?? ''),
    why: String(d.why ?? '')
  }
}
