import { app } from 'electron'
import { execFile } from 'node:child_process'
import { join } from 'node:path'

// Mode voix : pendant que Claude parle, le son des autres applications baisse (scripts/duck.ps1), puis revient.
// Les appels sont mis en file pour ne jamais se croiser.

let chain: Promise<void> = Promise.resolve()
let ducked = false

function run(action: 'duck' | 'restore', factor = 0.3) {
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
