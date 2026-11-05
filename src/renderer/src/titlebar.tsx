import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import logoUrl from './assets/canopy-mark.svg'
import { Icon } from './icons'
import { api } from './store'
import { UsageChip } from './usage'
import './titlebar.css'
import { isMac, MOD } from './platform'

// Barre de fenêtre de Canopy (option B, « barre fusionnée + recherche ») : la barre native de Windows est
// masquée ; logo, contenu de la vue, recherche, usage et boutons de fenêtre sont dessinés ici.
// Les vues y déposent leur en-tête par portail : <InTitleBar side="left">…</InTitleBar>.

type Slots = { left: HTMLElement | null; right: HTMLElement | null }
const SlotCtx = createContext<Slots>({ left: null, right: null })

/** Dépose un contenu dans la barre de fenêtre (à gauche : contexte de la vue ; à droite : ses actions). */
export function InTitleBar({ side = 'left', children }: { side?: 'left' | 'right'; children: ReactNode }) {
  const slots = useContext(SlotCtx)
  const el = slots[side]
  return el ? createPortal(children, el) : null
}

// Glyphes fins (10 px, trait 1 px), comme ceux de Windows, dans notre encre.
const GLYPH = {
  min: <path d="M1 5.5h8" />,
  max: <rect x="1" y="1" width="8" height="8" rx="1" />,
  restore: (
    <>
      <rect x="1" y="3" width="6" height="6" rx="1" />
      <path d="M3 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1H7" />
    </>
  ),
  close: <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
}

function WinButton({ kind, label, onClick }: { kind: keyof typeof GLYPH; label: string; onClick: () => void }) {
  return (
    <button type="button" className={`win-btn ${kind === 'close' ? 'close' : ''}`} aria-label={label} title={label} onClick={onClick}>
      <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" aria-hidden="true">
        {GLYPH[kind]}
      </svg>
    </button>
  )
}

/** Ouvre la palette de commandes (même effet que Ctrl+K). */
const openPalette = () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: !isMac, metaKey: isMac, bubbles: true }))

export function TitleBar({ children }: { children: ReactNode }) {
  const [left, setLeft] = useState<HTMLElement | null>(null)
  const [right, setRight] = useState<HTMLElement | null>(null)
  const [win, setWin] = useState({ maximized: false, focused: true })
  useEffect(() => {
    void api.windowState().then(setWin)
    return api.onWindowState(setWin)
  }, [])
  const mac = api.platform === 'darwin'
  return (
    <SlotCtx.Provider value={{ left, right }}>
      {/* Les zones vides sont des zones de glisser natives : Windows gère déplacer, double-clic et ancrage. */}
      <header className={`titlebar ${win.focused ? '' : 'blur'} ${win.maximized ? 'maxed' : ''}`}>
        {/* Sur Mac, les pastilles de la fenêtre prennent la place du logo, au-dessus du rail. */}
        {mac ? (
          <span className="tb-mac" />
        ) : (
          <span className="tb-logo">
            <img src={logoUrl} alt="Canopy" title="Canopy" />
          </span>
        )}
        <div className="tb-left" ref={setLeft} />
        <span className="tb-drag" />
        <button type="button" className="tb-search" onClick={openPalette} title={`Rechercher une session, une action (${MOD}+K)`}>
          <Icon name="search" size={14} />
          <span className="tb-search-txt">Rechercher…</span>
          <span className="tb-keys"><kbd>{MOD}</kbd><kbd>K</kbd></span>
        </button>
        <span className="tb-drag small" />
        <UsageChip down />
        <div className="tb-right" ref={setRight} />
        {!mac && (
          <>
            <span className="tb-sep" />
            <WinButton kind="min" label="Réduire" onClick={() => api.windowControl('minimize')} />
            <WinButton kind={win.maximized ? 'restore' : 'max'} label={win.maximized ? 'Restaurer' : 'Agrandir'} onClick={() => api.windowControl('toggle-maximize')} />
            <WinButton kind="close" label="Fermer" onClick={() => api.windowControl('close')} />
          </>
        )}
      </header>
      {children}
    </SlotCtx.Provider>
  )
}
