import { app, nativeImage } from 'electron'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { DocInfo } from '../shared/types'
import { officeKind, readOffice } from '../daemon/office'

// Documents dans le fil (planche 49) : informations lues dans le fichier, miniature du système
// quand il en a une, et aperçu fidèle d'un Word / PowerPoint converti en PDF par Office ou LibreOffice.

const dir = () => join(app.getPath('userData'), 'media-cache', 'converted')

/** PDF converti déjà en cache pour ce fichier (même chemin, même date de modification). */
export function convertedPath(file: string): string {
  const st = statSync(file)
  return join(dir(), createHash('sha1').update(`${file.toLowerCase()}|${st.mtimeMs}`).digest('hex').slice(0, 20) + '.pdf')
}

export async function docInfo(file: string): Promise<DocInfo & { thumb?: string }> {
  const type = officeKind(file)
  if (!type) return { type: 'pdf', error: 'Format non pris en charge.' }
  let info: DocInfo
  try {
    info = type === 'pdf' ? { type } : readOffice(file)
  } catch (e) {
    info = { type, error: (e as Error).message }
  }
  // Miniature fournie par Windows / macOS (Office en enregistre une ; un PDF selon le lecteur installé).
  let thumb: string | undefined
  if (type !== 'pdf' && process.platform !== 'linux') {
    try {
      const img = await nativeImage.createThumbnailFromPath(file, { width: 264, height: 372 })
      if (!img.isEmpty()) thumb = img.toDataURL()
    } catch {
      /* pas de miniature : la carte en dessine une */
    }
  }
  return { ...info, thumb }
}

const SOFFICE = [
  'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
  'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  '/Applications/LibreOffice.app/Contents/MacOS/soffice',
  '/usr/bin/soffice'
]

const run = (cmd: string, args: string[], env?: NodeJS.ProcessEnv) =>
  new Promise<void>((ok, ko) => execFile(cmd, args, { timeout: 90000, windowsHide: true, env: { ...process.env, ...env } }, (e) => (e ? ko(e) : ok())))

/** Word / PowerPoint → PDF : LibreOffice s'il est installé, sinon Office par COM (Windows). */
export async function convertDoc(file: string): Promise<{ out?: string; error?: string }> {
  const type = officeKind(file)
  if (type !== 'word' && type !== 'powerpoint') return { error: 'Seuls Word et PowerPoint se convertissent.' }
  const out = convertedPath(file)
  if (existsSync(out)) return { out }
  mkdirSync(dir(), { recursive: true })
  const soffice = SOFFICE.find((p) => existsSync(p))
  try {
    if (soffice) {
      await run(soffice, ['--headless', '--convert-to', 'pdf', '--outdir', dirname(out), file])
      const produced = join(dirname(out), basename(file, extname(file)) + '.pdf')
      if (existsSync(produced) && produced !== out) renameSync(produced, out)
    } else if (process.platform === 'win32') {
      // Chemins passés par variables d'environnement : pas de problème de guillemets dans le script.
      const script =
        type === 'word'
          ? "$w = New-Object -ComObject Word.Application; $w.Visible = $false; $w.DisplayAlerts = 0; try { $d = $w.Documents.Open($env:CANOPY_IN, $false, $true); $d.ExportAsFixedFormat($env:CANOPY_OUT, 17); $d.Close(0) } finally { $w.Quit() }"
          : '$p = New-Object -ComObject PowerPoint.Application; try { $pr = $p.Presentations.Open($env:CANOPY_IN, -1, 0, 0); $pr.SaveAs($env:CANOPY_OUT, 32); $pr.Close() } finally { $p.Quit() }'
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { CANOPY_IN: file, CANOPY_OUT: out })
    } else return { error: 'Installe LibreOffice pour l’aperçu fidèle.' }
  } catch (e) {
    return { error: `Conversion impossible : ${(e as Error).message.split('\n')[0]}` }
  }
  return existsSync(out) ? { out } : { error: 'La conversion n’a pas produit de PDF.' }
}
