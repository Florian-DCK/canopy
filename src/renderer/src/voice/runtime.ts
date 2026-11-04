import { create } from 'zustand'
import type { SceneBlock } from '../../../shared/scene'
import type { FileDiff, Item, MediaItem } from '../../../shared/types'
import { api, useStore } from '../store'
import { speakNumbers } from './numbers'
import { withTransition } from './transition'
import { gestureChime } from '../uiAgent'

// Mode voix (planches 25 et 28) : la fenêtre capte le micro (écho retiré par Chromium) et joue la voix ;
// le service local (voice/server.py) transcrit et synthétise. On parle à une vraie session de Canopy :
// Claude garde ses outils, dont l'outil interface pour montrer sans parler.

export type VoicePhase = 'off' | 'waking' | 'listen' | 'think' | 'speak' | 'error'
export const VOICES = [
  { id: 'ana', label: 'Ana' },
  { id: 'damien', label: 'Damien' }
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
  /** Claude a fait un geste sur l'interface pendant ce tour, sans parler. */
  gesture: boolean
  sessionId: string | null
  error: string
  voice: string
  /** Claude travaille pareil mais ne répond pas à voix haute (sa réponse reste écrite). */
  mute: boolean
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
  speech: false,
  heard: '',
  said: '',
  gesture: false,
  sessionId: null,
  error: '',
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
useStore.subscribe((s) => {
  // Hors mode voix, la session regardée devient la cible ; pendant, on n'en change qu'explicitement.
  if (s.view.name === 'session' && useVoice.getState().phase === 'off' && saved?.id !== s.view.sessionId) remember(s.view.sessionId)
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
/** Phrase en cours de synthèse (son audio arrive) et dernière phrase dont on a programmé la mise en avant. */
let genId = ''
let heardId = ''
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

function say(text: string) {
  const t = text.trim()
  if (!t || !/[\p{L}\p{N}]/u.test(t) || useVoice.getState().mute) return
  if (held) {
    held.push(t)
    return
  }
  saysOut++
  const id = String(++sayId)
  set((v) => ({ spoken: [...v.spoken, { id, text: t }] }))
  send({ type: 'say', id, text: t })
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
  // Première note d'une phrase : on la met en avant au moment exact où elle sonne.
  if (genId && genId !== heardId) {
    const id = (heardId = genId)
    setTimeout(() => set({ speaking: id }), Math.max(0, (at - playCtx.currentTime) * 1000))
  }
  playEnd = at + buf.duration
  sources.push(src)
  src.onended = () => {
    sources = sources.filter((x) => x !== src)
    maybeEndTurn()
  }
  if (useVoice.getState().phase !== 'speak') set({ phase: 'speak' })
}

/** Fin du tour : Claude a fini d'écrire et tout ce qu'il avait à dire a été joué. */
function maybeEndTurn() {
  if (!turn?.done || saysOut > 0 || sources.length || held) return
  turn = null
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
  for (const it of items) {
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

/** Ajoute à la scène les images, fichiers modifiés et artefacts apparus depuis le début du tour. */
function collectStage(sid: string, items: Item[], since: number) {
  const cur = useVoice.getState().stage
  const have = new Set(cur.map((e) => e.id))
  const add: StageEntry[] = []
  for (const it of items) {
    if (it.at < since || it.kind !== 'tool') continue
    if (it.diff && !have.has(it.id)) add.push({ id: it.id, kind: 'diff', diff: it.diff })
    if (it.artifact && !have.has(it.id)) add.push({ id: it.id, kind: 'artifact', url: it.artifact.url, title: it.artifact.title })
  }
  const said = items.filter((i) => i.at >= since && i.kind === 'text').map((i) => (i as { text: string }).text.toLowerCase()).join('\n')
  for (const m of useStore.getState().media[sid] ?? []) {
    const cited = m.source === 'mention' && said.includes(m.path.toLowerCase())
    if ((m.at >= since || cited) && (m.kind === 'image' || m.kind === 'video') && m.source !== 'attach' && !have.has(m.id)) add.push({ id: m.id, kind: m.kind, media: m })
  }
  if (add.length) setStage(add)
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
  const next = () => set({ sessionId: sid, heard: text, said: '', written: '', spoken: [], speaking: null, gesture: false, phase: 'think', stage: kept, stageSel: null })
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
      set({ phase: 'listen', error: '' })
      resumed = false
      follow()
      void startMic()
      break
    case 'speech':
      // Un bruit bref déclenche parfois la détection : on n'affiche « je t'écoute » que si ça dure (0,35 s) ou si une
      // transcription arrive ; un « fin de parole » avant annule tout.
      if (speechTimer) clearTimeout(speechTimer)
      speechTimer = null
      if (m.on) speechTimer = setTimeout(() => set({ speech: true, ...(!turn ? { phase: 'listen' as const } : {}) }), 700)
      else set({ speech: false })
      break
    case 'partial':
      // Des mots transcrits : c'est bien toi qui parles, même si c'était bref.
      if (!turn) set({ heard: m.text, ...(m.text ? { speech: true, phase: 'listen' as const } : {}) })
      break
    case 'final':
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
    case 'say_end':
      if (Number(m.id) >= minId) saysOut = Math.max(0, saysOut - 1)
      maybeEndTurn()
      break
  }
}

async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } })
  micCtx = new AudioContext({ sampleRate: 16000 })
  const srcNode = micCtx.createMediaStreamSource(micStream)
  // ScriptProcessor : simple et sans module externe (la CSP de la fenêtre interdit les worklets en blob).
  const proc = micCtx.createScriptProcessor(512, 1, 1)
  proc.onaudioprocess = (e) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(new Float32Array(e.inputBuffer.getChannelData(0)).buffer)
  }
  const mute = micCtx.createGain()
  mute.gain.value = 0
  srcNode.connect(proc)
  proc.connect(mute).connect(micCtx.destination)
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
  analyser.smoothingTimeConstant = 0.6
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
  if (v.phase === 'speak') api.voiceDuck(true)
  else duckTimer = setTimeout(() => api.voiceDuck(false), v.phase === 'off' ? 0 : 800)
})
