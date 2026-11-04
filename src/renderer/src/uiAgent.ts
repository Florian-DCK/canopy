import type { UiParams, UiPanelDetail, UiResult } from '../../shared/ui'
import { UI_PANEL_EVENT } from '../../shared/ui'
import { guessLocalUrl } from './browser/agent'
import { useBrowser } from './browser/store'
import { api, useStore, type View } from './store'
import { clearStage, pushScene, useVoice } from './voice/runtime'
import { withTransition } from './voice/transition'

// Outil « interface » (planche 28) : Claude change ce que l'utilisateur voit. Chaque geste réussi est
// confirmé par un tintement de la famille des notifications, un cran plus haut, plus court, plus doux.

/** 880 → 1320 Hz, 0,3 s : le « geste fait ». */
export function gestureChime() {
  try {
    const ctx = new AudioContext()
    const now = ctx.currentTime
    ;[880, 1320].forEach((f, k) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.type = 'sine'
      o.frequency.value = f
      const t = now + k * 0.07
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(0.035, t + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
      o.connect(g).connect(ctx.destination)
      o.start(t)
      o.stop(t + 0.35)
    })
    setTimeout(() => void ctx.close(), 800)
  } catch {
    /* audio indisponible */
  }
}

/** Vues quittées à cause de Claude, pour « back ». */
const previous: View[] = []

function go(view: View) {
  const st = useStore.getState()
  previous.push(st.view)
  if (previous.length > 20) previous.shift()
  // Fondu entre les vues ; en mode voix, le soleil se range dans la pastille (même nom de transition).
  withTransition(() => st.go(view))
}

const VIEW_NAME: Record<string, string> = { voice: 'Mode voix', cockpit: 'Cockpit', tiles: 'Mosaïque', tools: 'Outils de Claude', history: 'Historique', projects: 'Projets' }

async function run(sessionId: string, p: UiParams): Promise<UiResult> {
  const st = useStore.getState()
  switch (p.action) {
    case 'show': {
      const sid = p.sessionId ?? sessionId
      switch (p.target) {
        case 'cockpit':
        case 'tiles':
        case 'tools':
        case 'history':
        case 'projects':
        case 'voice':
          go({ name: p.target })
          return { ok: true, text: `Affiché : ${VIEW_NAME[p.target]}.` }
        case 'checklist':
          go({ name: 'checklists', id: p.checklistId })
          return { ok: true, text: p.checklistId ? 'Checklist affichée.' : 'Liste des checklists affichée.' }
        case 'session':
          if (!st.sessions[sid]) return { ok: false, text: `Session inconnue : ${sid}.` }
          st.setActiveTab(sid, 'session')
          go({ name: 'session', sessionId: sid })
          return { ok: true, text: `Session affichée : ${st.sessions[sid].title}.` }
        case 'artifact':
          if (!p.url) return { ok: false, text: "Indique l'URL de l'artefact (url)." }
          st.openArtTab(sid, p.url)
          go({ name: 'session', sessionId: sid })
          return { ok: true, text: 'Artefact affiché.' }
        case 'browser': {
          const b = useBrowser.getState()
          if (!b.tabs[sid]) b.open(sid, guessLocalUrl(sid))
          st.setActiveTab(sid, 'browser')
          go({ name: 'session', sessionId: sid })
          return { ok: true, text: 'Navigateur affiché.' }
        }
        default:
          return { ok: false, text: 'Indique la vue à afficher (target).' }
      }
    }
    case 'panel': {
      const detail: UiPanelDetail = { sessionId, state: p.state ?? 'open', tab: p.tab }
      if (detail.state === 'open') {
        st.setActiveTab(sessionId, 'session')
        if (st.view.name !== 'session' || st.view.sessionId !== sessionId) go({ name: 'session', sessionId })
      }
      // Laisse la vue se monter avant de prévenir le panneau.
      await new Promise((r) => requestAnimationFrame(() => r(null)))
      window.dispatchEvent(new CustomEvent(UI_PANEL_EVENT, { detail }))
      return { ok: true, text: detail.state === 'open' ? `Panneau de travail ouvert${p.tab ? ` (${p.tab})` : ''}.` : 'Panneau de travail fermé.' }
    }
    case 'highlight': {
      if (!p.selector) return { ok: false, text: 'Indique un élément (selector).' }
      const el = document.querySelector<HTMLElement>(p.selector)
      if (!el) return { ok: false, text: `Élément introuvable à l'écran : ${p.selector}.` }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      el.classList.remove('ui-flash')
      void el.offsetWidth // relance l'animation
      el.classList.add('ui-flash')
      setTimeout(() => el.classList.remove('ui-flash'), 2800)
      return { ok: true, text: 'Élément surligné.' }
    }
    case 'scroll': {
      if (p.selector) {
        const el = document.querySelector<HTMLElement>(p.selector)
        if (!el) return { ok: false, text: `Élément introuvable à l'écran : ${p.selector}.` }
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
        return { ok: true, text: 'Défilé jusqu’à l’élément.' }
      }
      const sc = document.querySelector<HTMLElement>('.convo .scroll')
      if (!sc) return { ok: false, text: "Pas de conversation à l'écran." }
      sc.scrollTo({ top: p.to === 'top' ? 0 : sc.scrollHeight, behavior: 'smooth' })
      return { ok: true, text: p.to === 'top' ? 'Haut de la conversation.' : 'Bas de la conversation.' }
    }
    case 'scene': {
      if (!p.scene) return { ok: false, text: 'Bloc manquant.' }
      if (useVoice.getState().phase === 'off') return { ok: false, text: "Le mode voix n'est pas ouvert : la scène ne s'affiche qu'en mode voix. Publie plutôt un artefact." }
      if (p.scene.type === 'clear') {
        clearStage()
        return { ok: true, text: 'Scène retirée.' }
      }
      pushScene(p.scene)
      return { ok: true, text: 'Bloc affiché à droite du soleil.' }
    }
    case 'back': {
      const v = previous.pop()
      if (!v) return { ok: false, text: 'Rien à quoi revenir.' }
      withTransition(() => st.go(v))
      return { ok: true, text: 'Vue précédente.' }
    }
  }
}

/** Branché une fois au démarrage de l'app. */
export function startUiAgent() {
  return api.onUiRequest(({ id, sessionId, params }) => {
    run(sessionId, params)
      .catch((e: unknown): UiResult => ({ ok: false, text: String((e as Error)?.message ?? e) }))
      .then((r) => {
        if (r.ok) gestureChime()
        // Mode compagnon : Canopy est rangé ; ce que Claude montre doit venir au premier plan (la bulle reste).
        if (r.ok && params.action !== 'scene' && localStorage.getItem('atelier.companion') === '1') api.showWindow()
        api.uiResult(id, r)
      })
  })
}
