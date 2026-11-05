import { app } from 'electron'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Racine du dépôt (scripts/, resources/, voice/…). En `npm run dev`, c'est le chemin de l'app ; sur Mac, l'app
 * « Canopy » démarre par un petit lanceur placé dans le bundle d'Electron (scripts/mac-app.mjs), qui indique la vraie
 * racine dans CANOPY_ROOT.
 */
export const appRoot = () => process.env.CANOPY_ROOT || app.getAppPath()

/** Lancé par electron-vite dev (rechargement à chaud) plutôt que depuis la version construite. */
export const isDevServer = () => !!process.env['ELECTRON_RENDERER_URL']

/**
 * macOS : une app ouverte depuis le Dock reçoit un PATH minimal (/usr/bin:/bin…) et ne trouve ni npm, ni node,
 * ni claude. On reprend celui du shell de l'utilisateur (Homebrew, nvm, ~/.local/bin), avec des chemins usuels en repli.
 */
export function fixMacPath() {
  if (process.platform !== 'darwin') return
  let shellPath = ''
  try {
    const out = execFileSync(process.env.SHELL || '/bin/zsh', ['-ilc', 'printf "__CANOPY__%s" "$PATH"'], { timeout: 4000, encoding: 'utf8' })
    shellPath = out.split('__CANOPY__').pop() ?? ''
  } catch {
    /* shell lent ou en erreur : chemins usuels */
  }
  const extra = ['/opt/homebrew/bin', '/usr/local/bin', join(homedir(), '.local', 'bin')]
  const parts = [...shellPath.split(':'), ...(process.env.PATH ?? '').split(':'), ...extra].filter(Boolean)
  process.env.PATH = [...new Set(parts)].join(':')
}
