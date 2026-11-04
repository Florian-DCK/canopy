import type { BrowserParams, BrowserResult } from '../../../shared/browser'
import { api, useStore } from '../store'
import * as reg from './registry'
import { DEFAULT_URL, localUrlIn, useBrowser } from './store'

// Actions de Claude dans le navigateur intégré (outil mcp__atelier__browser) : exécutées ici, sur le
// webview de la session. Aucun JavaScript arbitraire : seulement les requêtes prévues par la surcouche.

const b64 = (dataUrl?: string) => dataUrl?.replace(/^data:image\/png;base64,/, '')

/** Dernier serveur local vu dans la session (sortie de « npm run dev »…), sinon l'adresse par défaut. */
export function guessLocalUrl(sessionId: string): string {
  const items = useStore.getState().items[sessionId] ?? []
  let guess: string | undefined
  for (const i of items) {
    if (i.kind === 'tool' && i.result) guess = localUrlIn(i.result) ?? guess
    else if (i.kind === 'text') guess = localUrlIn(i.text) ?? guess
  }
  return guess ?? DEFAULT_URL
}

/** Ouvre l'onglet si besoin (sans changer la vue de l'utilisateur) et attend la page. */
async function ensure(sessionId: string, url?: string) {
  const st = useBrowser.getState()
  if (!st.tabs[sessionId]) st.open(sessionId, url ?? guessLocalUrl(sessionId))
}

async function run(sessionId: string, p: BrowserParams): Promise<BrowserResult> {
  const st = useBrowser.getState()
  switch (p.action) {
    case 'open': {
      if (!p.url) return { ok: false, text: 'Indique une adresse (url).' }
      const had = !!st.tabs[sessionId]
      await ensure(sessionId, p.url)
      if (p.device) st.patch(sessionId, { device: p.device })
      if (had) {
        st.patch(sessionId, { url: p.url })
        await reg.waitReady(sessionId).catch(() => {})
        const loaded = reg.untilLoaded(sessionId)
        void reg.entry(sessionId)?.el.loadURL(p.url)
        await loaded
      }
      await reg.waitReady(sessionId)
      const t = useBrowser.getState().tabs[sessionId]
      const errs = reg.entry(sessionId)?.logs.filter((l) => l.level === 'error').length ?? 0
      return { ok: true, text: `Page chargée : ${t?.title ?? ''} — ${t?.url ?? p.url} (${t?.device ?? 'desktop'})${errs ? ` · ${errs} erreur(s) dans la console` : ''}` }
    }
    case 'capture': {
      await ensure(sessionId)
      await reg.waitReady(sessionId)
      let rect
      if (p.selector) {
        const r = await reg.ask(sessionId, { kind: 'rect', selector: p.selector })
        if (!r.ok || !r.rect) return { ok: false, text: r.error ?? `Élément introuvable : ${p.selector}` }
        rect = r.rect
      }
      const img = await reg.shot(sessionId, rect, rect ? 10 : 0)
      if (!img) return { ok: false, text: 'Capture vide (la page est-elle chargée ?).' }
      return { ok: true, text: `Capture de ${p.selector ?? 'la page'} — ${useBrowser.getState().tabs[sessionId]?.url}`, image: b64(img) }
    }
    case 'read': {
      await ensure(sessionId)
      const r = await reg.ask(sessionId, { kind: 'read', selector: p.selector })
      if (!r.ok) return { ok: false, text: r.error ?? 'Lecture impossible.' }
      const head = `${r.title ?? ''} — ${r.url ?? ''}`
      if (r.el) return { ok: true, text: `${head}\nÉlément ${r.el.selector} (${Math.round(r.el.rect.width)} × ${Math.round(r.el.rect.height)})\nStyles : ${JSON.stringify(r.el.styles)}\nTexte : ${r.text ?? ''}` }
      return { ok: true, text: `${head}\n\n${r.text ?? ''}` }
    }
    case 'console': {
      await ensure(sessionId)
      const logs = reg.entry(sessionId)?.logs ?? []
      const important = logs.filter((l) => l.level !== 'info')
      if (!important.length) return { ok: true, text: `Aucune erreur ni avertissement depuis le chargement (${logs.length} message(s) d’information).` }
      return { ok: true, text: important.map((l) => `[${l.level === 'error' ? 'erreur' : 'avertissement'}] ${l.text}`).join('\n') }
    }
    case 'click':
    case 'type': {
      if (!p.selector) return { ok: false, text: 'Indique un élément (selector).' }
      await ensure(sessionId)
      const r = await reg.ask(sessionId, p.action === 'click' ? { kind: 'click', selector: p.selector } : { kind: 'type', selector: p.selector, text: p.text ?? '' })
      return { ok: r.ok, text: r.ok ? `${p.action === 'click' ? 'Clic sur' : 'Texte saisi dans'} ${p.selector}.` : (r.error ?? 'Action impossible.') }
    }
    case 'remarks': {
      const list = useBrowser.getState().remarks[sessionId] ?? []
      if (!list.length) return { ok: true, text: 'Aucune remarque.' }
      return { ok: true, text: list.map((r) => `${r.n}. [${r.state}] « ${r.text} » — ${r.el.selector} sur ${r.el.url}`).join('\n') }
    }
    case 'mark': {
      if (!p.remark || !p.state) return { ok: false, text: 'Indique remark (numéro) et state.' }
      return useBrowser.getState().setRemark(sessionId, p.remark, p.state)
        ? { ok: true, text: `Remarque ${p.remark} : ${p.state}.` }
        : { ok: false, text: `Remarque ${p.remark} introuvable.` }
    }
  }
}

/** Branché une fois au démarrage de l'app. */
export function startBrowserAgent() {
  return api.onBrowserRequest(({ id, sessionId, params }) => {
    run(sessionId, params)
      .catch((e: unknown): BrowserResult => ({ ok: false, text: String((e as Error)?.message ?? e) }))
      .then((r) => api.browserResult(id, r))
  })
}
