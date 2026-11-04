import { desktopCapturer, screen } from 'electron'
import { execFile } from 'node:child_process'
import type { CaptureResult } from '../shared/types'

// Outil « écran » (mode compagnon, planche 32) : Claude regarde ce que l'utilisateur a sous les yeux, à sa demande.
// Capture de l'écran où se trouve la souris, ou de la seule fenêtre active ; toujours signalée par l'œil de la bulle.

/** Titre de la fenêtre au premier plan (API Windows, via PowerShell). */
function foregroundTitle(): Promise<string> {
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

export async function captureScreen(what: 'screen' | 'window'): Promise<CaptureResult & { title?: string }> {
  const title = await foregroundTitle()
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const scale = Math.min(1, 1600 / display.size.width)
  const size = { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) }
  if (what === 'window' && title) {
    const wins = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: size })
    const hit = wins.find((w) => w.name === title) ?? wins.find((w) => title.includes(w.name) || w.name.includes(title))
    if (hit && !hit.thumbnail.isEmpty())
      return { ok: true, image: hit.thumbnail.toJPEG(75).toString('base64'), info: `Fenêtre active : « ${title} ».`, title }
  }
  const screens = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size })
  const src = screens.find((s) => s.display_id === String(display.id)) ?? screens[0]
  if (!src || src.thumbnail.isEmpty()) return { ok: false, info: "Impossible de capturer l'écran." }
  return {
    ok: true,
    image: src.thumbnail.toJPEG(75).toString('base64'),
    info: `Écran ${display.size.width}×${display.size.height} (celui de la souris)${title ? `, fenêtre active : « ${title} »` : ''}.`,
    title
  }
}
