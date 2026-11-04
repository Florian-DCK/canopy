import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dataFile } from './paths'

// Sessions créées par Atelier (le SDK les classe « programmatiques », comme les `claude -p` des hooks).
const file = () => dataFile('own-sessions.json')

function read(): string[] {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as string[]) : []
  } catch {
    return []
  }
}

export const ownSessions = (): Set<string> => new Set(read())

export function rememberOwnSession(id: string) {
  const list = read()
  if (list.includes(id)) return
  writeFileSync(file(), JSON.stringify([...list, id].slice(-2000)), 'utf8')
}
