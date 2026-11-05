import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, openSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { connect } from 'node:net'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import { appRoot } from './root'

// Service voix local (voice/server.py) : Whisper + Pocket TTS, lancé à la demande avec le Python du banc d'essai.
// Il tourne détaché et survit aux redémarrages de Canopy (les modèles mettent ~25 s à charger) ;
// il s'arrête seul après 15 min sans fenêtre connectée. Chemins modifiables par variables d'environnement.

const winBench = join(homedir(), 'Documents', 'voice-bench')
// Mac : sans banc d'essai dans Documents, dossier géré par l'installation (userData/voice).
export const BENCH = process.env.CANOPY_VOICE_BENCH ?? (process.platform === 'darwin' && !existsSync(winBench) ? join(app.getPath('userData'), 'voice') : winBench)
export const PYTHON =
  process.env.CANOPY_VOICE_PYTHON ?? (process.platform === 'win32' ? join(BENCH, '.venv-pocket', 'Scripts', 'python.exe') : join(BENCH, '.venv-pocket', 'bin', 'python'))

/** Arrête le service et ses enfants : taskkill sous Windows ; ailleurs le groupe de processus (service lancé detached). */
function killTree(pid: number) {
  if (process.platform === 'win32') {
    spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true })
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* déjà arrêté */
    }
  }
}

export type VoiceInfo = { ok: true; port: number; token: string } | { ok: false; error: string }
type Saved = { pid: number; port: number; token: string; /** Date du code du service au lancement : s'il change, on relance. */ mtime?: number }

const scriptPath = () => join(appRoot(), 'voice', 'server.py')
const scriptMtime = () => {
  try {
    return statSync(scriptPath()).mtimeMs
  } catch {
    return 0
  }
}
const stateFile = () => join(app.getPath('userData'), 'voice-service.json')
const logFile = (token: string) => join(app.getPath('userData'), `voice-service-${token.slice(0, 8)}.log`)
const lockFile = () => join(app.getPath('userData'), 'voice-service.lock')
let starting: Promise<VoiceInfo> | null = null

function alive(pid: number) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function listening(port: number) {
  return new Promise<boolean>((resolve) => {
    const s = connect(port, '127.0.0.1')
    s.once('connect', () => (s.destroy(), resolve(true)))
    s.once('error', () => resolve(false))
    s.setTimeout(1500, () => (s.destroy(), resolve(false)))
  })
}

/** Service déjà lancé (par cette fenêtre ou une précédente) et qui répond. */
async function running(): Promise<Saved | null> {
  try {
    const s = JSON.parse(readFileSync(stateFile(), 'utf8')) as Saved
    if (s.port && alive(s.pid) && (await listening(s.port))) {
      if (s.mtime === scriptMtime()) return s
      // Code du service modifié : on arrête l'ancien pour relancer le nouveau.
      killTree(s.pid)
      await new Promise((r) => setTimeout(r, 800))
    }
  } catch {
    /* pas de service */
  }
  return null
}

export function startVoice(voice: string): Promise<VoiceInfo> {
  starting ??= launch(voice).finally(() => (starting = null))
  return starting
}

async function launch(voice: string): Promise<VoiceInfo> {
  const cur = await running()
  if (cur) return { ok: true, port: cur.port, token: cur.token }
  const script = scriptPath()
  if (!existsSync(PYTHON)) return { ok: false, error: `Python du mode voix introuvable : ${PYTHON}` }
  if (!existsSync(script)) return { ok: false, error: `Service voix introuvable : ${script}` }
  const token = randomBytes(16).toString('hex')
  // Un autre Canopy (redémarrage en cours) est peut-être déjà en train de le lancer : on l'attend.
  try {
    const lock = JSON.parse(readFileSync(lockFile(), 'utf8')) as { pid: number; at: number }
    if (alive(lock.pid) && Date.now() - lock.at < 180_000) {
      while (alive(lock.pid) && Date.now() - lock.at < 180_000) {
        await new Promise((r) => setTimeout(r, 1000))
        const s = await running()
        if (s) return { ok: true, port: s.port, token: s.token }
      }
    }
  } catch {
    /* pas de lancement en cours */
  }
  const out = openSync(logFile(token), 'w')
  const p = spawn(PYTHON, ['-u', script], {
    cwd: BENCH,
    env: { ...process.env, CANOPY_VOICE_TOKEN: token, CANOPY_VOICE_DIR: join(BENCH, 'out'), CANOPY_VOICE: voice, PYTHONIOENCODING: 'utf-8' },
    windowsHide: true,
    detached: true,
    stdio: ['ignore', out, out]
  })
  closeSync(out)
  p.unref()
  writeFileSync(lockFile(), JSON.stringify({ pid: p.pid ?? 0, at: Date.now() }))
  const t0 = Date.now()
  while (Date.now() - t0 < 180_000) {
    await new Promise((r) => setTimeout(r, 500))
    const log = readFileSync(logFile(token), 'utf8')
    const m = /READY (\d+)/.exec(log)
    if (m) {
      const port = Number(m[1])
      writeFileSync(stateFile(), JSON.stringify({ pid: p.pid ?? 0, port, token, mtime: scriptMtime() } satisfies Saved))
      return { ok: true, port, token }
    }
    if (p.exitCode !== null || !alive(p.pid!)) {
      return { ok: false, error: `Le service voix s'est arrêté. ${log.trim().split('\n').slice(-3).join(' ')}` }
    }
  }
  return { ok: false, error: 'Le service voix met trop de temps à démarrer (3 min).' }
}

/** Arrêt explicite (le service s'éteint aussi seul quand plus personne ne s'en sert). */
export async function stopVoice() {
  const cur = await running()
  // Le python du venv est un lanceur : on arrête tout l'arbre.
  if (cur) killTree(cur.pid)
}
