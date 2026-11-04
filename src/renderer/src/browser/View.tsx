import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { BrowserDevice } from '../../../shared/browser'
import { Icon, type IconName } from '../icons'
import { Splitter } from '../layout'
import { FocusChat } from '../views/SessionView'
import * as reg from './registry'
import { hostOf, useBrowser } from './store'

// Onglet « navigateur » d'une session (planche 10) : conversation réduite à gauche, barre + page à droite.
// La page elle-même est un webview tenu par BrowserHost ; ici on ne mesure que son emplacement.

const DEVICES: { v: BrowserDevice; icon: IconName; label: string }[] = [
  { v: 'desktop', icon: 'desktop', label: 'Bureau' },
  { v: 'tablet', icon: 'tablet', label: 'Tablette · 820 px' },
  { v: 'mobile', icon: 'phone', label: 'Mobile · 390 px' }
]
const KEY = 'atelier.browser.chatW'

/** embedded : dans une case de la Mosaïque (page seule, la conversation est ailleurs). */
export function BrowserTabView({ sessionId, embedded = false }: { sessionId: string; embedded?: boolean }) {
  const tab = useBrowser((s) => s.tabs[sessionId])
  const patch = useBrowser((s) => s.patch)
  const setSlot = useBrowser((s) => s.setSlot)
  const slot = useRef<HTMLDivElement>(null)
  const [chatW, setChatW] = useState(() => Number(localStorage.getItem(KEY)) || 360)
  const chat = !embedded && (tab?.chat ?? true)
  const setChat = (v: boolean) => patch(sessionId, { chat: v })
  const [addr, setAddr] = useState(tab?.url ?? '')
  useEffect(() => setAddr(tab?.url ?? ''), [tab?.url])

  // L'emplacement suit la mise en page (redimensionnement, panneau, fenêtre).
  useLayoutEffect(() => {
    const el = slot.current
    if (!el) return
    const measure = () => {
      const r = el.getBoundingClientRect()
      setSlot(sessionId, { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      setSlot(sessionId, null)
    }
  }, [sessionId, setSlot, chat, chatW])

  if (!tab) return null
  const wv = () => reg.entry(sessionId)?.el
  const go = (raw: string) => {
    const v = raw.trim()
    if (!v) return
    const url = /^[a-z]+:\/\//i.test(v) ? v : /^(localhost|127\.|\[::1\])/.test(v) ? `http://${v}` : `https://${v}`
    patch(sessionId, { url })
    void wv()?.loadURL(url)
  }
  return (
    <div className="bt">
      {chat && (
        <>
          <aside className="focus-side" style={{ width: chatW }} aria-label="Conversation">
            <FocusChat sessionId={sessionId} />
          </aside>
          <Splitter
            side="left"
            width={chatW}
            onWidth={(w) => {
              setChatW(w)
              try {
                localStorage.setItem(KEY, String(w))
              } catch {
                /* stockage indisponible */
              }
            }}
            onClose={() => setChat(false)}
          />
        </>
      )}
      <section className="bt-main" aria-label="Navigateur">
        <div className="bt-bar">
          {!chat && !embedded && (
            <button type="button" className="icon-btn" title="Afficher la conversation" onClick={() => setChat(true)}><Icon name="sessions" size={16} /></button>
          )}
          <button type="button" className="icon-btn" title="Précédent" onClick={() => wv()?.goBack()}><Icon name="back" size={16} /></button>
          <button type="button" className="icon-btn" title="Suivant" onClick={() => wv()?.goForward()}><Icon name="forward" size={16} /></button>
          <button type="button" className="icon-btn" title="Recharger (Ctrl+R dans la page)" onClick={() => wv()?.reload()}>
            <Icon name={tab.loading ? 'run' : 'restart'} size={16} />
          </button>
          <form
            className="bt-url"
            onSubmit={(e) => {
              e.preventDefault()
              go(addr)
            }}
          >
            <Icon name="web" size={14} className={tab.url.startsWith('http://localhost') || tab.url.startsWith('http://127.') ? 'st-idle' : ''} />
            <label className="sr-only" htmlFor={`bt-url-${sessionId}`}>Adresse</label>
            <input id={`bt-url-${sessionId}`} value={addr} onChange={(e) => setAddr(e.target.value)} spellCheck={false} onFocus={(e) => e.currentTarget.select()} />
          </form>
          <span className="seg bt-dev" role="group" aria-label="Largeur">
            {DEVICES.map((d) => (
              <button key={d.v} type="button" aria-pressed={tab.device === d.v} title={d.label} onClick={() => patch(sessionId, { device: d.v })}>
                <Icon name={d.icon} size={15} />
              </button>
            ))}
          </span>
          <span className={`bt-console ${tab.errors ? 'err' : ''}`} title={tab.errors ? `${tab.errors} erreur${tab.errors > 1 ? 's' : ''} dans la console` : 'Console sans erreur'}>
            <Icon name="console" size={15} />{tab.errors > 0 && tab.errors}
          </span>
          <button type="button" className="icon-btn" title="Ouvrir dans ton navigateur" onClick={() => window.open(tab.url, '_blank')}><Icon name="external" size={16} /></button>
        </div>
        <div ref={slot} className="bt-slot" aria-label={`Page ${hostOf(tab.url)}`} />
      </section>
    </div>
  )
}
