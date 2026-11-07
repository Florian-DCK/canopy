import { useEffect, useState, type ReactNode } from 'react'
import type { CompanionPrefs, NotifInfo, NotifSettings, ThemeMode, VaultEntry } from '../../../shared/types'
import { BG_DELAYS, useBgDelay } from '../bgtasks'
import { useAgenda } from '../agenda'
import type { SourceStatus } from '../../../shared/agenda'
import { api, useStore } from '../store'
import { useTiles, ZOOM_MAX, ZOOM_MIN } from '../tiles'
import { useVoicePrefs, type Avatar, type EndMode } from '../voice/prefs'
import { enrollCancel, enrollSave, enrollStart, setMute, setVoiceName, startVoice, stopVoice, useVoice, VOICES } from '../voice/runtime'
import { ENROLL_PHRASES, useMyVoice } from '../voice/myvoice'
import './settings.css'
import { MOD } from '../platform'
import { useSetupGate } from './Setup'

// Page Paramètres (planche 34) : les réglages de Canopy réunis au même endroit. Ceux de Claude Code (skills, MCP,
// mémoire) restent dans « Outils de Claude ».

const SECTIONS = [
  ['voice', 'Voix'],
  ['companion', 'Compagnon'],
  ['sessions', 'Sessions'],
  ['notif', 'Notifications'],
  ['agenda', 'Agenda'],
  ['vault', 'Coffre'],
  ['look', 'Apparence'],
  ['install', 'Installation']
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
          <Seg<Avatar> label="Apparence" value={p.avatar} options={[['canopy', 'Canopée'], ['esprit', 'Esprit de la forêt'], ['chouette', 'Chouette'], ['gland', 'Gland']] as const} onChange={(avatar) => p.set({ avatar })} />
        </Row>
        <Row title="Voix" desc="Les voix clonées, locales, ou les voix d'OpenAI (en ligne, payantes, clé OPENAI_API_KEY). Le changement s'applique à la phrase suivante.">
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
      <MyVoiceCard />
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

/** Reconnaître ta voix : apprentissage (six phrases) et filtre « seulement ma voix ». */
function MyVoiceCard() {
  const p = useVoicePrefs()
  const me = useMyVoice()
  const v = useVoice()
  const okCount = me.samples.filter((s) => s.ok).length
  const next = ENROLL_PHRASES[Math.min(okCount, ENROLL_PHRASES.length - 1)]
  const last = me.samples[me.samples.length - 1]
  const running = v.phase !== 'off' && v.phase !== 'error'
  return (
    <Card title="Ma voix" note="Une empreinte de ta voix, gardée sur ton ordinateur : Claude ne réagit qu’à toi, pas aux vidéos ni aux autres voix.">
      {me.enrolling ? (
        <div className="st-enroll" aria-live="polite">
          <span className="st-enroll-step">Phrase {Math.min(okCount + 1, ENROLL_PHRASES.length)} sur {ENROLL_PHRASES.length} · <b>{next.how}</b></span>
          <p className="st-enroll-text">« {next.text} »</p>
          <span className="st-enroll-bar" aria-hidden="true">
            {ENROLL_PHRASES.map((_, i) => <span key={i} className={i < okCount ? 'done' : i === okCount ? 'cur' : ''} />)}
          </span>
          <span className="st-desc">
            {v.speech ? 'Je t’écoute…' : !last ? 'Lis la phrase à voix haute.' : !last.ok ? 'Trop court : relis la phrase en entier.' : last.same !== undefined && last.same < 0.5 ? 'Cette phrase ressemble peu aux autres (bruit, autre voix ?). Continue, elle comptera moins.' : 'Bien reçu.'}
          </span>
          <span className="st-inline">
            <button type="button" className="st-btn" onClick={enrollCancel}>Annuler</button>
            <button type="button" className="st-btn primary" disabled={okCount < 3} onClick={enrollSave}>
              {okCount >= ENROLL_PHRASES.length ? 'Enregistrer ma voix' : okCount >= 3 ? `Enregistrer (${okCount} phrases)` : 'Encore quelques phrases'}
            </button>
          </span>
        </div>
      ) : (
        <>
          <Row
            title="Empreinte de ta voix"
            desc={!running ? 'Le service voix démarre le temps de l’apprentissage.' : !me.available ? 'Modèle d’empreinte absent du service voix.' : me.profile ? 'Enregistrée. Réapprends-la si tu changes de micro ou si Claude t’entend moins bien.' : 'Pas encore apprise : six phrases à lire, une minute environ.'}
          >
            <span className="st-inline">
              {me.result && <span className={`st-state ${me.result.ok ? 'ok' : 'err'}`}>{me.result.ok ? `Apprise (${me.result.n} phrases)` : me.result.error}</span>}
              <button type="button" className="st-btn" disabled={running && !me.available} onClick={() => void enrollStart()}>{me.profile ? 'Réapprendre ma voix' : 'Apprendre ma voix'}</button>
            </span>
          </Row>
          <Row title="Ne répondre qu’à ma voix" desc="Ce qui ne te ressemble pas est ignoré, et une vidéo ne coupe plus la parole à Claude.">
            <Toggle label="Ne répondre qu’à ma voix" on={p.onlyMe && me.profile} onChange={(onlyMe) => p.set({ onlyMe })} />
          </Row>
          <Row title="Exigence" desc={`Plus strict : moins de faux départs, mais il faut parler distinctement.${me.ignored ? ` ${me.ignored} morceau${me.ignored > 1 ? 'x' : ''} écarté${me.ignored > 1 ? 's' : ''} depuis le démarrage.` : ''}`}>
            <span className="st-inline">
              <span className="st-desc">Indulgent</span>
              <input type="range" min={0} max={100} step={5} value={Math.round(p.meStrict * 100)} disabled={!p.onlyMe} onChange={(e) => p.set({ meStrict: Number(e.target.value) / 100 })} aria-label="Exigence de reconnaissance de ta voix" />
              <span className="st-desc">Strict</span>
            </span>
          </Row>
        </>
      )}
    </Card>
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

/** Agenda (planches 51 à 55) : connexions Google et Teamleader, briefs, notes de réunion. */
function SourceRow({ title, desc, status, source, children }: { title: string; desc?: string; status: SourceStatus; source: 'google' | 'teamleader'; children?: ReactNode }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const connect = async () => {
    setBusy(true)
    setErr('')
    try {
      const r = await api.agendaConnect(source)
      if (!r.ok) setErr(r.error)
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
      void useAgenda.getState().load()
    }
  }
  const problem = err || status.error
  return (
    <Row title={title} desc={status.connected ? `Connecté${status.account ? ` : ${status.account}` : ''}${status.error ? ` — ${status.error}` : ''}` : busy ? 'Termine la connexion dans ton navigateur…' : (problem ?? desc)}>
      {status.connected ? (
        <button type="button" className="st-btn" onClick={() => void api.agendaDisconnect(source).then(() => useAgenda.getState().load())}>Déconnecter</button>
      ) : (
        children ?? <button type="button" className="st-btn primary" disabled={busy} onClick={() => void connect()}>{source === 'google' ? 'Se connecter à Google' : 'Connecter'}</button>
      )}
    </Row>
  )
}

function GoogleClientForm() {
  const [id, setId] = useState('')
  const [secret, setSecret] = useState('')
  return (
    <span className="st-inline st-client">
      <input value={id} onChange={(e) => setId(e.target.value)} placeholder="ID client" aria-label="ID client" />
      <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="Code secret" aria-label="Code secret" />
      <button type="button" className="st-btn primary" disabled={!id.trim() || !secret.trim()} onClick={() => void api.agendaSetGoogleClient(id.trim(), secret.trim()).then(() => useAgenda.getState().load())}>Enregistrer</button>
    </span>
  )
}

function AgendaSection() {
  const { state, prefs, setPrefs, load } = useAgenda()
  useEffect(() => void load(), [load])
  if (!state || !prefs) return <div className="st-desc">Lecture de l’agenda…</div>
  return (
    <>
      <Card title="Connexions" note="Canopy se connecte lui-même : les connecteurs claude.ai ne servent qu’à Claude dans une session.">
        <SourceRow
          title="Google Agenda et Gmail"
          status={state.google}
          source="google"
          desc={state.google.configured ? 'Lecture seule : réunions et mails des participants.' : 'Console Google Cloud › Identifiants › ID client OAuth de type Application de bureau'}
        >
          {state.google.configured ? undefined : <GoogleClientForm />}
        </SourceRow>
        <SourceRow title="Teamleader Focus" desc="Tes tâches ouvertes. Les accès sont repris de l’outil de feuilles de temps." status={state.teamleader} source="teamleader" />
      </Card>
      <Card title="Briefs">
        <Row title="Préparer un brief pour" desc="Les réunions internes ont un bouton « brief à la demande ».">
          <Seg label="Préparer un brief pour" value={prefs.briefFor} options={[['external', 'Externes'], ['all', 'Toutes'], ['none', 'Aucune']] as const} onChange={(briefFor) => void setPrefs({ briefFor })} />
        </Row>
        <Row title="Mise à jour 30 min avant" desc="Seulement s’il y a du nouveau.">
          <Toggle label="Mise à jour 30 min avant" on={prefs.refreshBefore} onChange={(refreshBefore) => void setPrefs({ refreshBefore })} />
        </Row>
        <Row title="Lire les mails liés à la réunion" desc="Ceux qui parlent du sujet, sinon ceux des participants extérieurs. 60 derniers jours, lecture seule, jamais d’envoi.">
          <Toggle label="Lire les mails liés à la réunion" on={prefs.useMail} onChange={(useMail) => void setPrefs({ useMail })} />
        </Row>
        <Row title="Notification 10 min avant">
          <Toggle label="Notification 10 min avant" on={prefs.notifyBefore} onChange={(notifyBefore) => void setPrefs({ notifyBefore })} />
        </Row>
        <Row title="Rangement">
          <span className="st-desc">Dans les données de Canopy, jamais dans le dépôt du projet.</span>
        </Row>
      </Card>
      <IgnoredCard />
      <Card title="Notes de réunion">
        <Row title="Enregistrer et résumer une réunion" desc="Transcription et compte rendu après la réunion.">
          <span className="st-state">étape suivante</span>
        </Row>
      </Card>
    </>
  )
}

/** Réunions ignorées pour de bon (bouton « Ignorer › Toujours » de l'Agenda), et de quoi les rétablir. */
function IgnoredCard() {
  const [ignored, setIgnored] = useState<Record<string, string>>({})
  const state = useAgenda((s) => s.state)
  useEffect(() => void api.agendaIgnored().then(setIgnored), [state])
  const entries = Object.entries(ignored)
  return (
    <Card title="Réunions ignorées" note="Ni brief, ni notification, ni place dans l’agenda. Les blocs sans participants ni visio (télétravail, rappels) sont écartés d’office.">
      {entries.length === 0 && <Row title="Aucune pour l’instant" desc="Bouton « Ignorer » sur une réunion de l’Agenda.">{null}</Row>}
      {entries.map(([key, title]) => (
        <Row key={key} title={title} desc={key.startsWith('r:') ? 'Toute la série' : 'Toutes les réunions de ce titre'}>
          <button type="button" className="st-btn" onClick={() => void api.agendaUnignore(key).then(setIgnored)}>Rétablir</button>
        </Row>
      ))}
    </Card>
  )
}

/** Coffre (planche 39) : les noms des secrets, jamais leurs valeurs, où ils servent, et de quoi les retirer. */
function VaultSection() {
  const projects = useStore((s) => s.projects)
  const [list, setList] = useState<VaultEntry[] | null>(null)
  const load = () => void api.vaultList().then(setList).catch(() => setList([]))
  useEffect(load, [])
  const projectName = (key?: string) => projects.find((p) => p.path.replace(/\\/g, '/').toLowerCase() === key)?.name ?? key?.split('/').pop() ?? '—'
  const when = (t?: number) => (t ? new Date(t).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' }) : '—')
  return (
    <Card title="Secrets gardés" note="Chiffrés par Windows avec ton compte. Claude n'en connaît que les noms : Canopy écrit les valeurs dans le .env.local du projet, que Claude n'a pas le droit de lire.">
      {list === null && <div className="st-desc">Lecture du coffre…</div>}
      {list?.length === 0 && <div className="st-desc">Aucun secret pour l'instant. Quand Claude en demande un, ou que tu en colles un dans un message, il arrive ici.</div>}
      {list?.map((e) => (
        <Row key={`${e.scope}:${e.project ?? ''}:${e.name}`} title={e.name} desc={`${e.scope === 'global' ? 'Global' : projectName(e.project)} · ${e.where ? `servi dans ${e.where}` : 'pas encore servi'} · ${e.usedAt ? `utilisé le ${when(e.usedAt)}` : `ajouté le ${when(e.at)}`}`}>
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              const p = projects.find((x) => x.path.replace(/\\/g, '/').toLowerCase() === e.project)
              void api.vaultDelete(e.name, e.scope, p?.id).then(load)
            }}
          >
            Retirer
          </button>
        </Row>
      ))}
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
      <Row title="Zoom de la mosaïque" desc={`Le même pour toutes les cases ; ${MOD}+molette dans la mosaïque.`}>
        <span className="st-inline">
          <input type="range" min={ZOOM_MIN * 100} max={ZOOM_MAX * 100} step={10} value={Math.round(zoom * 100)} onChange={(e) => setZoom(Number(e.target.value) / 100)} aria-label="Zoom de la mosaïque" />
          <span className="st-val">{Math.round(zoom * 100)} %</span>
        </span>
      </Row>
    </Card>
  )
}

function UpdateButton() {
  const [msg, setMsg] = useState('')
  const check = async () => {
    setMsg('Vérification…')
    try {
      const u = await api.updateCheck()
      setMsg(u.error ? u.error : u.behind ? `${u.behind} nouveauté${u.behind > 1 ? 's' : ''} : voir le bandeau` : 'À jour')
    } catch (e) {
      setMsg(String((e as Error)?.message ?? e))
    }
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {msg && <span className="st-desc" style={{ margin: 0 }}>{msg}</span>}
      <button type="button" className="st-btn" onClick={() => void check()}>Vérifier maintenant</button>
    </span>
  )
}

function ShortcutButton() {
  const [msg, setMsg] = useState('')
  const make = async () => {
    try {
      const r = await api.setupShortcut()
      setMsg(r.ok ? (r.existed ? 'Déjà là' : 'Créé') : r.error ?? 'Échec')
    } catch (e) {
      setMsg(String((e as Error)?.message ?? e))
    }
  }
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {msg && <span className="st-desc" style={{ margin: 0 }}>{msg}</span>}
      <button type="button" className="st-btn" onClick={() => void make()}>Créer le raccourci</button>
    </span>
  )
}

function InstallSection() {
  const reopen = useSetupGate((g) => g.reopen)
  const openPreview = useSetupGate((g) => g.openPreview)
  return (
    <Card title="Installation">
      <Row title="Raccourci" desc="Lancer Canopy sans terminal : Applications sur Mac, Bureau sur Windows. Un raccourci existant n'est jamais remplacé.">
        <ShortcutButton />
      </Row>
      <Row title="Mises à jour" desc="Canopy vérifie le dépôt GitHub au démarrage puis toutes les 30 minutes ; un bandeau apparaît s'il y a du nouveau.">
        <UpdateButton />
      </Row>
      <Row title="Aperçu du setup" desc="Parcourir l'écran de premier lancement, en macOS ou Windows, sans rien enregistrer ni lancer.">
        <button type="button" className="st-btn" onClick={openPreview}>Voir l'aperçu</button>
      </Row>
      <Row title="Refaire le setup" desc="Rouvre l'écran de premier lancement (Claude, projets, fonctions, voix). Rien n'est remis à zéro.">
        <button type="button" className="st-btn" onClick={() => void reopen()}>Refaire le setup</button>
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
          {sec === 'agenda' && <AgendaSection />}
          {sec === 'vault' && <VaultSection />}
          {sec === 'look' && <LookSection />}
          {sec === 'install' && <InstallSection />}
        </div>
      </main>
    </div>
  )
}
