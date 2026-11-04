import { useEffect, useState, type ReactNode } from 'react'
import type { CompanionPrefs, NotifInfo, NotifSettings, ThemeMode } from '../../../shared/types'
import { BG_DELAYS, useBgDelay } from '../bgtasks'
import { api } from '../store'
import { useTiles, ZOOM_MAX, ZOOM_MIN } from '../tiles'
import { useVoicePrefs, type Avatar, type EndMode } from '../voice/prefs'
import { setMute, setVoiceName, startVoice, stopVoice, useVoice, VOICES } from '../voice/runtime'
import './settings.css'

// Page Paramètres (planche 34) : les réglages de Canopy réunis au même endroit. Ceux de Claude Code (skills, MCP,
// mémoire) restent dans « Outils de Claude ».

const SECTIONS = [
  ['voice', 'Voix'],
  ['companion', 'Compagnon'],
  ['sessions', 'Sessions'],
  ['notif', 'Notifications'],
  ['look', 'Apparence']
] as const
type Section = (typeof SECTIONS)[number][0]

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`st-toggle${on ? ' on' : ''}`} onClick={() => onChange(!on)}><span /></button>
}

function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <span className="st-seg" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{l}</button>
      ))}
    </span>
  )
}

function Row({ title, desc, children }: { title: string; desc?: string; children: ReactNode }) {
  return (
    <div className="st-row">
      <div className="st-row-t">
        <span>{title}</span>
        {desc && <span className="st-desc">{desc}</span>}
      </div>
      <div className="st-row-c">{children}</div>
    </div>
  )
}

function Card({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="st-card">
      <h3>{title}</h3>
      {note && <p className="st-note">{note}</p>}
      {children}
    </section>
  )
}

/** Fait entendre une voix (échantillon du banc d'essai) sans démarrer le mode voix. */
function preview(voice: string) {
  setVoiceName(voice)
}

function VoiceSection() {
  const v = useVoice()
  const p = useVoicePrefs()
  return (
    <>
      <Card title="Voix de Claude">
        <Row title="Apparence" desc="Le soleil Canopée, ou un petit personnage qui écoute, réfléchit et parle avec toi.">
          <Seg<Avatar> label="Apparence" value={p.avatar} options={[['canopy', 'Canopée'], ['esprit', 'Esprit de la forêt'], ['gland', 'Gland']] as const} onChange={(avatar) => p.set({ avatar })} />
        </Row>
        <Row title="Voix" desc="Les deux voix clonées. Le changement s'applique à la phrase suivante.">
          <span className="st-voices">
            {VOICES.map((x) => (
              <button key={x.id} type="button" aria-pressed={v.voice === x.id} onClick={() => preview(x.id)}>{x.label}</button>
            ))}
          </span>
        </Row>
        <Row title="Réponses" desc="À voix haute, ou mode fantôme : Claude travaille pareil mais ne parle pas (sa réponse s'écrit). Se commande aussi à la voix.">
          <Seg label="Réponses" value={v.mute ? 'ghost' : 'voice'} options={[['voice', 'À voix haute'], ['ghost', 'Fantôme']] as const} onChange={(x) => setMute(x === 'ghost')} />
        </Row>
        <Row title="Baisser les autres applications" desc="Pendant que Claude parle, la musique et les vidéos descendent, puis remontent.">
          <span className="st-inline">
            <input type="range" min={10} max={80} step={5} value={Math.round(p.duckLevel * 100)} disabled={!p.duck} onChange={(e) => p.set({ duckLevel: Number(e.target.value) / 100 })} aria-label="Volume laissé aux autres applications" />
            <span className="st-val">{Math.round(p.duckLevel * 100)} %</span>
            <Toggle label="Baisser les autres applications" on={p.duck} onChange={(duck) => p.set({ duck })} />
          </span>
        </Row>
      </Card>
      <Card title="Écoute">
        <Row title="Sensibilité aux bruits" desc="Plus tolérant : une porte, une toux ou le clavier ne réveillent plus Claude ; il faut parler un peu plus nettement.">
          <span className="st-inline">
            <span className="st-desc">Sensible</span>
            <input type="range" min={0} max={100} step={5} value={Math.round(p.tolerance * 100)} onChange={(e) => p.set({ tolerance: Number(e.target.value) / 100 })} aria-label="Tolérance aux bruits" />
            <span className="st-desc">Tolérant</span>
          </span>
        </Row>
        <Row title="Attente en fin de phrase" desc="Le détecteur de fin de tour décide selon ton intonation ; ceci règle les attentes de base. Il attend toujours plus après « euh », « et », « du coup »…">
          <Seg<EndMode> label="Attente en fin de phrase" value={p.end} options={[['fast', 'Rapide'], ['normal', 'Normale'], ['patient', 'Patiente']] as const} onChange={(end) => p.set({ end })} />
        </Row>
        <Row title="Commandes à la voix" desc="« Passe en mode fantôme » / « quitte le mode fantôme », « passe en mode compagnon » / « quitte le mode compagnon », « stop ». Traitées tout de suite, sans passer par Claude, si la phrase est courte.">
          <span />
        </Row>
      </Card>
      <Card title="Service voix">
        <Row title="État" desc="Whisper (transcription, sur la puce graphique) et Pocket TTS (voix) tournent sur ton ordinateur. Gardés en mémoire 15 min après la dernière utilisation.">
          <span className="st-inline">
            <span className={`st-state ${v.phase === 'off' ? '' : v.phase === 'error' ? 'err' : 'ok'}`}>{v.phase === 'off' ? 'Arrêté' : v.phase === 'error' ? 'Erreur' : v.phase === 'waking' ? 'Démarrage…' : 'En marche'}</span>
            <button type="button" className="st-btn" onClick={() => (v.phase === 'off' ? void startVoice() : stopVoice())}>{v.phase === 'off' ? 'Démarrer' : 'Arrêter'}</button>
          </span>
        </Row>
      </Card>
    </>
  )
}

function CompanionSection() {
  const [c, setC] = useState<CompanionPrefs | null>(null)
  useEffect(() => void api.getCompanionPrefs().then(setC), [])
  const set = (p: Partial<CompanionPrefs>) => void api.setCompanionPrefs(p).then(setC)
  if (!c) return null
  return (
    <>
      <Card title="Compagnon">
        <Row title="Position de la bulle" desc="Glisse la bulle où tu veux, elle retient sa place. Ici pour la remettre dans le coin.">
          <button type="button" className="st-btn" onClick={() => api.companionResetPosition()}>Remettre en bas à droite</button>
        </Row>
      </Card>
      <Card title="Ce que Claude peut faire sur ton ordinateur" note="Ce qui ne se défait pas (envoyer, supprimer, payer, fermer des applications) est toujours demandé avant. Les réglages simples (luminosité, volume, ouvrir une application) se font sans un mot.">
        <Row title="Regarder l'écran" desc="Quand tu parles de ce que tu vois. Un œil argile s'affiche à chaque capture.">
          <Toggle label="Regarder l'écran" on={c.screen} onChange={(screen) => set({ screen })} />
        </Row>
        <Row title="Agir à l'écran" desc="Cliquer, écrire, ouvrir un menu ; sa main glisse avant chaque geste. « Stop » arrête tout.">
          <Toggle label="Agir à l'écran" on={c.act} onChange={(act) => set({ act })} />
        </Row>
      </Card>
    </>
  )
}

function SessionsSection() {
  const bg = useBgDelay()
  return (
    <Card title="Sessions">
      <Row title="Passer en arrière-plan après" desc="Une commande ou un agent qui dure passe d'office en arrière-plan ; Claude continue à côté.">
        <Seg label="Délai" value={bg.delay} options={BG_DELAYS.map((d) => [d, d ? `${d} s` : 'Jamais'] as const)} onChange={(d) => bg.set(d)} />
      </Row>
      <Row title="Mode d'autorisation par défaut" desc="Repris de tes réglages Claude Code (defaultMode) ; chaque session se change aussi depuis sa saisie.">
        <span className="st-desc">Réglages Claude Code</span>
      </Row>
    </Card>
  )
}

function NotifSection() {
  const [info, setInfo] = useState<NotifInfo | null>(null)
  useEffect(() => {
    void api.getNotif().then(setInfo)
    return api.onNotifSettings(() => void api.getNotif().then(setInfo))
  }, [])
  const set = (p: Partial<NotifSettings>) => void api.setNotif(p).then(setInfo)
  if (!info) return null
  const s = info.settings
  return (
    <Card title="Notifications" note="En mode compagnon, elles s'affichent au-dessus de la bulle.">
      <Row title="Coin de l'écran">
        <Seg label="Coin" value={s.corner} options={[['tl', 'Haut gauche'], ['tr', 'Haut droite'], ['bl', 'Bas gauche'], ['br', 'Bas droite']] as const} onChange={(corner) => set({ corner })} />
      </Row>
      <Row title="Son" desc="Le tintement doux quand une session t'attend.">
        <Toggle label="Son" on={s.sound} onChange={(sound) => set({ sound })} />
      </Row>
      <Row title="Au-dessus du plein écran" desc="Même pendant une vidéo ou une présentation.">
        <Toggle label="Au-dessus du plein écran" on={s.overFullscreen} onChange={(overFullscreen) => set({ overFullscreen })} />
      </Row>
      <Row title="Heures calmes" desc="Pas de carte ni de son ; tout t'attend au retour.">
        <span className="st-inline">
          <input type="time" value={s.quietFrom} onChange={(e) => set({ quietFrom: e.target.value })} aria-label="Début" />
          →
          <input type="time" value={s.quietTo} onChange={(e) => set({ quietTo: e.target.value })} aria-label="Fin" />
          <Toggle label="Heures calmes" on={s.quiet} onChange={(quiet) => set({ quiet })} />
        </span>
      </Row>
    </Card>
  )
}

function LookSection() {
  const [theme, setTheme] = useState<ThemeMode | null>(null)
  useEffect(() => void api.getTheme().then(setTheme), [])
  const zoom = useTiles((t) => t.zoom)
  const setZoom = useTiles((t) => t.setZoom)
  return (
    <Card title="Apparence">
      <Row title="Thème">
        {theme && <Seg<ThemeMode> label="Thème" value={theme} options={[['light', 'Clair'], ['dark', 'Sombre'], ['system', 'Système']] as const} onChange={(m) => void api.setTheme(m).then(() => setTheme(m))} />}
      </Row>
      <Row title="Zoom de la mosaïque" desc="Le même pour toutes les cases ; Ctrl+molette dans la mosaïque.">
        <span className="st-inline">
          <input type="range" min={ZOOM_MIN * 100} max={ZOOM_MAX * 100} step={10} value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} aria-label="Zoom de la mosaïque" />
          <span className="st-val">{Math.round(zoom * 100)} %</span>
        </span>
      </Row>
    </Card>
  )
}

export function SettingsView() {
  const [sec, setSec] = useState<Section>('voice')
  return (
    <div className="settings">
      <aside className="st-nav">
        <h1>Paramètres</h1>
        {SECTIONS.map(([k, l]) => (
          <button key={k} type="button" aria-current={k === sec ? 'page' : undefined} onClick={() => setSec(k)}>{l}</button>
        ))}
        <span style={{ flex: 1 }} />
        <p className="st-desc">Réglages de Canopy. Ceux de Claude Code (skills, MCP, mémoire) restent dans « Outils de Claude ».</p>
      </aside>
      <main className="st-main">
        <div className="st-col">
          <h2>{SECTIONS.find(([k]) => k === sec)![1]}</h2>
          {sec === 'voice' && <VoiceSection />}
          {sec === 'companion' && <CompanionSection />}
          {sec === 'sessions' && <SessionsSection />}
          {sec === 'notif' && <NotifSection />}
          {sec === 'look' && <LookSection />}
        </div>
      </main>
    </div>
  )
}
