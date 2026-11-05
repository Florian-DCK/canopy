import { desktopCapturer, nativeImage, screen, systemPreferences } from 'electron'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CaptureResult } from '../shared/types'

// Outil « écran » (mode compagnon, planche 32) : Claude regarde ce que l'utilisateur a sous les yeux, à sa demande.
// Capture de l'écran où se trouve la souris, ou de la seule fenêtre active ; toujours signalée par l'œil de la bulle.

const MAC_SCREEN_DENIED = "Autorise Canopy dans Réglages Système › Confidentialité et sécurité › Enregistrement de l'écran"

function osascript(script: string): Promise<string> {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 5000 }, (err, out) => resolve(err ? '' : String(out).trim()))
  })
}

/** macOS : « Application — titre de fenêtre » (le titre demande l'accessibilité ; sans elle, le nom de l'app seul). */
async function macForeground(): Promise<{ title: string; bounds: string }> {
  const app = await osascript('tell application "System Events" to get name of first application process whose frontmost is true')
  const win = await osascript(
    'tell application "System Events" to tell (first application process whose frontmost is true) to get {name of window 1, position of window 1, size of window 1}'
  )
  // Réponse : « titre, x, y, w, h »
  const m = /^(.*), (-?\d+), (-?\d+), (\d+), (\d+)$/.exec(win)
  if (!m) return { title: app, bounds: '' }
  return { title: m[1] ? `${app} — ${m[1]}` : app, bounds: `${m[2]},${m[3]},${m[4]},${m[5]}` }
}

/** macOS : capture par `screencapture` (région en points, coordonnées globales), réduite et rendue en JPEG base64. */
async function macCapture(region: string, toOut: number): Promise<string | null> {
  const dir = await mkdtemp(join(tmpdir(), 'canopy-shot-'))
  const file = join(dir, 'shot.png')
  try {
    await new Promise<void>((resolve, reject) =>
      execFile('screencapture', ['-x', '-t', 'png', '-R', region, file], { timeout: 10000 }, (err) => (err ? reject(err) : resolve()))
    )
    const img = nativeImage.createFromBuffer(await readFile(file))
    if (img.isEmpty()) return null
    const { width } = img.getSize()
    const out = img.resize({ width: Math.max(1, Math.round(width * toOut)), quality: 'best' })
    return out.toJPEG(80).toString('base64')
  } catch {
    return null
  } finally {
    void rm(dir, { recursive: true, force: true })
  }
}

/** Titre de la fenêtre au premier plan (API Windows, via PowerShell ; macOS : System Events). */
function foregroundTitle(): Promise<string> {
  if (process.platform === 'darwin') return macForeground().then((f) => f.title)
  if (process.platform !== 'win32') return Promise.resolve('')
  const ps = `Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public class Fg { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); }
"@
$s = New-Object System.Text.StringBuilder 512; [void][Fg]::GetWindowText([Fg]::GetForegroundWindow(), $s, 512); [Console]::OutputEncoding = [Text.Encoding]::UTF8; $s.ToString()`
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 5000 }, (err, out) => resolve(err ? '' : String(out).trim()))
  })
}

/**
 * Capture par l'ancienne voie de Windows (GDI). Avec le HDR actif, la capture de Chromium arrive trop sombre et
 * trop saturée (« brûlée ») ; GDI reçoit l'écran déjà ramené en SDR, fidèle à ce que l'utilisateur voit.
 * rect : pixels physiques ; ou null = la fenêtre au premier plan. Rend un JPEG (base64) à la taille demandée.
 */
async function gdiCapture(rect: { x: number; y: number; w: number; h: number } | null, scale: number): Promise<string | null> {
  if (process.platform === 'darwin') {
    // rect : points (sous macOS pixels physiques = points × scaleFactor, déjà pris en compte dans scale).
    const region = rect ? `${rect.x},${rect.y},${rect.w},${rect.h}` : (await macForeground()).bounds
    return region ? macCapture(region, scale) : null
  }
  if (process.platform !== 'win32') return null
  const pick = rect
    ? `$x=${rect.x};$y=${rect.y};$w=${rect.w};$h=${rect.h}`
    : `$r=New-Object 'G+RECT';[void][G]::GetWindowRect([G]::GetForegroundWindow(),[ref]$r);$x=$r.L;$y=$r.T;$w=$r.R-$r.L;$h=$r.B-$r.T`
  const ps = `Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public class G { [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r); }
"@
[void][G]::SetProcessDPIAware()
${pick}
if ($w -le 0 -or $h -le 0) { exit 1 }
$src = New-Object System.Drawing.Bitmap $w, $h
$g = [System.Drawing.Graphics]::FromImage($src); $g.CopyFromScreen($x, $y, 0, 0, (New-Object System.Drawing.Size $w, $h)); $g.Dispose()
$ow = [Math]::Max(1, [int]($w * ${scale})); $oh = [Math]::Max(1, [int]($h * ${scale}))
$dst = New-Object System.Drawing.Bitmap $ow, $oh
$g = [System.Drawing.Graphics]::FromImage($dst); $g.InterpolationMode = 'HighQualityBicubic'; $g.DrawImage($src, 0, 0, $ow, $oh); $g.Dispose()
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$p = New-Object System.Drawing.Imaging.EncoderParameters 1; $p.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 80L
$ms = New-Object System.IO.MemoryStream; $dst.Save($ms, $enc, $p); [Convert]::ToBase64String($ms.ToArray())`
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 10000, maxBuffer: 32 << 20 }, (err, out) => {
      const b64 = String(out).trim()
      resolve(err || b64.length < 100 ? null : b64)
    })
  })
}

export async function captureScreen(what: 'screen' | 'window'): Promise<CaptureResult & { title?: string }> {
  if (process.platform === 'darwin' && systemPreferences.getMediaAccessStatus('screen') !== 'granted') return { ok: false, info: MAC_SCREEN_DENIED }
  const title = await foregroundTitle()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const scale = Math.min(1, 1600 / display.size.width)
  const size = { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) }
  // Pixels physiques → image à la taille des points d'écran (× scale) : les coordonnées lues sur la capture restent
  // celles qu'attendent les outils « act » et « mark ».
  const toOut = scale / display.scaleFactor
  if (what === 'window' && title) {
    const gdi = await gdiCapture(null, toOut)
    if (gdi) return { ok: true, image: gdi, info: `Fenêtre active : « ${title} ».`, title }
    const wins = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size })
    const hit = wins.find((w) => w.name === title) ?? wins.find((w) => title.includes(w.name) || w.name.includes(title))
    if (hit && !hit.thumbnail.isEmpty())
      return { ok: true, image: hit.thumbnail.toJPEG(75).toString('base64'), info: `Fenêtre active : « ${title} ».`, title }
  }
  const info = `Écran ${display.size.width}×${display.size.height} (celui de la souris)${title ? `, fenêtre active : « ${title} »` : ''}.`
  const phys = process.platform === 'win32' ? screen.dipToScreenRect(null, display.bounds) : display.bounds
  const gdi = await gdiCapture({ x: phys.x, y: phys.y, w: phys.width, h: phys.height }, toOut)
  if (gdi) return { ok: true, image: gdi, info, title }
  const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
  const src = screens.find((s) => s.display_id === String(display.id)) ?? screens[0]
  if (!src || src.thumbnail.isEmpty()) return { ok: false, info: "Impossible de capturer l'écran." }
  return { ok: true, image: src.thumbnail.toJPEG(75).toString('base64'), info, title }
}
