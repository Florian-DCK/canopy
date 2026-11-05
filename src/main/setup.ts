import { app, shell } from 'electron'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FoundProject, PermState, Project, SetupCheck, SetupFeatures, SetupLog, SetupStatus, SetupTask } from '../shared/types'
import { askMacPermission, macPermissions, type MacPermission } from './permissions'
import { getSetup, setSetup } from './settings'
import { shortcutExists, shortcutPath } from './shortcut'
import { BENCH, PYTHON } from './voice'

// Premier lancement : détection des prérequis, installations, connexion. Aucun effet de bord sur une installation existante.

const WIN = process.platform === 'win32'

type Ctx = { getProjects: () => Project[]; addPath: (p: string) => Promise<unknown>; refresh: () => Promise<void>; send: (e: SetupLog) => void }
let ctx: Ctx | null = null
export const configureSetup = (c: Ctx) => {
  ctx = c
}

let loadedResolve: () => void = () => {}
let isLoaded = false
const projectsLoaded = new Promise<void>((r) => (loadedResolve = r))
/** À appeler quand listProjects a abouti au moins une fois. */
export const markProjectsLoaded = () => {
  isLoaded = true
  loadedResolve()
}

const emit = (e: SetupLog) => ctx?.send(e)

/** Exécute une commande (shell sous Windows pour résoudre .cmd) ; renvoie stdout, ou null en cas d'échec. */
function run(cmd: string, args: string[], timeout = 5000): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(cmd, args, { shell: WIN, timeout, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)))
  })
}

async function check(cmd: string): Promise<SetupCheck> {
  const out = await run(cmd, ['--version'])
  if (out === null) return { ok: false, error: `${cmd} introuvable` }
  const where = await run(WIN ? 'where' : 'which', [cmd])
  return { ok: true, version: out.trim().split(/\r?\n/)[0], path: where?.trim().split(/\r?\n/)[0] }
}

export type AuthInfo = SetupStatus['auth']
/** Parse la sortie JSON de `claude auth status --json`. */
export function parseAuth(out: string | null): AuthInfo {
  try {
    const j = JSON.parse(out ?? '')
    return { loggedIn: j.loggedIn === true, method: j.authMethod ?? undefined, email: j.email ?? undefined, plan: j.subscriptionType ?? undefined }
  } catch {
    return { loggedIn: false }
  }
}
const authStatus = async () => parseAuth(await run('claude', ['auth', 'status', '--json'], 10000))

function findBlender(): string | null {
  if (process.platform === 'darwin') return existsSync('/Applications/Blender.app') ? '/Applications/Blender.app' : null
  if (!WIN) return null
  const root = 'C:\\Program Files\\Blender Foundation'
  try {
    for (const d of readdirSync(root)) {
      const exe = join(root, d, 'blender.exe')
      if (d.startsWith('Blender') && existsSync(exe)) return exe
    }
  } catch {
    /* pas de Blender */
  }
  return null
}

const permState = () => {
  const p = macPermissions()
  return { screen: p.screen as PermState, microphone: p.microphone as PermState, accessibility: p.accessibility as PermState }
}

/** Règle « déjà installé » : voir setupStatus. En cas de doute, done = true. */
async function doneState(): Promise<{ done: boolean; legacy?: boolean; features?: SetupFeatures }> {
  try {
    const s = getSetup()
    if (s) return { done: s.done, legacy: s.legacy, features: s.features }
    await Promise.race([projectsLoaded, new Promise<void>((r) => setTimeout(r, 8000))])
    const loaded = ctx ? ctx.getProjects().length : 0
    if (loaded >= 1) {
      setSetup({ done: true, legacy: true, at: Date.now() })
      return { done: true, legacy: true }
    }
    // Aucun projet : installation vierge seulement si le démon a bien répondu (sinon doute → done).
    return { done: !isLoaded }
  } catch {
    return { done: true }
  }
}

export async function setupStatus(): Promise<SetupStatus> {
  const [d, node, claude, git, auth] = await Promise.all([doneState(), check('node'), check('claude'), check('git'), authStatus()])
  return {
    ...d,
    platform: process.platform,
    node,
    claude,
    git,
    auth,
    blender: findBlender(),
    voice: {
      installed: existsSync(PYTHON),
      dir: BENCH,
      stt: process.platform === 'darwin' && process.arch === 'arm64' ? 'mlx' : process.platform === 'win32' ? 'openvino' : 'faster'
    },
    permissions: permState(),
    shortcut: { exists: shortcutExists(), path: shortcutPath() }
  }
}

const SKIP = new Set(['node_modules', 'appdata', 'library', '.cache'])

export async function findRepos(roots: string[], maxDepth = 3): Promise<{ path: string; mtime: number }[]> {
  const found: { path: string; mtime: number }[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    if (entries.some((e) => e.name === '.git')) {
      const m = await stat(join(dir, '.git', 'HEAD')).catch(() => stat(join(dir, '.git')).catch(() => null))
      found.push({ path: dir, mtime: m?.mtimeMs ?? 0 })
      return
    }
    if (depth >= maxDepth) return
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name.toLowerCase()))
        .map((e) => walk(join(dir, e.name), depth + 1))
    )
  }
  await Promise.all(roots.filter((r) => existsSync(r)).map((r) => walk(r, 0)))
  return found
}

const norm = (p: string) => (WIN ? p.toLowerCase() : p).replace(/[\\/]+$/, '')

export async function setupFindProjects(): Promise<FoundProject[]> {
  const home = homedir()
  const repos = await findRepos(['Documents', 'Developer', 'Projects', 'code'].map((d) => join(home, d)))
  const known = new Set((ctx?.getProjects() ?? []).map((p) => norm(p.path)))
  return repos
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, 30)
    .map((r) => ({ name: r.path.split(/[\\/]/).pop() ?? r.path, path: r.path, mtime: r.mtime, known: known.has(norm(r.path)) }))
}

export async function setupAddProjects(paths: string[]): Promise<void> {
  if (!ctx) return
  const known = new Set(ctx.getProjects().map((p) => norm(p.path)))
  for (const p of paths) {
    if (typeof p !== 'string' || known.has(norm(p))) continue
    await ctx.addPath(p)
    known.add(norm(p))
  }
  await ctx.refresh()
}

export function setupFinish(features: SetupFeatures) {
  setSetup({ done: true, at: Date.now(), features })
}

export function setupReopen() {
  const cur = getSetup()
  setSetup({ ...(cur ?? {}), done: false })
}

export async function setupAskPermission(kind: MacPermission): Promise<PermState> {
  if (process.platform !== 'darwin') return 'granted'
  await askMacPermission(kind)
  return macPermissions()[kind] as PermState
}

// --- tâches longues -------------------------------------------------------------------------------

const running = new Map<SetupTask, ChildProcess>()
const busy = new Set<SetupTask>()

/** Découpe un flux en lignes. */
function lines(cb: (l: string) => void) {
  let buf = ''
  return (chunk: Buffer) => {
    buf += chunk.toString('utf8')
    const parts = buf.split(/\r?\n|\r/)
    buf = parts.pop() ?? ''
    for (const l of parts) if (l.trim()) cb(l)
  }
}

export type Parsed = { step: { n: number; total: number; text: string } } | { done: true } | { error: string } | { line: string }
/** Ligne du script de la voix : `STEP n/total texte`, `DONE`, `ERROR message`, sinon ligne brute. */
export function parseVoiceLine(l: string): Parsed {
  const m = /^STEP\s+(\d+)\/(\d+)\s*(.*)$/.exec(l)
  if (m) return { step: { n: +m[1], total: +m[2], text: m[3] } }
  if (/^DONE\b/.test(l)) return { done: true }
  const e = /^ERROR\b\s*(.*)$/.exec(l)
  if (e) return { error: e[1] || 'Échec' }
  return { line: l }
}

/** Tue le processus et ses enfants (taskkill /T sous Windows : le shell intermédiaire ne relaie pas le kill). */
function killTree(p: ChildProcess) {
  if (WIN && p.pid) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  else p.kill()
}

/** Lance un processus pour une tâche ; une seule instance par tâche. onLine peut consommer la ligne (renvoie true). */
function startTask(task: SetupTask, cmd: string, args: string[], opts: { onLine?: (l: string) => boolean | void; finish?: (code: number | null) => SetupLog; timeout?: number } = {}): ChildProcess | null {
  if (busy.has(task)) return null
  busy.add(task)
  const p = spawn(cmd, args, { shell: WIN && !/powershell/i.test(cmd), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  running.set(task, p)
  const onData = lines((l) => {
    if (opts.onLine?.(l)) return
    emit({ task, line: l })
  })
  p.stdout?.on('data', onData)
  p.stderr?.on('data', onData)
  let ended = false
  const end = (e: SetupLog) => {
    if (ended) return
    ended = true
    clearTimeout(timer)
    busy.delete(task)
    running.delete(task)
    emit(e)
  }
  const timer = setTimeout(() => {
    killTree(p)
    end({ task, error: 'Délai dépassé' })
  }, opts.timeout ?? 30 * 60_000)
  p.on('error', (err) => end({ task, error: err.message }))
  p.on('close', (code) => end(opts.finish ? opts.finish(code) : code === 0 ? { task, done: true } : { task, error: `Échec (code ${code})` }))
  return p
}

export function setupLogin(mode: 'claudeai' | 'console'): void {
  if (busy.has('login')) return
  const opened = new Set<string>()
  let probe: NodeJS.Timeout | undefined
  let finished = false
  const stop = () => probe && clearInterval(probe)
  const p = startTask('login', 'claude', ['auth', 'login', mode === 'console' ? '--console' : '--claudeai'], {
    timeout: 10 * 60_000,
    onLine: (l) => {
      const url = /https:\/\/[^\s"'<>]+/.exec(l)?.[0]
      if (url) {
        emit({ task: 'login', line: l, url })
        if (!opened.has(url)) {
          opened.add(url)
          void shell.openExternal(url)
        }
        return true
      }
    },
    // Sortie du process : succès seulement si la connexion est effective.
    finish: (code) => {
      stop()
      return finished || code === 0 ? { task: 'login', done: true } : { task: 'login', error: 'Connexion non aboutie' }
    }
  })
  if (!p) return
  p.on('close', () => stop())
  probe = setInterval(async () => {
    if (finished || !running.has('login')) return
    if ((await authStatus()).loggedIn && !finished) {
      finished = true
      stop()
      killTree(p) // le « close » émet { done: true }
    }
  }, 2000)
}

export function setupLoginInput(text: string) {
  running.get('login')?.stdin?.write(text + '\n')
}

export function setupInstallClaude(): void {
  if (!WIN) startTask('claude', '/bin/bash', ['-lc', 'curl -fsSL https://claude.ai/install.sh | bash'])
  else startTask('claude', 'npm', ['install', '-g', '@anthropic-ai/claude-code'])
}

export function setupInstallVoice(): void {
  const scripts = join(app.getAppPath(), 'scripts')
  let sawDone = false
  let err: string | undefined
  const onLine = (l: string) => {
    const r = parseVoiceLine(l)
    if ('step' in r) emit({ task: 'voice', step: r.step })
    else if ('done' in r) sawDone = true
    else if ('error' in r) err = r.error
    else return false
    return true
  }
  const finish = (code: number | null): SetupLog =>
    err ? { task: 'voice', error: err } : sawDone || code === 0 ? { task: 'voice', done: true } : { task: 'voice', error: `Échec (code ${code})` }
  if (WIN) startTask('voice', 'powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(scripts, 'setup-voice.ps1'), BENCH], { onLine, finish })
  else startTask('voice', 'bash', [join(scripts, 'setup-voice.sh'), BENCH], { onLine, finish })
}
