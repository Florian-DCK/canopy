import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { create } from 'zustand'
import type { FoundProject, SetupFeatures, SetupLog, SetupStatus } from '../../../shared/types'
import { MOD, isMac } from '../platform'
import { api, useStore } from '../store'
import './setup.css'

// Premier lancement (planche 42). Le setup n'apparaît que si setupStatus() répond done=false ; tant que le statut est
// inconnu (ou en erreur), l'app normale s'affiche.

/** Porte du setup : statut connu, setup affiché, bandeau « à finir » ignoré pour la session. */
export const useSetupGate = create<{
  status: SetupStatus | null
  show: boolean
  /** Aperçu : le setup s'affiche mais rien n'est enregistré ni lancé. */
  preview: boolean
  ignored: boolean
  refresh: () => Promise<void>
  reopen: () => Promise<void>
  openPreview: () => void
  closePreview: () => void
  ignore: () => void
}>((set) => ({
  status: null,
  show: false,
  preview: false,
  ignored: false,
  openPreview: () => set({ show: true, preview: true }),
  closePreview: () => set({ show: false, preview: false }),
  refresh: async () => {
    try {
      const status = await api.setupStatus()
      set({ status, show: !status.done })
    } catch {
      /* méthode absente ou erreur : app normale */
    }
  },
  reopen: async () => {
    try {
      await api.setupReopen()
      set({ show: true })
    } catch {
      /* ignoré */
    }
  },
  ignore: () => set({ ignored: true })
}))

type StepKey = 'welcome' | 'claude' | 'projects' | 'features' | 'perms' | 'voice' | 'ready'
const ALL: [StepKey, string, string][] = [
  ['welcome', 'Bienvenue', ''],
  ['claude', 'Claude', ''],
  ['projects', 'Projets', ''],
  ['features', 'Fonctions', ''],
  ['perms', 'Autorisations', 'macOS'],
  ['voice', 'Voix', 'optionnel'],
  ['ready', 'C’est prêt', '']
]
const VOICES = ['azelma', 'alba', 'marius', 'javert']
const COLORS = ['#6A9BCC', '#D4A27F', '#B9B5AA', '#8DBF7A', '#C9A0DC', '#D97757']
const colorOf = (name: string) => COLORS[[...name].reduce((a, c) => a + c.charCodeAt(0), 0) % COLORS.length]
const short = (p: string) => p.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, '~')
const when = (t: number) => {
  const d = Math.floor((Date.now() - t) / 86400000)
  return d < 1 ? 'aujourd’hui' : d === 1 ? 'hier' : d < 7 ? `il y a ${d} j` : d < 30 ? `${Math.floor(d / 7)} sem.` : `${Math.floor(d / 30)} mois`
}
const DEFAULT_FEATURES: SetupFeatures = { voice: true, companion: true, capture: true, notif: true, blender: false, fal: false }

type Task = { running: boolean; lines: string[]; error?: string; url?: string }
const IDLE: Task = { running: false, lines: [] }
type VoiceTask = Task & { step?: { n: number; total: number }; steps: Record<number, string>; done?: boolean }

function Ico({ kind }: { kind: 'ok' | 'todo' | 'off' | 'act' | 'err' }) {
  return <span className={`su-ico${kind === 'ok' ? '' : ' ' + kind}`}>{kind === 'ok' ? '✓' : kind === 'act' ? '…' : kind === 'off' ? '–' : kind === 'err' ? '!' : ''}</span>
}
function Log({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null)
  useEffect(() => void ref.current?.scrollTo(0, ref.current.scrollHeight), [lines])
  return lines.length ? <pre className="su-log" ref={ref}>{lines.join('\n')}</pre> : null
}

export function Setup({ onDone, preview = false }: { onDone: () => void; preview?: boolean }) {
  // Aperçu : on peut simuler l'autre système ; les gestes qui écrivent ou lancent quelque chose sont neutralisés.
  const [simMac, setSimMac] = useState(api.platform === 'darwin')
  const mac = preview ? simMac : api.platform === 'darwin'
  const [note, setNote] = useState('')
  const inPreview = (what: string) => {
    if (!preview) return false
    setNote(`Aperçu : « ${what} » n’est pas lancé.`)
    return true
  }
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [step, setStep] = useState<StepKey>('welcome')
  const [feats, setFeats] = useState<SetupFeatures>(DEFAULT_FEATURES)
  const [mode, setMode] = useState<'claudeai' | 'console' | null>(null)
  const [login, setLogin] = useState<Task>(IDLE)
  const [code, setCode] = useState('')
  const [claudeTask, setClaudeTask] = useState<Task>(IDLE)
  const [voiceTask, setVoiceTask] = useState<VoiceTask>({ ...IDLE, steps: {} })
  const [voice, setVoice] = useState(VOICES[0]) // Choix gardé ici ; pas transmis au main pour l'instant (aucune méthode prévue).
  const [found, setFound] = useState<FoundProject[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [asked, setAsked] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [wantShortcut, setWantShortcut] = useState(true)
  const [shortcutErr, setShortcutErr] = useState('')
  const initFeats = useRef(false)

  const reload = useCallback(async () => {
    try {
      const s = await api.setupStatus()
      setStatus(s)
      if (!initFeats.current) {
        initFeats.current = true
        setFeats(s.features ?? { ...DEFAULT_FEATURES, blender: !!s.blender })
      }
      return s
    } catch {
      return null
    }
  }, [])

  useEffect(() => {
    void reload()
    api
      .setupFindProjects()
      .then((list) => {
        const sorted = [...list].sort((a, b) => b.mtime - a.mtime)
        const pick = new Set(sorted.filter((p) => !p.known).slice(0, 3).map((p) => p.path))
        setFound(sorted)
        setChecked(Object.fromEntries(sorted.map((p) => [p.path, p.known || pick.has(p.path)])))
      })
      .catch(() => {})
    return api.onSetupLog((e: SetupLog) => {
      const push = (t: Task): Task => ({ ...t, lines: e.line ? [...t.lines, e.line].slice(-60) : t.lines, url: e.url ?? t.url })
      if (e.task === 'login') setLogin((t) => ({ ...push(t), running: e.done || e.error ? false : t.running, error: e.error ?? t.error }))
      else if (e.task === 'claude') setClaudeTask((t) => ({ ...push(t), running: e.done || e.error ? false : t.running, error: e.error ?? t.error }))
      else setVoiceTask((t) => ({ ...push(t), step: e.step ?? t.step, steps: e.step ? { ...t.steps, [e.step.n]: e.step.text } : t.steps, done: e.done || t.done, running: e.done || e.error ? false : t.running, error: e.error ?? (e.step ? undefined : t.error) }))
      if (e.done) void reload()
    })
  }, [reload])

  // Autorisations : relire quand la fenêtre reprend le focus (retour des Réglages).
  useEffect(() => {
    const on = () => void reload()
    window.addEventListener('focus', on)
    return () => window.removeEventListener('focus', on)
  }, [reload])

  if (!status) return <div className="setup" />

  const list = ALL.filter(([k]) => (k !== 'perms' || mac) && (k !== 'voice' || feats.voice))
  const idx = Math.max(0, list.findIndex(([k]) => k === step))
  const cur = list[idx][0]
  const go = (k: StepKey) => setStep(k)
  const loggedIn = status.auth.loggedIn
  const stt = status.voice.stt
  const sttName = stt === 'mlx' ? 'Whisper avec MLX sur la puce Apple' : stt === 'openvino' ? 'Whisper avec OpenVINO sur la carte graphique Intel' : 'Whisper sur le processeur (plus lent)'
  const voiceRunning = voiceTask.running
  const nProj = found.filter((p) => checked[p.path]).length
  const firstProject = found.find((p) => checked[p.path] && !p.known)?.name ?? found.find((p) => checked[p.path])?.name ?? 'un projet'

  const startLogin = (m: 'claudeai' | 'console') => {
    setMode(m)
    if (inPreview(m === 'console' ? 'Se connecter à la Console' : 'Se connecter')) return
    setLogin({ running: true, lines: [] })
    api.setupLogin(m).then(() => reload(), (e) => setLogin((t) => ({ ...t, running: false, error: String(e?.message ?? e) })))
  }
  const installClaude = () => {
    if (inPreview('Installer Claude Code')) return
    setClaudeTask({ running: true, lines: [] })
    api.setupInstallClaude().then(() => reload(), (e) => setClaudeTask((t) => ({ ...t, running: false, error: String(e?.message ?? e) })))
  }
  const installVoice = () => {
    if (inPreview('Installer la voix')) return
    setVoiceTask({ running: true, lines: [], steps: {} })
    api.setupInstallVoice().then(() => reload(), (e) => setVoiceTask((t) => ({ ...t, running: false, error: String(e?.message ?? e) })))
  }
  const ask = async (kind: 'screen' | 'microphone' | 'accessibility') => {
    setAsked((a) => ({ ...a, [kind]: true }))
    if (inPreview('Autoriser')) return
    try {
      await api.setupAskPermission(kind)
    } catch {
      /* ignoré */
    }
    void reload()
  }

  const next = async () => {
    if (cur === 'projects') {
      const paths = found.filter((p) => checked[p.path] && !p.known).map((p) => p.path)
      if (paths.length && !preview) await api.setupAddProjects(paths).catch(() => {})
    }
    if (cur === 'ready') {
      if (preview) return onDone()
      setBusy(true)
      try {
        if (wantShortcut && !status.shortcut?.exists) {
          const r = await api.setupShortcut().catch((e) => ({ ok: false, error: String(e?.message ?? e) }))
          if (!r.ok) {
            setShortcutErr(r.error ?? 'Raccourci impossible à créer.')
            return
          }
        }
        await api.setupFinish(feats)
        await useStore.getState().loadProjects()
        onDone()
      } finally {
        setBusy(false)
      }
      return
    }
    go(list[Math.min(list.length - 1, idx + 1)][0])
  }

  const addFolder = async () => {
    if (inPreview('Ajouter un dossier')) return
    const p = await api.addProject().catch(() => null)
    if (!p || found.some((f) => f.path === p.path)) return
    setFound((f) => [{ name: p.name, path: p.path, mtime: Date.now(), known: true }, ...f])
    setChecked((c) => ({ ...c, [p.path]: true }))
  }

  const checks: [string, string, boolean, ReactNode?][] = [
    ['Node.js', status.node.version ?? 'introuvable', status.node.ok],
    ['Claude Code', status.claude.ok ? [status.claude.version, status.claude.path].filter(Boolean).join(' · ') : 'à installer', status.claude.ok],
    ['Git', status.git.version ?? 'introuvable', status.git.ok]
  ]

  const bodies: Record<StepKey, ReactNode> = {
    welcome: (
      <div className="su-col" style={{ maxWidth: 640 }}>
        <h1 className="su-h1 big">Travailler avec Claude sur tous tes projets, d’un coup d’œil.</h1>
        <p className="su-p" style={{ fontSize: 16 }}>Canopy pilote Claude Code sur ta machine : sessions en parallèle, artefacts, navigateur, voix. Quelques minutes pour le brancher ; ce qui est optionnel peut attendre.</p>
        <div className="su-list">
          {[
            ['Vérifier Claude Code et ta connexion', '1 min'],
            ['Choisir tes projets', '1 min'],
            ['Choisir les fonctions optionnelles', '30 s'],
            [mac ? 'Donner les autorisations de macOS utiles' : 'Aucune autorisation à donner sous Windows', mac ? '1 min' : '—'],
            ['Installer la voix (si tu la veux)', '≈ 8 min, en fond']
          ].map(([t, d]) => (
            <span key={t} className="su-line" style={{ gap: 14 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--slate)', flex: 'none' }} />
              <span className="su-t">{t}</span>
              <span className="su-mut" style={{ fontSize: 12.5 }}>{d}</span>
            </span>
          ))}
        </div>
        <span className="su-sm">Rien ne quitte ta machine pendant le setup, sauf la connexion à ton compte Claude et le téléchargement des modèles de voix si tu les choisis.</span>
      </div>
    ),
    claude: (
      <div className="su-col" style={{ maxWidth: 720, gap: 20 }}>
        <h1 className="su-h1">Brancher Claude</h1>
        <div className="su-list">
          {checks.map(([t, d, ok]) => (
            <span key={t} className="su-line">
              <Ico kind={ok ? 'ok' : t === 'Claude Code' && claudeTask.running ? 'act' : 'todo'} />
              <span className="su-t">{t}</span>
              <span className="su-d">{d}</span>
              {t === 'Claude Code' && !ok && (
                <button type="button" className="btn sm" disabled={claudeTask.running} onClick={installClaude}>{claudeTask.running ? 'Installation…' : 'Installer'}</button>
              )}
            </span>
          ))}
          <Log lines={claudeTask.lines} />
          {claudeTask.error && <span className="su-line su-err">{claudeTask.error}</span>}
        </div>
        <span className="su-h3">Comment Claude se connecte</span>
        <div className="su-grid2">
          <button type="button" className={`su-card${mode === 'claudeai' ? ' on' : ''}`} aria-pressed={mode === 'claudeai'} onClick={() => startLogin('claudeai')}>
            <b>Mon abonnement Claude</b>
            <span className="su-cd">Pro ou Max, via claude login : une page s’ouvre dans ton navigateur.</span>
            <span className="su-mut">Usage personnel</span>
          </button>
          <button type="button" className={`su-card${mode === 'console' ? ' on' : ''}`} aria-pressed={mode === 'console'} onClick={() => setMode('console')}>
            <b>Une clé d’API Anthropic</b>
            <span className="su-cd">Pour un usage d’équipe ou si tu n’as pas d’abonnement.</span>
            <span className="su-mut">Facturée à l’usage</span>
          </button>
        </div>
        {mode === 'console' && !login.running && !loggedIn && (
          <div className="su-col" style={{ gap: 8, alignItems: 'flex-start' }}>
            <button type="button" className="btn primary" onClick={() => startLogin('console')}>Se connecter à la Console</button>
            <span className="su-sm">Canopy ne voit jamais ta clé : Claude Code la garde lui-même.</span>
          </div>
        )}
        {login.running && (
          <div className="su-col" style={{ gap: 10 }}>
            <span className="su-line" style={{ padding: 0 }}>
              <Ico kind="act" />En attente de la connexion dans ton navigateur…
            </span>
            {login.url && <a href={login.url} target="_blank" rel="noreferrer" className="su-mono su-mut" style={{ wordBreak: 'break-all' }}>{login.url}</a>}
            <span className="su-row">
              <input className="su-input" placeholder="Code" value={code} onChange={(e) => setCode(e.target.value)} aria-label="Code" />
              <button type="button" className="btn sm" disabled={!code.trim()} onClick={() => void api.setupLoginInput(code.trim()).then(() => setCode(''))}>Envoyer le code</button>
            </span>
          </div>
        )}
        {login.error && <span className="su-err">{login.error}</span>}
        {loggedIn && !login.running && (
          <div className="su-ok">
            <Ico kind="ok" />
            <span>Connecté : <b style={{ fontWeight: 600 }}>{status.auth.email ?? 'compte Claude'}</b>{status.auth.plan ? ` · ${status.auth.plan}` : ''}</span>
            <span style={{ flex: 1 }} />
            <button type="button" className="su-link" onClick={() => startLogin(mode ?? 'claudeai')}>Changer de compte</button>
          </div>
        )}
      </div>
    ),
    projects: (
      <div className="su-col" style={{ maxWidth: 760 }}>
        <h1 className="su-h1">Tes projets</h1>
        <p className="su-p">Canopy a trouvé ces dossiers (dépôts git récents dans {mac ? '~/Documents et ~/Developer' : 'Documents'}). Coche ceux sur lesquels tu travailles ; chacun reçoit une couleur.</p>
        <div className="su-list">
          {found.length === 0 && <span className="su-line su-sm">Aucun dépôt git récent trouvé. Ajoute un dossier ci-dessous.</span>}
          {found.map((p) => (
            <button key={p.path} type="button" role="checkbox" aria-checked={!!checked[p.path]} className="su-proj" disabled={p.known} onClick={() => setChecked((c) => ({ ...c, [p.path]: !c[p.path] }))}>
              <span className={`su-box${checked[p.path] ? ' on' : ''}`}>{checked[p.path] ? '✓' : ''}</span>
              <span className="su-pd" style={{ background: colorOf(p.name) }} />
              <span className="su-pn">{p.name}</span>
              <span className="su-pp">{short(p.path)}</span>
              <span className="su-mut">{p.known ? 'déjà dans Canopy' : when(p.mtime)}</span>
            </button>
          ))}
        </div>
        <div className="su-row">
          <button type="button" className="btn" onClick={() => void addFolder()}>Ajouter un dossier…</button>
        </div>
      </div>
    ),
    features: (
      <div className="su-col" style={{ maxWidth: 820, gap: 16 }}>
        <h1 className="su-h1">Ce que tu veux activer</h1>
        <p className="su-p" style={{ fontSize: 15 }}>Le cœur est déjà prêt. Le reste est optionnel et peut s’ajouter plus tard.</p>
        <div className="su-grid2">
          {(
            [
              ['voice', 'Mode voix', 'Parler à Claude et l’entendre répondre, à la voix.', mac ? 'Micro · ≈ 2 Go de modèles (MLX)' : stt === 'openvino' ? 'Micro · ≈ 2,4 Go de modèles (OpenVINO)' : 'Micro · ≈ 2 Go de modèles'],
              ['companion', 'Compagnon', 'Une bulle sur le bureau ; Claude peut lire ton écran et agir, sous ton contrôle.', mac ? 'Enregistrement de l’écran · Accessibilité' : 'Aucune autorisation'],
              ['capture', 'Captures d’écran', 'Claude voit ce que tu lui montres (« regarde ça »).', mac ? 'Enregistrement de l’écran' : 'Aucune autorisation'],
              ['notif', 'Notifications', 'Quand une session a fini ou attend ta réponse, même en plein écran.', mac ? 'Notifications' : 'Aucune autorisation'],
              ['blender', 'Blender', 'Ouvrir les modèles 3D dans Blender et le piloter.', status.blender ? `${status.blender} trouvé` : 'Blender introuvable'],
              ['fal', 'Génération d’images (fal)', 'Clé fal gardée dans le coffre, jamais visible pour Claude.', 'Clé à coller à l’étape suivante']
            ] as [keyof SetupFeatures, string, string, string][]
          ).map(([k, t, d, n]) => {
            const dis = k === 'blender' && !status.blender
            const on = feats[k] && !dis
            return (
              <div key={k} className="su-card su-feat">
                <span><b>{t}</b><span className="su-cd">{d}</span><span className="su-mut">{n}</span></span>
                <button type="button" role="switch" aria-checked={on} aria-label={t} disabled={dis} className={`su-tog${on ? ' on' : ''}`} onClick={() => setFeats((f) => ({ ...f, [k]: !f[k] }))}><span /></button>
              </div>
            )
          })}
        </div>
      </div>
    ),
    perms: (() => {
      const P = status.permissions
      const defs: ['screen' | 'microphone' | 'accessibility' | 'notif', string, string, boolean, string][] = [
        ['microphone', 'Micro', 'Pour le mode voix.', feats.voice, 'Autoriser'],
        ['screen', 'Enregistrement de l’écran', 'Pour les captures et le compagnon.', feats.capture || feats.companion, 'Ouvrir les Réglages'],
        ['accessibility', 'Accessibilité', 'Pour que le compagnon clique et écrive à ta place.', feats.companion, 'Ouvrir les Réglages'],
        ['notif', 'Notifications', 'Pour te prévenir quand une session t’attend.', feats.notif, 'Autoriser']
      ]
      return (
        <div className="su-col" style={{ maxWidth: 760 }}>
          <h1 className="su-h1">Autorisations de macOS</h1>
          <p className="su-p">Seulement celles qu’exigent les fonctions que tu as choisies. macOS ouvre ses Réglages ; Canopy attend et coche dès que c’est fait.</p>
          <div className="su-list">
            {defs.filter((d) => d[3]).length === 0 && <span className="su-line su-sm">Aucune autorisation nécessaire pour les fonctions choisies.</span>}
            {defs.filter((d) => d[3]).map(([k, t, d, , btn]) => {
              // Notifications : pas d'API dédiée, macOS demandera à la première notification.
              const ok = k === 'notif' || P[k] === 'granted'
              const wait = !ok && asked[k]
              return (
                <div key={k} className="su-perm">
                  <span><b>{t}</b><span className="su-sm">{d}</span></span>
                  <span className={`su-pst ${ok ? 'ok' : wait ? 'wait' : ''}`}>{ok ? 'Autorisé' : wait ? 'En attente des Réglages…' : 'À autoriser'}</span>
                  <button type="button" className={`btn${ok ? ' ghost' : ' primary'}`} disabled={ok} onClick={() => (wait ? void reload() : k !== 'notif' && void ask(k))}>{ok ? 'Fait' : wait ? 'J’ai autorisé' : btn}</button>
                </div>
              )
            })}
          </div>
          {P.screen === 'granted' && (feats.capture || feats.companion) && <div className="su-warn">macOS ne prend en compte l’Enregistrement de l’écran qu’au prochain lancement.</div>}
        </div>
      )
    })(),
    voice: (() => {
      const total = voiceTask.step?.total ?? 5
      const curN = voiceTask.done ? total + 1 : (voiceTask.step?.n ?? 1)
      return (
        <div className="su-col" style={{ maxWidth: 760 }}>
          <h1 className="su-h1">Installer la voix</h1>
          <p className="su-p">Reconnaissance et synthèse tournent sur ta machine ({sttName}, voix Pocket TTS). Environ 2 Go à télécharger ; tu peux continuer pendant ce temps.</p>
          {status.voice.installed ? (
            <div className="su-ok"><Ico kind="ok" />Déjà installée</div>
          ) : voiceTask.running || voiceTask.error || voiceTask.done ? (
            <div className="su-list">
              {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
                const state = n < curN ? 'done' : n === curN ? 'act' : 'todo'
                const err = state === 'act' && !!voiceTask.error
                return (
                  <div key={n} className={`su-vstep ${state === 'todo' ? 'todo' : ''}`}>
                    <span className="su-line" style={{ padding: 0 }}>
                      <Ico kind={err ? 'err' : state === 'done' ? 'ok' : state === 'act' ? 'act' : 'todo'} />
                      <span className="su-t">{voiceTask.steps[n] ?? `Étape ${n}`}</span>
                    </span>
                    {state === 'act' && !err && voiceTask.running && <span className="su-bar" />}
                  </div>
                )
              })}
              {voiceTask.error && (
                <span className="su-line su-err">
                  <span style={{ flex: 1 }}>{voiceTask.error}</span>
                  <button type="button" className="btn sm" onClick={installVoice}>Reprendre</button>
                </span>
              )}
            </div>
          ) : (
            <div className="su-row"><button type="button" className="btn primary" onClick={installVoice}>Installer</button></div>
          )}
          <div className="su-row" style={{ gap: 12 }}>
            <span className="su-h3">Voix de Claude</span>
            {VOICES.map((v) => (
              <button key={v} type="button" className="su-pill" aria-pressed={voice === v} onClick={() => setVoice(v)}>{v}</button>
            ))}
          </div>
        </div>
      )
    })(),
    ready: (() => {
      const v = status.voice.installed ? `installé · ${voice}` : voiceRunning ? 'installation en cours' : voiceTask.error ? 'installation à reprendre' : 'installation à faire'
      const rows: [boolean, string, string][] = [
        [true, 'Claude connecté', status.auth.method === 'console' || mode === 'console' ? 'clé d’API' : 'abonnement'],
        [true, `${nProj} projet${nProj > 1 ? 's' : ''}`, 'dans le cockpit'],
        [feats.voice, 'Mode voix', feats.voice ? v : 'désactivé'],
        [feats.companion, 'Compagnon', feats.companion ? (mac ? (status.permissions.accessibility === 'granted' ? 'autorisé' : 'Accessibilité à autoriser') : 'actif') : 'désactivé'],
        [feats.capture, 'Captures d’écran', feats.capture ? (mac && status.permissions.screen !== 'granted' ? 'autorisation à finir' : 'actives') : 'désactivées'],
        [feats.notif, 'Notifications', feats.notif ? 'actives' : 'désactivées']
      ]
      return (
        <div className="su-col" style={{ maxWidth: 760 }}>
          <h1 className="su-h1" style={{ fontSize: 36 }}>C’est prêt.</h1>
          <div className="su-list">
            {rows.map(([on, t, d]) => (
              <span key={t} className="su-line" style={{ padding: '12px 18px' }}>
                <Ico kind={on ? 'ok' : 'off'} />
                <span className="su-t">{t}</span>
                <span className="su-mut" style={{ fontSize: 12.5 }}>{d}</span>
              </span>
            ))}
          </div>
          {status.shortcut?.exists ? (
            <span className="su-line su-shortcut">
              <Ico kind="ok" />
              <span className="su-t">Raccourci déjà là</span>
              <span className="su-mut mono" style={{ fontSize: 12 }}>{status.shortcut.path}</span>
            </span>
          ) : status.shortcut?.path ? (
            <label className="su-line su-shortcut">
              <input type="checkbox" checked={wantShortcut} onChange={(e) => setWantShortcut(e.target.checked)} />
              <span className="su-t">{mac ? 'Ajouter Canopy dans Applications' : 'Créer un raccourci sur le Bureau'}</span>
              <span className="su-mut" style={{ fontSize: 12.5 }}>{mac ? 'puis glisse-le dans le Dock' : 'Canopy.lnk'}</span>
            </label>
          ) : null}
          {shortcutErr && <span className="su-err">{shortcutErr}</span>}
          <span className="su-h3">Pour commencer</span>
          <div className="su-grid3">
            <span className="su-tip">Ouvre une session sur <b style={{ fontWeight: 600 }}>{firstProject}</b> et demande-lui de te présenter le projet.</span>
            <span className="su-tip">Essaie la voix : {isMac ? '⌥ Espace' : 'Alt+Espace'}, puis parle.</span>
            <span className="su-tip">{MOD}{isMac ? '' : '+'}K ouvre la recherche : sessions, projets, réglages.</span>
          </div>
        </div>
      )
    })()
  }

  const nextLabel = cur === 'welcome' ? 'Commencer' : cur === 'ready' ? 'Ouvrir Canopy' : cur === 'voice' && voiceRunning ? 'Continuer, ça s’installe en fond' : 'Continuer'
  const footNote = cur === 'claude' ? 'Rien n’est envoyé à Claude pendant le setup.' : cur === 'voice' ? 'Les modèles restent sur ta machine.' : ''

  return (
    <div className="setup" role="dialog" aria-label="Premier lancement de Canopy">
      <nav className="su-nav" aria-label="Étapes">
        <span className="su-brand">
          <svg aria-hidden="true" width="34" height="34" viewBox="0 0 34 34"><circle cx="17" cy="17" r="16" fill="#D97757" /><path d="M9 25l4-9 3 5 3-8 3 6 3-3v9z" fill="#F0EEE6" /></svg>
          Canopy
        </span>
        {list.map(([k, label, note], i) => (
          <button key={k} type="button" className={`su-step${i === idx ? ' cur' : i < idx ? ' past' : ''}`} aria-current={i === idx ? 'step' : undefined} onClick={() => go(k)}>
            <span className="su-dot">{i < idx ? '✓' : i + 1}</span>
            <span className="su-step-l">{label}</span>
            <span className="su-step-n">{note}</span>
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="su-navnote">Tout ce qui est réglé ici se retrouve ensuite dans Paramètres › Installation.</span>
      </nav>
      <main className="su-main">
        {preview && (
          <div className="su-preview" role="status">
            <b>Aperçu</b> — rien n’est enregistré ni lancé.{note && <span className="su-preview-note">{note}</span>}
            <span style={{ flex: 1 }} />
            <div className="su-preview-seg" role="group" aria-label="Système simulé">
              <button type="button" aria-pressed={mac} onClick={() => setSimMac(true)}>macOS</button>
              <button type="button" aria-pressed={!mac} onClick={() => setSimMac(false)}>Windows</button>
            </div>
            <button type="button" className="btn sm" onClick={onDone}>Quitter l’aperçu</button>
          </div>
        )}
        <div className="su-body">{bodies[cur]}</div>
        <footer className="su-foot">
          {idx > 0 && <button type="button" className="btn ghost" onClick={() => go(list[idx - 1][0])}>Retour</button>}
          <span className="su-fn">{footNote}</span>
          {(cur === 'voice' || cur === 'perms') && <button type="button" className="btn text" onClick={() => void next()}>Plus tard</button>}
          <button type="button" className="btn primary" disabled={busy || (cur === 'claude' && !loggedIn)} onClick={() => void next()}>{nextLabel}</button>
        </footer>
      </main>
    </div>
  )
}
