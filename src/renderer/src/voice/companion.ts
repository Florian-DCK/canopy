import { create } from 'zustand'
import type { CompanionPhase, CompanionState } from '../../../shared/companion'
import { api, useStore } from '../store'
import { hush, setMicMuted, startVoice, useVoice } from './runtime'
import { withTransition } from './transition'

// Mode compagnon (planche 32) : la voix reste ici ; on envoie à la bulle (fenêtre des notifications) ce qu'elle
// doit montrer, et on reçoit ses gestes.

// Mémorisé : si la fenêtre principale se recharge (mise à jour du code, Ctrl+R), la bulle continue d'être alimentée
// au lieu de rester figée sur son dernier état.
const KEY = 'atelier.companion'
const saved = (() => {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
})()
export const useCompanion = create<{ on: boolean }>(() => ({ on: saved }))
useCompanion.subscribe((c) => {
  try {
    localStorage.setItem(KEY, c.on ? '1' : '0')
  } catch {
    /* stockage indisponible */
  }
})

const DONE_MS = 2500
let doneUntil = 0
let summary = ''
let prevPhase = useVoice.getState().phase
let doneTimer: ReturnType<typeof setTimeout> | null = null
let actLabel = ''
let actSince = 0


/** Nom d'outil lisible pour la bulle (« mcp__atelier__screen » → « Regarde ton écran »). */
const TOOL_NAMES: Record<string, string> = {
  Read: 'Lit un fichier', Edit: 'Modifie un fichier', MultiEdit: 'Modifie un fichier', Write: 'Écrit un fichier', Bash: 'Lance une commande',
  PowerShell: 'Lance une commande', Grep: 'Cherche dans le code', Glob: 'Cherche des fichiers', WebSearch: 'Cherche sur le web', WebFetch: 'Lit une page web',
  Agent: 'Délègue à un agent', Artifact: 'Publie un artefact', TodoWrite: 'Met à jour son plan',
  mcp__atelier__screen: 'Regarde ton écran', mcp__atelier__capture: 'Regarde Canopy', mcp__atelier__browser: 'Navigue', mcp__atelier__interface: 'Te montre quelque chose',
  mcp__atelier__scene: 'Prépare un visuel', mcp__atelier__act: 'Agit sur ton écran', mcp__atelier__checklist: 'Met à jour la checklist', mcp__atelier__question: 'Te pose une question'
}
function toolLabel(raw?: string): string {
  if (!raw) return 'Travaille'
  const name = raw.split(/[\s(:]/)[0]
  return TOOL_NAMES[name] ?? (name.startsWith('mcp__') ? `Outil ${name.split('__').pop()}` : raw)
}

function stateNow(): CompanionState {
  const v = useVoice.getState()
  const st = useStore.getState()
  const s = v.sessionId ? st.sessions[v.sessionId] : undefined
  const project = s ? st.projects.find((p) => p.id === s.projectId)?.name : undefined
  const waiting = s?.status === 'wait'
  let phase: CompanionPhase
  if (v.phase === 'waking') phase = 'waking'
  else if (v.phase === 'error') phase = 'error'
  else if (v.phase === 'speak') phase = 'speak'
  else if (v.speech) phase = 'listen'
  else if (waiting) phase = 'ask'
  else if (v.phase === 'think') phase = 'work'
  else if (Date.now() < doneUntil) phase = 'done'
  else phase = 'rest'
  const act = s?.status === 'run' ? s.activity : undefined
  // Chrono de l'action en cours : compté depuis le dernier changement d'action vu ici (l'horodatage de la session
  // peut dater du début du tour).
  const label = act ? (act.kind === 'tool' ? toolLabel(act.label) : act.kind === 'writing' ? 'Écrit sa réponse' : 'Réfléchit') : ''
  if (label !== actLabel) {
    actLabel = label
    actSince = Date.now()
  }
  return {
    phase,
    // Parle : tout ce qui a été dit dans le tour (la bulle défile), pas seulement la dernière phrase.
    text: phase === 'listen' ? v.heard : phase === 'speak' ? v.written || v.said : phase === 'ask' ? 'Claude attend ta réponse' : phase === 'error' ? v.error : '',
    activity: act ? { label, since: actSince } : undefined,
    summary: phase === 'done' ? summary : undefined,
    micMuted: v.micMuted,
    lines: phase === 'speak' ? v.spoken.map((l) => l.text) : undefined,
    page: (() => {
      const e = v.stage.find((x) => x.id === v.stageSel) ?? v.stage[v.stage.length - 1]
      return e?.kind === 'scene' && e.block.type === 'html' && e.block.src ? { src: e.block.src, title: e.block.title, height: Math.min(e.block.height ?? 420, 520) } : undefined
    })(),
    current: phase === 'speak' ? v.spoken.findIndex((l) => l.id === v.speaking) : undefined,
    project,
    session: s?.title,
    heard: v.heard,
    said: v.written || v.said
  }
}

let last = ''
function push() {
  if (!useCompanion.getState().on) return
  const s = stateNow()
  const key = JSON.stringify(s)
  if (key === last) return
  last = key
  api.companionSet(s)
}

// Fin d'un tour (Claude a fini de travailler ou de parler) : la carte « fini » pendant quelques secondes.
useVoice.subscribe((v) => {
  if (v.phase === 'off' && useCompanion.getState().on) useCompanion.setState({ on: false })
  if ((prevPhase === 'think' || prevPhase === 'speak') && v.phase === 'listen' && !v.speech && !v.gesture) {
    const text = v.written || v.said
    if (text) {
      summary = text
      // Juste un signe « c'est fini », pas une carte à relire.
      doneUntil = Date.now() + DONE_MS
      if (doneTimer) clearTimeout(doneTimer)
      doneTimer = setTimeout(push, doneUntil - Date.now() + 50)
    }
  }
  if (v.speech || v.phase === 'think') doneUntil = 0
  prevPhase = v.phase
  push()
})
useStore.subscribe(push)

/** Entrer en mode compagnon (la voix démarre si besoin) ou en sortir. */
export function setCompanion(on: boolean) {
  useCompanion.setState({ on })
  last = ''
  if (on) {
    void startVoice()
    push()
  } else api.companionSet(null)
}

// Commande à la voix (voir onFinal dans runtime.ts).
window.addEventListener('atelier:companion', (e) => {
  const on = (e as CustomEvent<boolean>).detail
  setCompanion(on)
  if (!on) withTransition(() => useStore.getState().go({ name: 'voice' }))
})

api.onCompanionCommand((c) => {
  if (c === 'hush') return hush()
  if (c === 'mic') return setMicMuted(!useVoice.getState().micMuted)
  setCompanion(false)
  if (c === 'open') withTransition(() => useStore.getState().go({ name: 'voice' }))
})

// Rechargement en plein mode compagnon : on relance la voix et on renvoie l'état tout de suite.
if (saved) setTimeout(() => setCompanion(true), 0)
