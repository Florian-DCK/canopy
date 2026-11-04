import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { thumbUrl } from '../media'
import { api, useStore } from '../store'
import { CanopyMark, type MarkState } from './CanopyMark'
import { clearStage, setMicMuted, hush, voiceLevels, selectStage, setVoiceSession, setMute, setVoiceName, startVoice, stopVoice, useVoice, VOICES, type StageEntry, type VoicePhase } from './runtime'
import { StageBody, stageInfo } from './Scene'
import { withTransition } from './transition'
import { setCompanion, useCompanion } from './companion'
import './voice.css'

/** État du logo selon la phase : il écoute (arbres au vent) seulement quand tu parles vraiment. */
export function markOf(phase: VoicePhase, speech: boolean): MarkState {
  if (phase === 'waking') return 'intro'
  if (phase === 'think') return 'think'
  if (phase === 'speak') return 'speak'
  if (phase === 'listen' && speech) return 'listen'
  return 'rest'
}

const WORD: Record<VoicePhase, string> = {
  off: '',
  waking: 'Je me réveille…',
  listen: 'Je t’écoute',
  think: 'Je réfléchis',
  speak: 'Claude parle',
  error: 'Mode voix indisponible'
}

/** Vue Canopée : le grand soleil, ce que tu dis, ce que Claude répond. */
export function VoiceView() {
  const v = useVoice()
  const session = useStore((s) => (v.sessionId ? s.sessions[v.sessionId] : undefined))
  const go = useStore((s) => s.go)

  useEffect(() => {
    void startVoice()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hush()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const cls = v.phase === 'listen' && !v.speech ? 'rest' : v.phase
  const line =
    v.phase === 'error' ? v.error
    : v.phase === 'speak' ? v.said
    : v.phase === 'waking' ? 'Chargement de la voix et de la transcription (une trentaine de secondes la première fois).'
    // Tour fini : toute la réponse reste lisible (pas seulement la dernière phrase), jusqu'à ce que tu reparles.
    : v.phase === 'listen' && !v.speech && v.written ? v.written
    : v.heard ? `« ${v.heard} »`
    : v.said
  const word = v.micMuted && (v.phase === 'listen' || v.phase === 'off') ? 'Micro coupé' : v.phase === 'listen' && !v.speech && v.gesture ? 'Montré sans parler' : WORD[v.phase]
  const split = v.stage.length > 0
  const fromClaude = !!line && v.phase !== 'error' && v.phase !== 'waking' && (line === v.said || line === v.written)
  const whole = fromClaude && line === v.written && line !== v.said
  const act = session?.status === 'run' ? session.activity : undefined
  const activity = act ? (act.kind === 'tool' ? `${act.label ?? 'Outil'}…` : act.kind === 'writing' ? 'J’écris' : 'Je réfléchis') : undefined
  const cur = v.stage.find((e) => e.id === v.stageSel) ?? v.stage[v.stage.length - 1]

  return (
    <main className={`voice v-${cls}${split ? ' v-split' : ''}`} aria-label="Mode voix">
      <VoiceHeader sessionId={v.sessionId} />
      <div className="v-sun">
        <CanopyMark state={markOf(v.phase, v.speech)} size={split ? 240 : 340} levels={voiceLevels} />
        {v.mute && v.phase !== 'waking' && v.phase !== 'error' ? (
          <div className="v-words v-ghost" aria-live="polite">
            <span className="v-word">{v.speech ? 'Je t’écoute' : v.phase === 'think' ? activity ?? 'Je travaille' : 'Mode fantôme'}</span>
            {/* Comme en mode parlé : la réponse de Claude prend la place de ta phrase, même style. */}
            {v.written && !v.speech ? <SwapLine k="claude" className="v-line v-ghost-claude" text={v.written} /> : <SwapLine k={v.heard ? 'you' : 'empty'} className="v-line you" text={v.heard ? `« ${v.heard} »` : ''} />}
          </div>
        ) : (
          <div className="v-words" aria-live="polite">
            <span className="v-word">{word}</span>
            {v.phase === 'speak' && v.spoken.length > 0 ? (
              <SpokenLines lines={v.spoken.slice(v.burst)} speaking={v.speaking} />
            ) : (
            <SwapLine k={!line ? 'empty' : fromClaude ? `c-${line}` : v.phase === 'waking' ? 'waking' : 'you'} className={`v-line${fromClaude ? (whole ? ' v-whole' : '') : v.phase === 'waking' || v.phase === 'error' ? ' sys' : ' you'}`} text={line ?? ''} />
            )}
          </div>
        )}
      </div>
      {split && cur && <Stage entries={v.stage} cur={cur} sessionId={v.sessionId} />}
      <div className="v-bar">
        {!session && <span className="v-with">Aucune session : ouvre-en une pour lui parler</span>}
        <span style={{ flex: 1 }} />
        <MicButton />
        <button type="button" aria-pressed={v.mute} onClick={() => setMute(!v.mute)} title="Mode fantôme : Claude travaille pareil mais ne répond plus à voix haute. À la voix : « passe en mode fantôme », « quitte le mode fantôme ».">{v.mute ? 'Mode fantôme' : 'Réponses à voix haute'}</button>
        <span>Voix</span>
        <div className="v-seg" role="group" aria-label="Voix">
          {VOICES.map((x) => (
            <button key={x.id} type="button" aria-pressed={v.voice === x.id} onClick={() => setVoiceName(x.id)}>{x.label}</button>
          ))}
        </div>
        {v.phase === 'speak' && <button type="button" onClick={hush} title="Couper Claude (Échap)"><Icon name="stop" size={14} />Couper</button>}
        {v.phase === 'error' && <button type="button" onClick={() => void startVoice()}><Icon name="restart" size={14} />Réessayer</button>}
        <button type="button" onClick={() => setCompanion(true)} title="Canopy se range ; une bulle reste au-dessus de ton bureau et continue d'écouter">Mode compagnon</button>
        <button
          type="button"
          onClick={() => {
            stopVoice()
            go(v.sessionId ? { name: 'session', sessionId: v.sessionId } : { name: 'cockpit' })
          }}
        >
          <Icon name="close" size={14} />Quitter le mode voix
        </button>
      </div>
    </main>
  )
}

/** Pendant que Claude parle : toute la réponse, la phrase entendue en clair et centrée, le texte défile au rythme
 * de la voix (comme dans la bulle du compagnon). */
function SpokenLines({ lines, speaking }: { lines: { id: string; text: string }[]; speaking: string | null }) {
  const box = useRef<HTMLDivElement>(null)
  const cur = lines.findIndex((l) => l.id === speaking)
  useEffect(() => {
    const b = box.current
    const el = b?.querySelector<HTMLElement>('.k-now')
    if (b && el) b.scrollTo({ top: el.offsetTop - b.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' })
  }, [cur, lines.length])
  return (
    <div ref={box} className="v-line v-karaoke">
      {lines.map((l, k) => (
        <span key={l.id} className={k === cur ? 'k-now' : k < cur ? 'k-past' : 'k-next'}>{l.text} </span>
      ))}
    </div>
  )
}

/** Une ligne de texte qui change en douceur : la nouvelle monte en se précisant pendant que l'ancienne s'efface.
 * Même clé = même ligne qui grandit (ta phrase en cours de transcription) ; nouvelle clé = remplacement. */
function SwapLine({ k, text, className }: { k: string; text: string; className: string }) {
  const [lines, setLines] = useState([{ k, text, className }])
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    setLines((cur) => {
      const last = cur[cur.length - 1]
      if (last.k === k) return [...cur.slice(0, -1), { k, text, className }]
      return [last, { k, text, className }]
    })
  }, [k, text, className])
  useEffect(() => {
    if (lines.length < 2) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setLines((cur) => cur.slice(-1)), 320)
  }, [lines.length])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  return (
    <span className="v-swap">
      {lines.map((l, i) => (
        <span key={l.k} className={`${l.className} ${i < lines.length - 1 ? 'v-out' : 'v-in'}`}>{l.text}</span>
      ))}
    </span>
  )
}

/** En haut : à quel projet et quelle session tu parles, et de quoi en changer. */
function VoiceHeader({ sessionId }: { sessionId: string | null }) {
  const sessions = useStore((s) => s.sessions)
  const projects = useStore((s) => s.projects)
  const cur = sessionId ? sessions[sessionId] : undefined
  const project = cur ? projects.find((p) => p.id === cur.projectId) : undefined
  const open = Object.values(sessions).filter((x) => !x.readOnly)
  const sandbox = projects.find((p) => p.sandbox)
  // « Nouvelle conversation au bac à sable » : une session s'ouvre là-bas et la voix lui parle.
  const pick = async (v: string) => {
    if (!v.startsWith('new:')) return setVoiceSession(v)
    const meta = await api.createSession(v.slice(4))
    setVoiceSession(meta.id)
  }
  const byProject = projects.map((p) => ({ p, list: open.filter((x) => x.projectId === p.id).sort((a, b) => b.updatedAt - a.updatedAt) })).filter((g) => g.list.length)
  return (
    <header className="v-top">
      <span className="v-top-project">{project?.name ?? 'Aucun projet'}</span>
      <span className="v-top-sep">·</span>
      <span className="v-top-session" title={cur?.title}>{cur?.title ?? 'Aucune session'}</span>
      {(open.length > 1 || sandbox) && (
        <label className="v-top-change" title="Parler à une autre session">
          Changer
          <select value={sessionId ?? ''} onChange={(e) => void pick(e.target.value)}>
            {sandbox && <option value={`new:${sandbox.id}`}>＋ Nouvelle conversation au bac à sable</option>}
            {byProject.map(({ p, list }) => (
              <optgroup key={p.id} label={p.name}>
                {list.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
      )}
    </header>
  )
}

/** Scène à droite du soleil : la dernière chose montrée en grand, les autres en vignettes. */
function Stage({ entries, cur, sessionId }: { entries: StageEntry[]; cur: StageEntry; sessionId: string | null }) {
  const st = useStore()
  const info = stageInfo(cur)
  const open = () => {
    if (!sessionId) return
    if (cur.kind === 'image' || cur.kind === 'video') st.openViewer({ sessionId, mediaId: cur.media.id, mode: 'single' })
    else if (cur.kind === 'artifact') {
      st.openArtTab(sessionId, cur.url)
      st.go({ name: 'session', sessionId })
    }
  }
  return (
    <section className="v-stage" aria-label="Ce que Claude montre">
      <div key={cur.id} className="v-stage-body">
        <StageBody e={cur} />
      </div>
      <div className="v-stage-info">
        <span className="v-stage-t">{info.title}</span>
        <span>{info.meta}</span>
        <span style={{ flex: 1 }} />
        {entries.length > 1 && <span>{entries.indexOf(cur) + 1} / {entries.length}</span>}
        {(cur.kind === 'image' || cur.kind === 'video' || cur.kind === 'artifact') && <button type="button" onClick={open}>Ouvrir en grand</button>}
        {sessionId && <button type="button" onClick={() => st.go({ name: 'session', sessionId })}>Voir dans la session</button>}
        <button type="button" onClick={clearStage} title="Retirer de l'écran"><Icon name="close" size={13} /></button>
      </div>
      {entries.length > 1 && (
        <div className="v-thumbs">
          {entries.map((e) => (
            <button key={e.id} type="button" aria-pressed={e.id === cur.id} title={stageInfo(e).title} onClick={() => selectStage(e.id)}>
              {e.kind === 'image' ? <img src={thumbUrl(e.media.id)} alt="" /> : <span>{stageInfo(e).title}</span>}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

/** Couper ou rendre ton micro : je n'entends plus rien tant qu'il est coupé. */
function MicButton() {
  const muted = useVoice((v) => v.micMuted)
  return (
    <button type="button" className={`v-mic${muted ? ' off' : ''}`} aria-pressed={muted} onClick={() => setMicMuted(!muted)} title={muted ? 'Réactiver le micro' : 'Couper le micro'}>
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />{muted && <path d="M4 4l16 16" />}</svg>
      {muted ? 'Micro coupé' : 'Micro'}
    </button>
  )
}

/** Pastille quand Claude a montré autre chose : le soleil continue d'écouter en bas de l'écran. */
export function VoiceDock() {
  const v = useVoice()
  const view = useStore((s) => s.view)
  const go = useStore((s) => s.go)
  // En mode compagnon, la bulle suffit : pas de seconde barre dans Canopy.
  const companion = useCompanion((c) => c.on)
  if (v.phase === 'off' || view.name === 'voice' || companion) return null
  const st = v.phase === 'speak' ? 'Claude parle' : v.phase === 'think' ? 'Je réfléchis' : v.gesture ? 'Montré sans parler' : 'Je t’écoute'
  const txt = v.phase === 'speak' ? v.said : v.heard ? `« ${v.heard} »` : ''
  return (
    <div className="v-dock" role="status">
      <button type="button" className="v-dock-mark" title="Revenir au mode voix" onClick={() => withTransition(() => go({ name: 'voice' }))}>
        <CanopyMark state={markOf(v.phase, v.speech)} size={44} />
      </button>
      {txt && <span className="v-dock-txt">{txt}</span>}
      <span className="v-dock-st">{st}</span>
      <button type="button" className="v-dock-x" title="Quitter le mode voix" onClick={stopVoice}><Icon name="close" size={14} /></button>
    </div>
  )
}
