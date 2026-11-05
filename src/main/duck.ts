import { app } from 'electron'
import { execFile } from 'node:child_process'
import { join } from 'node:path'

// Mode voix : pendant que Claude parle, le son des autres applications baisse (scripts/duck.ps1), puis revient.
// Les appels sont mis en file pour ne jamais se croiser.

let chain: Promise<void> = Promise.resolve()
let ducked = false

// macOS : pas de volume par application ; on baisse le volume de sortie système et on rend le niveau d'avant.
let macPrev: number | null = null

function osa(script: string) {
  return new Promise<string>((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 5000 }, (err, out) => resolve(err ? '' : String(out).trim()))
  })
}

async function runMac(action: 'duck' | 'restore', factor: number) {
  if (action === 'duck') {
    const cur = Number(await osa('output volume of (get volume settings)'))
    if (!Number.isFinite(cur) || (await osa('output muted of (get volume settings)')) === 'true') return
    macPrev = cur
    await osa(`set volume output volume ${Math.round(cur * factor)}`)
  } else if (macPrev !== null) {
    const prev = macPrev
    macPrev = null
    await osa(`set volume output volume ${prev}`)
  }
}

function run(action: 'duck' | 'restore', factor = 0.3) {
  if (process.platform === 'darwin') return runMac(action, factor)
  if (process.platform !== 'win32') return Promise.resolve()
  const script = join(app.getAppPath(), 'scripts', 'duck.ps1')
  return new Promise<void>((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action, '-Factor', String(factor)], { windowsHide: true, timeout: 20_000 }, () => resolve())
  })
}

export function setDuck(on: boolean, factor = 0.3) {
  if (on === ducked) return
  ducked = on
  chain = chain.then(() => run(on ? 'duck' : 'restore', factor))
}

/** À la fermeture : le son des autres applications ne doit jamais rester baissé. */
export function restoreDuck() {
  if (!ducked) return
  ducked = false
  void run('restore')
}
