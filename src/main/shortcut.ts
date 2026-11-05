import { app } from 'electron'
import { execFile } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

// Raccourci pour lancer Canopy sans terminal (setup, étape « C'est prêt »).
// macOS : ~/Applications/Canopy.app (applet AppleScript qui lance scripts/canopy-dev.sh), icône de Canopy.
// Windows : Canopy.lnk sur le Bureau, vers scripts/atelier-dev.vbs (comme le raccourci d'origine).
// Un raccourci déjà présent n'est jamais remplacé.

const root = () => app.getAppPath()

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
    if (process.platform === 'darwin') await macApp(target)
    else await winLink(target)
    return { ok: true, path: target }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

async function macApp(target: string) {
  const script = join(root(), 'scripts', 'canopy-dev.sh')
  chmodSync(script, 0o755)
  mkdirSync(join(homedir(), 'Applications'), { recursive: true })
  const q = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  // Détaché : l'applet se termine aussitôt, Canopy continue.
  const as = `do shell script "/bin/zsh -l " & quoted form of "${q(script)}" & " > /dev/null 2>&1 &"`
  await exec('osacompile', ['-o', target, '-e', as])
  // Icône : resources/canopy.png → .icns (sips + iconutil, fournis par macOS).
  const png = join(root(), 'resources', 'canopy.png')
  if (!existsSync(png)) return
  const tmp = mkdtempSync(join(tmpdir(), 'canopy-icon-'))
  try {
    const set = join(tmp, 'Canopy.iconset')
    mkdirSync(set)
    for (const s of [16, 32, 128, 256, 512]) {
      await exec('sips', ['-z', String(s), String(s), png, '--out', join(set, `icon_${s}x${s}.png`)])
      await exec('sips', ['-z', String(s * 2), String(s * 2), png, '--out', join(set, `icon_${s}x${s}@2x.png`)])
    }
    const icns = join(tmp, 'Canopy.icns')
    await exec('iconutil', ['-c', 'icns', set, '-o', icns])
    copyFileSync(icns, join(target, 'Contents', 'Resources', 'applet.icns'))
    await exec('touch', [target]) // le Finder relit l'icône
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
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
