// macOS (lancé par `npm install`, postinstall) : crée l'app « Canopy » dans ~/Applications.
// - copie de l'Electron du projet (clone APFS : quasi gratuit en place), au nom, identifiant et icône de Canopy ;
//   une vraie app, que Spotlight trouve et que macOS nomme « Canopy » dans les demandes d'autorisation ;
// - Contents/Resources/app = petit lanceur qui démarre la version construite de ce dépôt (out/), sans serveur de dev ;
// - signature ad hoc ; refaite seulement si quelque chose change, pour que les autorisations restent valables.
// Sans effet hors macOS. L'Electron de node_modules n'est pas modifié (`npm run dev` inchangé).
import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') process.exit(0)

const ID = 'be.hilarious.canopy'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'node_modules', 'electron', 'dist', 'Electron.app')
const apps = join(homedir(), 'Applications')
const dest = join(apps, 'Canopy.app')
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'pipe', encoding: 'utf8', ...opts })
const log = (m) => console.log(`[canopy] ${m}`)
const plistGet = (plist, k) => {
  try {
    return run('/usr/libexec/PlistBuddy', ['-c', `Print :${k}`, plist]).trim()
  } catch {
    return ''
  }
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// Même nom que le projet (« atelier ») : même dossier de données que `npm run dev`.
const stubPkg = JSON.stringify({ name: pkg.name, version: pkg.version, main: 'index.js' }, null, 2)
const stubJs = `// Lanceur de Canopy (créé par scripts/mac-app.mjs) : démarre la version construite du dépôt.
const path = require('path')
process.env.CANOPY_ROOT = ${JSON.stringify(root)}
require(path.join(process.env.CANOPY_ROOT, 'out', 'main', 'index.js'))
`

try {
  // Piège connu : npm n'a parfois pas téléchargé le binaire d'Electron.
  if (!existsSync(src)) run(process.execPath, [join(root, 'node_modules', 'electron', 'install.js')], { stdio: 'inherit' })
  if (!existsSync(src)) throw new Error('Electron introuvable dans node_modules')

  // Un Canopy.app d'une autre origine n'est jamais remplacé. Les nôtres (lien ou ancien raccourci AppleScript
  // des versions précédentes, ou copie à notre identifiant) le sont.
  mkdirSync(apps, { recursive: true })
  let ours = !existsSync(dest)
  let upToDate = false
  if (!ours) {
    const st = lstatSync(dest)
    const plist = join(dest, 'Contents', 'Info.plist')
    if (st.isSymbolicLink() || existsSync(join(dest, 'Contents', 'Resources', 'Scripts', 'main.scpt'))) ours = true
    else if (plistGet(plist, 'CFBundleIdentifier') === ID) {
      ours = true
      const stubDir = join(dest, 'Contents', 'Resources', 'app')
      upToDate =
        plistGet(plist, 'CFBundleVersion') === plistGet(join(src, 'Contents', 'Info.plist'), 'CFBundleVersion') &&
        existsSync(join(stubDir, 'index.js')) &&
        readFileSync(join(stubDir, 'index.js'), 'utf8') === stubJs &&
        readFileSync(join(stubDir, 'package.json'), 'utf8') === stubPkg
    }
  }
  if (!ours) throw new Error(`${dest} existe déjà et n'a pas été créé par Canopy : laissé tel quel`)

  if (!upToDate) {
    rmSync(dest, { recursive: true, force: true })
    // Clone APFS (copie à la demande, quasi sans place) ; copie classique en repli.
    try {
      run('cp', ['-cR', src, dest])
    } catch {
      run('ditto', [src, dest])
    }

    // Identité
    const plist = join(dest, 'Contents', 'Info.plist')
    const set = (k, v) => {
      try {
        run('/usr/libexec/PlistBuddy', ['-c', `Set :${k} ${v}`, plist])
      } catch {
        run('/usr/libexec/PlistBuddy', ['-c', `Add :${k} string ${v}`, plist])
      }
    }
    set('CFBundleName', 'Canopy')
    set('CFBundleDisplayName', 'Canopy')
    set('CFBundleIdentifier', ID)

    // Icône (resources/canopy.png → electron.icns, l'icône déclarée par le bundle)
    const png = join(root, 'resources', 'canopy.png')
    if (existsSync(png)) {
      const tmp = mkdtempSync(join(tmpdir(), 'canopy-icon-'))
      try {
        const iconset = join(tmp, 'Canopy.iconset')
        mkdirSync(iconset)
        for (const s of [16, 32, 128, 256, 512]) {
          run('sips', ['-z', String(s), String(s), png, '--out', join(iconset, `icon_${s}x${s}.png`)])
          run('sips', ['-z', String(s * 2), String(s * 2), png, '--out', join(iconset, `icon_${s}x${s}@2x.png`)])
        }
        run('iconutil', ['-c', 'icns', iconset, '-o', join(dest, 'Contents', 'Resources', 'electron.icns')])
      } finally {
        rmSync(tmp, { recursive: true, force: true })
      }
    }

    // Lanceur
    const stub = join(dest, 'Contents', 'Resources', 'app')
    rmSync(stub, { recursive: true, force: true })
    mkdirSync(stub)
    writeFileSync(join(stub, 'package.json'), stubPkg)
    writeFileSync(join(stub, 'index.js'), stubJs)

    // Signature ad hoc (bundle modifié), quarantaine retirée, Spotlight prévenu.
    run('codesign', ['--force', '--deep', '--sign', '-', dest])
    try {
      run('xattr', ['-dr', 'com.apple.quarantine', dest])
    } catch {
      /* pas de quarantaine */
    }
    run('touch', [dest])
    try {
      run('mdimport', [dest])
    } catch {
      /* Spotlight l'indexera de lui-même */
    }
    log(`app créée : ${dest}`)
  }

  // Version construite (celle que lance l'app) ; inutile quand c'est l'app elle-même qui demande le raccourci.
  if (!process.env.CANOPY_SKIP_BUILD) {
    log('construction de Canopy…')
    run('npx', ['electron-vite', 'build'], { cwd: root, stdio: 'inherit' })
  }
  log('prêt : ouvre « Canopy » (Spotlight ou Applications), puis garde-le dans le Dock.')
} catch (e) {
  // Ne jamais faire échouer npm install : Canopy reste lançable avec `npm run dev`.
  console.warn(`[canopy] préparation de l'app macOS incomplète : ${e.message}`)
}
