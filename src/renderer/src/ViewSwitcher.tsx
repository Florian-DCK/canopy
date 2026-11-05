import { useEffect, useRef, useState } from 'react'
import { Icon, type IconName } from './icons'
import { useStore, type View } from './store'

// Ctrl+Tab, comme Alt+Tab, sur les onglets de la barre latérale (cockpit, conversation, mosaïque, historique…) :
// du plus récent au plus ancien. Un appui bref ramène au précédent (A → B → Ctrl+Tab → A) ; Ctrl tenu, chaque Tab
// avance (Maj+Tab recule) dans le sélecteur et relâcher Ctrl ouvre l'onglet choisi.

type Slot = 'cockpit' | 'session' | 'tiles' | 'history' | 'projects' | 'checklists' | 'tools' | 'voice' | 'settings'
const SLOTS: Record<Slot, { label: string; icon: IconName }> = {
  cockpit: { label: 'Cockpit', icon: 'sessions' },
  session: { label: 'Conversation', icon: 'conversation' },
  tiles: { label: 'Mosaïque', icon: 'tiles' },
  history: { label: 'Historique', icon: 'history' },
  projects: { label: 'Projets', icon: 'files' },
  checklists: { label: 'Checklists', icon: 'todo' },
  tools: { label: 'Outils de Claude', icon: 'plug' },
  voice: { label: 'Mode voix', icon: 'audio' },
  settings: { label: 'Paramètres', icon: 'settings' }
}
const slotOf = (v: View): Slot | null => (v.name === 'project' ? 'cockpit' : v.name in SLOTS ? (v.name as Slot) : null)

export function ViewSwitcher() {
  const view = useStore((s) => s.view)
  const sessions = useStore((s) => s.sessions)
  // Dernière vue de chaque onglet (la session précise, le projet ouvert…), du plus récent au plus ancien.
  const mru = useRef<{ slot: Slot; view: View }[]>([])
  useEffect(() => {
    const slot = slotOf(view)
    if (!slot) return
    mru.current = [{ slot, view }, ...mru.current.filter((e) => e.slot !== slot)]
  }, [view])

  const [sw, setSw] = useState<{ i: number; list: { slot: Slot; view: View }[] } | null>(null)
  const swRef = useRef(sw)
  swRef.current = sw
  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.key !== 'Tab') return
      const list = swRef.current?.list ?? mru.current
      if (list.length < 2) return
      e.preventDefault()
      e.stopPropagation()
      const n = list.length
      const i = swRef.current ? (swRef.current.i + (e.shiftKey ? n - 1 : 1)) % n : e.shiftKey ? n - 1 : 1
      setSw({ i, list })
    }
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== 'Control' || !swRef.current) return
      const pick = swRef.current.list[swRef.current.i]
      setSw(null)
      if (pick) useStore.getState().go(pick.view)
    }
    const onBlur = () => setSw(null)
    window.addEventListener('keydown', onDown, true)
    window.addEventListener('keyup', onUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown, true)
      window.removeEventListener('keyup', onUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  if (!sw) return null
  return (
    <div className="tab-switch" role="listbox" aria-label="Onglets récents">
      {sw.list.map((e, i) => {
        const s = SLOTS[e.slot]
        const detail = e.view.name === 'session' ? sessions[e.view.sessionId]?.title : undefined
        return (
          <div key={e.slot} role="option" aria-selected={i === sw.i} className={`tab-switch-row${i === sw.i ? ' on' : ''}`}>
            <Icon name={s.icon} size={15} />
            {s.label}
            {detail && <span className="tab-switch-sub">{detail}</span>}
          </div>
        )
      })}
      <div className="tab-switch-hint">Tab pour avancer · relâche Ctrl pour ouvrir</div>
    </div>
  )
}
