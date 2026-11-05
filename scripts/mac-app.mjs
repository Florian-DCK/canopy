// macOS (lancé par `npm install`, postinstall) : fait de l'Electron du projet une vraie app « Canopy ».
// - nom, identifiant et icône de Canopy → macOS demande les autorisations au nom de « Canopy » ;
// - Contents/Resources/app = petit lanceur qui démarre la version construite de ce dépôt (out/), sans serveur de dev ;
// - signature ad hoc (le bundle est modifié) : identique d'une fois à l'autre, les autorisations restent valables ;
// - ~/Applications/Canopy.app pointe sur cette app (Spotlight, Dock).
// Sans effet hors macOS. `npm run dev` continue de fonctionner (le chemin du projet passé à Electron l'emporte).
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') process.exit(0)

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appDir = join(root, 'node_modules', 'electron', 'dist', 'Electron.app')
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', ...opts })
const log = (m) => console.log(`[canopy] ${m}`)

try {
  // Piège connu : npm n'a parfois pas téléchargé le binaire d'Electron.
  if (!existsSync(appDir)) run(process.execPath, [join(root, 'node_modules', 'electron', 'install.js')], { stdio: 'inherit' })
  if (!existsSync(appDir)) throw new Error('Electron introuvable dans node_modules')

  // 1. Identité
  const plist = join(appDir, 'Contents', 'Info.plist')
  const set = (k, v) => {
    try {
      run('/usr/libexec/PlistBuddy', ['-c', `Set :${k} ${v}`, plist])
    } catch {
      run('/usr/libexec/PlistBuddy', ['-c', `Add :${k} string ${v}`, plist])
    }
  }
  set('CFBundleName', 'Canopy')
  set('CFBundleDisplayName', 'Canopy')
  set('CFBundleIdentifier', 'be.hilarious.canopy')

  // 2. Icône (resources/canopy.png → electron.icns, l'icône déclarée par le bundle)
  const png = join(root, 'resources', 'canopy.png')
  if (existsSync(png)) {
    const tmp = mkdtempSync(join(tmpdir(), 'canopy-icon-'))
    try {
      const set2 = join(tmp, 'Canopy.iconset')
      mkdirSync(set2)
      for (const s of [16, 32, 128, 256, 512]) {
        run('sips', ['-z', String(s), String(s), png, '--out', join(set2, `icon_${s}x${s}.png`)])
        run('sips', ['-z', String(s * 2), String(s * 2), png, '--out', join(set2, `icon_${s}x${s}@2x.png`)])
      }
      run('iconutil', ['-c', 'icns', set2, '-o', join(appDir, 'Contents', 'Resources', 'electron.icns')])
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  // 3. Lanceur : même nom que le projet (« atelier ») pour garder le même dossier de données que `npm run dev`.
  const stub = join(appDir, 'Contents', 'Resources', 'app')
  rmSync(stub, { recursive: true, force: true })
  mkdirSync(stub)
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  writeFileSync(join(stub, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.version, main: 'index.js' }, null, 2))
  writeFileSync(
    join(stub, 'index.js'),
    `// Lanceur de Canopy (créé par scripts/mac-app.mjs) : démarre la version construite du dépôt.
const path = require('path')
process.env.CANOPY_ROOT = path.resolve(__dirname, '..', '..', '..', '..', '..', '..', '..')
require(path.join(process.env.CANOPY_ROOT, 'out', 'main', 'index.js'))
`
  )

  // 4. Signature ad hoc (bundle modifié) ; quarantaine retirée au cas où.
  run('codesign', ['--force', '--deep', '--sign', '-', appDir])
  try {
    run('xattr', ['-dr', 'com.apple.quarantine', appDir])
  } catch {
    /* pas de quarantaine */
  }
  run('touch', [appDir])

  // 5. Raccourci ~/Applications/Canopy.app (un raccourci d'une autre origine n'est jamais remplacé ;
  //    l'ancien raccourci AppleScript créé par le setup, lui, est remplacé).
  const apps = join(homedir(), 'Applications')
  const link = join(apps, 'Canopy.app')
  mkdirSync(apps, { recursive: true })
  let replace = !existsSync(link)
  if (!replace) {
    try {
      const st = lstatSync(link)
      const old = !st.isSymbolicLink() && existsSync(join(link, 'Contents', 'Resources', 'Scripts', 'main.scpt'))
      if (st.isSymbolicLink() || old) {
        rmSync(link, { recursive: true, force: true })
        replace = true
      }
    } catch {
      /* laissé tel quel */
    }
  }
  if (replace) symlinkSync(appDir, link)

  // 6. Version construite (celle que lance l'app) ; inutile quand c'est l'app elle-même qui demande le raccourci.
  if (!process.env.CANOPY_SKIP_BUILD) {
    log('construction de Canopy…')
    run('npx', ['electron-vite', 'build'], { cwd: root, stdio: 'inherit' })
  }
  log(`prêt : ouvre « Canopy » (Spotlight, ou ${link}).`)
} catch (e) {
  // Ne jamais faire échouer npm install : Canopy reste lançable avec `npm run dev`.
  console.warn(`[canopy] préparation de l'app macOS incomplète : ${e.message}`)
}
