import { useEffect, useRef, useState } from 'react'
import type { NotifInfo, NotifSettings } from '../../shared/types'
import { Icon } from './icons'
import { api, useStore } from './store'

// Réglages des notifications (planche 9) : bouton du rail + panneau. S'ouvre aussi depuis « Réglages » d'une carte.

const CORNERS: { v: NotifSettings['corner']; label: string }[] = [
  { v: 'tl', label: 'En haut à gauche' },
  { v: 'tr', label: 'En haut à droite' },
  { v: 'bl', label: 'En bas à gauche' },
  { v: 'br', label: 'En bas à droite' }
]
const hhmm = (t: number) => new Date(t).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' })

function Toggle({ on, label, onChange }: { on: boolean; label: string; onChange: (v: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="ns-toggle" onClick={() => onChange(!on)}><span /></button>
}

export function NotifButton() {
  const [open, setOpen] = useState(false)
  const [info, setInfo] = useState<NotifInfo | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const projects = useStore((s) => s.projects)
  const load = () => void api.getNotif().then(setInfo)
  useEffect(() => {
    load()
    const off1 = api.onNotifSettings(load)
    const off2 = api.onOpenNotifSettings(() => setOpen(true))
    return () => {
      off1()
      off2()
    }
  }, [])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  const set = (p: Partial<NotifSettings>) => void api.setNotif(p).then(setInfo)
  const s = info?.settings
  const silent = !!info?.silenceUntil
  const label = silent ? `Notifications en silence jusqu’à ${hhmm(info!.silenceUntil)}` : 'Notifications'
  return (
    <div ref={ref} className="ns-wrap">
      <button type="button" aria-label={label} title={label} aria-expanded={open} onClick={() => setOpen(!open)} className={silent ? 'ns-silent' : ''}>
        <Icon name={silent ? 'idle' : 'wait'} size={20} />
      </button>
      {open && s && (
        <div className="ns-pop" role="dialog" aria-label="Réglages des notifications">
          <div className="ns-title">Notifications</div>
          {silent ? (
            <div className="ns-silence">
              <Icon name="idle" size={15} />
              <span>Silence jusqu’à {hhmm(info!.silenceUntil)}</span>
              <button type="button" className="btn sm" onClick={() => void api.silenceNotif(0).then(setInfo)}>Reprendre</button>
            </div>
          ) : (
            <button type="button" className="btn sm ns-mute" onClick={() => void api.silenceNotif(60).then(setInfo)}><Icon name="idle" size={14} />Silence 1 h</button>
          )}
          <div className="ns-row">
            <span className="ns-l">Position<small>écran de la souris</small></span>
            <span className="ns-corners" role="radiogroup" aria-label="Position">
              {CORNERS.map((c) => (
                <button key={c.v} type="button" role="radio" aria-checked={s.corner === c.v} aria-label={c.label} title={c.label} className={`ns-corner ${c.v}`} onClick={() => set({ corner: c.v })}><span /></button>
              ))}
            </span>
          </div>
          <div className="ns-row">
            <span className="ns-l">Au-dessus du plein écran<small>sauf jeux en plein écran exclusif</small></span>
            <Toggle on={s.overFullscreen} label="Au-dessus du plein écran" onChange={(v) => set({ overFullscreen: v })} />
          </div>
          <div className="ns-row">
            <span className="ns-l">Son pour les attentes</span>
            <Toggle on={s.sound} label="Son pour les attentes" onChange={(v) => set({ sound: v })} />
          </div>
          <div className="ns-row">
            <span className="ns-l">Heures calmes<small>les attentes restent dans Canopy, sans carte ni son</small></span>
            <Toggle on={s.quiet} label="Heures calmes" onChange={(v) => set({ quiet: v })} />
          </div>
          {s.quiet && (
            <div className="ns-row ns-hours">
              <label>de <input type="time" value={s.quietFrom} onChange={(e) => set({ quietFrom: e.target.value })} /></label>
              <label>à <input type="time" value={s.quietTo} onChange={(e) => set({ quietTo: e.target.value })} /></label>
            </div>
          )}
          {info.mutedProjects.length > 0 && (
            <div className="ns-row ns-muted">
              <span className="ns-l">Projets coupés</span>
              <span className="ns-chips">
                {info.mutedProjects.map((id) => (
                  <button key={id} type="button" className="btn sm" title="Rétablir les notifications" onClick={() => void api.unmuteProject(id).then(setInfo)}>
                    {projects.find((p) => p.id === id)?.name ?? id}<Icon name="close" size={12} />
                  </button>
                ))}
              </span>
            </div>
          )}
          <p className="ns-foot">
            <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>Entrée</kbd> autorise la demande du dessus depuis n’importe quelle application ; <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>Échap</kbd> la refuse.
          </p>
        </div>
      )}
    </div>
  )
}
