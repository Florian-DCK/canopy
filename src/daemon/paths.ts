import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Dossier de données d'Atelier (userData d'Electron), transmis au démon par ATELIER_DATA. */
export const DATA = process.env.ATELIER_DATA || join(process.env.APPDATA || process.cwd(), 'atelier')
mkdirSync(DATA, { recursive: true })
export const dataFile = (name: string) => join(DATA, name)
