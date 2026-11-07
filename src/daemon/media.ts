import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import type { MediaItem, MediaKind, MediaSource } from '../shared/types'
import { DB_EXT, isDbFile, summarize } from './db'
import { DATA } from './paths'

// Médias des sessions (côté démon) : images lues par l'agent (copie figée, car le fichier peut être
// réécrit), captures d'outils, fichiers image/vidéo/3D cités, bases de données (photo du schéma). Electron les sert ensuite via atelier-media://.

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
const VIDEO_EXT = ['.mp4', '.webm', '.mov', '.m4v']
const AUDIO_EXT = ['.wav', '.mp3', '.ogg', '.m4a', '.flac', '.opus', '.aac']
const MODEL_EXT = ['.glb', '.gltf', '.obj', '.stl', '.fbx']
const DOC_EXT = ['.pdf', '.docx', '.pptx']
const MIME: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }

export function kindOf(path: string): MediaKind | null {
  const e = extname(path).toLowerCase()
  if (IMAGE_EXT.includes(e)) return 'image'
  if (VIDEO_EXT.includes(e)) return 'video'
  if (AUDIO_EXT.includes(e)) return 'audio'
  if (MODEL_EXT.includes(e)) return 'model'
  if (DB_EXT.includes(e)) return 'db'
  if (DOC_EXT.includes(e)) return 'doc'
  return null
}

export class MediaStore {
  private files = new Map<string, string>()
  private dir = join(DATA, 'media-cache')

  constructor() {
    mkdirSync(this.dir, { recursive: true })
  }

  private add(file: string, kind: MediaKind, meta: Omit<MediaItem, 'id' | 'kind' | 'file' | 'size'>): MediaItem {
    const id = randomUUID()
    this.files.set(id, file)
    let size: number | undefined
    try {
      size = statSync(file).size
    } catch {
      /* ignoré */
    }
    return { id, kind, file, size, ...meta }
  }

  /** Image renvoyée en base64 par un outil : copie figée dans le cache. */
  fromBase64(
    data: string,
    mediaType: string,
    meta: { sessionId: string; itemId: string; source: MediaSource; name?: string; path?: string }
  ): MediaItem | null {
    const ext = MIME[mediaType]
    if (!ext || !data) return null
    const buf = Buffer.from(data, 'base64')
    const file = join(this.dir, createHash('sha1').update(buf).digest('hex') + ext)
    if (!existsSync(file)) writeFileSync(file, buf)
    return this.add(file, 'image', {
      sessionId: meta.sessionId,
      itemId: meta.itemId,
      source: meta.source,
      name: meta.name ?? (meta.path ? basename(meta.path) : `capture${ext}`),
      path: meta.path ?? file,
      at: Date.now()
    })
  }

  /** Fichier local cité : seulement s'il existe. */
  fromPath(raw: string, cwd: string, meta: { sessionId: string; itemId: string }): MediaItem | null {
    const kind = kindOf(raw)
    if (!kind) return null
    const p = raw.startsWith('file:///') ? decodeURIComponent(raw.slice(IS_POSIX && !/^file:\/\/\/[A-Za-z]:/.test(raw) ? 7 : 8)) : raw
    // resolve() aussi pour un chemin absolu : C:/a/b et C:\a\b deviennent le même fichier (une seule photo par base).
    const file = resolve(cwd, p)
    try {
      if (!statSync(file).isFile()) return null
    } catch {
      return null
    }
    if (kind === 'db') return this.fromDb(file, { ...meta, source: 'mention' })
    return this.add(file, kind, { ...meta, source: 'mention', name: basename(file), path: file, at: Date.now() })
  }

  /** Fichier de données lu par l'agent (JSON, JSONL, log) : la carte lit son contenu à l'affichage. */
  fromData(file: string, meta: { sessionId: string; itemId: string }): MediaItem | null {
    try {
      if (!statSync(file).isFile()) return null
    } catch {
      return null
    }
    return this.add(file, 'data', { ...meta, source: 'read', name: basename(file), path: file, at: Date.now() })
  }

  /** Base de données (SQLite, CSV) : avec la photo de son schéma et de ses comptes ; `query` = SELECT lancé par l'agent. */
  fromDb(file: string, meta: { sessionId: string; itemId: string; source: MediaSource; query?: string; baseline?: boolean; foundBy?: string }): MediaItem | null {
    if (!isDbFile(file)) return null
    return this.add(file, 'db', { ...meta, name: basename(file), path: file, at: Date.now(), db: summarize(file) })
  }

  /** Contenu d'une image pour l'envoyer à Claude (pièce jointe). */
  read(id: string): { data: string; mediaType: string } | null {
    const file = this.files.get(id)
    if (!file) return null
    const ext = extname(file).toLowerCase()
    const mediaType = ext === '.jpeg' ? 'image/jpeg' : Object.entries(MIME).find(([, x]) => x === ext)?.[0]
    if (!mediaType) return null
    return { data: readFileSync(file).toString('base64'), mediaType }
  }
}

const IS_POSIX = process.platform !== 'win32'

/** Chemins / URL file:// de médias cités dans un texte (Windows, absolus POSIX hors Windows, ou relatifs). */
export function findMediaPaths(text: string, posix = IS_POSIX): string[] {
  const ext = 'png|jpe?g|gif|webp|bmp|svg|mp4|webm|mov|m4v|wav|mp3|ogg|m4a|flac|opus|aac|glb|gltf|obj|stl|fbx|sqlite3?|db|csv|tsv|xlsx|pdf|docx|pptx'
  // Absolu POSIX (/Users/x/a.png) : pas au milieu d'un autre chemin ni d'une URL (https://…).
  const posixAlt = posix ? String.raw`|(?<![\w:.\/~-])\/[^\s"'<>|*?\`]+?` : ''
  const re = new RegExp(
    String.raw`(?:file:\/\/\/[^\s"'<>|]+?|[A-Za-z]:[\\/][^\s"'<>|*?\`]+?${posixAlt}|(?:\.{1,2}[\\/])?[\w\-.]+(?:[\\/][\w\-. ]+?)*)\.(?:${ext})(?![\w])`,
    'gi'
  )
  const out = new Set<string>()
  // Chemin absolu entre backticks : les espaces y sont permis (« Hilarious Knockout\… »).
  const quotedHead = posix ? String.raw`(?:[A-Za-z]:[\\/]|\/)` : String.raw`[A-Za-z]:[\\/]`
  const quoted = new RegExp(String.raw`\`(${quotedHead}[^\`\n]+?\.(?:${ext}))\``, 'gi')
  for (const m of text.matchAll(quoted)) out.add(m[1])
  for (const m of text.matchAll(re)) if (![...out].some((q) => q.endsWith(m[0]) && q !== m[0])) out.add(m[0].replace(/^[(\[`'"]+/, ''))
  return [...out]
}

/** JSON, JSONL ou journal qui mérite une carte (pas les fichiers de config que l'agent lit tout le temps). */
export function isDataFile(path: string): boolean {
  const p = path.replace(/\\/g, '/').toLowerCase()
  if (/\/(node_modules|\.git|\.vscode|\.idea|\.claude|\.canopy|dist|out|build)\//.test(p)) return false
  const name = p.split('/').pop() ?? ''
  if (/\.(jsonl|ndjson|log)$/.test(name)) return true
  if (!name.endsWith('.json')) return false
  return !/^(package(-lock)?|tsconfig.*|jsconfig|composer(-lock)?|manifest|launch|tasks|settings(\.local)?|components|vercel|netlify|turbo|lerna|nx|project|app|angular|deno|biome|renovate|\.?eslintrc|\.?prettierrc|\.?babelrc|.*\.config|.*-lock)\.json$/.test(name)
}

/** Fichiers de données lus par une commande (cat, type, Get-Content, tail, head, jq, less…). */
export function dataFilesInCommand(cmd: string): string[] {
  if (!/\b(cat|type|gc|get-content|tail|head|jq|less|more|bat)\b/i.test(cmd)) return []
  const out: string[] = []
  for (const m of cmd.matchAll(/(?:"([^"]+\.(?:json|jsonl|ndjson|log))"|'([^']+\.(?:json|jsonl|ndjson|log))'|([^\s"'|;&<>]+\.(?:json|jsonl|ndjson|log)))(?![\w.])/gi)) out.push(m[1] ?? m[2] ?? m[3])
  return out.filter(isDataFile)
}
