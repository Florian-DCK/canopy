import { app, nativeImage, net, protocol } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MediaItem } from '../shared/types'

// Côté Electron : sert les médias du démon au renderer (atelier-media://), fabrique les miniatures,
// complète les dimensions. Seuls les médias annoncés par le démon sont servis.

export const SCHEME = 'atelier-media'

/** À appeler avant app.whenReady(). */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

export class MediaServer {
  private known = new Map<string, MediaItem>()
  private thumbs = join(app.getPath('userData'), 'media-cache', 'thumbs')

  constructor() {
    mkdirSync(this.thumbs, { recursive: true })
  }

  /** Enregistre un média et complète largeur/hauteur pour les images. */
  register(m: MediaItem): MediaItem {
    if (m.kind === 'image' && m.width === undefined) {
      const img = nativeImage.createFromPath(m.file)
      if (!img.isEmpty()) {
        const s = img.getSize()
        m = { ...m, width: s.width, height: s.height }
      }
    }
    this.known.set(m.id, m)
    return m
  }

  /** Fichier d'origine s'il existe encore, sinon la copie en cache. */
  fileOf(id: string): string | undefined {
    const m = this.known.get(id)
    if (!m) return undefined
    return existsSync(m.path) ? m.path : m.file
  }

  handleProtocol() {
    protocol.handle(SCHEME, async (req) => {
      const u = new URL(req.url)
      const id = u.pathname.replace(/^\//, '')
      const m = this.known.get(id)
      if (!m) return new Response('introuvable', { status: 404 })
      const file = u.host === 'thumb' ? this.thumb(m) : m.file
      return net.fetch(pathToFileURL(file).toString(), { headers: req.headers })
    })
  }

  private thumb(m: MediaItem): string {
    const lower = m.file.toLowerCase()
    if (m.kind !== 'image' || lower.endsWith('.svg') || lower.endsWith('.gif')) return m.file
    const out = join(this.thumbs, `${m.id}.jpg`)
    if (!existsSync(out)) {
      const img = nativeImage.createFromPath(m.file)
      if (img.isEmpty()) return m.file
      writeFileSync(out, (img.getSize().width > 480 ? img.resize({ width: 480, quality: 'good' }) : img).toJPEG(82))
    }
    return out
  }
}
