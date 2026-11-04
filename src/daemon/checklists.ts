// Checklists : fichiers Markdown `<projet>/.canopy/checklists/*.md` (format décrit dans shared/checklist.ts).
// Le fichier est la source de vérité : on le relit à chaque appel, on le réécrit en préservant les lignes
// qu'on ne comprend pas (paragraphes, commentaires, clés de frontmatter inconnues).
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'node:fs'
import { join } from 'node:path'
import type { CheckItem, CheckState, CheckWho, Checklist, ChecklistOp, ChecklistSummary, ChecklistToolSummary } from '../shared/checklist'

const DIR = '.canopy/checklists'

type Change = NonNullable<ChecklistToolSummary['changes']>[number]
type Node = { k: 'raw'; line: string } | { k: 'section'; name: string } | { k: 'item'; item: CheckItem }
type Doc = { title: string; sessions: string[]; extra: string[]; nodes: Node[] }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const shortId = () => randomBytes(2).toString('hex')
const hashId = (text: string) => 'h:' + createHash('sha1').update(text).digest('hex').slice(0, 6)

const ITEM_RE = /^(\s*)- \[( |x|X)\] (.*?)(?:\s*<!--\s*(.*?)\s*-->)?\s*$/

function parseDoc(raw: string, fallbackTitle: string): Doc {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const doc: Doc = { title: fallbackTitle, sessions: [], extra: [], nodes: [] }
  let i = 0
  if (lines[0]?.trim() === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) {
      for (const l of lines.slice(1, end)) {
        const t = /^title:\s*(.*)$/.exec(l)
        const s = /^sessions:\s*\[(.*)\]\s*$/.exec(l)
        if (t) doc.title = t[1].trim() || fallbackTitle
        else if (s) doc.sessions = s[1].split(',').map((x) => x.trim()).filter(Boolean)
        else if (l.trim()) doc.extra.push(l)
      }
      i = end + 1
    }
  }
  const seen = new Set<string>()
  for (; i < lines.length; i++) {
    const line = lines[i]
    const sec = /^##\s+(.*?)\s*$/.exec(line)
    if (sec) {
      doc.nodes.push({ k: 'section', name: sec[1] })
      continue
    }
    const m = ITEM_RE.exec(line)
    if (!m) {
      doc.nodes.push({ k: 'raw', line })
      continue
    }
    const meta: Record<string, string> = {}
    for (const kv of (m[4] ?? '').matchAll(/(\w+):(\S+)/g)) meta[kv[1]] = kv[2]
    const text = m[3].trim()
    let id = meta.id || hashId(text)
    for (let n = 2; seen.has(id); n++) id = `${meta.id || hashId(text)}~${n}`
    seen.add(id)
    const at = meta.at ? Date.parse(meta.at) : NaN
    const done = m[2] !== ' '
    doc.nodes.push({
      k: 'item',
      item: {
        id,
        text,
        state: done ? 'done' : meta.state === 'work' ? 'work' : 'todo',
        ...(meta.by === 'claude' || meta.by === 'user' ? { by: meta.by as CheckWho } : {}),
        ...(Number.isFinite(at) ? { at } : {}),
        depth: m[1].length >= 2 ? 1 : 0
      }
    })
  }
  // Les lignes vides de fin ne sont pas du contenu.
  while (doc.nodes.length && doc.nodes[doc.nodes.length - 1].k === 'raw' && !(doc.nodes[doc.nodes.length - 1] as any).line.trim()) doc.nodes.pop()
  return doc
}

function serializeDoc(doc: Doc): string {
  const used = new Set(doc.nodes.flatMap((n) => (n.k === 'item' && !n.item.id.startsWith('h:') ? [n.item.id] : [])))
  const out = ['---', `title: ${doc.title}`, `sessions: [${doc.sessions.join(', ')}]`, ...doc.extra, '---']
  for (const n of doc.nodes) {
    if (n.k === 'raw') out.push(n.line)
    else if (n.k === 'section') out.push(`## ${n.name}`)
    else {
      const it = n.item
      if (it.id.startsWith('h:')) {
        let id = shortId()
        while (used.has(id)) id = shortId()
        used.add(id)
        it.id = id
      }
      const meta = [`id:${it.id}`, ...(it.state === 'work' ? ['state:work'] : []), ...(it.by ? [`by:${it.by}`] : []), ...(it.at ? [`at:${new Date(it.at).toISOString()}`] : [])]
      out.push(`${'  '.repeat(it.depth)}- [${it.state === 'done' ? 'x' : ' '}] ${it.text} <!-- ${meta.join(' ')} -->`)
    }
  }
  return out.join('\n') + '\n'
}

function items(doc: Doc): CheckItem[] {
  const list: CheckItem[] = []
  let section: string | undefined
  for (const n of doc.nodes) {
    if (n.k === 'section') section = n.name
    else if (n.k === 'item') list.push({ ...n.item, ...(section ? { section } : {}) })
  }
  return list
}

const itemIdx = (doc: Doc, id: string) => doc.nodes.findIndex((n) => n.k === 'item' && n.item.id === id)
/** Index qui suit l'élément et ses sous-éléments contigus. */
function blockEnd(doc: Doc, i: number): number {
  const first = doc.nodes[i] as { k: 'item'; item: CheckItem }
  let j = i + 1
  if (first.item.depth === 0) while (j < doc.nodes.length && doc.nodes[j].k === 'item' && (doc.nodes[j] as any).item.depth === 1) j++
  return j
}
/** Fin d'une section (avant le titre suivant), sans les lignes vides de queue. */
function sectionEnd(doc: Doc, from: number): number {
  let j = from
  while (j < doc.nodes.length && doc.nodes[j].k !== 'section') j++
  while (j > from && doc.nodes[j - 1].k === 'raw' && !(doc.nodes[j - 1] as any).line.trim()) j--
  return j
}

function applyOps(doc: Doc, ops: ChecklistOp[], by: CheckWho): Change[] {
  const changes: Change[] = []
  const now = Date.now()
  for (const op of ops) {
    if (op.op === 'title') doc.title = op.title.replace(/\s+/g, ' ').trim() || doc.title
    else if (op.op === 'link') {
      if (!doc.sessions.includes(op.sessionId)) doc.sessions.push(op.sessionId)
    } else if (op.op === 'unlink') doc.sessions = doc.sessions.filter((s) => s !== op.sessionId)
    else if (op.op === 'add') {
      const node: Node = { k: 'item', item: { id: shortId(), text: op.text.replace(/\s+/g, ' ').trim(), state: 'todo', by, at: now, depth: op.depth ?? 0 } }
      if (!node.item.text) continue
      let at = -1
      const a = op.afterId ? itemIdx(doc, op.afterId) : -1
      if (a >= 0) at = blockEnd(doc, a)
      else if (op.section) {
        const s = doc.nodes.findIndex((n) => n.k === 'section' && norm(n.name) === norm(op.section!))
        if (s >= 0) at = sectionEnd(doc, s + 1)
        else {
          at = sectionEnd(doc, doc.nodes.length)
          doc.nodes.splice(at, 0, { k: 'section', name: op.section })
          at++
        }
      } else at = sectionEnd(doc, doc.nodes.length)
      doc.nodes.splice(at, 0, node)
      changes.push({ text: node.item.text, change: 'added' })
    } else {
      const i = itemIdx(doc, op.itemId)
      if (i < 0) continue
      const it = (doc.nodes[i] as { k: 'item'; item: CheckItem }).item
      if (op.op === 'set') {
        if (it.state === op.state) continue
        it.state = op.state
        it.by = by
        it.at = now
        changes.push({ text: it.text, change: op.state === 'done' ? 'done' : op.state === 'work' ? 'work' : 'undone' })
      } else if (op.op === 'edit') {
        const t = op.text.replace(/\s+/g, ' ').trim()
        if (!t || t === it.text) continue
        it.text = t
        changes.push({ text: t, change: 'edited' })
      } else if (op.op === 'remove') {
        doc.nodes.splice(i, blockEnd(doc, i) - i)
        changes.push({ text: it.text, change: 'removed' })
      } else if (op.op === 'move') {
        const block = doc.nodes.splice(i, blockEnd(doc, i) - i)
        const b = op.beforeId && op.beforeId !== op.itemId ? itemIdx(doc, op.beforeId) : -1
        doc.nodes.splice(b >= 0 ? b : sectionEnd(doc, doc.nodes.length), 0, ...block)
      }
    }
  }
  return changes
}

export type ChecklistsApplyResult = { checklist: Checklist; changes: Change[] }

export class Checklists {
  private watchers = new Map<string, FSWatcher>()
  private own = new Map<string, number>()
  private pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  constructor(
    private projects: () => { id: string; path: string }[],
    /** Appelé après chaque écriture (nôtre ou externe) avec les ids concernés. */
    private onChange: (ids: string[]) => void
  ) {}

  private dir(path: string) {
    return join(path, '.canopy', 'checklists')
  }

  private locate(id: string): { projectId: string; root: string; file: string; rel: string } | null {
    const k = id.indexOf(':')
    if (k < 0) return null
    const projectId = id.slice(0, k)
    const rel = id.slice(k + 1)
    const p = this.projects().find((x) => x.id === projectId)
    if (!p || !rel.startsWith(DIR + '/') || rel.includes('..') || !rel.endsWith('.md')) return null
    return { projectId, root: p.path, file: join(p.path, ...rel.split('/')), rel }
  }

  private watch() {
    for (const p of this.projects()) {
      const d = this.dir(p.path)
      if (this.watchers.has(d) || !existsSync(d)) continue
      try {
        const w = watch(d, (_ev, name) => {
          if (!name || !String(name).endsWith('.md')) return
          const file = join(d, String(name))
          if ((this.own.get(file) ?? 0) > Date.now()) return
          this.pending.add(`${p.id}:${DIR}/${String(name)}`)
          if (this.timer) clearTimeout(this.timer)
          this.timer = setTimeout(() => {
            this.timer = null
            const ids = [...this.pending]
            this.pending.clear()
            if (ids.length) this.onChange(ids)
          }, 300)
        })
        w.on('error', () => {
          w.close()
          this.watchers.delete(d)
        })
        this.watchers.set(d, w)
      } catch (err) {
        console.error('[checklists] watch', d, err)
      }
    }
  }

  private read(id: string): { doc: Doc; checklist: Checklist } | null {
    const loc = this.locate(id)
    if (!loc) return null
    try {
      const raw = readFileSync(loc.file, 'utf8')
      const doc = parseDoc(raw, loc.rel.split('/').pop()!.replace(/\.md$/, ''))
      return {
        doc,
        checklist: { id, projectId: loc.projectId, path: loc.rel, title: doc.title, sessions: doc.sessions, items: items(doc), updatedAt: statSync(loc.file).mtimeMs }
      }
    } catch {
      return null
    }
  }

  private write(id: string, doc: Doc) {
    const loc = this.locate(id)!
    mkdirSync(join(loc.root, '.canopy', 'checklists'), { recursive: true })
    this.own.set(loc.file, Date.now() + 500)
    const tmp = loc.file + '.tmp'
    writeFileSync(tmp, serializeDoc(doc), 'utf8')
    renameSync(tmp, loc.file)
    this.watch()
    this.onChange([id])
  }

  list(): ChecklistSummary[] {
    this.watch()
    const out: ChecklistSummary[] = []
    for (const p of this.projects()) {
      let names: string[] = []
      try {
        names = readdirSync(this.dir(p.path)).filter((n) => n.endsWith('.md'))
      } catch {
        continue
      }
      for (const n of names) {
        const c = this.read(`${p.id}:${DIR}/${n}`)?.checklist
        if (!c) continue
        const { items: its, ...rest } = c
        out.push({ ...rest, total: its.length, done: its.filter((i) => i.state === 'done').length, working: its.filter((i) => i.state === 'work').length })
      }
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): Checklist | null {
    return this.read(id)?.checklist ?? null
  }

  create(projectId: string, title: string, texts: string[] = [], sessionId?: string): Checklist {
    const p = this.projects().find((x) => x.id === projectId)
    if (!p) throw new Error('Projet inconnu')
    const clean = title.replace(/\s+/g, ' ').trim() || 'Checklist'
    const base = norm(clean).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'checklist'
    let slug = base
    for (let n = 2; existsSync(join(this.dir(p.path), slug + '.md')); n++) slug = `${base}-${n}`
    const id = `${projectId}:${DIR}/${slug}.md`
    const doc: Doc = { title: clean, sessions: sessionId ? [sessionId] : [], extra: [], nodes: [] }
    const ops: ChecklistOp[] = texts.map((text) => ({ op: 'add', text }))
    applyOps(doc, ops, 'claude')
    for (const n of doc.nodes) if (n.k === 'item') delete n.item.by, delete n.item.at
    this.write(id, doc)
    return this.get(id)!
  }

  apply(id: string, ops: ChecklistOp[], by: CheckWho): ChecklistsApplyResult {
    const cur = this.read(id)
    if (!cur) throw new Error('Checklist introuvable')
    // Les ids « h:… » (lignes écrites à la main) sont recalculés à la lecture : les ops les retrouvent.
    const changes = applyOps(cur.doc, ops, by)
    this.write(id, cur.doc)
    return { checklist: this.get(id)!, changes }
  }

  remove(id: string) {
    const loc = this.locate(id)
    if (!loc) return
    try {
      this.own.set(loc.file, Date.now() + 500)
      unlinkSync(loc.file)
    } catch {
      /* déjà supprimé */
    }
    this.onChange([id])
  }
}

// ---------- outil MCP « checklist » ----------
export type ChecklistToolArgs = {
  action: 'list' | 'read' | 'create' | 'check' | 'uncheck' | 'work' | 'add' | 'edit' | 'remove' | 'link'
  checklist?: string
  title?: string
  items?: string[]
  item?: string
  text?: string
  section?: string
}

const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const counts = (c: { items: CheckItem[] }) => ({ done: c.items.filter((i) => i.state === 'done').length, total: c.items.length })
const STATE_MARK: Record<CheckState, string> = { todo: '[ ]', work: '[~]', done: '[x]' }

/** Checklist désignée par id ou titre (exact puis approximatif), projet donné d'abord. */
export function findChecklist(store: Checklists, projectId: string, q: string): ChecklistSummary | undefined {
  const all = store.list()
  const n = norm(q)
  for (const pool of [all.filter((c) => c.projectId === projectId), all]) {
    const hit = pool.find((c) => c.id === q) ?? pool.find((c) => norm(c.title) === n) ?? pool.find((c) => norm(c.title).includes(n) || n.includes(norm(c.title)))
    if (hit) return hit
  }
  return undefined
}

export function runChecklistTool(store: Checklists, ctx: { projectId: string; sdkSessionId?: string }, a: ChecklistToolArgs): { text: string; ok: boolean } {
  const fail = (text: string) => ({ text, ok: false })
  const head = (s: ChecklistToolSummary) => `<!--canopy-checklist ${JSON.stringify({ ...s, title: cut(s.title, 80), changes: s.changes?.slice(0, 8).map((c) => ({ ...c, text: cut(c.text, 80) })) })}-->`
  try {
    const all = store.list()
    const mine = all.filter((c) => c.projectId === ctx.projectId)

    if (a.action === 'list') {
      const lines = mine.map((c) => `- ${c.title} (id ${c.id}) : ${c.done}/${c.total}`)
      const s: ChecklistToolSummary = { id: '', title: 'Checklists du projet', done: mine.reduce((n, c) => n + c.done, 0), total: mine.reduce((n, c) => n + c.total, 0), action: 'list' }
      return { ok: true, text: `${head(s)}\n${lines.join('\n') || 'Aucune checklist dans ce projet.'}` }
    }

    if (a.action === 'create') {
      if (!a.title) return fail('create : title requis')
      const c = store.create(ctx.projectId, a.title, a.items ?? [], ctx.sdkSessionId)
      const s: ChecklistToolSummary = { id: c.id, title: c.title, ...counts(c), action: 'create', changes: c.items.slice(0, 8).map((i) => ({ text: i.text, change: 'added' as const })) }
      return { ok: true, text: `${head(s)}\nChecklist « ${c.title} » créée (id ${c.id}, ${c.items.length} éléments), liée à cette session.` }
    }

    // Résolution de la checklist : id, puis titre exact, puis titre approximatif ; projet de la session d'abord.
    let target: ChecklistSummary | undefined
    if (a.checklist) {
      const q = norm(a.checklist)
      for (const pool of [mine, all]) {
        target = pool.find((c) => c.id === a.checklist) ?? pool.find((c) => norm(c.title) === q) ?? pool.find((c) => norm(c.title).includes(q) || q.includes(norm(c.title)))
        if (target) break
      }
      if (!target) return fail(`Checklist introuvable : « ${a.checklist} ». Disponibles : ${mine.map((c) => c.title).join(', ') || 'aucune'}.`)
    } else if (mine.length === 1) target = mine[0]
    else return fail(`Précise « checklist » (id ou titre). Disponibles : ${mine.map((c) => c.title).join(', ') || 'aucune'}.`)

    const cur = store.get(target.id)
    if (!cur) return fail('Checklist illisible')

    const findItem = (q: string): CheckItem | string => {
      const n = norm(q)
      const hit = cur.items.find((i) => i.id === q) ?? cur.items.find((i) => norm(i.text) === n)
      if (hit) return hit
      const many = cur.items.filter((i) => norm(i.text).includes(n))
      if (many.length === 1) return many[0]
      return many.length ? `« ${q} » est ambigu : ${many.map((i) => `${i.id} « ${cut(i.text, 40)} »`).join(' ; ')}` : `Élément introuvable : « ${q} »`
    }
    const texts = [...(a.item ? [a.item] : []), ...(a.action === 'add' ? [] : (a.items ?? []))]
    const targets: CheckItem[] = []
    const needItems = ['check', 'uncheck', 'work', 'edit', 'remove'].includes(a.action)
    if (needItems) {
      if (!texts.length) return fail(`${a.action} : item requis`)
      for (const t of texts) {
        const r = findItem(t)
        if (typeof r === 'string') return fail(r)
        targets.push(r)
      }
    }

    let ops: ChecklistOp[] = []
    if (a.action === 'check') ops = targets.map((i) => ({ op: 'set', itemId: i.id, state: 'done' }))
    else if (a.action === 'uncheck') ops = targets.map((i) => ({ op: 'set', itemId: i.id, state: 'todo' }))
    else if (a.action === 'work') ops = targets.map((i) => ({ op: 'set', itemId: i.id, state: 'work' }))
    else if (a.action === 'remove') ops = targets.map((i) => ({ op: 'remove', itemId: i.id }))
    else if (a.action === 'edit') {
      if (!a.text) return fail('edit : text requis')
      ops = [{ op: 'edit', itemId: targets[0].id, text: a.text }]
    } else if (a.action === 'add') {
      const list = a.items ?? (a.text ? [a.text] : [])
      if (!list.length) return fail('add : items requis')
      ops = list.map((text) => ({ op: 'add', text, section: a.section }))
    } else if (a.action === 'link') {
      if (!ctx.sdkSessionId) return fail("Session pas encore identifiée, réessaie après le premier échange")
      ops = [{ op: 'link', sessionId: ctx.sdkSessionId }]
      if (a.title) ops.push({ op: 'title', title: a.title })
    }

    if (a.action === 'read') {
      const s: ChecklistToolSummary = { id: cur.id, title: cur.title, ...counts(cur), action: 'read' }
      const lines = cur.items.map((i, n) => `${n + 1}. ${'  '.repeat(i.depth)}${STATE_MARK[i.state]} ${i.text} (id ${i.id}${i.section ? `, section ${i.section}` : ''})`)
      return { ok: true, text: `${head(s)}\n${cur.title} — ${s.done}/${s.total} faits ([ ] à faire, [~] en cours, [x] fait)\n${lines.join('\n')}` }
    }

    const r = store.apply(cur.id, ops, 'claude')
    const s: ChecklistToolSummary = { id: r.checklist.id, title: r.checklist.title, ...counts(r.checklist), action: 'update', changes: r.changes }
    const detail = r.changes.map((c) => `- ${c.change} : ${c.text}`).join('\n')
    return { ok: true, text: `${head(s)}\n« ${s.title} » : ${s.done}/${s.total} faits.${detail ? '\n' + detail : '\nAucun changement.'}` }
  } catch (err: any) {
    return fail(`Erreur checklist : ${String(err?.message ?? err)}`)
  }
}
