import { app, nativeTheme } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NotifSettings, ThemeMode } from '../shared/types'

type Settings = { theme: ThemeMode; notif?: Partial<NotifSettings>; /** Mode compagnon : coin bas-droit de la bulle. */ companionAnchor?: { x: number; y: number } }

export const NOTIF_DEFAULT: NotifSettings = { corner: 'br', overFullscreen: true, sound: true, quiet: false, quietFrom: '22:00', quietTo: '08:00' }

const file = () => join(app.getPath('userData'), 'settings.json')

function read(): Settings {
  try {
    if (existsSync(file())) return { theme: 'system', ...JSON.parse(readFileSync(file(), 'utf8')) }
  } catch {
    /* fichier illisible : valeurs par défaut */
  }
  return { theme: 'system' }
}

export function getTheme(): ThemeMode {
  return read().theme
}

/** Applique le thème à Electron (barre de titre + prefers-color-scheme du renderer) et le mémorise. */
export function setTheme(theme: ThemeMode) {
  nativeTheme.themeSource = theme
  writeFileSync(file(), JSON.stringify({ ...read(), theme }, null, 2), 'utf8')
}

export function applySavedTheme() {
  nativeTheme.themeSource = getTheme()
}

export const windowBackground = () => (nativeTheme.shouldUseDarkColors ? '#1F1E1D' : '#FAF9F5')

export function getNotifSettings(): NotifSettings {
  return { ...NOTIF_DEFAULT, ...read().notif }
}

export function setNotifSettings(patch: Partial<NotifSettings>): NotifSettings {
  const cur = read()
  const notif = { ...NOTIF_DEFAULT, ...cur.notif, ...patch }
  writeFileSync(file(), JSON.stringify({ ...cur, notif }, null, 2), 'utf8')
  return notif
}

export function getCompanionAnchor(): { x: number; y: number } | null {
  return read().companionAnchor ?? null
}

export function setCompanionAnchor(p: { x: number; y: number }) {
  writeFileSync(file(), JSON.stringify({ ...read(), companionAnchor: p }, null, 2), 'utf8')
}
