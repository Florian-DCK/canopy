import { create } from 'zustand'
import type { SceneBlock } from '../../../shared/scene'
import type { FileDiff, Item, MediaItem } from '../../../shared/types'
import { api, useStore } from '../store'
import { speakNumbers } from './numbers'
import { withTransition } from './transition'
import { gestureChime } from '../uiAgent'
import { useVoicePrefs, voiceConfig } from './prefs'
import { useMyVoice } from './myvoice'

// Mode voix (planches 25 et 28) : la fenêtre capte le micro (écho retiré par Chromium) et joue la voix ;
// le service local (voice/server.py) transcrit et synthétise. On parle à une vraie session de Canopy :
// Claude garde ses outils, dont l'outil interface pour montrer sans parler.

export type VoicePhase = 'off' | 'waking' | 'listen' | 'think' | 'speak' | 'error'
export const VOICES = [
  { id: 'ana', label: 'Ana' },
  { id: 'damien', label: 'Damien' },
  { id: 'openai-cedar', label: 'Cedar · OpenAI' },
  { id: 'openai-marin', label: 'Marin · OpenAI' }
] as const
const VOICE_KEY = 'atelier.voice.name'
const MUTE_KEY = 'atelier.voice.mute'
const STAGE_KEY = 'atelier.voice.stage'
/** Préfixe des messages dits à voix haute : le harnais demande à Claude d'y répondre à l'oral. */
export const SPOKEN_MARK = '🎙 '

/** Ce que la scène montre à droite du soleil pendant le tour (vidée au tour suivant). */
export type StageEntry =
  | { id: string; kind: 'image' | 'video'; media: MediaItem }
  | { id: string; kind: 'diff'; diff: FileDiff }
  | { id: string; kind: 'artifact'; url: string; title?: string }
  | { id: string; kind: 'scene'; block: SceneBlock }
  /** Fichiers modifiés pendant le tour : ampleur et une phrase par fichier (pas de code). */
  | { id: string; kind: 'changes'; files: ChangedFile[] }
  /** Deux captures du même élément de Canopy pendant le tour : avant, après. */
  | { id: string; kind: 'ba'; before: MediaItem; after: MediaItem; label: string }

export type ChangedFile = { path: string; added: number; removed: number; note?: string }

type VoiceState = {
  stage: StageEntry[]
  /** Entrée affichée en grand (null = la dernière). */
  stageSel: string | null
  phase: VoicePhase
  /** Tu es en train de parler (détection de voix). */
  speech: boolean
  /** Ce que tu as dit (en cours puis final). */
  heard: string
  /** La phrase que Claude est en train de dire. */
  said: string
  /** Tout ce que Claude a écrit pendant le tour (affiché en mode fantôme). */
  written: string
  /** Phrases dites pendant le tour, et celle qu'on entend à l'instant (suivie au rythme de la voix). */
  spoken: { id: string; text: string }[]
  speaking: string | null
  /** Mot prononcé à l'instant dans la ligne `speaking` (estimé sur l'horloge de lecture). */
  word: number
  /** Début du passage parlé en cours dans `spoken` : chaque reprise de parole ouvre un nouveau transcript. */
  burst: number
  /** Claude a fait un geste sur l'interface pendant ce tour, sans parler. */
  gesture: boolean
  sessionId: string | null
  error: string
  voice: string
  /** Claude travaille pareil mais ne répond pas à voix haute (sa réponse reste écrite). */
  mute: boolean
  /** Micro coupé par l'utilisateur : plus rien n'est envoyé au service voix. */
  micMuted: boolean
}

export const useVoice = create<VoiceState>(() => ({
  phase: 'off',
  stage: (() => {
    try {
      return JSON.parse(localStorage.getItem(STAGE_KEY) ?? '[]') as StageEntry[]
    } catch {
      return []
    }
  })(),
  stageSel: null,
  written: '',
  spoken: [],
  speaking: null,
  word: 0,
  burst: 0,
  speech: false,
  heard: '',
  said: '',
  gesture: false,
  sessionId: null,
  error: '',
  micMuted: false,
  mute: (() => {
    try {
      return localStorage.getItem(MUTE_KEY) === '1'
    } catch {
      return false
    }
  })(),
  voice: (() => {
    try {
      return localStorage.getItem(VOICE_KEY) || 'ana'
    } catch {
      return 'ana'
    }
  })()
}))
const set = useVoice.setState

// ---------- session visée ----------
// Le mode voix reste attaché à sa session, même après un redémarrage du moteur (les identifiants changent alors :
// on la retrouve par son identifiant Claude Code). Sans session choisie : la dernière regardée.
const SESSION_KEY = 'atelier.voice.session'
type Saved = { id: string; sdk?: string }
let saved: Saved | null = (() => {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    return raw.startsWith('{') ? (JSON.parse(raw) as Saved) : { id: raw }
  } catch {
    return null
  }
})()
function remember(id: string) {
  const sdk = useStore.getState().sessions[id]?.sdkSessionId
  saved = { id, sdk }
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(saved))
  } catch {
    /* stockage indisponible */
  }
}
useStore.subscribe((s, prev) => {
  // Hors mode voix, la session regardée devient la cible.
  if (s.view.name === 'session' && useVoice.getState().phase === 'off' && saved?.id !== s.view.sessionId) remember(s.view.sessionId)
  // Passer d'une session au mode voix (bouton de la barre) : on parle à cette session-là, même si la voix tournait déjà.
  if (s.view.name === 'voice' && prev.view.name === 'session' && prev.view.sessionId !== useVoice.getState().sessionId) {
    const sid = prev.view.sessionId
    if (s.sessions[sid] && !s.sessions[sid].readOnly) setVoiceSession(sid)
  }
})
function targetSession(): string | null {
  const { sessions } = useStore.getState()
  const ok = (id?: string | null) => !!id && !!sessions[id] && !sessions[id].readOnly
  const cur = useVoice.getState().sessionId
  if (ok(cur)) return cur
  if (ok(saved?.id)) return saved!.id
  if (saved?.sdk) {
    const hit = Object.values(sessions).find((x) => x.sdkSessionId === saved!.sdk && !x.readOnly)
    if (hit) return hit.id
  }
  return Object.values(sessions).filter((x) => !x.readOnly).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null
}

/** Changer de session sans quitter le mode voix. */
export function setVoiceSession(id: string) {
  remember(id)
  turn = null
  set({ sessionId: id, heard: '', said: '', written: '', gesture: false })
}

// ---------- texte écrit → phrases à dire ----------
const SENTENCE = /^(.+?[.!?…:])(\s+|$)/s
function speakable(md: string): string {
  return speakNumbers(md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_~|]/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\s+/g, ' '))
}


// ---------- état du moteur ----------
let ws: WebSocket | null = null
let micCtx: AudioContext | null = null
let micStream: MediaStream | null = null
let playCtx: AudioContext | null = null
let rate = 24000
let playEnd = 0
let sources: AudioBufferSourceNode[] = []
/** Interrompu par un bruit ? On garde les phrases restantes ; si ce n'était pas de la parole, Claude reprend. */
let held: string[] | null = null
let speechTimer: ReturnType<typeof setTimeout> | null = null
let turn: { start: number; spoken: Map<string, number>; pending: string; ran: boolean; done: boolean; dropped: boolean } | null = null
let saysOut = 0
let unsub: (() => void) | null = null
let sayId = 0
/** Phrase en cours de synthèse (son audio arrive). */
let genId = ''
let analyser: AnalyserNode | null = null
let bins = new Uint8Array(0)

/** Volume de la voix par barre (0 à 1), graves au centre, aigus sur les bords, comme une onde symétrique. */
export function voiceLevels(n: number): number[] {
  if (!analyser) return []
  analyser.getByteFrequencyData(bins)
  const half = Math.ceil(n / 2)
  const span = Math.min(bins.length, 48) // la voix tient dans les premières bandes
  const out = new Array<number>(n)
  for (let k = 0; k < half; k++) {
    const v = bins[Math.floor((k / half) * span)] / 255
    out[half - 1 - k] = v
    out[n - half + k] = v
  }
  return out
}
/** Audio accepté à partir de cette phrase (ce qui était en route avant une coupure est ignoré). */
let minId = 1
let accept = true

function send(o: object) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o))
}

/** Texte envoyé à la voix ; `parts` : ses phrases, affichées chacune sur sa ligne (bloc entier des voix OpenAI). */
function say(text: string, parts?: string[]) {
  const t = text.trim()
  if (!t || !/[\p{L}\p{N}]/u.test(t) || useVoice.getState().mute) return
  if (held) {
    held.push(t)
    return
  }
  saysOut++
  const id = String(++sayId)
  const lines = (parts?.length ? parts : [t]).map((x, k) => ({ id: k ? `${id}.${k}` : id, text: x.trim() }))
  plays.set(id, { at: -1, dur: 0, done: false, lines })
  set((v) => ({ spoken: [...v.spoken, ...lines] }))
  send({ type: 'say', id, text: t })
}

// ---------- mot prononcé (estimé) ----------
// La voix ne donne pas le minutage des mots : on le déduit de la position de lecture, au prorata de la longueur des
// mots, sur la durée du son (reçue en entier bien avant la fin de la lecture ; estimée d'ici là).
type Play = { at: number; dur: number; done: boolean; lines: { id: string; text: string }[] }
const plays = new Map<string, Play>()
let secPerChar = 0.055
let wordTimer: ReturnType<typeof setInterval> | null = null

function stopWordClock() {
  if (wordTimer) clearInterval(wordTimer)
  wordTimer = null
  plays.clear()
}

function tickWords() {
  if (!playCtx) return
  const now = playCtx.currentTime
  let cur: Play | undefined
  for (const p of plays.values()) if (p.at >= 0 && p.at <= now) cur = p
  if (!cur) return
  const words = cur.lines.map((l) => l.text.split(/\s+/).filter(Boolean))
  const total = words.flat().reduce((n, w) => n + w.length + 1, 0)
  const est = cur.done ? cur.dur : Math.max(cur.dur, total * secPerChar)
  let pos = (Math.min(1, (now - cur.at) / est) || 0) * total
  for (let k = 0; k < words.length; k++) {
    for (let w = 0; w < words[k].length; w++) {
      pos -= words[k][w].length + 1
      if (pos < 0 || (k === words.length - 1 && w === words[k].length - 1)) {
        const v = useVoice.getState()
        if (v.speaking !== cur.lines[k].id || v.word !== w) set({ speaking: cur.lines[k].id, word: w })
        return
      }
    }
  }
}

function stopPlayback() {
  for (const s of sources) {
    try {
      s.stop()
    } catch {
      /* déjà fini */
    }
  }
  sources = []
  stopWordClock()
  playEnd = 0
  saysOut = 0
  minId = sayId + 1
  accept = false
}

function play(chunk: ArrayBuffer) {
  if (!playCtx || !accept) return
  const data = new Float32Array(chunk)
  if (!data.length) return
  const buf = playCtx.createBuffer(1, data.length, rate)
  buf.copyToChannel(data, 0)
  const src = playCtx.createBufferSource()
  src.buffer = buf
  src.connect(analyser ?? playCtx.destination)
  const at = Math.max(playEnd, playCtx.currentTime + 0.04)
  src.start(at)
  // Le mot mis en avant suit l'horloge de lecture (tickWords) à partir de la première note de la phrase.
  const p = plays.get(genId)
  if (p) {
    if (p.at < 0) p.at = at
    p.dur += buf.duration
    wordTimer ??= setInterval(tickWords, 60)
  }
  playEnd = at + buf.duration
  sources.push(src)
  src.onended = () => {
    sources = sources.filter((x) => x !== src)
    maybeEndTurn()
    // Plus rien à dire pour l'instant mais Claude continue à travailler : on repasse en « travaille », le transcript se ferme.
    if (turn && !turn.done && !sources.length && saysOut === 0 && useVoice.getState().phase === 'speak') set({ phase: 'think' })
  }
  if (useVoice.getState().phase !== 'speak') {
    // Nouvelle prise de parole : le transcript repart de la phrase qui commence.
    const v = useVoice.getState()
    const k = v.spoken.findIndex((l) => l.id === genId)
    set({ phase: 'speak', burst: k >= 0 ? k : Math.max(0, v.spoken.length - 1) })
  }
}

/** Fin du tour : Claude a fini d'écrire et tout ce qu'il avait à dire a été joué. */
function maybeEndTurn() {
  if (!turn?.done || saysOut > 0 || sources.length || held) return
  turn = null
  stopWordClock()
  send({ type: 'listen' })
  set({ phase: 'listen', said: '' })
}

/** Suit la session pendant le tour : nouvelles phrases → voix ; outil interface → geste sans parole. */
let resumed = true

function follow() {
  const st = useStore.getState()
  if (!resumed) {
    const rs = targetSession()
    if (!rs || !(st.items[rs]?.length)) return
    resumed = true
    resumeTurn()
  }
  const sid = useVoice.getState().sessionId
  if (!turn || !sid) return
  const items: Item[] = st.items[sid] ?? []
  const status = st.sessions[sid]?.status
  if (status === 'run') turn.ran = true
  collectStage(sid, items, turn.start)
  // Voix OpenAI : un bloc de texte part entier, une fois fini (suivi d'autre chose, ou tour terminé) : une seule
  // demande, une intonation d'un seul souffle et pas de blanc entre les phrases. Voix locales : phrase par phrase.
  const whole = useVoice.getState().voice.startsWith('openai-')
  const last = items[items.length - 1]
  for (const it of items) {
    if (whole && it === last && status === 'run') continue
    if (it.at < turn.start) continue
    if (it.kind === 'tool' && it.name === 'mcp__atelier__interface') {
      if (!useVoice.getState().gesture) set({ gesture: true })
      // Après un geste, le texte de Claude n'est pas lu : le son et l'écran suffisent (il reste visible dans la session).
      turn.dropped = true
    }
    if (it.kind !== 'text' || it.parent || turn.dropped) continue
    const done = turn.spoken.get(it.id) ?? 0
    if (it.text.length <= done) continue
    turn.pending += it.text.slice(done)
    turn.spoken.set(it.id, it.text.length)
    if (whole) {
      const s = speakable(turn.pending)
      if (s.trim()) {
        const parts: string[] = []
        let rest = s
        let p: RegExpExecArray | null
        while ((p = SENTENCE.exec(rest))) {
          parts.push(p[1])
          rest = rest.slice(p[0].length)
        }
        if (rest.trim()) parts.push(rest)
        say(s, parts)
        set((v) => ({ said: s.trim(), written: `${v.written} ${s.trim()}`.trim() }))
      }
      turn.pending = ''
      continue
    }
    let m: RegExpExecArray | null
    while ((m = SENTENCE.exec(turn.pending))) {
      const s = speakable(m[1])
      if (s.trim()) {
        say(s)
        set((v) => ({ said: s.trim(), written: `${v.written} ${s.trim()}`.trim() }))
      }
      turn.pending = turn.pending.slice(m[0].length)
    }
  }
  if (turn.ran && status !== 'run' && !turn.done) {
    if (!turn.dropped && turn.pending.trim()) {
      const s = speakable(turn.pending)
      say(s)
      set((v) => ({ said: s.trim(), written: `${v.written} ${s.trim()}`.trim() }))
    }
    turn.pending = ''
    turn.done = true
    if (status === 'wait') set({ said: 'Claude attend ta réponse à l’écran.' })
    maybeEndTurn()
  }
}

/** Ajoute à la scène les images et artefacts apparus depuis le début du tour. */
function collectStage(sid: string, items: Item[], since: number) {
  const cur = useVoice.getState().stage
  const have = new Set(cur.map((e) => e.id))
  const add: StageEntry[] = []
  for (const it of items) {
    if (it.at < since || it.kind !== 'tool') continue
    // Les fichiers modifiés ne vont pas à l'écran en code : ils forment le récap (voir plus bas).
    if (it.artifact && !have.has(it.id)) add.push({ id: it.id, kind: 'artifact', url: it.artifact.url, title: it.artifact.title })
  }
  const said = items.filter((i) => i.at >= since && i.kind === 'text').map((i) => (i as { text: string }).text.toLowerCase()).join('\n')
  // Avant · après : les captures de Canopy faites avec les mêmes réglages (même vue, même élément) pendant le tour.
  const tools = new Map(items.filter((i) => i.kind === 'tool' && i.at >= since).map((i) => [i.id, i as Extract<Item, { kind: 'tool' }>]))
  const shots = new Map<string, MediaItem[]>()
  for (const m of useStore.getState().media[sid] ?? []) {
    const t = tools.get(m.itemId)
    if (m.kind !== 'image' || t?.name !== 'mcp__atelier__capture') continue
    shots.set(t.summary, [...(shots.get(t.summary) ?? []), m])
  }
  const paired = new Set<string>()
  for (const [label, ms] of shots) {
    if (ms.length < 2) continue
    const id = `ba:${ms[0].id}`
    ms.forEach((m) => paired.add(m.id))
    const after = ms[ms.length - 1]
    const old = cur.find((e) => e.id === id)
    if (!old) add.push({ id, kind: 'ba', before: ms[0], after, label: baLabel(label) })
    else if (old.kind === 'ba' && old.after.id !== after.id) set((v) => ({ stage: v.stage.map((e) => (e.id === id ? { ...old, after } : e)) }))
  }
  for (const m of useStore.getState().media[sid] ?? []) {
    const cited = m.source === 'mention' && said.includes(m.path.toLowerCase())
    if ((m.at >= since || cited) && (m.kind === 'image' || m.kind === 'video') && m.source !== 'attach' && !have.has(m.id) && !paired.has(m.id)) add.push({ id: m.id, kind: m.kind, media: m })
  }
  // Une capture déjà montrée seule qui trouve sa paire : elle laisse la place à l'avant · après.
  if (paired.size && cur.some((e) => paired.has(e.id))) set((v) => ({ stage: v.stage.filter((e) => !paired.has(e.id)) }))
  collectChanges(items, since, add)
  if (add.length) setStage(add)
}

/** « {"mode":"current","selector":".v-bar"} » → « .v-bar » : de quoi nommer l'élément. */
function baLabel(summary: string): string {
  try {
    const o = JSON.parse(summary)
    return o.selector ?? o.view ?? 'Canopy'
  } catch {
    return /"selector":"([^"]+)"/.exec(summary)?.[1] ?? 'Canopy'
  }
}

/** Phrase d'un fichier dans la réponse du résumé : chemins comparés sans tenir compte des barres ni de la casse. */
function noteFor(got: Record<string, string>, path: string): string {
  const key = (p: string) => p.replace(/\\/g, '/').toLowerCase()
  const base = (p: string) => key(p).split('/').pop()
  const hit = Object.entries(got).find(([k]) => key(k) === key(path)) ?? Object.entries(got).find(([k]) => base(k) === base(path))
  return hit?.[1] ?? ''
}

/** Récap des fichiers modifiés : une seule entrée par tour, mise à jour au fil des modifications. */
let recapTimer: ReturnType<typeof setTimeout> | null = null
function collectChanges(items: Item[], since: number, add: StageEntry[]) {
  const by = new Map<string, { path: string; added: number; removed: number; lines: string[] }>()
  for (const it of items) {
    if (it.at < since || it.kind !== 'tool' || !it.diff) continue
    // Seulement les fichiers du projet (chemin relatif) : pas les fichiers de travail temporaires.
    if (/^([A-Za-z]:|[\\/])/.test(it.diff.path)) continue
    const f = by.get(it.diff.path) ?? { path: it.diff.path, added: 0, removed: 0, lines: [] }
    f.added += it.diff.added
    f.removed += it.diff.removed
    f.lines.push(...it.diff.lines.filter((l) => l.t !== ' ').slice(0, 40).map((l) => `${l.t}${l.s}`))
    by.set(it.diff.path, f)
  }
  if (!by.size) return
  const id = `changes:${since}`
  const prev = useVoice.getState().stage.find((e) => e.id === id)
  const notes = prev?.kind === 'changes' ? Object.fromEntries(prev.files.map((f) => [f.path, f.note])) : {}
  const files: ChangedFile[] = [...by.values()].map((f) => ({ path: f.path, added: f.added, removed: f.removed, note: notes[f.path] }))
  if (prev?.kind === 'changes') {
    if (JSON.stringify(prev.files.map((f) => [f.path, f.added, f.removed])) === JSON.stringify(files.map((f) => [f.path, f.added, f.removed]))) return
    set((v) => ({ stage: v.stage.map((e) => (e.id === id ? { id, kind: 'changes', files } : e)) }))
  } else {
    // Un seul récap à l'écran : celui du tour en cours remplace les anciens.
    if (useVoice.getState().stage.some((e) => e.kind === 'changes')) set((v) => ({ stage: v.stage.filter((e) => e.kind !== 'changes') }))
    add.push({ id, kind: 'changes', files })
  }
  // Les phrases arrivent quand les modifications se calment (3 s sans nouveau changement).
  if (recapTimer) clearTimeout(recapTimer)
  recapTimer = setTimeout(() => {
    const todo = [...by.values()].filter((f) => !notes[f.path]).map((f) => ({ path: f.path, lines: f.lines.join('\n') }))
    if (!todo.length) return
    void api
      .summarizeChanges(todo)
      .then((got) =>
        set((v) => ({ stage: v.stage.map((e) => (e.id === id && e.kind === 'changes' ? { ...e, files: e.files.map((f) => ({ ...f, note: f.note ?? noteFor(got, f.path) })) } : e)) }))
      )
      // Résumé indisponible (moteur pas à jour, hors ligne) : pas de « Je résume… » sans fin.
      .catch(() => set((v) => ({ stage: v.stage.map((e) => (e.id === id && e.kind === 'changes' ? { ...e, files: e.files.map((f) => ({ ...f, note: f.note ?? '' })) } : e)) })))
  }, 3000)
}

/** Premier ajout d'un tour : remplace la scène ; ensuite, s'y ajoute. */
let stageReset = false
function setStage(add: StageEntry[]) {
  const apply = () => set((v) => ({ stage: stageReset ? add : [...v.stage, ...add], stageSel: null }))
  // Ouverture (le soleil glisse à gauche) ou remplacement (l'ancien bloc sort, le nouveau entre) : toujours animé.
  withTransition(apply)
  stageReset = false
}

/** Retirer ce qui est montré (bouton, ou Claude à ta demande). */
export function clearStage() {
  stageReset = false
  if (useVoice.getState().stage.length) withTransition(() => set({ stage: [], stageSel: null }))
}

useVoice.subscribe((v, p) => {
  if (v.stage === p.stage) return
  try {
    localStorage.setItem(STAGE_KEY, JSON.stringify(v.stage))
  } catch {
    /* stockage indisponible */
  }
})

/** Bloc posé par Claude (outil scène). */
export function pushScene(block: SceneBlock) {
  setStage([{ id: `scene-${Date.now()}`, kind: 'scene', block }])
}

export function selectStage(id: string | null) {
  withTransition(() => set({ stageSel: id }))
}

// Commandes du mode fantôme, traitées ici sans passer par Claude (Whisper entend parfois « monde fantôme »).
const GHOST_ON = /\b(passe|mets?|active|entre|bascule)\b.{0,20}\b(mode|monde)\s+fant[ôo]me\b|^\s*(mode|monde)\s+fant[ôo]me\W*$/i
const GHOST_OFF = /\b(quitte|sors|d[ée]sactive|arr[êe]te|coupe)\b.{0,20}\b(mode|monde)\s+fant[ôo]me\b|\b(reparle|parle)[- ]moi\b|\bmode\s+normal\b/i

/** Après un rechargement de la fenêtre : on retrouve le dernier tour parlé dans la session (ce que tu as dit,
 * la scène, la dernière phrase de Claude) et, si Claude travaille encore, on reprend la lecture de la suite. */
function resumeTurn() {
  const sid = targetSession()
  if (!sid) return
  const st = useStore.getState()
  const items = st.items[sid] ?? []
  let k = items.length - 1
  while (k >= 0 && !(items[k].kind === 'user' && (items[k] as { text: string }).text.startsWith(SPOKEN_MARK.trim()))) k--
  if (k < 0) return
  const u = items[k] as Extract<Item, { kind: 'user' }>
  const texts = items.slice(k + 1).filter((i): i is Extract<Item, { kind: 'text' }> => i.kind === 'text' && !i.parent)
  const last = texts.length ? speakable(texts[texts.length - 1].text).trim() : ''
  set({ sessionId: sid, heard: u.text.replace(SPOKEN_MARK.trim(), '').trim(), said: last, written: texts.map((t) => speakable(t.text).trim()).join(' '), stageSel: null })
  stageReset = true
  collectStage(sid, items, u.at)
  if (st.sessions[sid]?.status === 'run') {
    // Ce qui est déjà écrit a été lu avant le rechargement : on ne lira que la suite.
    turn = { start: u.at, spoken: new Map(texts.map((t) => [t.id, t.text.length])), pending: '', ran: true, done: false, dropped: false }
    set({ phase: 'think' })
  }
}

async function onFinal(text: string) {
  // Une phrase très courte qui contient « fantôme » (« un autre fantôme », « mode fantôme ») vaut aussi commande.
  const short = /fant[ôo]me/i.test(text) && text.trim().split(/\s+/).length <= 5
  // « Passe en mode compagnon » / « quitte le mode compagnon » : traité ici aussi, sans passer par Claude.
  // Commandes vocales seulement pour une phrase courte et directe : une phrase qui parle du mode (« désactive le fait
  // que… quand je reviens sur Canopy ») doit arriver à Claude, pas être prise pour un ordre.
  const brief = text.trim().split(/\s+/).length <= 6
  if (brief && /^\W*(stop|arr[êe]te(-toi)?|stoppe)\W*$/i.test(text)) {
    api.actStop()
    hush()
    const sid = useVoice.getState().sessionId
    if (sid) void api.interrupt(sid).catch(() => {})
    gestureChime()
    set({ heard: text, said: 'Arrêté.', gesture: false })
    send({ type: 'listen' })
    return
  }
  const comp = !brief ? null : /(quitte|sors|ferme|arr[êe]te).{0,25}compagn/i.test(text) ? false : /(passe|mets?|active|entre|bascule|lance).{0,25}compagn|^\W*(mode|monde)\s+compagn/i.test(text) ? true : null
  if (comp !== null) {
    gestureChime()
    set({ heard: text, said: '', gesture: false })
    send({ type: 'listen' })
    window.dispatchEvent(new CustomEvent('atelier:companion', { detail: comp }))
    return
  }
  const ghost = !brief ? null : GHOST_OFF.test(text) ? false : GHOST_ON.test(text) || short ? true : null
  if (ghost !== null) {
    setMute(ghost)
    gestureChime()
    set({ heard: text, said: ghost ? 'Mode fantôme : je t’écoute et je travaille, sans parler.' : 'Je te réponds de nouveau à voix haute.', gesture: false })
    send({ type: 'listen' })
    return
  }
  const sid = targetSession()
  if (!sid) {
    set({ heard: text, said: 'Ouvre d’abord une session : je lui transmettrai ce que tu dis.' })
    send({ type: 'listen' })
    return
  }
  // Ce qui est montré reste à l'écran : il sera remplacé par ce que le nouveau tour montrera. Les fichiers modifiés, eux, s'effacent.
  const kept = useVoice.getState().stage.filter((e) => e.kind !== 'diff')
  const next = () => set({ sessionId: sid, heard: text, said: '', written: '', spoken: [], speaking: null, burst: 0, gesture: false, phase: 'think', stage: kept, stageSel: null })
  if (kept.length !== useVoice.getState().stage.length) withTransition(next)
  else next()
  stageReset = true
  turn = { start: Date.now(), spoken: new Map(), pending: '', ran: false, done: false, dropped: false }
  saysOut = 0
  try {
    await api.send(sid, SPOKEN_MARK + text)
  } catch (e) {
    set({ phase: 'listen', said: `Envoi impossible : ${String((e as Error)?.message ?? e)}` })
    turn = null
    send({ type: 'listen' })
  }
}

function onMessage(ev: MessageEvent) {
  if (ev.data instanceof ArrayBuffer) return play(ev.data)
  const m = JSON.parse(String(ev.data))
  switch (m.type) {
    case 'ready':
      rate = m.rate
      useMyVoice.setState({ available: !!m.speaker, profile: !!m.profile })
      set({ phase: 'listen', error: '' })
      send({ type: 'config', ...voiceConfig() })
      // Service déjà lancé avec une autre voix (il survit aux redémarrages) : on lui redonne celle choisie ici.
      if (m.voice !== useVoice.getState().voice) send({ type: 'voice', name: useVoice.getState().voice })
      resumed = false
      follow()
      void startMic()
      break
    case 'not_me':
      useMyVoice.setState((v) => ({ ignored: v.ignored + 1 }))
      break
    case 'enroll_sample':
      useMyVoice.setState((v) => ({ samples: [...v.samples, { ok: !!m.ok, seconds: m.seconds, same: m.same, reason: m.reason }] }))
      break
    case 'enroll_done':
      useMyVoice.setState((v) => ({ enrolling: false, result: { ok: !!m.ok, n: m.n, error: m.error }, profile: v.profile || !!m.ok }))
      break
    case 'speech':
      // Un bruit bref déclenche parfois la détection : on n'affiche « je t'écoute » que si ça dure (0,35 s) ou si une
      // transcription arrive ; un « fin de parole » avant annule tout.
      if (speechTimer) clearTimeout(speechTimer)
      speechTimer = null
      // « Seulement ma voix » : une toux ou une respiration te ressemblent aussi ; on attend les premiers mots
      // transcrits (« partial ») pour afficher l'écoute.
      if (m.on && !useVoicePrefs.getState().onlyMe) speechTimer = setTimeout(() => set({ speech: true, ...(!turn ? { phase: 'listen' as const } : {}) }), voiceConfig().listenDelay)
      // Une pause au milieu de ta phrase n'est pas la fin : l'écoute reste affichée jusqu'à ce que le service tranche
      // (« final » : tu as fini ; « noise » : ce n'était pas une phrase). Seul un bruit jamais confirmé s'éteint ici.
      else if (!useVoice.getState().speech) set({ speech: false })
      break
    case 'partial':
      // Des mots transcrits : c'est bien toi qui parles, même si c'était bref.
      if (!turn) set({ heard: m.text, ...(m.text ? { speech: true, phase: 'listen' as const } : {}) })
      break
    case 'final':
      set({ speech: false })
      // C'était bien toi : la réponse interrompue s'arrête là (elle reste écrite dans la session).
      if (held && turn) turn.dropped = true
      held = null
      void onFinal(m.text)
      break
    case 'barge': {
      // Tu reprends la parole : Claude se tait. Les phrases pas encore entendues (celle en cours comprise) sont gardées
      // de côté : si c'était un bruit, il reprendra où il en était ; si tu parlais vraiment, on les oublie.
      const v = useVoice.getState()
      const k = v.spoken.findIndex((l) => l.id === v.speaking)
      held = turn ? v.spoken.slice(Math.max(0, k)).map((l) => l.text) : null
      stopPlayback()
      send({ type: 'stop' })
      set({ phase: 'listen', heard: '' })
      break
    }
    case 'noise':
      set({ speech: false })
      // Ce n'était pas de la parole : Claude reprend la phrase coupée et la suite.
      if (held && turn) {
        const again = held
        held = null
        send({ type: 'busy' })
        set({ phase: 'think' })
        for (const t of again) {
          saysOut++
          send({ type: 'say', id: String(++sayId), text: t })
        }
        maybeEndTurn()
      }
      break
    case 'say_start':
      accept = Number(m.id) >= minId
      genId = String(m.id)
      break
    case 'say_end': {
      // Son complet : le minutage des mots se cale sur sa vraie durée, et le débit appris sert aux suivants.
      const p = plays.get(String(m.id))
      const n = p?.lines.reduce((c, l) => c + l.text.length + 1, 0) ?? 0
      if (p && p.dur > 0 && n) {
        p.done = true
        secPerChar = 0.7 * secPerChar + 0.3 * (p.dur / n)
      }
      if (Number(m.id) >= minId) saysOut = Math.max(0, saysOut - 1)
      maybeEndTurn()
      break
    }
  }
}

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
  micCtx = new AudioContext({ sampleRate: 16000 })
  const srcNode = micCtx.createMediaStreamSource(micStream)
  // ScriptProcessor : simple et sans module externe (la CSP de la fenêtre interdit les worklets en blob).
  const proc = micCtx.createScriptProcessor(512, 1, 1)
  proc.onaudioprocess = (e) => {
    if (ws?.readyState !== WebSocket.OPEN) return
    // Micro coupé : on envoie du silence plutôt que rien, pour que la phrase en cours se termine et parte.
    const n = e.inputBuffer.length
    ws.send(useVoice.getState().micMuted ? new Float32Array(n).buffer : new Float32Array(e.inputBuffer.getChannelData(0)).buffer)
  }
  const mute = micCtx.createGain()
  mute.gain.value = 0
  srcNode.connect(proc)
  proc.connect(mute).connect(micCtx.destination)
}

/** Apprendre ta voix : le service écoute les phrases lues sans rien transcrire ni envoyer à Claude. */
export async function enrollStart() {
  if (useVoice.getState().phase === 'off' || useVoice.getState().phase === 'error') {
    await startVoice()
    // Le service répond « ready » quand il est prêt : on attend qu'il soit à l'écoute.
    for (let i = 0; i < 300 && useVoice.getState().phase === 'waking'; i++) await new Promise((r) => setTimeout(r, 100))
  }
  useMyVoice.setState({ enrolling: true, samples: [], result: null })
  send({ type: 'enroll', action: 'start' })
}
export function enrollCancel() {
  useMyVoice.setState({ enrolling: false, samples: [] })
  send({ type: 'enroll', action: 'cancel' })
}
export function enrollSave() {
  send({ type: 'enroll', action: 'save' })
}

export async function startVoice() {
  if (useVoice.getState().phase !== 'off' && useVoice.getState().phase !== 'error') return
  const target = targetSession()
  if (target) remember(target)
  set({ phase: 'waking', error: '', heard: '', said: '', gesture: false, sessionId: target })
  const info = await api.voiceStart(useVoice.getState().voice)
  if (!info.ok) return set({ phase: 'error', error: info.error })
  playCtx = new AudioContext()
  analyser = playCtx.createAnalyser()
  analyser.fftSize = 256
  analyser.smoothingTimeConstant = 0.35 // assez vif pour suivre les syllabes (bouches des personnages)
  analyser.connect(playCtx.destination)
  bins = new Uint8Array(analyser.frequencyBinCount)
  const sock = new WebSocket(`ws://127.0.0.1:${info.port}/?t=${info.token}`)
  sock.binaryType = 'arraybuffer'
  sock.onmessage = onMessage
  sock.onclose = () => {
    if (ws === sock && useVoice.getState().phase !== 'off') set({ phase: 'error', error: 'Le service voix s’est déconnecté.' })
  }
  ws = sock
  unsub = useStore.subscribe(follow)
}

export function stopVoice() {
  api.companionSet(null)
  unsub?.()
  unsub = null
  turn = null
  stopPlayback()
  ws?.close()
  ws = null
  micStream?.getTracks().forEach((t) => t.stop())
  micStream = null
  void micCtx?.close()
  micCtx = null
  void playCtx?.close()
  playCtx = null
  set({ phase: 'off', speech: false, heard: '', said: '', gesture: false, stage: [], stageSel: null })
}

/** Couper Claude sans quitter le mode voix (Échap, bouton). */
export function hush() {
  if (turn) turn.dropped = true
  stopPlayback()
  send({ type: 'stop' })
  if (turn) {
    turn.done = true
    maybeEndTurn()
  }
}

export function setVoiceName(name: string) {
  try {
    localStorage.setItem(VOICE_KEY, name)
  } catch {
    /* stockage indisponible */
  }
  set({ voice: name })
  send({ type: 'voice', name })
}

/** Écrire au lieu de parler (au bureau) : la phrase suit le même chemin qu'une phrase dite, Claude se tait d'abord. */
export function typeToVoice(text: string) {
  const t = text.trim()
  if (!t) return
  held = null
  if (turn) turn.dropped = true
  stopPlayback()
  send({ type: 'stop' })
  void onFinal(t)
}

/** Coupe ou rend la voix de Claude ; l'écoute et le travail continuent. */
export function setMute(mute: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, mute ? '1' : '0')
  } catch {
    /* stockage indisponible */
  }
  if (mute) {
    stopPlayback()
    send({ type: 'stop' })
    maybeEndTurn()
  }
  set({ mute })
}

// Pendant que Claude parle, les autres applications baissent ; elles remontent 0,8 s après sa dernière phrase
// (pas de va-et-vient entre deux phrases).
let duckTimer: ReturnType<typeof setTimeout> | null = null
useVoice.subscribe((v, p) => {
  if (v.phase === p.phase) return
  if (duckTimer) clearTimeout(duckTimer)
  duckTimer = null
  if (v.phase === 'speak') {
    const pr = useVoicePrefs.getState()
    if (pr.duck) api.voiceDuck(true, pr.duckLevel)
  }
  else duckTimer = setTimeout(() => api.voiceDuck(false), v.phase === 'off' ? 0 : 800)
})

// Un réglage change dans les Paramètres : le service voix l'applique tout de suite.
useVoicePrefs.subscribe(() => send({ type: 'config', ...voiceConfig() }))

/** Deux notes brèves : descendantes quand le micro se coupe, montantes quand il revient. */
export function micChime(muted: boolean) {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    ;(muted ? [660, 440] : [440, 660]).forEach((f, k) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      const t = now + k * 0.09
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.06, t + 0.015)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 0.25)
    })
    setTimeout(() => void ctx.close(), 700)
  } catch {
    /* audio indisponible */
  }
}

/** Couper ou rendre le micro (bouton de la vue voix et de la bulle, Ctrl+Alt+A). */
export function setMicMuted(muted: boolean) {
  if (useVoice.getState().micMuted !== muted) micChime(muted)
  if (speechTimer) clearTimeout(speechTimer)
  speechTimer = null
  set({ micMuted: muted, speech: false })
}
