import { randomUUID } from 'node:crypto'
import { app, nativeImage, net, protocol } from 'electron'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MediaItem } from '../shared/types'

// Côté Electron : sert les médias du démon au renderer (atelier-media://), fabrique les miniatures,
// complète les dimensions. Seuls les médias annoncés par le démon sont servis.

export const SCHEME = 'atelier-media'

/** À appeler avant app.whenReady(). */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
  ])
}

export class MediaServer {
  private known = new Map<string, MediaItem>()
  /** Pages écrites par Claude pour la scène (outil scène, type html), servies sur atelier-media://scene/<id>. */
  private pages = new Map<string, string>()
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

  addPage(html: string): string {
    const id = randomUUID()
    this.pages.set(id, html)
    if (this.pages.size > 30) this.pages.delete(this.pages.keys().next().value!)
    return id
  }

  handleProtocol() {
    protocol.handle(SCHEME, async (req) => {
      const u = new URL(req.url)
      const id = u.pathname.replace(/^\//, '')
      if (u.host === 'scene') {
        const html = this.pages.get(id)
        if (html === undefined) return new Response('introuvable', { status: 404 })
        // Isolée : pas d'accès au réseau ni à Canopy ; scripts et styles en ligne autorisés, polices Google, images en data:.
        return new Response(wrapPage(html), {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src data: blob: https:; media-src data: blob:; connect-src 'none'"
          }
        })
      }
      // media/<id>/<nom> : un modèle 3D et ses fichiers voisins (textures d'un .gltf, .mtl d'un .obj), pris dans son dossier.
      const [mid, ...rest] = id.split('/')
      const m = this.known.get(mid)
      if (!m) return new Response('introuvable', { status: 404 })
      if (rest.length > 1 || (rest.length === 1 && decodeURIComponent(rest[0]) !== basename(m.file))) {
        if (m.kind !== 'model') return new Response('introuvable', { status: 404 })
        const dir = dirname(existsSync(m.path) ? m.path : m.file)
        const f = resolve(dir, decodeURIComponent(rest.join('/')))
        if (!f.toLowerCase().startsWith(dir.toLowerCase() + sep) || !existsSync(f)) return new Response('introuvable', { status: 404 })
        return withCors(await net.fetch(pathToFileURL(f).toString(), { headers: req.headers }))
      }
      const file = u.host === 'thumb' ? this.thumb(m) : m.file
      const res = await net.fetch(pathToFileURL(file).toString(), { headers: req.headers })
      return m.kind === 'model' ? withCors(res) : res
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

/** Fragment HTML de Claude : posé sur un fond et une typographie Canopy (sombre, comme la scène). Une page complète passe telle quelle. */
function wrapPage(html: string): string {
  if (/<html[\s>]/i.test(html)) return html
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>
html,body{margin:0;background:#1F1E1D;color:#E3E1D8;font:14px/1.5 'Segoe UI',system-ui,sans-serif}
body{padding:22px 24px}h1,h2,h3{font-family:Georgia,'Source Serif 4',serif;font-weight:400;color:#F5F4EE;margin:0 0 .5em}
a{color:#8BBCF5}:root{--clay:#D57151;--ivory:#FAF9F5;--slate:#141413;--muted:#8F8D86}
</style></head><body>${html}</body></html>`
}

/** Les modèles 3D sont lus par fetch() depuis la page (origine http://localhost en dev) : il faut l'en-tête CORS. */
function withCors(res: Response): Response {
  const h = new Headers(res.headers)
  h.set('access-control-allow-origin', '*')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h })
}
