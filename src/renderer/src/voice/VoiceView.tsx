import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Icon } from '../icons'
import { thumbUrl } from '../media'
import { api, useStore } from '../store'
import { CanopyMark, type MarkState } from './CanopyMark'
import { clearStage, setMicMuted, hush, voiceLevels, selectStage, setVoiceSession, setMute, startVoice, stopVoice, typeToVoice, useVoice, type StageEntry, type VoicePhase } from './runtime'
import { Changes, StageBody, stageInfo } from './Scene'
import { Avatar } from './Avatar'
import { useVoicePrefs } from './prefs'
import { withTransition } from './transition'
import { setCompanion } from './companion'
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
  const avatarKind = useVoicePrefs((p) => p.avatar)
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
        <Avatar kind={avatarKind} state={markOf(v.phase, v.speech)} size={split ? 240 : 340} levels={voiceLevels} />
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
              <SpokenLines lines={v.spoken.slice(v.burst)} speaking={v.speaking} word={v.word} />
            ) : (
            <SwapLine k={!line ? 'empty' : fromClaude ? `c-${line}` : v.phase === 'waking' ? 'waking' : 'you'} className={`v-line${fromClaude ? (whole ? ' v-whole' : '') : v.phase === 'waking' || v.phase === 'error' ? ' sys' : ' you'}`} text={line ?? ''} />
            )}
          </div>
        )}
      </div>
      {split && cur && <Stage entries={v.stage} cur={cur} sessionId={v.sessionId} />}
      <div className="v-bar">
        {!session && <span className="v-with">Aucune session : ouvre-en une pour lui parler</span>}
        <TypeField />
        <span style={{ flex: 1 }} />
        {/* Commandes en icônes ; leur nom apparaît au survol. Le choix de la voix est dans les Paramètres. */}
        <div className="v-tools" role="toolbar" aria-label="Mode voix">
          {v.phase === 'speak' && <VBtn label="Couper Claude (Échap)" onClick={hush}><Icon name="stop" size={16} /></VBtn>}
          {v.phase === 'error' && <VBtn label="Réessayer" onClick={() => void startVoice()}><Icon name="restart" size={16} /></VBtn>}
          <MicButton />
          <VBtn label={v.mute ? 'Mode fantôme : Claude ne répond plus à voix haute' : 'Réponses à voix haute'} pressed={v.mute} className={v.mute ? 'warn' : ''} onClick={() => setMute(!v.mute)}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />{v.mute ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}</svg>
          </VBtn>
          <VBtn label="Mode compagnon : une bulle reste sur ton bureau" onClick={() => setCompanion(true)}>
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2.5" /><circle cx="16.5" cy="13.5" r="3.2" fill="currentColor" stroke="none" /><path d="M8 21h8" /></svg>
          </VBtn>
          <span className="v-tools-sep" aria-hidden="true" />
          <VBtn
            label="Quitter le mode voix"
            onClick={() => {
              stopVoice()
              go(v.sessionId ? { name: 'session', sessionId: v.sessionId } : { name: 'cockpit' })
            }}
          >
            <Icon name="close" size={16} />
          </VBtn>
        </div>
      </div>
    </main>
  )
}

/** Pendant que Claude parle : toute la réponse, la phrase entendue en clair et centrée, le texte défile au rythme
 * de la voix (comme dans la bulle du compagnon). */
function SpokenLines({ lines, speaking, word }: { lines: { id: string; text: string }[]; speaking: string | null; word: number }) {
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
        <span key={l.id} className={k === cur ? 'k-now' : k < cur ? 'k-past' : 'k-next'}>{k === cur ? nowWords(l.text, word) : l.text} </span>
      ))}
    </div>
  )
}

/** Ligne en cours : les deux mots qu'on entend en clair, les mots déjà dits estompés, la suite en retrait. */
function nowWords(text: string, word: number) {
  return text.split(/(\s+)/).filter((x) => x.trim()).map((w, i) => (
    <span key={i} className={i < word ? 'k-past' : i <= word + 1 ? undefined : 'k-next'}>{w} </span>
  ))
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
  // Une seule ligne de vignettes (les plus récentes, la courante toujours visible) ; « +N » déplie le reste.
  const [all, setAll] = useState(false)
  const MAX = 6
  const idx = entries.indexOf(cur)
  const start = Math.min(Math.max(0, entries.length - MAX), Math.max(0, idx))
  const shown = all ? entries : entries.slice(start, start + MAX)
  const hidden = entries.length - shown.length
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
      {/* Avant · après : le récap des fichiers se glisse juste dessous. */}
      {cur.kind === 'ba' && (() => {
        const ch = [...entries].reverse().find((x) => x.kind === 'changes')
        return ch?.kind === 'changes' ? <Changes files={ch.files} compact /> : null
      })()}
      <div className="v-stage-info">
        <span className="v-stage-t">{info.title}</span>
        <span>{info.meta}</span>
        <span style={{ flex: 1 }} />
        {entries.length > 1 && <span>{entries.indexOf(cur) + 1} / {entries.length}</span>}
        <div className="v-tools small" role="toolbar" aria-label="Ce que Claude montre">
          {(cur.kind === 'image' || cur.kind === 'video' || cur.kind === 'artifact') && <VBtn label="Ouvrir en grand" onClick={open}><Icon name="expand" size={15} /></VBtn>}
          {sessionId && <VBtn label="Voir dans la session" onClick={() => st.go({ name: 'session', sessionId })}><Icon name="conversation" size={15} /></VBtn>}
          <VBtn label="Retirer de l’écran" onClick={clearStage}><Icon name="close" size={15} /></VBtn>
        </div>
      </div>
      {entries.length > 1 && (
        <div className={`v-thumbs${all ? ' all' : ''}`}>
          {!all && hidden > 0 && (
            <button type="button" className="v-more" onClick={() => setAll(true)} aria-label={`Voir les ${entries.length} éléments`}>+{hidden}</button>
          )}
          {shown.map((e) => (
            <button key={e.id} type="button" aria-pressed={e.id === cur.id} title={stageInfo(e).title} onClick={() => selectStage(e.id)}>
              {e.kind === 'image' ? <img src={thumbUrl(e.media.id)} alt="" /> : <span>{stageInfo(e).title}</span>}
            </button>
          ))}
          {all && (
            <button type="button" className="v-more" onClick={() => setAll(false)}>Réduire</button>
          )}
        </div>
      )}
    </section>
  )
}

/** Bouton rond à icône ; son nom s'affiche au survol (bulle) et sert aux lecteurs d'écran. */
function VBtn({ label, onClick, pressed, className, children }: { label: string; onClick: () => void; pressed?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={`v-ibtn ${className ?? ''}`} aria-label={label} aria-pressed={pressed} data-tip={label} onClick={onClick}>
      {children}
    </button>
  )
}

/** Champ pour écrire à Claude sans parler (au bureau, micro coupé) ; Entrée envoie. */
function TypeField() {
  const [text, setText] = useState('')
  return (
    <form
      className="v-type"
      onSubmit={(e) => {
        e.preventDefault()
        typeToVoice(text)
        setText('')
      }}
    >
      <input aria-label="Écrire à Claude" placeholder="Écris-lui plutôt…" value={text} onChange={(e) => setText(e.target.value)} />
      <button type="submit" aria-label="Envoyer" disabled={!text.trim()}><Icon name="send" size={14} /></button>
    </form>
  )
}

/** Couper ou rendre ton micro : je n'entends plus rien tant qu'il est coupé. */
function MicButton() {
  const muted = useVoice((v) => v.micMuted)
  return (
    <VBtn label={muted ? 'Micro coupé : clique pour le réactiver' : 'Couper le micro'} pressed={muted} className={`v-mic${muted ? ' off' : ''}`} onClick={() => setMicMuted(!muted)}>
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />{muted && <path d="M4 4l16 16" />}</svg>
    </VBtn>
  )
}

/** Nombre de composers vocaux à l'écran : tant qu'il y en a un, la pastille de secours se cache. */
const useInlineVoice = create<{ n: number }>(() => ({ n: 0 }))

/** Le composer de la session à qui l'on parle devient la zone vocale : on voit sa phrase là où elle part. */
export function VoiceComposer({ sessionId }: { sessionId: string }) {
  const v = useVoice()
  const avatarKind = useVoicePrefs((p) => p.avatar)
  const session = useStore((s) => s.sessions[sessionId])
  const go = useStore((s) => s.go)
  const [typing, setTyping] = useState(false)
  const [text, setText] = useState('')
  useEffect(() => {
    useInlineVoice.setState((s) => ({ n: s.n + 1 }))
    return () => useInlineVoice.setState((s) => ({ n: s.n - 1 }))
  }, [])

  const act = session?.status === 'run' ? session.activity : undefined
  const activity = act ? (act.kind === 'tool' ? `${act.label ?? 'Outil'}…` : act.kind === 'writing' ? 'J’écris' : 'Je réfléchis') : undefined
  const word =
    v.micMuted && v.phase === 'listen' ? 'Micro coupé'
    : v.phase === 'think' ? activity ?? WORD.think
    : v.phase === 'listen' && v.mute && !v.speech ? 'Mode fantôme'
    : WORD[v.phase]
  const line =
    v.phase === 'error' ? v.error
    : v.phase === 'waking' ? 'Chargement de la voix et de la transcription…'
    : v.phase === 'speak' ? v.said
    : v.phase === 'think' || v.speech ? (v.heard ? `« ${v.heard} »` : '')
    : ''
  const hint = v.micMuted ? 'Réactive le micro, ou écris-lui.' : 'Parle, je t’écoute.'

  return (
    <div className={`composer v-cmp v-cmp-${v.phase}`} role="group" aria-label="Mode voix">
      <div className="v-cmp-main">
        <button type="button" className="v-cmp-mark" title="Agrandir le mode voix" onClick={() => withTransition(() => go({ name: 'voice' }))}>
          <Avatar kind={avatarKind} state={markOf(v.phase, v.speech)} size={52} levels={voiceLevels} />
        </button>
        <div className="v-cmp-words" aria-live="polite">
          <span className="v-cmp-word">{word}</span>
          {line ? <span className={`v-cmp-line${v.phase === 'error' || v.phase === 'waking' ? ' sys' : ''}`}>{line}</span> : <span className="v-cmp-line hint">{hint}</span>}
        </div>
      </div>
      {typing && (
        <form
          className="v-cmp-type"
          onSubmit={(e) => {
            e.preventDefault()
            typeToVoice(text)
            setText('')
          }}
        >
          <input aria-label="Écrire à Claude" autoFocus placeholder="Écris-lui plutôt… (Entrée envoie)" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setTyping(false)} />
          <button type="submit" className="cmp-send" aria-label="Envoyer" disabled={!text.trim()}><Icon name="send" size={16} /></button>
        </form>
      )}
      <div className="cmp-bar">
        <MicIcon />
        <button type="button" className={`cmp-icon${v.mute ? ' on' : ''}`} aria-pressed={v.mute} title={v.mute ? 'Mode fantôme : Claude ne répond plus à voix haute' : 'Réponses à voix haute'} onClick={() => setMute(!v.mute)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 9.5h3l4.5-4v13L7 14.5H4z" />{v.mute ? <path d="M16 9.5l5 5M21 9.5l-5 5" /> : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />}</svg>
        </button>
        <button type="button" className={`cmp-icon${typing ? ' on' : ''}`} aria-pressed={typing} title="Écrire plutôt que parler" onClick={() => setTyping(!typing)}>
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M7 10h1M11 10h1M15 10h1M8 14h8" /></svg>
        </button>
        <span style={{ flex: 1 }} />
        {v.phase === 'error' && <button type="button" className="cmp-icon" title="Réessayer" onClick={() => void startVoice()}><Icon name="restart" size={15} /></button>}
        <button type="button" className="cmp-icon" title="Quitter le mode voix" onClick={stopVoice}><Icon name="close" size={14} /></button>
        {v.phase === 'speak' && (
          <button type="button" className="cmp-send stop" aria-label="Couper Claude (Échap)" title="Couper Claude (Échap)" onClick={hush}>
            <Icon name="stop" size={15} />
          </button>
        )}
      </div>
    </div>
  )
}

function MicIcon() {
  const muted = useVoice((v) => v.micMuted)
  return (
    <button type="button" className={`cmp-icon${muted ? ' on' : ''}`} aria-pressed={muted} title={muted ? 'Micro coupé : clique pour le réactiver' : 'Couper le micro'} onClick={() => setMicMuted(!muted)}>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />{muted && <path d="M4 4l16 16" />}</svg>
    </button>
  )
}

/** Pastille de secours : la session à qui l'on parle n'est pas à l'écran (sinon c'est son composer qui écoute). */
export function VoiceDock() {
  const v = useVoice()
  const avatarKind = useVoicePrefs((p) => p.avatar)
  const view = useStore((s) => s.view)
  const go = useStore((s) => s.go)
  const inline = useInlineVoice((s) => s.n > 0)
  // En mode compagnon, Canopy au premier plan cache la bulle : la barre voix reprend sa place ici.
  if (v.phase === 'off' || view.name === 'voice' || inline) return null
  const st = v.phase === 'speak' ? 'Claude parle' : v.phase === 'think' ? 'Je réfléchis' : v.gesture ? 'Montré sans parler' : 'Je t’écoute'
  const txt = v.phase === 'speak' ? v.said : v.heard ? `« ${v.heard} »` : ''
  return (
    <div className="v-dock" role="status">
      <button type="button" className="v-dock-mark" title="Revenir au mode voix" onClick={() => withTransition(() => go({ name: 'voice' }))}>
        <Avatar kind={avatarKind} state={markOf(v.phase, v.speech)} size={44} />
      </button>
      {txt && <span className="v-dock-txt">{txt}</span>}
      <span className="v-dock-st">{st}</span>
      <button type="button" className="v-dock-x" title="Quitter le mode voix" onClick={stopVoice}><Icon name="close" size={14} /></button>
    </div>
  )
}
