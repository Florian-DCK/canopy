import { app } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { appRoot } from './root'

// Raccourci pour lancer Canopy sans terminal (setup, étape « C'est prêt »).
// macOS : ~/Applications/Canopy.app → l'Electron du projet devenu « Canopy » (scripts/mac-app.mjs).
// Windows : Canopy.lnk sur le Bureau, vers scripts/atelier-dev.vbs (comme le raccourci d'origine).
// Un raccourci déjà présent n'est jamais remplacé.

const root = () => appRoot()

export function shortcutPath(): string | null {
  if (process.platform === 'darwin') return join(homedir(), 'Applications', 'Canopy.app')
  if (process.platform === 'win32') return join(app.getPath('desktop'), 'Canopy.lnk')
  return null
}

export const shortcutExists = () => {
  const p = shortcutPath()
  return !!p && existsSync(p)
}

const exec = (cmd: string, args: string[]) =>
  new Promise<void>((resolve, reject) => execFile(cmd, args, { timeout: 30_000, windowsHide: true }, (err, _o, se) => (err ? reject(new Error(String(se || err.message).trim())) : resolve())))

export async function createShortcut(): Promise<{ ok: boolean; path?: string; existed?: boolean; error?: string }> {
  const target = shortcutPath()
  if (!target) return { ok: false, error: 'Raccourci non pris en charge sur ce système.' }
  if (existsSync(target)) return { ok: true, path: target, existed: true }
  try {
    if (process.platform === 'darwin') await macApp()
    else await winLink(target)
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

/** Mac : scripts/mac-app.mjs fait de l'Electron du projet l'app « Canopy » et pose ~/Applications/Canopy.app. */
async function macApp() {
  await new Promise<void>((resolve, reject) =>
    execFile(process.execPath, [join(root(), 'scripts', 'mac-app.mjs')], { timeout: 120_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', CANOPY_SKIP_BUILD: '1' } }, (err, out, se) =>
      err ? reject(new Error(String(se || err.message).trim())) : /incomplète/.test(String(se)) ? reject(new Error(String(se).trim())) : resolve()
    )
  )
}

async function winLink(target: string) {
  const vbs = join(root(), 'scripts', 'atelier-dev.vbs')
  const ico = join(root(), 'resources', 'canopy.ico')
  const ps = (s: string) => `'${s.replace(/'/g, "''")}'`
  const cmd = [
    '$s = (New-Object -ComObject WScript.Shell).CreateShortcut(' + ps(target) + ')',
    `$s.TargetPath = ${ps(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wscript.exe'))}`,
    `$s.Arguments = ${ps(`"${vbs}"`)}`,
    `$s.WorkingDirectory = ${ps(root())}`,
    `$s.IconLocation = ${ps(ico)}`,
    '$s.Save()'
  ].join('; ')
  await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd])
}
