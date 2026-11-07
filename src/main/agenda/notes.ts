import { app, ipcMain } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomBytes, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { MeetingNote, MeetingNoteMeta, NoteSeg, NoteSpeaker, NoteWho, NotesSummaryInput } from '../../shared/notes'
import { voiceRunning } from '../voice'
import type { ChecklistSummary } from '../../shared/checklist'
import type { Project } from '../../shared/types'
import { agendaBrief, agendaMeeting } from './index'

// Notes de réunion (étape 2a) : segments transcrits par le renderer, enregistrés ici (un fichier par prise de notes),
// puis résumés par le démon à la fin.

export type NotesDeps = {
  projects: () => Project[]
  rpc: <T = unknown>(method: string, ...args: unknown[]) => Promise<T>
  /** Dit au renderer que la liste ou une note a changé. */
  emit: (id?: string) => void
}

const dir = () => join(app.getPath('userData'), 'agenda', 'notes')
const fileOf = (id: string) => join(dir(), `${String(id).replace(/[^\w-]/g, '')}.json`)
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
const pad = (n: number) => String(n).padStart(2, '0')
const clock = (t: number) => {
  const d = new Date(t)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
const WHO: Record<NoteWho, string> = { me: 'Toi', room: 'Dans la pièce', remote: 'En visio', mic: 'Micro' }

function write(path: string, text: string) {
  mkdirSync(dir(), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, text, 'utf8')
  renameSync(tmp, path)
}

const read = (id: string): MeetingNote | null => {
  try {
    return JSON.parse(readFileSync(fileOf(id), 'utf8')) as MeetingNote
  } catch {
    return null
  }
}

export function startNotes(d: NotesDeps) {
  // Notes en mémoire pendant la prise de notes (évite de relire le fichier à chaque lot de segments).
  const live = new Map<string, MeetingNote>()
  const timers = new Map<string, NodeJS.Timeout>()

  const get = (id: string) => live.get(id) ?? read(id)
  const save = (n: MeetingNote) => {
    n.count = n.segments.length
    try {
      write(fileOf(n.id), JSON.stringify(n))
    } catch (e) {
      console.log('[notes] note non enregistrée :', msg(e))
    }
  }
  const flush = (id: string) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    const n = live.get(id)
    if (n) save(n)
  }
  const change = (n: MeetingNote) => {
    save(n)
    d.emit(n.id)
  }

  // Une prise de notes interrompue par la fermeture de Canopy : on garde les segments, la note passe à « terminée ».
  try {
    for (const f of readdirSync(dir()).filter((x) => x.endsWith('.json'))) {
      const n = read(f.slice(0, -5))
      if (n && (n.state === 'recording' || n.state === 'paused' || n.state === 'refining' || n.state === 'summarizing') && !n.summary) {
        n.state = 'done'
        n.error = 'Prise de notes interrompue (Canopy fermé).'
        n.endedAt ??= n.segments[n.segments.length - 1]?.t1 ?? n.startedAt
        save(n)
      }
    }
  } catch {
    /* pas encore de dossier */
  }

  function label(n: MeetingNote, s: NoteSeg) {
    if (s.speaker) {
      const name = n.speakers?.find((x) => x.id === s.speaker)?.name?.trim()
      if (name) return name
      if (s.speaker === 'me') return 'Toi'
      const m = /^([pv])(\d+)$/.exec(s.speaker)
      if (m) return `${m[1] === 'p' ? 'Pièce' : 'Visio'} ${m[2]}`
    }
    return WHO[s.who] ?? 'Micro'
  }

  function transcript(n: MeetingNote) {
    return [...n.segments]
      .sort((a, b) => a.t0 - b.t0)
      .map((s) => `${clock(s.t0)} · ${label(n, s)} · ${s.text.trim()}`)
      .join('\n')
  }

  /** Deuxième passe : le service revoit le son gardé (transcription précise + voix). En cas d'échec, on garde le direct. */
  async function refine(id: string) {
    const n = get(id)
    if (!n || !n.segments.length) return
    const info = await voiceRunning().catch(() => null)
    if (!info) return
    flush(id)
    n.state = 'refining'
    n.progress = 0
    n.error = undefined
    change(n)
    // Le service referme les fichiers de son quand les pistes se déconnectent : on lui laisse le temps de finir.
    await new Promise((r) => setTimeout(r, 1500))
    await new Promise<void>((resolve) => {
      let last = 0
      let ws: WebSocket
      const end = (why?: string) => {
        clearTimeout(timer)
        if (why) console.log('[notes] deuxième passe abandonnée :', why)
        try {
          ws.close()
        } catch {
          /* déjà fermée */
        }
        resolve()
      }
      const timer = setTimeout(() => {
        try {
          ws.send(JSON.stringify({ type: 'discard' }))
        } catch {
          /* connexion perdue */
        }
        end('délai dépassé')
      }, 15 * 60_000)
      try {
        ws = new WebSocket(`ws://127.0.0.1:${info.port}/?t=${info.token}&mode=final&note=${encodeURIComponent(id)}&lang=auto`)
      } catch (e) {
        return end(msg(e))
      }
      let done = false
      ws.onmessage = (ev) => {
        let m: any
        try {
          m = JSON.parse(String(ev.data))
        } catch {
          return
        }
        if (m.type === 'progress') {
          n.progress = Math.max(0, Math.min(1, Number(m.value) || 0))
          if (Date.now() - last > 1000) {
            last = Date.now()
            d.emit(id)
          }
        } else if (m.type === 'done') {
          done = true
          const segs: NoteSeg[] = Array.isArray(m.segments) ? m.segments.map((s: NoteSeg) => ({ ...s, id: randomUUID() })) : []
          if (segs.length) {
            const names = new Map((n.speakers ?? []).filter((x) => x.name).map((x) => [x.id, x.name]))
            n.draft = n.segments
            n.segments = segs
            n.speakers = (Array.isArray(m.speakers) ? m.speakers : []).map((x: NoteSpeaker) => (names.has(x.id) ? { ...x, name: names.get(x.id) } : x))
          }
          n.progress = undefined
          save(n)
          end()
        } else if (m.type === 'error') end(String(m.message ?? 'erreur'))
      }
      ws.onerror = () => end('connexion impossible')
      ws.onclose = () => end(done ? undefined : 'connexion fermée')
    })
    n.progress = undefined
    change(n)
  }

  /** Remplace (ou ajoute) « ## Après la réunion » dans le brief : « En bref » et « Décisions ». */
  function appendToBrief(n: MeetingNote, summary: string) {
    const b = n.meetingId ? agendaBrief(n.meetingId) : null
    if (!b || !existsSync(b.path)) return
    const part = (name: string) => summary.match(new RegExp(`^##\\s+${name}[^\\n]*\\n([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'im'))?.[1]?.trim()
    const bref = part('En bref')
    const dec = part('Décisions')
    if (!bref && !dec) return
    const section = `## Après la réunion\n\n${bref ? `### En bref\n\n${bref}\n\n` : ''}${dec ? `### Décisions\n\n${dec}\n` : ''}`.trimEnd() + '\n'
    let cur = readFileSync(b.path, 'utf8')
    const k = cur.search(/^##\s+Après la réunion[^\n]*$/m)
    if (k >= 0) {
      const rest = cur.slice(k).replace(/^##[^\n]*\n/, '')
      const next = rest.search(/^## /m)
      cur = cur.slice(0, k) + section + (next >= 0 ? `\n${rest.slice(next)}` : '')
    } else cur = `${cur.trimEnd()}\n\n${section}`
    write(b.path, cur)
  }

  async function summarize(id: string) {
    const n = get(id)
    if (!n) return
    flush(id)
    n.state = 'summarizing'
    n.error = undefined
    n.endedAt ??= Date.now()
    change(n)
    try {
      const project = d.projects().find((p) => p.id === n.projectId)
      const input: NotesSummaryInput = {
        title: n.title,
        projectName: project?.name,
        projectPath: project?.path,
        brief: n.meetingId ? agendaBrief(n.meetingId)?.markdown : undefined,
        transcript: transcript(n),
        startedAt: n.startedAt,
        endedAt: n.endedAt,
        now: Date.now()
      }
      if (!n.segments.length) throw new Error('Aucune parole transcrite : rien à résumer.')
      n.summary = await d.rpc<string>('makeNotesSummary', input)
      n.state = 'done'
      try {
        appendToBrief(n, n.summary)
      } catch (e) {
        console.log('[notes] brief non complété :', msg(e))
      }
    } catch (e) {
      n.state = 'error'
      n.error = msg(e)
    }
    live.delete(id)
    change(n)
  }

  ipcMain.handle('notes:list', (): MeetingNoteMeta[] => {
    const out: MeetingNoteMeta[] = []
    try {
      for (const f of readdirSync(dir()).filter((x) => x.endsWith('.json'))) {
        const n = get(f.slice(0, -5))
        if (!n) continue
        const { segments, summary: _s, draft: _d, speakers: _k, ...meta } = n
        out.push({ ...meta, count: segments.length })
      }
    } catch {
      /* aucun dossier : aucune note */
    }
    return out.sort((a, b) => b.startedAt - a.startedAt)
  })
  ipcMain.handle('notes:get', (_e, id: string) => get(id))
  ipcMain.handle('notes:removeSeg', (_e, id: string, segId: string) => {
    const n = get(id)
    if (!n) return
    n.segments = n.segments.filter((s) => s.id !== segId)
    if (live.has(id)) live.set(id, n)
    save(n)
    d.emit(id)
  })
  ipcMain.handle('notes:rename', (_e, id: string, title: string) => {
    const n = get(id)
    const t = title.trim()
    if (!n || !t) return
    n.title = t.slice(0, 120)
    if (live.has(id)) live.set(id, n)
    save(n)
    d.emit(id)
  })
  ipcMain.handle('notes:start', (_e, p: { title: string; meetingId?: string }) => {
    const m = p.meetingId ? agendaMeeting(p.meetingId) : undefined
    const n: MeetingNote = {
      id: `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`,
      title: p.title?.trim() || m?.title || 'Réunion',
      meetingId: p.meetingId,
      projectId: m?.projectId ?? null,
      startedAt: Date.now(),
      state: 'recording',
      count: 0,
      segments: []
    }
    live.set(n.id, n)
    change(n)
    return n
  })
  ipcMain.handle('notes:append', (_e, id: string, segs: NoteSeg[], state?: 'recording' | 'paused') => {
    const n = get(id)
    if (!n) return
    live.set(id, n)
    const seen = new Set(n.segments.map((s) => s.id))
    for (const s of segs ?? []) if (!seen.has(s.id)) n.segments.push(s)
    if (state) n.state = state
    n.count = n.segments.length
    if (!timers.has(id)) {
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id)
          save(n)
        }, 2000)
      )
    }
  })
  ipcMain.handle('notes:finish', async (_e, id: string) => {
    const n = get(id)
    if (n) n.endedAt = Date.now()
    try {
      await refine(id)
    } catch (e) {
      console.log('[notes] deuxième passe en échec :', msg(e))
    }
    await summarize(id)
  })
  ipcMain.handle('notes:nameSpeaker', (_e, id: string, speakerId: string, name: string) => {
    const n = get(id)
    const sp = n?.speakers?.find((x) => x.id === speakerId)
    if (!n || !sp) return
    sp.name = String(name ?? '').trim().slice(0, 60) || undefined
    if (live.has(id)) live.set(id, n)
    change(n)
  })
  ipcMain.handle('notes:summarize', (_e, id: string) => summarize(id))
  ipcMain.handle('notes:delete', (_e, id: string) => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    live.delete(id)
    try {
      unlinkSync(fileOf(id))
    } catch {
      /* déjà supprimée */
    }
    d.emit(id)
  })
  ipcMain.handle('notes:toChecklist', async (_e, id: string, projectId: string, items: string[]) => {
    try {
      const n = get(id)
      const prefix = n?.title.replace(/\s+/g, ' ').trim().slice(0, 30) ?? ''
      const texts = items.map((t) => (prefix ? `${prefix} · ${t}` : t))
      const found = (await d.rpc<ChecklistSummary[]>('listChecklists')).find((c) => c.projectId === projectId && c.title === 'Actions de réunion')
      if (found) await d.rpc('updateChecklist', found.id, texts.map((text) => ({ op: 'add', text })))
      else await d.rpc('createChecklist', projectId, 'Actions de réunion', texts)
      return { ok: true as const }
    } catch (e) {
      return { ok: false as const, error: msg(e) }
    }
  })
}
