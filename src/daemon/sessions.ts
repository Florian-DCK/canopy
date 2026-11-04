import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import type { ActParams,
  AppEvent,
  ArtifactRef,
  Attachment,
  CaptureParams,
  CaptureResult,
  ExternalSession,
  FileDiff,
  MediaItem,
  HistoryEntry,
  AskQuestion,
  Item,
  PermissionDecision,
  PermissionModeUI,
  QuestionAnswer,
  SessionMeta,
  ToolsInventory
} from '../shared/types'
import type { BrowserParams, BrowserResult } from '../shared/browser'
import type { UiParams, UiResult } from '../shared/ui'
import type { SceneBlock } from '../shared/scene'
import { findMediaPaths, type MediaStore } from './media'
import { z } from 'zod'
import { findChecklist, runChecklistTool, type Checklists, type ChecklistToolArgs } from './checklists'
import { HARNESS } from './harness'
import { defaultPermissionMode, getProject } from './projects'
import { disabledMcp, disabledSkills, setMcpDisabled } from './tooling'
import { ownSessions, rememberOwnSession } from './own'

// Le SDK est ESM-only : import dynamique depuis le main (CJS).
type Sdk = typeof import('@anthropic-ai/claude-agent-sdk')
let sdkPromise: Promise<Sdk> | null = null
export const loadSdk = () => (sdkPromise ??= import('@anthropic-ai/claude-agent-sdk'))

type Emit = (e: AppEvent) => void

/** File d'attente des messages du composer, consommée par query() (streaming input). */
type Content = string | unknown[]

class InputQueue {
  private buf: Content[] = []
  private waiter: ((v: IteratorResult<unknown>) => void) | null = null
  private closed = false

  push(content: Content) {
    const msg = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }
    if (this.waiter) {
      this.waiter({ value: msg, done: false })
      this.waiter = null
    } else this.buf.push(content)
  }

  close() {
    this.closed = true
    this.waiter?.({ value: undefined, done: true })
    this.waiter = null
  }

  [Symbol.asyncIterator]() {
    return {
      next: (): Promise<IteratorResult<any>> => {
        const content = this.buf.shift()
        if (content !== undefined)
          return Promise.resolve({
            value: { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null },
            done: false
          })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((r) => (this.waiter = r))
      }
    }
  }
}

type Pending = {
  resolve: (r: any) => void
  suggestions?: unknown[]
  input: Record<string, unknown>
  /** Question bloquante (AskUserQuestion) plutôt qu'autorisation. */
  question?: true
}

/** Questions telles qu'envoyées par Claude, ramenées à une forme sûre pour l'affichage. */
function normalizeQuestions(raw: unknown): AskQuestion[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 4).map((q: any) => ({
    question: String(q?.question ?? ''),
    header: String(q?.header ?? '').slice(0, 24),
    multiSelect: !!q?.multiSelect,
    options: (Array.isArray(q?.options) ? q.options : []).slice(0, 4).map((o: any) => ({
      label: String(o?.label ?? ''),
      description: String(o?.description ?? ''),
      ...(typeof o?.preview === 'string' && o.preview ? { preview: o.preview } : {})
    }))
  }))
}

/** Question sans attente encore ouverte : Claude continue ; sans choix par défaut, il attendra en fin de tour. */
type OpenAsk = { questions: AskQuestion[]; fallback?: string; waiting: boolean }

type Live = {
  /** Questions sans attente en cours (id de l'élément du fil → question). */
  asks?: Map<string, OpenAsk>
  meta: SessionMeta
  input: InputQueue
  query?: any
  started: boolean
  pending: Map<string, Pending>
  tools: Map<string, { name: string; parent: string | null; input?: any }>
  mentioned: Set<string>
  toolsDone: Set<string>
  /** Reprise en copie (forkSession) : nouvelle conversation qui part de l'historique. */
  fork?: boolean
  /** Rejeu d'un transcript : les éléments s'accumulent ici puis partent en un seul événement. */
  buffer?: Item[]
  bufferedPatch?: Partial<SessionMeta>
  /** Outils appelés depuis le début du tour (pour la ligne « Terminé »). */
  turnTools?: number
  /** Tâches vues par le SDK (début, libellé) et celles passées en arrière-plan (elles auront une carte de fin). */
  taskInfo?: Map<string, { at: number; label: string; toolUseId?: string }>
  bgSeen?: Set<string>
  /** Fichier de sortie de chaque carte « tâche terminée » (id de l'élément → chemin). */
  taskOutputs?: Map<string, string>
  /** Texte de l'agent principal en cours d'écriture (flux token par token). */
  draft?: { id: string; text: string; timer?: NodeJS.Timeout }
}

const short = (s: string, n = 140) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const rel = (p: string, root: string) =>
  p.toLowerCase().startsWith(root.toLowerCase()) ? p.slice(root.length).replace(/^[\\/]/, '') : p

function summarize(name: string, input: any, root: string): string {
  if (!input) return ''
  if (input.file_path) return rel(String(input.file_path), root)
  if (input.command) return short(String(input.command))
  if (input.pattern) return short(String(input.pattern)) + (input.path ? ` · ${rel(String(input.path), root)}` : '')
  if (input.url) return short(String(input.url))
  if (input.query) return short(String(input.query))
  if (input.description) return short(String(input.description))
  if (name === 'TodoWrite' && Array.isArray(input.todos)) return `${input.todos.length} étapes`
  return short(JSON.stringify(input))
}

function diffOf(name: string, input: any, root: string): FileDiff | undefined {
  if (!input?.file_path) return undefined
  const path = rel(String(input.file_path), root)
  const lines: FileDiff['lines'] = []
  const add = (t: '+' | '-', s: string) => s.split('\n').forEach((l) => lines.push({ t, s: l }))
  if (name === 'Write' && typeof input.content === 'string') add('+', input.content)
  else if (name === 'Edit') {
    add('-', String(input.old_string ?? ''))
    add('+', String(input.new_string ?? ''))
  } else if (name === 'MultiEdit' && Array.isArray(input.edits)) {
    for (const e of input.edits) {
      add('-', String(e.old_string ?? ''))
      add('+', String(e.new_string ?? ''))
    }
  } else return undefined
  return {
    path,
    added: lines.filter((l) => l.t === '+').length,
    removed: lines.filter((l) => l.t === '-').length,
    lines: lines.slice(0, 400)
  }
}

const norm = (p: string) => p.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()

/** Projet dont le dossier contient `cwd` (le plus spécifique gagne). */
export function matchProject<P extends { path: string }>(cwd: string | undefined, projects: P[]): P | undefined {
  if (!cwd) return undefined
  const c = norm(cwd)
  return projects
    .filter((p) => c === norm(p.path) || c.startsWith(norm(p.path) + '\\'))
    .sort((a, b) => b.path.length - a.path.length)[0]
}

const titleOf = (h: { customTitle?: string; summary?: string; firstPrompt?: string }) =>
  short((h.customTitle || h.summary || h.firstPrompt || 'Session sans titre').replace(/\s+/g, ' '), 90)

/** Publication d'un artefact claude.ai (outil Artifact) : URL, version et titre lus dans le résultat. */
function artifactOf(tool: { name: string; input?: any } | undefined, text: string): { artifact?: ArtifactRef } {
  if (tool?.name !== 'Artifact') return {}
  const action = tool.input?.action ?? 'publish'
  if (action !== 'publish' || tool.input?.asset) return {}
  const m = /(Created a new Artifact at|Updated the Artifact at)\s+(https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+)/.exec(text)
  if (!m) return {}
  const version = Number(/\(Version (\d+)/.exec(text)?.[1]) || undefined
  const title = tool.input?.title ? String(tool.input.title) : undefined
  return { artifact: { url: m[2], version, title, created: m[1].startsWith('Created') } }
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content))
    return content.map((c: any) => (c?.type === 'text' ? c.text : '')).join('\n')
  return ''
}

export class SessionManager {
  private sessions = new Map<string, Live>()

  constructor(private emit: Emit, private media: MediaStore) {}

  /** Branché par le démon : demande une capture à la fenêtre Electron connectée. */
  capture?: (sessionId: string, p: CaptureParams) => Promise<CaptureResult>
  /** Branché par le démon : action de Claude dans le navigateur intégré. */
  browser?: (sessionId: string, p: BrowserParams) => Promise<BrowserResult>
  /** Branché par le démon : action de Claude sur l'interface de Canopy. */
  ui?: (sessionId: string, p: UiParams) => Promise<UiResult>
  /** Branché par le démon : stockage des checklists du projet. */
  checklists?: Checklists

  /** Serveur MCP en mémoire : l'outil « capture » pour que l'agent voie l'interface de Canopy. */
  private atelierMcp(s: Live, createSdkMcpServer: any, tool: any) {
    const capture = tool(
      'capture',
      "Photographie l'interface de Canopy pour vérifier un rendu. mode « hidden » (défaut) : rend la vue dans une fenêtre invisible, sans déranger l'utilisateur ; « current » : copie la fenêtre qu'il a sous les yeux. view : session (défaut, celle-ci sauf sessionId), cockpit, history, projects, tiles (vue Mosaïque), tools (Outils de Claude). theme light|dark, width/height en px, selector pour recadrer sur un élément, inspect pour relever les styles calculés et le texte d'un élément.",
      {
        mode: z.enum(['hidden', 'current']).optional(),
        view: z.enum(['session', 'cockpit', 'history', 'projects', 'tiles', 'tools']).optional(),
        sessionId: z.string().optional(),
        theme: z.enum(['light', 'dark']).optional(),
        width: z.number().int().min(320).max(2560).optional(),
        height: z.number().int().min(240).max(1600).optional(),
        selector: z.string().optional(),
        inspect: z.string().optional(),
        panels: z.enum(['open', 'closed']).optional(),
        tab: z.enum(['session', 'art']).optional()
      },
      async (args: CaptureParams) => {
        const r = await this.capture!(s.meta.id, { ...args, sessionId: args.sessionId ?? (args.view && args.view !== 'session' ? undefined : s.meta.id) })
        return {
          content: [...(r.image ? [{ type: 'image', data: r.image, mimeType: 'image/jpeg' }] : []), { type: 'text', text: r.info }],
          isError: !r.ok
        }
      }
    )
    const browser = tool(
      'browser',
      "Pilote le navigateur intégré de Canopy (onglet de la session, visible par l'utilisateur). open : charge une adresse (device : desktop, tablet 820 px, mobile 390 px). capture : image de la page ou d'un élément (selector). read : texte de la page, ou styles et texte d'un élément. console : erreurs et avertissements depuis le chargement. click / type : agir sur un élément. remarks : liste des remarques posées par l'utilisateur (numéro, état, élément, texte). mark : changer l'état d'une remarque (work quand tu la traites, done quand tu as vérifié sur la page). Préfère ce navigateur à Playwright ou à l'extension Chrome pour l'app du projet.",
      {
        action: z.enum(['open', 'capture', 'read', 'console', 'click', 'type', 'remarks', 'mark']),
        url: z.string().optional(),
        device: z.enum(['desktop', 'tablet', 'mobile']).optional(),
        selector: z.string().optional(),
        text: z.string().optional(),
        remark: z.number().int().optional(),
        state: z.enum(['new', 'sent', 'work', 'done']).optional()
      },
      async (args: BrowserParams) => {
        if (!this.browser) return { content: [{ type: 'text', text: "Navigateur indisponible (Canopy n'est pas ouvert)" }], isError: true }
        const r = await this.browser(s.meta.id, args)
        return {
          content: [{ type: 'text', text: r.text }, ...(r.image ? [{ type: 'image', data: r.image, mimeType: 'image/png' }] : [])],
          isError: !r.ok
        }
      }
    )
    const checklist = tool(
      'checklist',
      "Checklists du projet : documents durables (fichiers .canopy/checklists/*.md) que l'utilisateur voit et coche dans Canopy. À utiliser pour suivre une liste d'idées, une recette, une feuille de route ; différent de TodoWrite (brouillon du tour). list : checklists du projet. read : éléments numérotés avec état et id. create (title, items) : crée et lie à cette session. check / uncheck / work : cocher, décocher, marquer en cours (item = id ou texte approximatif ; items pour plusieurs). add (items, section?) : ajouter. edit (item, text) : reformuler. remove (item). link : lier cette session. checklist = id ou titre approximatif (projet de la session d'abord).",
      {
        action: z.enum(['list', 'read', 'create', 'check', 'uncheck', 'work', 'add', 'edit', 'remove', 'link']),
        checklist: z.string().optional(),
        title: z.string().optional(),
        items: z.array(z.string()).optional(),
        item: z.string().optional(),
        text: z.string().optional(),
        section: z.string().optional()
      },
      async (args: ChecklistToolArgs) => {
        if (!this.checklists) return { content: [{ type: 'text', text: 'Checklists indisponibles' }], isError: true }
        const r = runChecklistTool(this.checklists, { projectId: s.meta.projectId, sdkSessionId: s.meta.sdkSessionId }, args)
        return { content: [{ type: 'text', text: r.text }], isError: !r.ok }
      }
    )
    const question = tool(
      'question',
      "Pose une question à l'utilisateur SANS attendre sa réponse : tu continues ton travail pendant qu'il réfléchit. Pour une préférence qui s'ajuste après coup (libellé, langue, couleur, option par défaut). Si la réponse change ce que tu vas faire ensuite ou si c'est difficile à défaire, utilise plutôt AskUserQuestion (bloquant). fallback : le libellé de l'option que tu suis sans réponse ; sans fallback, tu mets de côté ce qui dépend de la réponse et tu avances sur le reste. La réponse t'arrive plus tard comme un message de l'utilisateur ; si elle diffère de ton fallback, ajuste ce que tu as déjà fait.",
      {
        question: z.string(),
        header: z.string().optional(),
        options: z.array(z.object({ label: z.string(), description: z.string() })).min(2).max(4),
        multiSelect: z.boolean().optional(),
        fallback: z.string().optional()
      },
      async (args: { question: string; header?: string; options: { label: string; description: string }[]; multiSelect?: boolean; fallback?: string }) => {
        const questions = normalizeQuestions([args])
        const fallback = args.fallback?.trim() || undefined
        const itemId = randomUUID()
        ;(s.asks ??= new Map()).set(itemId, { questions, fallback, waiting: false })
        this.add(s, { id: itemId, kind: 'question', parent: null, questions, blocking: false, mode: 'async', ...(fallback ? { fallback } : {}), state: 'pending', at: Date.now() })
        const next = fallback
          ? `Continue avec « ${fallback} ». Si l'utilisateur choisit autre chose, sa réponse t'arrivera comme un message : ajuste alors ce que tu as fait.`
          : "Avance sur ce qui ne dépend pas de la réponse ; elle t'arrivera comme un message. Si tu n'as plus rien d'autre à faire, termine ton tour : l'utilisateur sera prévenu et ta question deviendra bloquante."
        return { content: [{ type: 'text', text: `Question posée sans attendre. ${next}` }] }
      }
    )
    const ui = tool(
      'interface',
      "Agit sur ce que l'utilisateur voit dans Canopy : c'est le geste qui répond, pas une phrase. show : affiche une vue (target : session, cockpit, tiles = Mosaïque, tools = Outils de Claude, history, projects, checklist (+ checklist = id ou titre ; sans = toutes), artifact (+ url), browser = navigateur intégré de la session, voice = revenir au grand soleil du mode voix). panel : ouvre ou ferme le panneau de travail de la session (state open|closed, tab lists|files|media|ctx). highlight : fait défiler jusqu'à un élément (selector CSS) et le surligne quelques secondes. scroll : haut ou bas de la conversation (to top|bottom) ou jusqu'à un selector. back : revient à la vue précédente. Quand l'utilisateur demande de montrer, ouvrir ou afficher quelque chose, fais-le avec cet outil et ne le décris pas ensuite : un petit son lui confirme le geste. Rien d'irréversible ici.",
      {
        action: z.enum(['show', 'panel', 'highlight', 'scroll', 'back']),
        target: z.enum(['session', 'cockpit', 'tiles', 'tools', 'history', 'projects', 'checklist', 'artifact', 'browser', 'voice']).optional(),
        sessionId: z.string().optional(),
        checklist: z.string().optional(),
        url: z.string().optional(),
        state: z.enum(['open', 'closed']).optional(),
        tab: z.enum(['lists', 'files', 'media', 'ctx']).optional(),
        selector: z.string().optional(),
        to: z.enum(['top', 'bottom']).optional()
      },
      async ({ checklist: q, ...args }: UiParams & { checklist?: string }) => {
        if (!this.ui) return { content: [{ type: 'text', text: "Interface indisponible (Canopy n'est pas ouvert)" }], isError: true }
        const p: UiParams = { ...args }
        if (args.action === 'show' && args.target === 'checklist' && q) {
          const c = this.checklists ? findChecklist(this.checklists, s.meta.projectId, q) : undefined
          if (!c) return { content: [{ type: 'text', text: `Checklist introuvable : « ${q} ».` }], isError: true }
          p.checklistId = c.id
        }
        const r = await this.ui(s.meta.id, p)
        return { content: [{ type: 'text', text: r.text }], isError: !r.ok }
      }
    )
    const scene = tool(
      'scene',
      "Mode voix : pose à droite du soleil un bloc visuel qui illustre ce que tu dis. Ce qui est montré reste à l'écran jusqu'à ce qu'autre chose le remplace ; type clear (title vide) le retire, quand l'utilisateur le demande ou que ce n'est plus utile. Choisis la forme qui sert le propos. bar : comparer quelques valeurs (items label + value). line : une évolution (items dans l'ordre). donut : une part d'un tout (items label + value, center = texte au milieu). kpi : 2 ou 3 chiffres qui comptent (items label + display + note). before_after : l'effet d'un changement (items[0] = avant, items[1] = après, avec value, display, note). list : peu de résultats, une ligne chacun (items label + status ok|ko|warn + note). table : plusieurs colonnes (columns + rows). gauge : un score d'abord puis ce qui casse (value, max, items = problèmes). plan : des étapes (items label + status done|work|todo). html : une page libre que tu écris (html = fragment ou page complète, CSS et JS en ligne, polices Google et bibliothèques cdnjs/jsdelivr permises, pas de réseau ; height en px, 420 par défaut) pour tout ce que les blocs ne savent pas montrer : maquette, schéma animé, petit outil, mise en page. Fond sombre Canopy par défaut (variables --clay, --ivory, --slate, --muted). display = valeur lisible (« 1,4 s ») ; unit = unité des value. Les images, fichiers modifiés et artefacts du tour s'affichent déjà seuls : pas besoin de scène pour eux. Ne décris pas le bloc à voix haute, commente seulement ce qu'il montre.",
      {
        type: z.enum(['clear', 'html', 'bar', 'line', 'donut', 'kpi', 'before_after', 'list', 'table', 'gauge', 'plan']),
        title: z.string(),
        subtitle: z.string().optional(),
        unit: z.string().optional(),
        items: z.array(z.object({ label: z.string(), value: z.number().optional(), display: z.string().optional(), status: z.enum(['ok', 'ko', 'warn', 'done', 'work', 'todo']).optional(), note: z.string().optional() })).optional(),
        columns: z.array(z.string()).optional(),
        rows: z.array(z.array(z.string())).optional(),
        value: z.number().optional(),
        max: z.number().optional(),
        center: z.string().optional(),
        html: z.string().optional(),
        height: z.number().int().min(120).max(900).optional()
      },
      async (block: SceneBlock) => {
        if (!this.ui) return { content: [{ type: 'text', text: "Interface indisponible (Canopy n'est pas ouvert)" }], isError: true }
        const r = await this.ui(s.meta.id, { action: 'scene', scene: block })
        return { content: [{ type: 'text', text: r.text }], isError: !r.ok }
      }
    )
    const screenTool = tool(
      'screen',
      "Regarde l'écran de l'utilisateur, hors de Canopy : what « screen » (défaut) = l'écran où se trouve sa souris, « window » = seulement la fenêtre active. Donne aussi le titre de la fenêtre active. À utiliser quand il parle de ce qu'il a sous les yeux (« regarde », « tu vois ce menu ? », « qu'est-ce que tu en penses ? ») ; jamais par simple curiosité. La bulle du mode compagnon affiche un œil à chaque capture.",
      { what: z.enum(['screen', 'window']).optional() },
      async ({ what }: { what?: 'screen' | 'window' }) => {
        if (!this.capture) return { content: [{ type: 'text', text: "Canopy n'est pas ouvert." }], isError: true }
        const r = await this.capture(s.meta.id, { desktop: what ?? 'screen' })
        return {
          content: [...(r.image ? [{ type: 'image', data: r.image, mimeType: 'image/jpeg' }] : []), { type: 'text', text: r.info }],
          isError: !r.ok
        }
      }
    )
    const actTool = tool(
      'act',
      "Agit sur l'écran de l'utilisateur (hors de Canopy), à sa demande explicite. find : liste les éléments visibles de la fenêtre active (type · nom · position) ; commence par là. invoke : déclenche un élément par son nom (target, et kind pour départager : Button, MenuItem, Hyperlink, TabItem…) — bouton, menu, lien, case. type : écrit text (dans target s'il est donné, sinon là où est le curseur). key : touches (keys, ex. « ctrl+l », « enter », « win », « alt+tab »). click : en dernier recours, clic en x,y (points de la capture de mcp__atelier__screen). look : joint une capture après le geste pour vérifier. Sa main (un autocollant argile) glisse à l'écran avant chaque geste. AVANT tout geste qui ne se défait pas (envoyer, supprimer, payer, publier, valider un achat ou un formulaire), demande et attends son « oui ». Si l'application a une voie directe plus fiable (API, connecteur Gmail, glab), préfère-la et dis-le.",
      {
        action: z.enum(['find', 'invoke', 'click', 'type', 'key']),
        target: z.string().optional(),
        kind: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        text: z.string().optional(),
        append: z.boolean().optional(),
        keys: z.string().optional(),
        look: z.boolean().optional()
      },
      async (args: ActParams) => {
        if (!this.capture) return { content: [{ type: 'text', text: "Canopy n'est pas ouvert." }], isError: true }
        const r = await this.capture(s.meta.id, { act: args })
        return {
          content: [...(r.image ? [{ type: 'image', data: r.image, mimeType: 'image/jpeg' }] : []), { type: 'text', text: r.info }],
          isError: !r.ok
        }
      }
    )
    return createSdkMcpServer({ name: 'atelier', version: '1.0.0', tools: [capture, browser, checklist, question, ui, scene, screenTool, actTool] })
  }

  private emitMedia(m: MediaItem | null) {
    if (m) this.emit({ type: 'media:add', media: m })
  }

  /** Images base64 dans un tool_result (Read d'une image, capture Playwright…). */
  private mediaFromToolResult(s: Live, toolUseId: string, content: unknown) {
    if (!Array.isArray(content)) return
    const tool = s.tools.get(toolUseId)
    const name = tool?.name ?? ''
    const isRead = name === 'Read'
    const source = isRead ? 'read' : /screenshot|snapshot|browser|playwright/i.test(name) ? 'screenshot' : 'tool'
    for (const b of content as any[]) {
      if (b?.type !== 'image' || b.source?.type !== 'base64') continue
      // Un fichier lu ne doit pas réapparaître comme « cité » quand l'agent en parle ensuite.
      if (isRead && tool?.input?.file_path) {
        const p = String(tool.input.file_path)
        s.mentioned.add(p.toLowerCase())
        s.mentioned.add(p.split(/[\\/]/).pop()!.toLowerCase())
      }
      this.emitMedia(
        this.media.fromBase64(b.source.data, b.source.media_type, {
          sessionId: s.meta.id,
          itemId: toolUseId,
          source,
          path: isRead && tool?.input?.file_path ? String(tool.input.file_path) : undefined,
          name: isRead ? undefined : `${name.replace(/^mcp__[^_]+(__)?/, '') || 'capture'}.png`
        })
      )
    }
  }

  /** Fichiers image/vidéo cités dans un texte de l'agent (une fois par session et par chemin). */
  private mediaFromText(s: Live, itemId: string, text: string, root: string) {
    for (const p of findMediaPaths(text)) {
      const key = p.toLowerCase()
      if (s.mentioned.has(key) || s.mentioned.has(key.split(/[\\/]/).pop()!)) continue
      const m = this.media.fromPath(p, root, { sessionId: s.meta.id, itemId })
      if (m && s.mentioned.has(m.path.toLowerCase())) continue
      if (m) {
        s.mentioned.add(key)
        s.mentioned.add(m.path.toLowerCase())
        this.emitMedia(m)
      }
    }
  }

  list(): SessionMeta[] {
    return [...this.sessions.values()].map((s) => s.meta)
  }

  create(projectId: string, model?: string, extra?: Partial<SessionMeta>): SessionMeta {
    const project = getProject(projectId)
    if (!project) throw new Error('Projet inconnu')
    const now = Date.now()
    const meta: SessionMeta = {
      id: randomUUID(),
      projectId,
      title: 'Nouvelle session',
      status: 'idle',
      modelChoice: model,
      permissionMode: defaultPermissionMode(project.path),
      startedAt: now,
      updatedAt: now,
      ...extra
    }
    this.sessions.set(meta.id, { meta, input: new InputQueue(), started: false, pending: new Map(), tools: new Map(), toolsDone: new Set(), mentioned: new Set() })
    this.emit({ type: 'session:created', session: meta })
    return meta
  }

  /**
   * Sessions Claude Code récentes de la machine (terminal, VS Code, Canopy…), sans les sessions
   * programmatiques des hooks et scripts (`claude -p`), sauf celles créées par Canopy.
   */
  private async allSessions(limit: number) {
    const { listSessions } = await loadSdk()
    const [all, interactive] = await Promise.all([
      listSessions({ limit }).catch(() => []),
      listSessions({ limit, includeProgrammatic: false }).catch(() => [])
    ])
    const keep = new Set(interactive.map((h) => h.sessionId))
    const own = ownSessions()
    return all.filter((h) => keep.has(h.sessionId) || own.has(h.sessionId))
  }

  /** Historique des projets connus, sous-dossiers compris. */
  async history(projects: { id: string; path: string }[]): Promise<HistoryEntry[]> {
    const out: HistoryEntry[] = []
    for (const h of await this.allSessions(300)) {
      const p = matchProject(h.cwd, projects)
      if (!p) continue
      out.push({
        sdkSessionId: h.sessionId,
        projectId: p.id,
        title: titleOf(h),
        lastModified: h.lastModified,
        branch: h.gitBranch && h.gitBranch !== 'HEAD' ? h.gitBranch : undefined
      })
    }
    return out.sort((a, b) => b.lastModified - a.lastModified)
  }

  /** Sessions actives hors de Canopy : transcript modifié il y a moins de `windowMs`. */
  async external(projects: { id: string; path: string }[], windowMs = 5 * 60_000): Promise<ExternalSession[]> {
    const mine = new Set([...this.sessions.values()].map((s) => s.meta.sdkSessionId).filter(Boolean))
    const now = Date.now()
    return (await this.allSessions(60))
      .filter((h) => now - h.lastModified < windowMs && !mine.has(h.sessionId) && h.cwd)
      .map((h) => ({
        sdkSessionId: h.sessionId,
        cwd: h.cwd!,
        projectId: matchProject(h.cwd, projects)?.id,
        title: titleOf(h),
        lastModified: h.lastModified
      }))
  }

  /** Rouvre une session passée : rejoue le transcript, puis reprend avec `resume` au prochain message. */
  async resume(projectId: string, sdkSessionId: string, title: string, readOnly = false, fork = false, id?: string): Promise<SessionMeta> {
    const open = [...this.sessions.values()].find((s) => s.meta.sdkSessionId === sdkSessionId)
    if (open && !fork) return open.meta
    const project = getProject(projectId)
    if (!project) throw new Error('Projet inconnu')
    const meta = this.create(projectId, undefined, { sdkSessionId, title, readOnly: readOnly || undefined, ...(id ? { id } : {}) })
    const s = this.sessions.get(meta.id)!
    s.fork = fork
    const { getSessionMessages } = await loadSdk()
    const msgs = await getSessionMessages(sdkSessionId, { dir: project.path }).catch(() => [])
    // Rejeu en un bloc : des milliers d'événements item:add recopiaient le fil à chaque fois (coût quadratique).
    s.buffer = []
    for (const m of msgs as any[]) {
      if (m.type === 'user' && !m.parent_tool_use_id) {
        const c = m.message?.content
        const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n') : ''
        // Ignore les messages techniques injectés (rappels système, sorties de commandes…).
        if (text.trim() && !text.trimStart().startsWith('<')) {
          const uid = m.uuid ?? randomUUID()
          this.add(s, { id: uid, kind: 'user', text, at: Date.now() })
          if (Array.isArray(c))
            for (const b of c)
              if (b?.type === 'image' && b.source?.type === 'base64')
                this.emitMedia(this.media.fromBase64(b.source.data, b.source.media_type, { sessionId: s.meta.id, itemId: uid, source: 'attach', name: 'image jointe' }))
          continue
        }
      }
      this.handle(s, { type: m.type, message: m.message, parent_tool_use_id: m.parent_tool_use_id }, project.path, true)
    }
    // Outils restés sans résultat dans le transcript : interrompus, pas « en cours ».
    for (const id of s.tools.keys())
      if (!s.toolsDone.has(id)) this.patchItem(s, id, { status: 'error', result: 'Interrompu (pas de résultat enregistré)' } as Partial<Item>)
    if (msgs.length)
      this.add(s, {
        id: randomUUID(),
        kind: 'event',
        event: readOnly ? 'readonly' : 'resume',
        text: readOnly ? 'Lecture — cette session tourne dans un terminal' : `Session reprise · ${new Date().toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })}`,
        at: Date.now()
      })
    const items = s.buffer
    const patch = s.bufferedPatch
    s.buffer = undefined
    s.bufferedPatch = undefined
    this.emit({ type: 'items:set', sessionId: s.meta.id, items })
    if (patch) this.patch(s, patch)
    return s.meta
  }

  /** Query SDK et projet d'une session vivante (pour la complétion « / »). */
  querySource(id: string) {
    const s = this.sessions.get(id)
    return { query: s?.query, projectId: s?.meta.projectId }
  }

  /** Passe une session en lecture seule en session pilotée par Canopy. */
  takeOver(id: string) {
    const s = this.sessions.get(id)
    if (s) this.patch(s, { readOnly: false })
  }

  async setModel(id: string, model: string) {
    const s = this.sessions.get(id)
    if (!s) return
    if ((s.meta.modelChoice ?? '') !== model && s.started)
      this.add(s, { id: randomUUID(), kind: 'event', event: 'model', text: `Modèle : ${model ? model[0].toUpperCase() + model.slice(1) : 'défaut'}`, at: Date.now() })
    this.patch(s, { modelChoice: model || undefined })
    await s.query?.setModel(model || undefined).catch(() => {})
  }

  private patch(s: Live, patch: Partial<SessionMeta>) {
    if (s.buffer) {
      Object.assign(s.meta, patch)
      s.bufferedPatch = { ...s.bufferedPatch, ...patch }
      return
    }
    Object.assign(s.meta, patch, { updatedAt: Date.now() })
    this.emit({ type: 'session:patch', id: s.meta.id, patch: { ...patch, updatedAt: s.meta.updatedAt } })
  }

  private add(s: Live, item: Item) {
    if (s.buffer) s.buffer.push(item)
    else this.emit({ type: 'item:add', sessionId: s.meta.id, item })
  }

  private patchItem(s: Live, itemId: string, patch: Partial<Item>) {
    if (s.buffer) {
      const k = s.buffer.findIndex((x) => x.id === itemId)
      if (k >= 0) s.buffer[k] = { ...s.buffer[k], ...patch } as Item
    } else this.emit({ type: 'item:patch', sessionId: s.meta.id, itemId, patch })
  }

  async send(id: string, text: string, attachments: Attachment[] = []) {
    const s = this.sessions.get(id)
    if (!s) throw new Error('Session inconnue')
    if (s.meta.readOnly) throw new Error('Session en lecture seule')
    if (s.meta.title === 'Nouvelle session') this.patch(s, { title: short(text.replace(/\s+/g, ' '), 70) })
    // Pièces jointes → blocs image du message (médias connus ou captures en data URL).
    const images: unknown[] = []
    const userId = randomUUID()
    for (const a of attachments) {
      const img =
        'mediaId' in a
          ? this.media.read(a.mediaId)
          : (() => {
              const m = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(a.dataUrl)
              return m ? { mediaType: m[1], data: m[2] } : null
            })()
      if (!img) continue
      images.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.data } })
      // La pièce jointe devient un média de ton message : vignette dans la bulle, visionneuse au clic.
      this.emitMedia(this.media.fromBase64(img.data, img.mediaType, { sessionId: s.meta.id, itemId: userId, source: 'attach', name: a.name }))
    }
    this.add(s, {
      id: userId,
      kind: 'user',
      text,
      attachments: attachments.length ? attachments.map((a) => a.name) : undefined,
      at: Date.now()
    })
    // Ton message relance Claude : les questions sans attente qui le bloquaient redeviennent « en suspens ».
    for (const [qid, a] of s.asks ?? []) if (a.waiting) {
      a.waiting = false
      this.patchItem(s, qid, { mode: 'async' } as Partial<Item>)
    }
    this.patch(s, { status: s.pending.size ? 'wait' : 'run' })
    s.input.push(images.length ? [...images, { type: 'text', text }] : text)
    if (!s.started) {
      s.started = true
      void this.run(s)
    }
  }

  private async run(s: Live) {
    const project = getProject(s.meta.projectId)!
    const { query, createSdkMcpServer, tool } = await loadSdk()
    // Jamais de facturation API : l'auth reste celle de `claude login`.
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    // L'outil Artifact est coupé par défaut quand la CLI est lancée par le SDK (« sdk_default_off ») ;
    // CLAUDE_CODE_ARTIFACT=1 est l'option prévue pour le réactiver, comme dans le terminal.
    env.CLAUDE_CODE_ARTIFACT = '1'
    // Variables propres au démon : ne pas les transmettre (ELECTRON_RUN_AS_NODE casserait toute app Electron lancée par l'agent).
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ATELIER_DATA

    const q = query({
      prompt: s.input as any,
      options: {
        cwd: project.path,
        env,
        model: s.meta.modelChoice,
        // Reprend la conversation Claude Code existante (session rouverte ou relancée après une erreur).
        resume: s.meta.sdkSessionId,
        forkSession: s.fork || undefined,
        // Prompt de Claude Code + consignes de Canopy (mise en forme, artefacts, médias…).
        systemPrompt: { type: 'preset', preset: 'claude_code', append: HARNESS },
        settingSources: ['user', 'project', 'local'],
        permissionMode: s.meta.permissionMode,
        includePartialMessages: true,
        // Outils de Canopy fournis à la session (voir harness.ts) ; autorisés sans demande.
        ...(this.capture || this.browser
          ? {
              mcpServers: { atelier: this.atelierMcp(s, createSdkMcpServer, tool) },
              allowedTools: [...(this.capture ? ['mcp__atelier__capture'] : []), ...(this.checklists ? ['mcp__atelier__checklist'] : []), 'mcp__atelier__question', ...(this.ui ? ['mcp__atelier__interface', 'mcp__atelier__scene'] : []), ...(this.capture ? ['mcp__atelier__screen', 'mcp__atelier__act'] : [])]
            }
          : {}),
        canUseTool: (toolName, input, opts) => this.ask(s, toolName, input, opts)
      }
    })
    s.query = q

    try {
      for await (const m of q as AsyncIterable<any>) this.handle(s, m, project.path)
    } catch (err: any) {
      console.error('[atelier] session', s.meta.id, err)
      this.add(s, { id: randomUUID(), kind: 'error', text: String(err?.message ?? err), at: Date.now() })
      this.patch(s, { status: 'error' })
    } finally {
      s.started = false
      s.query = undefined
      s.input = new InputQueue()
    }
  }

  /** Flux partiel de l'agent principal : activité + texte qui s'écrit (envoyé toutes les 120 ms au plus). */
  private stream(s: Live, ev: any) {
    const now = Date.now()
    const setActivity = (kind: 'thinking' | 'writing' | 'tool', label?: string) => {
      const cur = s.meta.activity
      if (cur?.kind === kind && cur.label === label) return
      this.patch(s, { activity: { kind, label, since: now } })
    }
    if (ev?.type === 'message_start') setActivity('thinking')
    else if (ev?.type === 'content_block_start') {
      const b = ev.content_block
      if (b?.type === 'text') {
        this.endDraft(s)
        const id = randomUUID()
        s.draft = { id, text: '' }
        this.add(s, { id, kind: 'text', text: '', parent: null, at: now })
        setActivity('writing')
      } else if (b?.type === 'thinking' || b?.type === 'redacted_thinking') setActivity('thinking')
      else if (b?.type === 'tool_use' || b?.type === 'server_tool_use') setActivity('tool', b.name)
    } else if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && s.draft) {
      s.draft.text += ev.delta.text ?? ''
      if (!s.draft.timer)
        s.draft.timer = setTimeout(() => {
          if (!s.draft) return
          s.draft.timer = undefined
          this.patchItem(s, s.draft.id, { text: s.draft.text } as Partial<Item>)
        }, 120)
    }
  }

  private endDraft(s: Live) {
    if (s.draft?.timer) clearTimeout(s.draft.timer)
    s.draft = undefined
  }

  private handle(s: Live, m: any, root: string, replay = false) {
    const now = Date.now()
    switch (m.type) {
      case 'system':
        if (m.subtype === 'compact_boundary') {
          const pre = m.compact_metadata?.pre_tokens
          this.add(s, { id: m.uuid ?? randomUUID(), kind: 'event', event: 'compact', text: `Contexte compacté${pre ? ` · ${Math.round(pre / 1000)}k` : ''}`, at: now })
        }
        if (!replay && m.subtype === 'task_started') {
          ;(s.taskInfo ??= new Map()).set(m.task_id, { at: now, label: m.description || 'Tâche', toolUseId: m.tool_use_id })
        }
        if (!replay && m.subtype === 'background_tasks_changed') {
          const tasks = (m.tasks ?? []).filter((t: any) => !t.ambient)
          for (const t of tasks) (s.bgSeen ??= new Set()).add(t.task_id)
          this.patch(s, {
            bgTasks: tasks.map((t: any) => ({ id: t.task_id, kind: t.task_type, label: t.description || s.taskInfo?.get(t.task_id)?.label || 'Tâche', startedAt: s.taskInfo?.get(t.task_id)?.at ?? now }))
          })
        }
        if (!replay && m.subtype === 'task_notification' && !m.ambient && s.bgSeen?.has(m.task_id)) {
          const info = s.taskInfo?.get(m.task_id)
          const itemId = m.uuid ?? randomUUID()
          if (m.output_file) (s.taskOutputs ??= new Map()).set(itemId, m.output_file)
          this.add(s, {
            id: itemId,
            kind: 'task',
            taskId: m.task_id,
            label: info?.label ?? 'Tâche de fond',
            status: m.status,
            summary: String(m.summary ?? ''),
            durationMs: m.usage?.duration_ms ?? (info ? now - info.at : undefined),
            outputFile: m.output_file,
            at: now
          })
        }
        if (m.subtype === 'init' && !replay) {
          rememberOwnSession(m.session_id)
          s.fork = false
          this.patch(s, { sdkSessionId: m.session_id, model: m.model })
        }
        break
      case 'assistant': {
        const parent = m.parent_tool_use_id ?? null
        for (const c of m.message?.content ?? []) {
          if (c.type === 'text' && c.text?.trim()) {
            let itemId: string
            if (!parent && s.draft) {
              itemId = s.draft.id
              this.endDraft(s)
              this.patchItem(s, itemId, { text: c.text } as Partial<Item>)
            } else {
              itemId = randomUUID()
              this.add(s, { id: itemId, kind: 'text', text: c.text, parent, at: now })
            }
            this.mediaFromText(s, itemId, c.text, root)
          } else if (c.type === 'tool_use') {
            s.tools.set(c.id, { name: c.name, parent, input: c.input })
            s.turnTools = (s.turnTools ?? 0) + 1
            const isAgent = c.name === 'Task' || c.name === 'Agent'
            this.add(s, {
              id: c.id,
              kind: 'tool',
              name: c.name,
              summary: summarize(c.name, c.input, root),
              parent,
              status: 'running',
              diff: diffOf(c.name, c.input, root),
              subagent: isAgent
                ? { type: String(c.input?.subagent_type ?? 'agent'), description: String(c.input?.description ?? '') }
                : undefined,
              todos: c.name === 'TodoWrite' && Array.isArray(c.input?.todos) ? c.input.todos : undefined,
              at: now
            })
          }
        }
        const u = m.message?.usage
        if (!parent && u) {
          const ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
          if (ctx > 0) this.patch(s, { contextTokens: ctx })
        }
        break
      }
      case 'user': {
        const content = m.message?.content
        if (!Array.isArray(content)) break
        for (const c of content) {
          if (c.type === 'tool_result' && s.tools.has(c.tool_use_id)) {
            s.toolsDone.add(c.tool_use_id)
            this.mediaFromToolResult(s, c.tool_use_id, c.content)
            const full = resultText(c.content)
            this.patchItem(s, c.tool_use_id, {
              status: c.is_error ? 'error' : 'ok',
              result: short(full, 600),
              ...(c.is_error ? {} : artifactOf(s.tools.get(c.tool_use_id), full))
            } as Partial<Item>)
          }
        }
        break
      }
      case 'result': {
        const ok = m.subtype === 'success'
        const secs = Math.round((m.duration_ms ?? 0) / 1000)
        this.add(s, {
          id: randomUUID(),
          kind: 'result',
          ok,
          text: ok ? `Terminé · ${secs} s · ${m.num_turns ?? '?'} tours` : `Arrêt : ${m.subtype}`,
          durationMs: m.duration_ms,
          actions: s.turnTools,
          at: now
        })
        s.turnTools = 0
        this.endDraft(s)
        const win = Math.max(0, ...Object.values((m.modelUsage ?? {}) as Record<string, { contextWindow?: number }>).map((u) => u?.contextWindow ?? 0))
        // Fin du tour avec une question sans attente ni choix par défaut : Claude n'a plus rien d'autre à faire,
        // la question devient bloquante (argile, notification).
        for (const [qid, a] of s.asks ?? []) if (!a.fallback && !a.waiting) {
          a.waiting = true
          this.patchItem(s, qid, { mode: 'wait' } as Partial<Item>)
        }
        this.patch(s, { status: this.waiting(s) ? 'wait' : 'idle', activity: undefined, ...(win ? { contextWindow: win } : {}) })
        break
      }
      case 'stream_event':
        if (!replay && !m.parent_tool_use_id) this.stream(s, m.event)
        break
      case 'rate_limit_event': {
        // Le pourcentage vient de la sonde d'usage ; ici on ne garde que le statut (avertissement / bloqué).
        const i = m.rate_limit_info ?? {}
        if (i.status) this.emit({ type: 'quota', quota: { status: i.status } })
        break
      }
    }
  }

  private ask(s: Live, toolName: string, input: Record<string, unknown>, opts: any): Promise<any> {
    if (toolName === 'AskUserQuestion') return this.askQuestion(s, input, opts)
    const root = getProject(s.meta.projectId)?.path ?? ''
    const permId = randomUUID()
    this.add(s, {
      id: permId,
      kind: 'permission',
      tool: toolName,
      summary: opts?.title || summarize(toolName, input, root),
      parent: s.tools.get(opts?.toolUseID)?.parent ?? null,
      canAlways: Array.isArray(opts?.suggestions) && opts.suggestions.length > 0,
      state: 'pending',
      detail: toolName === 'ExitPlanMode' && typeof input?.plan === 'string' ? input.plan : undefined,
      at: Date.now()
    })
    this.patch(s, { status: 'wait' })
    return new Promise((resolve) => {
      s.pending.set(permId, { resolve, suggestions: opts?.suggestions, input })
      opts?.signal?.addEventListener?.('abort', () => {
        if (s.pending.delete(permId)) {
          this.patchItem(s, permId, { state: 'denied' } as Partial<Item>)
          resolve({ behavior: 'deny', message: 'Annulé' })
        }
      })
    })
  }

  respond(id: string, permId: string, decision: PermissionDecision) {
    const s = this.sessions.get(id)
    const p = s?.pending.get(permId)
    if (!s || !p) return
    s.pending.delete(permId)
    if (decision === 'deny') {
      p.resolve({ behavior: 'deny', message: 'Refusé par l’utilisateur' })
    } else {
      p.resolve({
        behavior: 'allow',
        updatedInput: p.input,
        ...(decision === 'always' && p.suggestions ? { updatedPermissions: p.suggestions } : {})
      })
    }
    this.patchItem(s, permId, { state: decision === 'deny' ? 'denied' : 'allowed' } as Partial<Item>)
    this.patch(s, { status: this.waiting(s) ? 'wait' : s.query ? 'run' : 'idle' })
  }

  /** Passe au second plan ce qui tourne au premier plan (Ctrl+B du terminal) : Claude reprend la main. */
  async backgroundTask(id: string, toolUseId?: string): Promise<boolean> {
    const s = this.sessions.get(id)
    if (!s?.query?.backgroundTasks) return false
    const ok = !!(await s.query.backgroundTasks(toolUseId).catch(() => false))
    if (ok) {
      const t = toolUseId ? s.tools.get(toolUseId) : undefined
      const what = t ? summarize(t.name, t.input, getProject(s.meta.projectId)?.path ?? '') || t.name : 'Tâches en cours'
      this.add(s, { id: randomUUID(), kind: 'event', event: 'background', text: `Passée en arrière-plan · ${short(what, 80)}`, at: Date.now() })
    }
    return ok
  }

  /** Session vivante la plus récente d'un projet (les mesures ont besoin d'un Claude Code lancé). */
  private liveOf(projectId: string) {
    return [...this.sessions.values()].filter((x) => x.meta.projectId === projectId && x.query && !x.meta.readOnly).sort((a, b) => b.meta.updatedAt - a.meta.updatedAt)
  }

  /** Inventaire des outils d'un projet : coût réel en contexte et état des serveurs, mesurés sur une session ouverte. */
  /** Dernier inventaire par projet : l'ouverture de la page est instantanée, « Mesurer » le refait. */
  private invCache = new Map<string, ToolsInventory>()

  /** Claude Code lancé à vide dans un projet (aucun message envoyé), le temps d'une mesure. */
  private async probe(cwd: string) {
    const { query } = await loadSdk()
    const env = { ...process.env }
    delete env.ANTHROPIC_API_KEY
    delete env.ELECTRON_RUN_AS_NODE
    delete env.ATELIER_DATA
    let release = () => {}
    const idle = {
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<IteratorResult<any>>((r) => (release = () => r({ done: true, value: undefined })))
      })
    }
    const q: any = query({
      prompt: idle as any,
      options: { cwd, env, systemPrompt: { type: 'preset', preset: 'claude_code', append: HARNESS }, settingSources: ['user', 'project', 'local'] }
    })
    // Draine le flux jusqu'à la fin du process.
    void (async () => {
      try {
        for await (const _ of q) {
          /* rien */
        }
      } catch {
        /* ignoré */
      }
    })()
    return { q, close: () => release() }
  }

  async toolsInventory(projectId: string, force = false): Promise<ToolsInventory> {
    const cached = this.invCache.get(projectId)
    if (cached && !force && Date.now() - (cached.measuredAt ?? 0) < 10 * 60_000) return cached
    const project = getProject(projectId)
    const offSkills = disabledSkills()
    const offMcp = project ? disabledMcp(project.path) : []
    const inv: ToolsInventory = { projectId, categories: [], memoryFiles: [], skills: [], mcp: [], agents: [] }
    const live = this.liveOf(projectId)[0]
    // Sans session ouverte dans le projet : une sonde, fermée aussitôt la mesure faite.
    const probe = !live && project ? await this.probe(project.path).catch(() => null) : null
    const q = live?.query ?? probe?.q
    if (q) {
      const timeout = <T,>(p: Promise<T>, fallback: T) => Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), 60_000))])
      const [u, st] = await Promise.all([
        timeout<any>(q.getContextUsage?.({ detail: 'full' }).catch(() => null) ?? Promise.resolve(null), null),
        timeout<any[]>(q.mcpServerStatus?.().catch(() => []) ?? Promise.resolve([]), [])
      ])
      probe?.close()
      inv.measuredAt = Date.now()
      inv.sessionTitle = live ? live.meta.title : 'une session vide lancée pour la mesure'
      if (u) {
        inv.total = u.totalTokens
        inv.max = u.maxTokens
        inv.categories = (u.categories ?? []).filter((c: any) => c.kind !== 'free' && c.id !== 'messages').map((c: any) => ({ id: c.id ?? c.name, name: c.name, tokens: c.tokens }))
        inv.skills = (u.skills?.skillFrontmatter ?? []).map((k: any) => ({ name: k.name, source: k.source, plugin: k.pluginName, path: k.path, tokens: k.tokens, enabled: true }))
        inv.agents = (u.agents ?? []).map((a: any) => ({ name: a.agentType, source: a.source, tokens: a.tokens }))
        inv.memoryFiles = (u.memoryFiles ?? []).map((f: any) => ({ path: f.path, type: f.type, tokens: f.tokens }))
      }
      const toolsOf = (name: string) => (u?.mcpTools ?? []).filter((t: any) => t.serverName === name)
      inv.mcp = (st ?? []).map((m: any) => {
        const used = toolsOf(m.name)
        const instr = (u?.mcpInstructions ?? []).find((x: any) => x.serverName === m.name)?.tokens ?? 0
        return {
          name: m.name,
          status: m.status,
          scope: m.scope ?? m.source,
          error: m.error,
          tokens: used.reduce((n: number, t: any) => n + (t.isLoaded === false ? 0 : t.tokens), 0) + instr,
          deferred: used.length > 0 && used.every((t: any) => t.isLoaded === false),
          enabled: m.status !== 'disabled' && !offMcp.includes(m.name),
          tools: (m.tools ?? []).map((t: any) => ({ name: t.name, tokens: used.find((x: any) => x.name.endsWith(t.name))?.tokens ?? 0, readOnly: t.annotations?.readOnly, destructive: t.annotations?.destructive }))
        }
      })
    }
    // Ce qui est coupé n'est pas chargé, donc absent des mesures : on l'ajoute pour pouvoir le réactiver.
    for (const name of offSkills) if (!inv.skills.some((k) => k.name === name)) inv.skills.push({ name, source: 'désactivé', tokens: 0, enabled: false })
    for (const name of offMcp) if (!inv.mcp.some((m) => m.name === name)) inv.mcp.push({ name, status: 'disabled', tokens: 0, deferred: false, enabled: false, tools: [] })
    if (inv.measuredAt) this.invCache.set(projectId, inv)
    return inv
  }

  /** Coupe ou rallume un serveur MCP pour un projet : réglage persistant, et tout de suite dans ses sessions ouvertes. */
  async setMcpEnabled(projectId: string, name: string, enabled: boolean) {
    const project = getProject(projectId)
    if (!project) return
    setMcpDisabled(project.path, name, !enabled)
    await Promise.all(this.liveOf(projectId).map((s) => s.query.toggleMcpServer?.(name, enabled).catch(() => {})))
  }

  async reconnectMcp(projectId: string, name: string) {
    await Promise.all(this.liveOf(projectId).map((s) => s.query.reconnectMcpServer?.(name).catch(() => {})))
  }

  async stopTask(id: string, taskId: string) {
    const s = this.sessions.get(id)
    await s?.query?.stopTask?.(taskId).catch(() => {})
  }

  /** Fin (16 Ko) du fichier de sortie d'une tâche de fond terminée. */
  taskOutput(id: string, itemId: string): string {
    const file = this.sessions.get(id)?.taskOutputs?.get(itemId)
    if (!file) return '(sortie indisponible : le moteur a redémarré depuis)'
    try {
      const raw = readFileSync(file, 'utf8')
      return raw.length > 16_000 ? '…\n' + raw.slice(-16_000) : raw
    } catch {
      return '(sortie introuvable)'
    }
  }

  /** Claude attend-il quelque chose de toi (autorisation, question bloquante) ? */
  private waiting(s: Live) {
    return s.pending.size > 0 || [...(s.asks?.values() ?? [])].some((a) => a.waiting)
  }

  /** Question bloquante (outil AskUserQuestion) : une carte dans le fil, Claude attend la réponse. */
  private askQuestion(s: Live, input: Record<string, unknown>, opts: any): Promise<any> {
    const id = randomUUID()
    this.add(s, {
      id,
      kind: 'question',
      parent: s.tools.get(opts?.toolUseID)?.parent ?? null,
      questions: normalizeQuestions(input.questions),
      blocking: true,
      mode: 'wait',
      state: 'pending',
      at: Date.now()
    })
    this.patch(s, { status: 'wait' })
    return new Promise((resolve) => {
      s.pending.set(id, { resolve, input, question: true })
      opts?.signal?.addEventListener?.('abort', () => {
        if (s.pending.delete(id)) {
          this.patchItem(s, id, { state: 'skipped' } as Partial<Item>)
          resolve({ behavior: 'deny', message: 'Annulé' })
        }
      })
    })
  }

  /** Réponse à une question (bloquante ou sans attente) : choisie, passée, ou « je réponds dans le fil ». */
  answerQuestion(id: string, itemId: string, a: QuestionAnswer) {
    const s = this.sessions.get(id)
    if (!s) return
    const state = a.action === 'answer' ? 'answered' : a.action === 'skip' ? 'skipped' : 'chat'
    const p = s.pending.get(itemId)
    if (p?.question) {
      s.pending.delete(itemId)
      const qs = normalizeQuestions(p.input.questions)
      const answers = a.action === 'answer' ? (a.answers ?? {}) : {}
      const annotations: Record<string, { notes?: string; unanswered?: string }> = {}
      for (const q of qs) {
        const note = a.notes?.[q.question]
        const unanswered = a.action === 'skip' ? 'skipped' : a.action === 'chat' ? 'replied_in_chat' : answers[q.question] ? undefined : 'skipped'
        if (note || unanswered) annotations[q.question] = { ...(note ? { notes: note } : {}), ...(unanswered ? { unanswered } : {}) }
      }
      p.resolve({ behavior: 'allow', updatedInput: { ...p.input, answers, annotations } })
      this.patchItem(s, itemId, { state, answers, notes: a.notes } as Partial<Item>)
      this.patch(s, { status: this.waiting(s) ? 'wait' : s.query ? 'run' : 'idle' })
      return
    }
    const open = s.asks?.get(itemId)
    if (!open) return
    s.asks!.delete(itemId)
    this.patchItem(s, itemId, { state, answers: a.answers, notes: a.notes, mode: 'async' } as Partial<Item>)
    const q = open.questions[0]
    // La réponse part comme un message : Claude la lit au prochain point d'étape (ou reprend s'il avait fini).
    if (a.action === 'answer') {
      const ans = a.answers?.[q.question] ?? ''
      const note = a.notes?.[q.question]
      void this.send(id, `Réponse à ta question « ${q.question} » : ${ans}${note ? ` (précision : ${note})` : ''}`)
    } else if (a.action === 'skip' && !open.fallback) {
      void this.send(id, `Je passe ta question « ${q.question} » : choisis toi-même et dis-moi ce que tu as retenu.`)
    } else {
      this.patch(s, { status: this.waiting(s) ? 'wait' : s.query ? 'run' : 'idle' })
    }
  }

  async interrupt(id: string) {
    const s = this.sessions.get(id)
    if (!s?.query) return
    for (const [permId, p] of s.pending) {
      p.resolve({ behavior: 'deny', message: 'Interrompu' })
      this.patchItem(s, permId, { state: 'denied' } as Partial<Item>)
    }
    s.pending.clear()
    await s.query.interrupt().catch(() => {})
  }

  async setPermissionMode(id: string, mode: PermissionModeUI) {
    const s = this.sessions.get(id)
    if (!s) return
    const MODE_NAME: Record<PermissionModeUI, string> = { default: 'Demander', acceptEdits: 'Accepter les modifications', auto: 'Auto', plan: 'Plan' }
    if (s.meta.permissionMode !== mode && s.started)
      this.add(s, { id: randomUUID(), kind: 'event', event: 'mode', text: `Mode : ${MODE_NAME[mode]}`, at: Date.now() })
    this.patch(s, { permissionMode: mode })
    await s.query?.setPermissionMode(mode).catch(() => {})
  }

  async close(id: string) {
    const s = this.sessions.get(id)
    if (!s) return
    await this.interrupt(id)
    s.input.close()
    this.sessions.delete(id)
    this.emit({ type: 'session:removed', id })
  }

  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((id) => this.close(id)))
  }
}
