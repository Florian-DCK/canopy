import { app, nativeTheme } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AGENDA_PREFS_DEFAULT, type AgendaPrefs } from '../shared/agenda'
import type { CompanionPrefs, NotifSettings, SetupFeatures, ThemeMode } from '../shared/types'

export type SetupState = { done: boolean; legacy?: boolean; at?: number; features?: SetupFeatures }

type Settings = { theme: ThemeMode; /** Premier lancement. */ setup?: SetupState; notif?: Partial<NotifSettings>; /** Mode compagnon : coin bas-droit de la bulle. */ companionAnchor?: { x: number; y: number } | null; /** Ce que Claude peut faire sur l'ordinateur. */ companion?: Partial<CompanionPrefs>; /** Projets dont Canopy peut relire les requêtes Postgres (planche 46). */ pgProjects?: string[]; /** Agenda (planches 51 à 55) : réglages et projets retenus par réunion. */ agenda?: Partial<AgendaPrefs>; agendaLinks?: Record<string, string | null>; /** Réunions ignorées pour de bon (série ou titre). */ agendaIgnored?: Record<string, string> }

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

export function setCompanionAnchor(p: { x: number; y: number } | null) {
  writeFileSync(file(), JSON.stringify({ ...read(), companionAnchor: p }, null, 2), 'utf8')
}

export function getPgProjects(): string[] {
  return read().pgProjects ?? []
}

export function setPgProjects(pgProjects: string[]) {
  writeFileSync(file(), JSON.stringify({ ...read(), pgProjects }, null, 2), 'utf8')
}

export function getAgendaPrefs(): AgendaPrefs {
  return { ...AGENDA_PREFS_DEFAULT, ...read().agenda }
}

export function setAgendaPrefs(patch: Partial<AgendaPrefs>): AgendaPrefs {
  const cur = read()
  const agenda = { ...AGENDA_PREFS_DEFAULT, ...cur.agenda, ...patch }
  writeFileSync(file(), JSON.stringify({ ...cur, agenda }, null, 2), 'utf8')
  return agenda
}

export function getAgendaLinks(): Record<string, string | null> {
  return read().agendaLinks ?? {}
}

export function setAgendaLinks(agendaLinks: Record<string, string | null>) {
  writeFileSync(file(), JSON.stringify({ ...read(), agendaLinks }, null, 2), 'utf8')
}

export function getSetup(): SetupState | undefined {
  return read().setup
}

export function setSetup(setup: SetupState) {
  writeFileSync(file(), JSON.stringify({ ...read(), setup }, null, 2), 'utf8')
}

const COMPANION_DEFAULT: CompanionPrefs = { screen: true, act: true }

export function getCompanionPrefs(): CompanionPrefs {
  return { ...COMPANION_DEFAULT, ...read().companion }
}

export function setCompanionPrefs(patch: Partial<CompanionPrefs>): CompanionPrefs {
  const cur = read()
  const companion = { ...COMPANION_DEFAULT, ...cur.companion, ...patch }
  writeFileSync(file(), JSON.stringify({ ...cur, companion }, null, 2), 'utf8')
  return companion
}

/** Réunions ignorées pour de bon : clé (série « r: » ou titre « t: ») → titre lisible. */
export function getAgendaIgnored(): Record<string, string> {
  return read().agendaIgnored ?? {}
}

export function setAgendaIgnored(agendaIgnored: Record<string, string>) {
  writeFileSync(file(), JSON.stringify({ ...read(), agendaIgnored }, null, 2), 'utf8')
}
