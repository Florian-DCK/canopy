import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateInfo } from '../shared/types'
import { appRoot, isDevServer } from './root'

// Mises à jour depuis le dépôt git (Canopy tourne depuis le code source) : fetch au démarrage puis toutes les 30 min.
// « Mettre à jour » = git pull --ff-only (+ npm install si les dépendances changent) ; ensuite les rechargements
// habituels prennent le relais (interface à chaud, Electron relancé par electron-vite, bandeau « Moteur modifié »).

const root = () => appRoot()
const WIN = process.platform === 'win32'

function git(args: string[], timeout = 30_000): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('git', args, { cwd: root(), timeout, windowsHide: true }, (err, out, se) => (err ? reject(new Error(String(se || err.message).trim())) : resolve(String(out).trim())))
  )
}

let last: UpdateInfo = { behind: 0, ahead: 0, subjects: [], dirty: false }
let busy = false

export async function checkUpdate(): Promise<UpdateInfo> {
  if (busy) return last
  if (!existsSync(join(root(), '.git'))) return (last = { behind: 0, ahead: 0, subjects: [], dirty: false })
  try {
    await git(['fetch', '--quiet', 'origin'])
    const up = await git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch(() => '')
    if (!up) return (last = { behind: 0, ahead: 0, subjects: [], dirty: false })
    const [behind, ahead, log, status] = await Promise.all([
      git(['rev-list', '--count', 'HEAD..@{u}']),
      git(['rev-list', '--count', '@{u}..HEAD']),
      git(['log', '--format=%s', '-n', '6', 'HEAD..@{u}']),
      git(['status', '--porcelain', '--untracked-files=no'])
    ])
    last = { behind: Number(behind) || 0, ahead: Number(ahead) || 0, subjects: log ? log.split('\n') : [], dirty: status.length > 0, checkedAt: Date.now() }
  } catch (e) {
    // Hors ligne ou dépôt sans remote : pas de bandeau, l'erreur reste consultable.
    last = { ...last, error: (e as Error).message, checkedAt: Date.now() }
  }
  return last
}

export async function applyUpdate(): Promise<UpdateInfo> {
  if (busy) return last
  busy = true
  try {
    const before = await git(['rev-parse', 'HEAD'])
    await git(['pull', '--ff-only'], 120_000)
    const changed = await git(['diff', '--name-only', before, 'HEAD'])
    if (/^package(-lock)?\.json$/m.test(changed)) {
      await new Promise<void>((resolve, reject) =>
        execFile(WIN ? 'npm.cmd' : 'npm', ['install'], { cwd: root(), timeout: 600_000, windowsHide: true, shell: WIN }, (err, _o, se) =>
          err ? reject(new Error(`npm install : ${String(se || err.message).trim().split('\n').slice(-2).join(' ')}`)) : resolve()
        )
      )
    }
    // Version construite (app « Canopy » sur Mac, ou `npm start`) : reconstruire puis relancer.
    // En `npm run dev`, les rechargements habituels suffisent.
    if (!isDevServer()) {
      await new Promise<void>((resolve, reject) =>
        execFile(WIN ? 'npx.cmd' : 'npx', ['electron-vite', 'build'], { cwd: root(), timeout: 300_000, windowsHide: true, shell: WIN }, (err, _o, se) =>
          err ? reject(new Error(`construction : ${String(se || err.message).trim().split('\n').slice(-2).join(' ')}`)) : resolve()
        )
      )
      app.relaunch()
      app.exit(0)
    }
    busy = false
    return await checkUpdate()
  } catch (e) {
    busy = false
    return (last = { ...last, error: (e as Error).message })
  }
}

/** Vérification au démarrage (après 20 s, le temps que tout se lance) puis toutes les 30 min. */
export function watchUpdates(send: (u: UpdateInfo) => void) {
  const tick = () => void checkUpdate().then(send)
  setTimeout(tick, 20_000)
  setInterval(tick, 30 * 60_000)
}
