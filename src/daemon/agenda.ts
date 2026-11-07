// Agenda (planches 51 à 55) : brief d'une réunion écrit par Claude (requête à part, lecture seule),
// et lignes d'agenda transmises aux sessions de chaque projet.
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { BriefInput } from '../shared/agenda'
import type { NotesSummaryInput } from '../shared/notes'
import { loadSdk } from './sessions'

let lines: Record<string, string> = {}

/** Une ligne par projet (prochaine réunion, tâches…), ajoutée aux consignes des sessions qui démarrent. */
export function setAgendaLines(l: Record<string, string>) {
  lines = l ?? {}
}

export function agendaLine(projectId: string): string | undefined {
  return lines[projectId] || undefined
}

const TOOLS = ['Read', 'Grep', 'Glob']

/** `p` (absolu, ou relatif à la racine) est-il sous `root` ? */
const inside = (root: string, p: string) => {
  const r = relative(resolve(root), resolve(root, p))
  return r === '' || (!r.startsWith('..') && !isAbsolute(r))
}

const fmt = (t: number, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', ...opts }).format(t)
const day = (t: number) => fmt(t, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
const hour = (t: number) => fmt(t, { hour: '2-digit', minute: '2-digit' })
const dateShort = (t: number) => fmt(t, { day: '2-digit', month: '2-digit', year: 'numeric' })

function buildPrompt(i: BriefInput): string {
  const m = i.meeting
  const home = homedir().replace(/\\/g, '/')
  const parts: string[] = []
  parts.push(`Nous sommes le ${day(i.now)}, il est ${hour(i.now)} (Europe/Brussels).`)
  parts.push(
    [
      '# Réunion',
      `Titre : ${m.title}`,
      `Quand : ${day(m.start)}, ${hour(m.start)}–${hour(m.end)}`,
      m.location ? `Lieu : ${m.location}` : '',
      `Lien de visio : ${m.joinUrl ? 'oui' : 'non'}`,
      `Participants : ${m.attendees.length ? m.attendees.map((a) => `${a.name ? a.name + ' ' : ''}<${a.email}>${a.external ? ' (externe)' : ''}${a.self ? ' (toi)' : ''}`).join(', ') : 'aucun'}`,
      `Description : ${m.description?.trim() ? m.description.trim().slice(0, 3000) : '(vide)'}`
    ]
      .filter(Boolean)
      .join('\n')
  )
  parts.push(`# Projet\n${i.projectName ? `${i.projectName}${i.projectPath ? ` — ${i.projectPath}` : ''}` : 'Aucun projet relié'}`)
  parts.push(
    `# Tâches Teamleader (${i.tasks.length})\n` +
      (i.tasks.length ? i.tasks.map((t) => `- ${t.title}${t.due ? ` (échéance ${t.due})` : ''}${t.projectName ? ` [${t.projectName}]` : ''}`).join('\n') : '(aucune)')
  )
  parts.push(
    `# Sessions récentes du projet (${i.sessions.length})\n` +
      (i.sessions.length ? i.sessions.map((s) => `- ${s.title} (${dateShort(s.at)})`).join('\n') : '(aucune)')
  )
  parts.push(
    `# Mails liés à la réunion (${i.mails.length})\n` +
      (i.mails.length ? i.mails.map((x) => `- ${dateShort(x.date)} · ${x.from} · ${x.subject} — ${x.snippet}`).join('\n') : '(aucun)')
  )
  if (i.previous?.trim()) parts.push(`# Brief précédent\n${i.previous.trim()}`)
  parts.push(
    [
      '# Consigne',
      'Écris le brief de cette réunion pour Florian, en français : concis, factuel, sans jamais rien inventer.',
      'Chaque point vient des données ci-dessus ou de fichiers que tu as lus ; si les données sont minces, dis-le en une ligne.',
      'Lis d’abord les documents du projet, à la racine ET dans ses sous-dossiers directs (Glob `*.md` puis `*/*.md`, sans node_modules) : CLAUDE.md, AGENTS.md, README, PLAN, QUESTIONS, brief, devis, notes… Ce sont souvent les sources les plus utiles (questions au client, plan, décisions). Lis aussi `.canopy/checklists/*.md`, ' +
        `et le wiki (liste les sujets avec Glob \`${home}/.claude/wiki/topics/*/index.md\`, puis lis l'index du sujet lié à la réunion, s'il y en a un).`,
      'Réponds UNIQUEMENT en Markdown, avec exactement ces sections, dans cet ordre :',
      "## L'essentiel — 3 à 5 puces.",
      "Format de chaque puce de « L'essentiel » et de « Points à aborder » : UNE ligne courte (20 mots au plus), jamais de sous-liste. " +
        "Juste en dessous, si c'est utile, une ligne indentée qui commence par `  ↳ ` : le contexte pour quelqu'un qui n'a pas suivi le dossier récemment " +
        "(d'où vient le point, pourquoi il compte, les chiffres ou options utiles), en 1 à 3 phrases, avec la source entre parenthèses (fichier, mail du JJ/MM, description).",
      `## Depuis ce matin — seulement si un brief précédent est fourni ET qu'il y a du nouveau depuis sa date ; chaque puce commence par \`HH:MM · \` ; garde les puces précédentes. Sinon, omets toute la section.` +
        ' Le brief précédent peut contenir des lignes ajoutées à la main sous « Depuis ce matin » : garde-les telles quelles.',
      '## Points à aborder — 2 à 6 puces de la forme `- [ ] …`.',
      '## Sources — puces courtes : « Description de la réunion », « Mails liés à la réunion (n fils) », « Tâches Teamleader (n) », « Sessions du projet (n) », « Wiki <sujet> », puis les fichiers lus.'
    ].join('\n')
  )
  return parts.join('\n\n')
}

/** Brief d'une réunion : une requête Sonnet en lecture seule (Read, Grep, Glob), sans trace dans l'historique. */
export async function makeBrief(input: BriefInput): Promise<string> {
  const { query } = await loadSdk()
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ANTHROPIC_API_KEY
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), 4 * 60_000)
  let text = ''
  const cwd = input.projectPath && existsSync(input.projectPath) ? input.projectPath : homedir()
  const roots = [cwd, join(homedir(), '.claude', 'wiki'), dirname(input.path)]
  try {
    const q = query({
      prompt: buildPrompt(input),
      options: {
        model: 'sonnet',
        cwd,
        env,
        maxTurns: 14,
        persistSession: false,
        settingSources: [],
        tools: TOOLS,
        allowedTools: TOOLS,
        canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
          if (!TOOLS.includes(toolName)) return { behavior: 'deny' as const, message: 'Lecture seule : ce brief ne modifie rien.' }
          const p = (toolInput.file_path ?? toolInput.path) as string | undefined
          // Glob/Grep sans chemin : ils partent du dossier de travail (le projet).
          if (p && !roots.some((r) => inside(r, p))) return { behavior: 'deny' as const, message: 'Hors périmètre : projet, wiki ou dossier du brief seulement.' }
          return { behavior: 'allow' as const, updatedInput: toolInput }
        },
        abortController
      } as any
    })
    for await (const m of q) {
      if ((m as any).type === 'result' && typeof (m as any).result === 'string') text = (m as any).result
    }
  } catch (e: any) {
    if (abortController.signal.aborted) throw new Error('Le brief a pris trop de temps (4 min).')
    throw e
  } finally {
    clearTimeout(timer)
  }
  const k = text.split('\n').findIndex((l) => l.startsWith('## '))
  const out = k >= 0 ? text.split('\n').slice(k).join('\n').trim() : ''
  if (!out) throw new Error("Claude n'a rien écrit pour ce brief.")
  return out
}

function notesPrompt(i: NotesSummaryInput): string {
  const parts: string[] = []
  parts.push(`Nous sommes le ${day(i.now)}, il est ${hour(i.now)} (Europe/Brussels).`)
  parts.push(`# Réunion
Titre : ${i.title}
De ${hour(i.startedAt)} à ${hour(i.endedAt)}, le ${day(i.startedAt)}`)
  parts.push(`# Projet
${i.projectName ? `${i.projectName}${i.projectPath ? ` — ${i.projectPath}` : ''}` : 'Aucun projet relié'}`)
  if (i.brief?.trim()) parts.push(`# Brief de la réunion (contexte)
${i.brief.trim().slice(0, 6000)}`)
  parts.push(`# Transcript
${i.transcript.trim() || '(vide)'}`)
  parts.push(
    [
      '# Consigne',
      'Écris le compte rendu de cette réunion pour Florian, en français, d’après le transcript ci-dessus : concis, factuel, sans jamais rien inventer.',
      'Le transcript mélange parfois français, anglais et néerlandais et contient des erreurs de transcription : corrige silencieusement les erreurs évidentes (noms propres, termes du projet, que le brief ou les fichiers du projet peuvent confirmer), sans rien ajouter qui n’ait pas été dit.',
      'Les seuls interlocuteurs identifiés sont « Toi » (Florian), « Dans la pièce » et « En visio » : ne devine pas les noms, sauf s’ils sont cités dans le transcript.',
      'Tu peux lire les documents du projet (Read, Grep, Glob) si cela aide à comprendre un terme ; ne cherche pas plus loin.',
      'Réponds UNIQUEMENT en Markdown, avec exactement ces sections, dans cet ordre :',
      '## En bref — 3 à 5 phrases.',
      '## Décisions — puces ; « Aucune décision claire. » s’il n’y en a pas.',
      '## Actions — puces de la forme `- [ ] Qui · quoi · échéance si elle a été dite` ; Qui = Toi, un nom cité, ou « À préciser ».',
      '## Questions ouvertes — puces (ou « Aucune. »).',
      'Format de chaque puce de « Décisions » et « Actions » : UNE ligne courte (20 mots au plus), jamais de sous-liste. ' +
        'Juste en dessous, si c’est utile, une ligne indentée qui commence par `  ↳ ` : le contexte en 1 à 2 phrases (pourquoi, chiffres, option retenue).'
    ].join('\n')
  )
  return parts.join('\n\n')
}

/** Compte rendu d'une prise de notes : une requête Sonnet en lecture seule limitée au projet, sans trace dans l'historique. */
export async function makeNotesSummary(input: NotesSummaryInput): Promise<string> {
  const { query } = await loadSdk()
  const env = { ...process.env } as Record<string, string>
  delete env.ELECTRON_RUN_AS_NODE
  delete env.ANTHROPIC_API_KEY
  const abortController = new AbortController()
  const timer = setTimeout(() => abortController.abort(), 4 * 60_000)
  let text = ''
  const cwd = input.projectPath && existsSync(input.projectPath) ? input.projectPath : homedir()
  try {
    const q = query({
      prompt: notesPrompt(input),
      options: {
        model: 'sonnet',
        cwd,
        env,
        maxTurns: 6,
        persistSession: false,
        settingSources: [],
        tools: TOOLS,
        allowedTools: TOOLS,
        canUseTool: async (toolName: string, toolInput: Record<string, unknown>) => {
          if (!TOOLS.includes(toolName)) return { behavior: 'deny' as const, message: 'Lecture seule : ce compte rendu ne modifie rien.' }
          const p = (toolInput.file_path ?? toolInput.path) as string | undefined
          if (p && !inside(cwd, p)) return { behavior: 'deny' as const, message: 'Hors périmètre : le projet seulement.' }
          return { behavior: 'allow' as const, updatedInput: toolInput }
        },
        abortController
      } as any
    })
    for await (const m of q) {
      if ((m as any).type === 'result' && typeof (m as any).result === 'string') text = (m as any).result
    }
  } catch (e: any) {
    if (abortController.signal.aborted) throw new Error('Le compte rendu a pris trop de temps (4 min).')
    throw e
  } finally {
    clearTimeout(timer)
  }
  const k = text.split('\n').findIndex((l) => l.startsWith('## '))
  const out = k >= 0 ? text.split('\n').slice(k).join('\n').trim() : ''
  if (!out) throw new Error("Claude n'a rien écrit pour ce compte rendu.")
  return out
}
