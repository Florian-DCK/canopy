import { readFileSync } from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import type { DocInfo } from '../shared/types'

// Documents Office (planche 49) lus sans dépendance : un .docx/.pptx/.xlsx est un zip de XML.
// On en tire le texte, les titres, les diapositives et les feuilles (pour la carte, la visionneuse,
// et les feuilles Excel ouvertes comme des tables). Lecture seule.

/** Entrées d'un zip (répertoire central), décompressées à la demande. */
function unzip(buf: Buffer): Map<string, () => Buffer> {
  const out = new Map<string, () => Buffer>()
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  if (eocd < 0) throw new Error('Fichier Office illisible (zip).')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10)
    const size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extra = buf.readUInt16LE(p + 30)
    const comment = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    out.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      return method === 8 ? inflateRawSync(data) : Buffer.from(data)
    })
    p += 46 + nameLen + extra + comment
  }
  return out
}

const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, c) => String.fromCodePoint(+c)).replace(/&amp;/g, '&')
const xml = (z: Map<string, () => Buffer>, name: string) => z.get(name)?.().toString('utf8') ?? ''
const num = (s: string, tag: string) => Number(new RegExp(`<${tag}>(\\d+)</${tag}>`).exec(s)?.[1]) || undefined
const byNum = (a: string, b: string) => Number(/(\d+)\.xml$/.exec(a)?.[1]) - Number(/(\d+)\.xml$/.exec(b)?.[1])

export function officeKind(file: string): DocInfo['type'] | null {
  const e = file.toLowerCase().split('.').pop()
  return e === 'pdf' ? 'pdf' : e === 'docx' ? 'word' : e === 'pptx' ? 'powerpoint' : e === 'xlsx' ? 'excel' : null
}

export function readOffice(file: string): DocInfo {
  const type = officeKind(file)!
  const z = unzip(readFileSync(file))
  const app = xml(z, 'docProps/app.xml')
  const title = decode(/<dc:title>([^<]*)<\/dc:title>/.exec(xml(z, 'docProps/core.xml'))?.[1] ?? '') || undefined

  if (type === 'word') {
    const doc = xml(z, 'word/document.xml')
    const paras = [...doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => {
      const style = /<w:pStyle w:val="([^"]+)"/.exec(m[0])?.[1] ?? ''
      const text = decode([...m[0].matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(''))
      const level = /^(Heading|Titre|berschrift)(\d)$/i.exec(style)?.[2] ?? (/^Title$|^Titre$/i.test(style) ? '0' : undefined)
      return { text, level: level !== undefined ? Number(level) : undefined }
    }).filter((p) => p.text.trim())
    const text = paras.map((p) => p.text).join('\n')
    return {
      type,
      title,
      pages: num(app, 'Pages'),
      words: num(app, 'Words') ?? (text.match(/\S+/g)?.length || undefined),
      comments: (xml(z, 'word/comments.xml').match(/<w:comment /g) ?? []).length || undefined,
      headings: paras.filter((p) => p.level !== undefined).map((p) => ({ level: p.level!, text: p.text })).slice(0, 80),
      text: text.slice(0, 200000)
    }
  }

  if (type === 'powerpoint') {
    const slides = [...z.keys()].filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k)).sort(byNum)
    return {
      type,
      title,
      pages: slides.length,
      slides: slides.map((k) => {
        const s = xml(z, k)
        const texts = [...s.matchAll(/<a:p>[\s\S]*?<\/a:p>/g)].map((p) => decode([...p[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(''))).filter((t) => t.trim())
        // Notes : seulement la zone de texte du corps (pas le numéro de diapositive ni l'image).
        const noteXml = [...xml(z, k.replace('slides/slide', 'notesSlides/notesSlide')).matchAll(/<p:sp>[\s\S]*?<\/p:sp>/g)].map((m) => m[0]).filter((sp) => /<p:ph [^>]*type="body"/.test(sp)).join('')
        const notes = decode([...noteXml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((t) => t[1]).join(' '))
        return { title: texts[0] ?? '', text: texts.slice(1).join('\n'), notes: notes.trim() || undefined }
      })
    }
  }

  if (type === 'excel') {
    const sheets = readSheets(file, z, 0)
    return { type, title, sheets: sheets.map((s) => ({ name: s.name, rows: s.rows.length, cols: s.rows[0]?.length ?? 0 })) }
  }
  return { type, title }
}

/** Feuilles Excel en lignes de cellules (valeurs calculées en cache, chaînes partagées). maxRows = 0 : toutes. */
export function readSheets(file: string, z0?: Map<string, () => Buffer>, maxRows = 0): { name: string; rows: (string | number | null)[][] }[] {
  const z = z0 ?? unzip(readFileSync(file))
  const shared = [...xml(z, 'xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => decode([...m[1].matchAll(/<t(?: [^>]*)?>([^<]*)<\/t>/g)].map((t) => t[1]).join('')))
  const rels = new Map([...xml(z, 'xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2].replace(/^\/?(xl\/)?/, 'xl/')]))
  const col = (ref: string) => [...(/^[A-Z]+/.exec(ref)?.[0] ?? 'A')].reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1
  return [...xml(z, 'xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map((m) => {
    const src = xml(z, rels.get(m[2]) ?? '')
    const rows: (string | number | null)[][] = []
    for (const r of src.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: (string | number | null)[] = []
      for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const t = /t="(\w+)"/.exec(c[2])?.[1]
        const v = /<v>([^<]*)<\/v>/.exec(c[3] ?? '')?.[1]
        const inline = /<is>[\s\S]*?<t[^>]*>([^<]*)<\/t>/.exec(c[3] ?? '')?.[1]
        row[col(c[1])] = t === 's' ? shared[Number(v)] ?? null : t === 'inlineStr' ? decode(inline ?? '') : t === 'str' || t === 'b' || t === 'e' ? (v === undefined ? null : decode(v)) : v === undefined ? null : Number(v)
      }
      rows.push(Array.from(row, (x) => (x === undefined ? null : x)))
      if (maxRows && rows.length >= maxRows) break
    }
    return { name: decode(m[1]), rows }
  })
}
