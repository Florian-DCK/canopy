// Démon Canopy : processus Node indépendant d'Electron. Il porte les sessions Agent SDK, les
// autorisations en attente, les médias, la sonde d'usage et la détection des sessions externes.
// Electron (et toute autre fenêtre) n'est qu'un client : il peut redémarrer sans couper les agents.
//
// Protocole (127.0.0.1 uniquement, en-tête x-atelier-token obligatoire) :
//   GET  /health                → { ok, pid, version, busy }
//   GET  /snapshot              → AppState (avec seq)
//   GET  /events?since=<seq>    → flux SSE d'événements numérotés (rattrapage depuis since)
//   POST /rpc { method, args }  → { ok, result } | { ok: false, error }
import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { emptyState, reduce, type AppState } from '../shared/state'
import type { BrowserResult } from '../shared/browser'
import type { UiResult } from '../shared/ui'
import type { AppEvent, CaptureResult, SessionMeta } from '../shared/types'
import { Checklists } from './checklists'
import { MediaStore } from './media'
import { dataFile } from './paths'
import { ensureSandbox, addProject, getProject, listProjects, removeProject, renameProject } from './projects'
import { loadSdk, SessionManager } from './sessions'
import { listCommands, listFiles } from './suggest'
import { CLAUDE_DIR, setSkillEnabled } from './tooling'
import { forgetMemory, listMemory, moveMemory, writeMemory } from './memory'
import { deleteAgent, draftAgent, listAgents, saveAgent, setAgentEnabled } from './agents'
import { summarizeChanges } from './recap'
import { UsageProbe } from './usage'

// Journal : le démon est lancé sans console, il écrit lui-même dans daemon.log.
for (const level of ['log', 'error'] as const) {
  const orig = console[level].bind(console)
  console[level] = (...args: unknown[]) => {
    orig(...args)
    try {
      appendFileSync(dataFile('daemon.log'), `${new Date().toISOString()} ${args.map((a) => (a instanceof Error ? a.stack : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}
`)
    } catch {
      /* journal indisponible */
    }
  }
}

const TOKEN = randomBytes(24).toString('hex')
/** Version = date de build du script : Electron la compare pour proposer « moteur modifié ». */
const VERSION = createHash('sha1').update(readFileSync(__filename)).digest('hex')
const INFO = dataFile('daemon.json')
const OPEN = dataFile('open-sessions.json')

// ---------- état + bus d'événements ----------
let state: AppState = emptyState()
const log: { seq: number; e: AppEvent }[] = []
const clients = new Set<ServerResponse>()
let shuttingDown = false

function emit(e: AppEvent) {
  state = reduce({ ...state, seq: state.seq + 1 }, e)
  const entry = { seq: state.seq, e }
  log.push(entry)
  if (log.length > 5000) log.splice(0, log.length - 5000)
  const line = `data: ${JSON.stringify(entry)}\n\n`
  for (const c of clients) c.write(line)
  if (e.type.startsWith('session:')) saveOpenSoon()
  if (e.type === 'item:add' && e.item.kind === 'result') void usage.refresh()
}

const media = new MediaStore()
// Le bac à sable existe toujours (planche 35).
ensureSandbox()
const sessions = new SessionManager(emit, media)

// Captures : le démon relaie la demande à Electron (événement) et attend la réponse (RPC captureResult).
const captures = new Map<string, (r: CaptureResult) => void>()
sessions.capture = (_sessionId, params) =>
  new Promise<CaptureResult>((resolve) => {
    if (!clients.size) return resolve({ ok: false, info: 'Aucune fenêtre Canopy connectée : ouvre Canopy puis réessaie.' })
    const id = randomBytes(8).toString('hex')
    const timer = setTimeout(() => {
      captures.delete(id)
      resolve({ ok: false, info: 'Pas de réponse de la fenêtre Canopy (20 s).' })
    }, 20_000)
    captures.set(id, (r) => {
      clearTimeout(timer)
      captures.delete(id)
      resolve(r)
    })
    emit({ type: 'capture:request', id, params, at: Date.now() })
  })
// Navigateur intégré : même courtier (événement browser:request, réponse par RPC browserResult).
const browsers = new Map<string, (r: BrowserResult) => void>()
sessions.browser = (sessionId, params) =>
  new Promise<BrowserResult>((resolve) => {
    if (!clients.size) return resolve({ ok: false, text: 'Aucune fenêtre Canopy connectée : ouvre Canopy puis réessaie.' })
    const id = randomBytes(8).toString('hex')
    const timer = setTimeout(() => {
      browsers.delete(id)
      resolve({ ok: false, text: "Le navigateur n'a pas répondu (60 s)." })
    }, 60_000)
    browsers.set(id, (r) => {
      clearTimeout(timer)
      browsers.delete(id)
      resolve(r)
    })
    emit({ type: 'browser:request', id, sessionId, params, at: Date.now() })
  })
// Interface : même courtier (événement ui:request, réponse par RPC uiResult).
const uis = new Map<string, (r: UiResult) => void>()
sessions.ui = (sessionId, params) =>
  new Promise<UiResult>((resolve) => {
    if (!clients.size) return resolve({ ok: false, text: 'Aucune fenêtre Canopy connectée : ouvre Canopy puis réessaie.' })
    const id = randomBytes(8).toString('hex')
    const timer = setTimeout(() => {
      uis.delete(id)
      resolve({ ok: false, text: "L'interface n'a pas répondu (15 s)." })
    }, 15_000)
    uis.set(id, (r) => {
      clearTimeout(timer)
      uis.delete(id)
      resolve(r)
    })
    emit({ type: 'ui:request', id, sessionId, params, at: Date.now() })
  })
// Checklists : fichiers du projet ; on notifie après chaque écriture (RPC, outil de Claude, fichier modifié à la main).
sessions.checklists = new Checklists(listProjects, (ids) => emit({ type: 'checklists:changed', ids }))
const checklists = sessions.checklists
const usage = new UsageProbe(loadSdk, (quota) => emit({ type: 'quota', quota }))

// ---------- sessions ouvertes : survivent à un redémarrage du démon ----------
type OpenEntry = Pick<SessionMeta, 'id' | 'projectId' | 'sdkSessionId' | 'title' | 'modelChoice' | 'permissionMode' | 'readOnly' | 'cwd'>
let saveTimer: NodeJS.Timeout | null = null
function saveOpenSoon() {
  if (shuttingDown || saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    if (shuttingDown) return
    const list: OpenEntry[] = Object.values(state.sessions)
      .filter((s) => s.sdkSessionId)
      .map(({ id, projectId, sdkSessionId, title, modelChoice, permissionMode, readOnly }) => ({
        id,
        projectId,
        sdkSessionId,
        title,
        modelChoice,
        permissionMode,
        readOnly
      }))
    writeFileSync(OPEN, JSON.stringify(list, null, 2), 'utf8')
  }, 500)
}

async function restoreOpen() {
  if (!existsSync(OPEN)) return
  let list: OpenEntry[] = []
  try {
    list = JSON.parse(readFileSync(OPEN, 'utf8'))
  } catch {
    return
  }
  for (const o of list) {
    if (!o.sdkSessionId || !getProject(o.projectId)) continue
    try {
      // Même identifiant qu'avant le redémarrage : la fenêtre ouverte retrouve sa session.
      const meta = await sessions.resume(o.projectId, o.sdkSessionId, o.title, !!o.readOnly, false, o.id)
      if (o.modelChoice) await sessions.setModel(meta.id, o.modelChoice)
      if (o.permissionMode && o.permissionMode !== meta.permissionMode) await sessions.setPermissionMode(meta.id, o.permissionMode)
    } catch (err) {
      console.error('[daemon] restauration', o.sdkSessionId, err)
    }
  }
}

// ---------- détection des sessions externes ----------
let polling = false
async function pollExternal() {
  if (polling) return
  polling = true
  try {
    emit({ type: 'external', sessions: await sessions.external(listProjects()) })
  } catch (err) {
    console.error('[daemon] external', err)
  } finally {
    polling = false
  }
}

const busy = () => Object.values(state.sessions).some((s) => s.status === 'run' || s.status === 'wait')

async function shutdown(force = false) {
  if (busy() && !force) throw new Error('Une session travaille ou attend une autorisation')
  shuttingDown = true
  usage.stop()
  // Arrêter une session Claude peut ne jamais rendre la main : on n'attend pas plus de 3 s.
  await Promise.race([sessions.closeAll(), new Promise((r) => setTimeout(r, 3000))])
  try {
    unlinkSync(INFO)
  } catch {
    /* déjà supprimé */
  }
  setTimeout(() => process.exit(0), 50)
}

/** Chemin d'un projet connu (les opérations de mémoire refusent un projet inconnu). */
function pathOf(projectId: string): string {
  const p = getProject(projectId)
  if (!p) throw new Error('Projet inconnu')
  return p.path
}

// ---------- RPC ----------
const rpc: Record<string, (...a: any[]) => unknown> = {
  listProjects: () => listProjects(),
  addProjectPath: (path: string) => {
    const p = addProject(path)
    void pollExternal()
    emit({ type: 'projects:changed' })
    return p
  },
  removeProject: async (id: string) => {
    for (const s of sessions.list()) if (s.projectId === id) await sessions.close(s.id)
    removeProject(id)
    emit({ type: 'projects:changed' })
  },
  renameProject: (id: string, name: string) => {
    const p = renameProject(id, name)
    emit({ type: 'projects:changed' })
    return p
  },
  createSession: (projectId: string, model?: string) => sessions.create(projectId, model),
  send: (id: string, text: string, attachments?: any[]) => sessions.send(id, text, attachments),
  interrupt: (id: string) => sessions.interrupt(id),
  closeSession: (id: string) => sessions.close(id),
  setPermissionMode: (id: string, mode: any) => sessions.setPermissionMode(id, mode),
  respondPermission: (id: string, permId: string, d: any) => sessions.respond(id, permId, d),
  answerQuestion: (id: string, itemId: string, a: any) => sessions.answerQuestion(id, itemId, a),
  backgroundTask: (id: string, toolUseId?: string) => sessions.backgroundTask(id, toolUseId),
  stopTask: (id: string, taskId: string) => sessions.stopTask(id, taskId),
  toolsInventory: (projectId: string, force?: boolean) => sessions.toolsInventory(projectId, !!force),
  setSkillEnabled: (name: string, enabled: boolean) => setSkillEnabled(name, enabled),
  setMcpEnabled: (projectId: string, name: string, enabled: boolean) => sessions.setMcpEnabled(projectId, name, enabled),
  reconnectMcp: (projectId: string, name: string) => sessions.reconnectMcp(projectId, name),
  // « global » : les agents de tous les projets (~/.claude/agents), sans projet ni interrupteur par projet.
  listAgents: (projectId: string) => listAgents(projectId === 'global' ? CLAUDE_DIR : pathOf(projectId)),
  saveAgent: (projectId: string, a: any, oldPath?: string) => saveAgent(projectId === 'global' ? CLAUDE_DIR : pathOf(projectId), { ...a, scope: projectId === 'global' ? 'user' : a.scope }, oldPath),
  deleteAgent: (path: string) => deleteAgent(path),
  setAgentEnabled: (projectId: string, name: string, enabled: boolean) => setAgentEnabled(pathOf(projectId), name, enabled),
  draftAgent: (text: string) => draftAgent(text),
  summarizeChanges: (files: { path: string; lines: string }[]) => summarizeChanges(files),
  listMemory: (projectId: string) => listMemory(pathOf(projectId)),
  writeMemory: (projectId: string, file: string, raw: string) => writeMemory(pathOf(projectId), file, raw),
  forgetMemory: (projectId: string, file: string) => forgetMemory(pathOf(projectId), file),
  moveMemory: (projectId: string, file: string, to: string) => moveMemory(pathOf(projectId), file, pathOf(to)),
  configProject: () => {
    const known = listProjects().find((p) => p.path.toLowerCase() === CLAUDE_DIR.toLowerCase())
    if (known) return known
    const p = renameProject(addProject(CLAUDE_DIR).id, 'Config Claude Code')
    emit({ type: 'projects:changed' })
    return p
  },
  taskOutput: (id: string, itemId: string) => sessions.taskOutput(id, itemId),
  listHistory: () => sessions.history(listProjects()),
  listFiles: (projectId: string) => listFiles(projectId, getProject(projectId)?.path),
  listChecklists: () => checklists.list(),
  getChecklist: (id: string) => checklists.get(id),
  createChecklist: (projectId: string, title: string, items?: string[], sessionId?: string) => checklists.create(projectId, title, items, sessionId),
  updateChecklist: (id: string, ops: any[]) => checklists.apply(id, ops, 'user').checklist,
  deleteChecklist: (id: string) => checklists.remove(id),
  listCommands: (id: string) => {
    const { query, projectId } = sessions.querySource(id)
    return listCommands(query, projectId ? getProject(projectId)?.path : undefined)
  },
  resumeSession: (projectId: string, sdkId: string, title: string, readOnly?: boolean, fork?: boolean) =>
    sessions.resume(projectId, sdkId, title, !!readOnly, !!fork),
  setModel: (id: string, model: string) => sessions.setModel(id, model),
  takeOver: (id: string) => sessions.takeOver(id),
  refreshUsage: () => usage.refresh(),
  captureResult: (id: string, r: CaptureResult) => captures.get(id)?.(r),
  browserResult: (id: string, r: BrowserResult) => browsers.get(id)?.(r),
  uiResult: (id: string, r: UiResult) => uis.get(id)?.(r),
  // Capture sans passer par une session (scripts, tests).
  capture: (params: any) => sessions.capture!('', params ?? {}),
  shutdown: (force?: boolean) => shutdown(!!force)
}

// ---------- serveur HTTP ----------
const readBody = (req: IncomingMessage) =>
  new Promise<string>((res, rej) => {
    let b = ''
    req.on('data', (c) => (b += c))
    req.on('end', () => res(b))
    req.on('error', rej)
  })

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = createServer(async (req, res) => {
  if (req.headers['x-atelier-token'] !== TOKEN) return json(res, 401, { ok: false, error: 'token' })
  const url = new URL(req.url ?? '/', 'http://localhost')
  try {
    if (req.method === 'GET' && url.pathname === '/health')
      return json(res, 200, { ok: true, pid: process.pid, version: VERSION, busy: busy() })
    if (req.method === 'GET' && url.pathname === '/snapshot') return json(res, 200, state)
    if (req.method === 'GET' && url.pathname === '/events') {
      const since = Number(url.searchParams.get('since') ?? state.seq)
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
      res.write(': ok\n\n')
      // Rattrapage : événements manqués depuis `since` (sinon le client doit reprendre un snapshot).
      const first = log[0]?.seq ?? state.seq + 1
      if (since + 1 < first) res.write(`event: resync\ndata: {}\n\n`)
      else for (const x of log) if (x.seq > since) res.write(`data: ${JSON.stringify(x)}\n\n`)
      clients.add(res)
      const ping = setInterval(() => res.write(': ping\n\n'), 15000)
      req.on('close', () => {
        clearInterval(ping)
        clients.delete(res)
      })
      return
    }
    if (req.method === 'POST' && url.pathname === '/rpc') {
      const { method, args } = JSON.parse((await readBody(req)) || '{}')
      const fn = rpc[method]
      if (!fn) return json(res, 404, { ok: false, error: `méthode inconnue : ${method}` })
      // JSON transforme les arguments optionnels absents (undefined) en null : on les rétablit.
      const result = await fn(...(Array.isArray(args) ? args : []).map((a) => (a === null ? undefined : a)))
      return json(res, 200, { ok: true, result: result ?? null })
    }
    json(res, 404, { ok: false, error: 'introuvable' })
  } catch (err: any) {
    json(res, 200, { ok: false, error: String(err?.message ?? err) })
  }
})

/** Un seul démon par dossier de données : si un autre répond déjà, on s'efface. */
async function otherDaemonAlive(): Promise<boolean> {
  try {
    const i = JSON.parse(readFileSync(INFO, 'utf8'))
    if (i.pid === process.pid) return false
    const r = await fetch(`http://127.0.0.1:${i.port}/health`, { headers: { 'x-atelier-token': i.token } })
    return !!(await r.json())?.ok
  } catch {
    return false
  }
}

void (async () => {
  if (await otherDaemonAlive()) {
    console.log('[daemon] un autre démon tourne déjà pour ce dossier, arrêt')
    process.exit(0)
  }
  server.listen(0, '127.0.0.1', onListening)
})()

// Démon remplacé (daemon.json pointe vers un autre) : il s'arrête de lui-même.
setInterval(() => {
  try {
    const i = JSON.parse(readFileSync(INFO, 'utf8'))
    if (i.pid !== process.pid && !busy()) void shutdown(true)
  } catch {
    /* fichier absent pendant un redémarrage */
  }
}, 30_000)

function onListening() {
  const addr = server.address()
  const port = typeof addr === 'object' && addr ? addr.port : 0
  writeFileSync(INFO, JSON.stringify({ port, token: TOKEN, pid: process.pid, version: VERSION, script: __filename }), 'utf8')
  console.log(`[daemon] prêt sur 127.0.0.1:${port} (pid ${process.pid})`)
  void restoreOpen()
  void pollExternal()
  void usage.refresh()
  setInterval(pollExternal, 8000)
  setInterval(() => void usage.refresh(), 60_000)
}

process.on('uncaughtException', (err) => console.error('[daemon] uncaught', err))
process.on('unhandledRejection', (err) => console.error('[daemon] unhandled', err))
