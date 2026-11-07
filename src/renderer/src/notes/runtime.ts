import { create } from 'zustand'
import type { NoteSeg } from '../../../shared/notes'
import { api } from '../store'
import { micChime, stopVoice, useVoice } from '../voice/runtime'

// Notes de réunion (étape 2a) : deux pistes (micro, son du PC) envoyées au service vocal en mode notes.
// Tout est au niveau du module : l'enregistrement continue quand on change de vue.

type Track = 'mic' | 'pc'
export type NotesLang = 'fr' | 'en' | 'nl' | 'auto'
const LANG_KEY = 'atelier.notes.lang'
const savedLang = (): NotesLang => {
  try {
    const v = localStorage.getItem(LANG_KEY)
    return v === 'fr' || v === 'en' || v === 'nl' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

type Status = 'idle' | 'starting' | 'recording' | 'paused'

type NotesState = {
  status: Status
  noteId: string | null
  /** Dernière prise de notes terminée, pour ouvrir son résultat. */
  lastNoteId: string | null
  title: string
  segs: NoteSeg[]
  micSpeaking: boolean
  pcSpeaking: boolean
  /** Le son du PC est transcrit (sinon : micro seul). */
  pcOk: boolean
  warning: string
  error: string
  /** Langue de la réunion envoyée au service (fr, en, nl ou auto). */
  lang: NotesLang
  /** Démarrage : étape en cours, affichée pendant l’attente. */
  step: string
  /** Durée enregistrée, ms (pauses exclues). */
  elapsed: number
}

const IDLE: NotesState = { status: 'idle', noteId: null, lastNoteId: null, title: '', segs: [], micSpeaking: false, pcSpeaking: false, pcOk: false, warning: '', error: '', step: '', lang: 'auto', elapsed: 0 }
export const useNotes = create<NotesState>(() => IDLE)
const set = useNotes.setState

type Chain = { track: Track; ws: WebSocket; stream: MediaStream; ctx: AudioContext }
let chains: Chain[] = []
let noteId: string | null = null
let unflushed: NoteSeg[] = []
let pending: { seg: NoteSeg; at: number }[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let tick: ReturnType<typeof setInterval> | null = null
let runStart = 0
let acc = 0
let starting = false
let lastSegAt = 0

export const notesActive = () => useNotes.getState().status !== 'idle'

/* ---------- Dédoublonnage de l'écho ---------- */
// Le micro entend aussi les haut-parleurs : une phrase de la visio arrive sur les deux pistes, découpée autrement.
// Deux segments qui se recouvrent dans le temps (±3 s) sont « le même » si la plupart des mots du plus court sont
// dans l'autre. Un segment micro attend tant que la piste PC parle (et 3 s après) ; un segment PC qui arrive plus
// tard efface aussi un segment micro déjà affiché.

const words = (s: string) => new Set(s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean))
function similar(a: NoteSeg, b: NoteSeg) {
  if (a.t0 > b.t1 + 3000 || b.t0 > a.t1 + 3000) return false
  const x = words(a.text)
  const y = words(b.text)
  if (!x.size || !y.size) return false
  let n = 0
  x.forEach((w) => y.has(w) && n++)
  return n >= Math.min(3, x.size, y.size) && n / Math.min(x.size, y.size) >= 0.5
}

let pcQuietAt = 0
let sweepTimer: ReturnType<typeof setInterval> | null = null

function commit(seg: NoteSeg) {
  unflushed.push(seg)
  set((s) => ({ segs: [...s.segs, seg] }))
}

/** Les segments micro en attente partent quand la piste PC s'est tue depuis 3 s (30 s d'attente au plus). */
function sweep(all = false) {
  const now = Date.now()
  const pcBusy = useNotes.getState().pcSpeaking || now - pcQuietAt < 3000
  pending = pending.filter((p) => {
    if (all || !pcBusy || now - p.at > 30_000) {
      commit(p.seg)
      return false
    }
    return true
  })
}

/** Oublier une ligne (clic sur la croix, ou écho repéré après coup). */
export function removeSeg(segId: string) {
  unflushed = unflushed.filter((s) => s.id !== segId)
  set((s) => ({ segs: s.segs.filter((x) => x.id !== segId) }))
  if (noteId) void api.notesRemoveSeg(noteId, segId).catch(() => {})
}

function onSeg(track: Track, m: { who: NoteSeg['who']; text: string; lang?: string; t0: number; t1: number }) {
  const text = String(m.text ?? '').trim()
  if (!text) return
  const seg: NoteSeg = { id: crypto.randomUUID(), track, who: m.who, t0: m.t0, t1: m.t1, text, lang: m.lang ?? undefined }
  lastSegAt = Date.now()
  if (track === 'pc') {
    pending = pending.filter((p) => !similar(p.seg, seg))
    useNotes.getState().segs.filter((s) => s.track === 'mic' && similar(s, seg)).forEach((s) => removeSeg(s.id))
    return commit(seg)
  }
  if (useNotes.getState().segs.some((s) => s.track === 'pc' && similar(seg, s))) return
  if (!chains.some((c) => c.track === 'pc')) return commit(seg)
  pending.push({ seg, at: Date.now() })
}

function flush(state?: 'recording' | 'paused') {
  if (!noteId || (!unflushed.length && !state)) return
  const segs = unflushed
  unflushed = []
  void api.notesAppend(noteId, segs, state).catch(() => { unflushed = [...segs, ...unflushed] })
}

/* ---------- Capture ---------- */

function pipe(track: Track, stream: MediaStream, ws: WebSocket): Chain {
  const ctx = new AudioContext({ sampleRate: 16000 })
  const src = ctx.createMediaStreamSource(stream)
  const proc = ctx.createScriptProcessor(512, 1, 1)
  proc.onaudioprocess = (e) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(new Float32Array(e.inputBuffer.getChannelData(0)).buffer)
  }
  const mute = ctx.createGain()
  mute.gain.value = 0
  src.connect(proc)
  proc.connect(mute).connect(ctx.destination)
  ws.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return
    let m: any
    try {
      m = JSON.parse(ev.data)
    } catch {
      return
    }
    if (m.type === 'ready') ws.send(JSON.stringify({ type: 'lang', value: useNotes.getState().lang }))
    else if (m.type === 'seg') onSeg(track, m)
    else if (m.type === 'speech') {
      if (track === 'pc' && !m.on) pcQuietAt = Date.now()
      set(track === 'mic' ? { micSpeaking: !!m.on } : { pcSpeaking: !!m.on })
    }
  }
  ws.onclose = () => {
    if (noteId && chains.some((c) => c.ws === ws)) set({ warning: 'Le service voix s’est déconnecté : la transcription est interrompue.' })
  }
  return { track, ws, stream, ctx }
}

const open = (port: number, token: string, track: Track, id: string) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/?t=${token}&mode=notes&track=${track}&note=${id}&lang=${useNotes.getState().lang}`)
  ws.binaryType = 'arraybuffer'
  return ws
}

function release() {
  chains.forEach((c) => {
    c.ws.onclose = null
    c.ws.close()
    c.stream.getTracks().forEach((t) => t.stop())
    void c.ctx.close()
  })
  chains = []
  if (flushTimer) clearInterval(flushTimer)
  if (sweepTimer) clearInterval(sweepTimer)
  sweepTimer = null
  if (tick) clearInterval(tick)
  flushTimer = tick = null
}

export async function startNotes(p: { title: string; meetingId?: string }) {
  if (notesActive() || starting) return
  starting = true
  set({ ...IDLE, lastNoteId: useNotes.getState().lastNoteId, status: 'starting', step: 'Accès au micro…', lang: savedLang() })
  let mic: MediaStream | null = null
  let pc: MediaStream | null = null
  try {
    const ph = useVoice.getState().phase
    if (ph !== 'off' && ph !== 'error') stopVoice()
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
    let warning = ''
    set({ step: 'Capture du son du PC…' })
    try {
      // Sans réponse en 15 s (fenêtre de partage restée ouverte), on continue avec le micro seul.
      const d = await Promise.race([navigator.mediaDevices.getDisplayMedia({ audio: true, video: true }), new Promise<never>((_, no) => setTimeout(() => no(new Error('délai')), 15_000))])
      d.getVideoTracks().forEach((t) => { t.stop(); d.removeTrack(t) })
      if (d.getAudioTracks().length) pc = d
      else throw new Error('no audio')
    } catch {
      warning = 'Son du PC indisponible : seule la pièce est transcrite.'
    }
    set({ step: 'Démarrage du service de transcription (jusqu’à une minute la première fois)…' })
    const info = await api.voiceStart(useVoice.getState().voice)
    if (!info.ok) throw new Error(info.error)
    const note = await api.notesStart(p)
    noteId = note.id
    chains = [pipe('mic', mic, open(info.port, info.token, 'mic', note.id))]
    if (pc) chains.push(pipe('pc', pc, open(info.port, info.token, 'pc', note.id)))
    unflushed = []
    pending = []
    acc = 0
    runStart = Date.now()
    set({ status: 'recording', step: '', noteId: note.id, title: note.title, pcOk: !!pc, warning })
    flushTimer = setInterval(() => flush(), 2000)
    sweepTimer = setInterval(() => sweep(), 500)
    tick = setInterval(() => set({ elapsed: acc + (useNotes.getState().status === 'recording' ? Date.now() - runStart : 0) }), 500)
  } catch (e) {
    mic?.getTracks().forEach((t) => t.stop())
    pc?.getTracks().forEach((t) => t.stop())
    release()
    noteId = null
    set({ status: 'idle', step: '', error: `Prise de notes impossible : ${String((e as Error)?.message ?? e)}` })
  } finally {
    starting = false
  }
}

/** Langue de la réunion : changeable pendant l'enregistrement, retenue pour la prochaine fois. */
export function setNotesLang(lang: NotesLang) {
  set({ lang })
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    /* stockage indisponible */
  }
  chains.forEach((c) => c.ws.readyState === WebSocket.OPEN && c.ws.send(JSON.stringify({ type: 'lang', value: lang })))
}

export function pauseNotes(on: boolean) {
  const s = useNotes.getState()
  if (!noteId || s.status === 'idle' || (s.status === 'paused') === on) return
  if (on) acc += Date.now() - runStart
  else runStart = Date.now()
  chains.forEach((c) => c.ws.readyState === WebSocket.OPEN && c.ws.send(JSON.stringify({ type: 'pause', on })))
  set({ status: on ? 'paused' : 'recording', micSpeaking: false, pcSpeaking: false, elapsed: acc })
  flush(on ? 'paused' : 'recording')
  micChime(on)
}

export async function finishNotes() {
  const id = noteId
  if (!id) return
  // Une pause fait sortir la phrase en cours de transcription ; fermer la connexion la perdrait. On attend donc
  // 2,5 s sans nouveau segment (8 s au plus) avant de couper.
  if (useNotes.getState().status === 'recording') acc += Date.now() - runStart
  chains.forEach((c) => c.ws.readyState === WebSocket.OPEN && c.ws.send(JSON.stringify({ type: 'pause', on: true })))
  set({ status: 'paused', micSpeaking: false, pcSpeaking: false, elapsed: acc })
  const t0 = Date.now()
  lastSegAt = t0
  while (Date.now() - t0 < 8000 && Date.now() - lastSegAt < 2500) await new Promise((r) => setTimeout(r, 250))
  // Les segments micro encore en attente d'un éventuel écho partent tels quels.
  sweep(true)
  release()
  flush()
  noteId = null
  set({ ...IDLE, lastNoteId: id })
  void api.notesFinish(id).catch(() => {})
}
