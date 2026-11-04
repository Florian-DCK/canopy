import { createElement, useEffect, useMemo, useRef, useState } from 'react'
import type { ArtifactRef, Item } from '../../../shared/types'
import { useBrowser } from '../browser/store'
import { Icon } from '../icons'
import { Splitter } from '../layout'
import { CAPTURE, useStore } from '../store'
import { FocusChat } from './SessionView'

// Artefacts claude.ai dans Atelier : carte dans le fil, et un onglet de vue par artefact (chat réduit + artefact).
// Affichés en direct dans un <webview> qui garde la connexion claude.ai (partition persistante).

type Tool = Extract<Item, { kind: 'tool' }>
export type SessionArtifact = ArtifactRef & { itemId: string; at: number; count: number }

const NO_ITEMS: Item[] = []
export const PARTITION = 'persist:claude'
const idOf = (url: string) => url.split('/').pop() ?? url

/** Artefacts publiés dans la session, du plus récent au plus ancien (une entrée par URL). */
export function useSessionArtifacts(sessionId: string): SessionArtifact[] {
  const items = useStore((s) => s.items[sessionId] ?? NO_ITEMS)
  return useMemo(() => {
    const byUrl = new Map<string, SessionArtifact>()
    for (const i of items) {
      if (i.kind !== 'tool' || !i.artifact) continue
      const prev = byUrl.get(i.artifact.url)
      byUrl.set(i.artifact.url, {
        ...prev,
        ...i.artifact,
        title: i.artifact.title ?? prev?.title,
        itemId: i.id,
        at: i.at,
        count: (prev?.count ?? 0) + 1
      })
    }
    return [...byUrl.values()].sort((a, b) => b.at - a.at)
  }, [items])
}

export function useArtifactTitle(a: { url: string; title?: string }) {
  const known = useStore((s) => s.artifactTitles[a.url])
  return known ?? a.title ?? `Artefact ${idOf(a.url).slice(0, 8)}`
}

const copy = (url: string) => void navigator.clipboard.writeText(url)
const external = (url: string) => window.open(url, '_blank')

/** claude.ai en direct ; se recharge quand la version change ; mémorise le titre de la page. */
export function ArtifactFrame({ url, version }: { url: string; version?: number }) {
  const ref = useRef<HTMLElement>(null)
  const setTitle = useStore((s) => s.setArtifactTitle)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    const wv = ref.current as any
    if (!wv) return
    const onTitle = (e: any) => {
      const t = String(e.title ?? '').replace(/\s*[-|–]\s*Claude\s*$/i, '').trim()
      if (t && !/^claude$/i.test(t) && !/^https?:/.test(t)) setTitle(url, t)
    }
    const onStop = () => setLoading(false)
    const onStart = () => setLoading(true)
    wv.addEventListener('page-title-updated', onTitle)
    wv.addEventListener('did-stop-loading', onStop)
    wv.addEventListener('did-start-loading', onStart)
    return () => {
      wv.removeEventListener('page-title-updated', onTitle)
      wv.removeEventListener('did-stop-loading', onStop)
      wv.removeEventListener('did-start-loading', onStart)
    }
  }, [url, version, setTitle])
  return (
    <div className="art-frame">
      {createElement('webview', {
        key: `${url}#${version ?? 0}`,
        ref,
        src: url,
        partition: PARTITION,
        allowpopups: 'true',
        style: { width: '100%', height: '100%', display: 'flex' }
      })}
      {loading && <span className="art-loading"><Icon name="run" size={14} />Chargement de claude.ai…</span>}
    </div>
  )
}

/** Onglets de vue d'une session : artefacts publiés, sauf ceux fermés depuis leur dernière publication. */
export function useArtifactTabs(sessionId: string) {
  const list = useSessionArtifacts(sessionId)
  const st = useStore((s) => s.artTabs[sessionId])
  const tabs = list
    .filter((a) => !(st?.closed[a.url] && st.closed[a.url] >= a.at))
    .sort((a, b) => a.at - b.at)
  // Fenêtre de capture : ?tab=art affiche le dernier onglet artefact.
  const forced = CAPTURE && new URLSearchParams(location.search).get('tab') === 'art' ? tabs.at(-1)?.url : undefined
  const browserOpen = useBrowser((s) => !!s.tabs[sessionId])
  const active = forced ?? (st?.active === 'browser' && browserOpen ? 'browser' : st?.active && tabs.some((t) => t.url === st.active) ? st.active : 'session')
  const fresh = (a: SessionArtifact) => active !== a.url && a.at > (st?.seen[a.url] ?? 0)
  return { tabs, active, fresh }
}

/** Carte affichée sous l'appel Artifact qui a publié. */
export function ArtifactCard({ t, sessionId }: { t: Tool; sessionId: string }) {
  const a = t.artifact!
  const title = useArtifactTitle(a)
  const open = useStore((s) => s.openArtTab)
  return (
    <div className="art-card">
      <span className="art-card-ico" aria-hidden="true"><Icon name="artifact" size={20} /></span>
      <span className="art-card-txt">
        <b>{title}</b>
        <span>Artefact · {a.created ? 'créé à l’instant' : `v${a.version ?? '?'} publiée`}</span>
      </span>
      <button type="button" className="btn primary sm" onClick={() => open(sessionId, a.url)}>Ouvrir</button>
      <button type="button" className="icon-btn" aria-label="Ouvrir dans le navigateur" title="Ouvrir dans le navigateur" onClick={() => external(a.url)}><Icon name="external" size={16} /></button>
      <button type="button" className="icon-btn" aria-label="Copier le lien" title="Copier le lien" onClick={() => copy(a.url)}><Icon name="link" size={16} /></button>
    </div>
  )
}

type FocusLayout = 'chat' | 'only'
const FOCUS_KEY = 'atelier.focus.layout'
const loadFocus = (): { layout: FocusLayout; chatW: number } => {
  try {
    return { layout: 'chat', chatW: 380, ...JSON.parse(localStorage.getItem(FOCUS_KEY) ?? '{}') }
  } catch {
    return { layout: 'chat', chatW: 380 }
  }
}

/** Vue d'un onglet artefact : chat réduit à gauche (ou rien) + artefact en direct. */
export function ArtifactTabView({ sessionId, url }: { sessionId: string; url: string }) {
  const list = useSessionArtifacts(sessionId)
  const a = list.find((x) => x.url === url)
  const title = useArtifactTitle(a ?? { url })
  const [pref, setPref] = useState(loadFocus)
  const save = (p: Partial<{ layout: FocusLayout; chatW: number }>) =>
    setPref((cur) => {
      const next = { ...cur, ...p }
      try {
        localStorage.setItem(FOCUS_KEY, JSON.stringify(next))
      } catch {
        /* stockage indisponible */
      }
      return next
    })
  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      {pref.layout === 'chat' && (
        <>
          <aside className="focus-side" style={{ width: pref.chatW }} aria-label="Conversation">
            <FocusChat sessionId={sessionId} />
          </aside>
          <Splitter side="left" width={pref.chatW} onWidth={(chatW) => save({ chatW })} onClose={() => save({ layout: 'only' })} />
        </>
      )}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div className="art-bar">
          <span className="art-live"><span className="art-live-dot" aria-hidden="true" />en direct</span>
          <span className="art-meta">{title}{a?.version ? ` · v${a.version}` : ''}</span>
          <span style={{ flex: 1 }} />
          <div className="seg" role="group" aria-label="Disposition">
            <button type="button" aria-pressed={pref.layout === 'chat'} title="Conversation et artefact" onClick={() => save({ layout: 'chat' })}>
              <Icon name="sessions" size={15} />Avec la conversation
            </button>
            <button type="button" aria-pressed={pref.layout === 'only'} title="Artefact seul" onClick={() => save({ layout: 'only' })}>
              <Icon name="artifact" size={15} />Seul
            </button>
          </div>
          <button type="button" className="icon-btn" aria-label="Copier le lien" title="Copier le lien" onClick={() => copy(url)}><Icon name="link" size={16} /></button>
          <button type="button" className="icon-btn" aria-label="Ouvrir dans le navigateur" title="Ouvrir dans le navigateur" onClick={() => external(url)}><Icon name="external" size={16} /></button>
        </div>
        <div className="art-stage">
          <ArtifactFrame url={url} version={a?.version} />
        </div>
      </div>
    </div>
  )
}
