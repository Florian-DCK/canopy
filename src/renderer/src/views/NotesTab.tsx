import { useEffect, useRef, useState } from 'react'
import type { MeetingNote, MeetingNoteMeta, NoteSeg, NoteSpeaker, NoteWho } from '../../../shared/notes'
import { briefItems, useAgenda } from '../agenda'
import { finishNotes, pauseNotes, removeSeg, setNotesLang, startNotes, useNotes, type NotesLang } from '../notes/runtime'
import { api, useStore } from '../store'

const clock = (ms: number) => {
  const s = Math.floor(ms / 1000)
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}
const hms = (t: number) => new Date(t).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const WHO: Record<NoteWho, [string, string]> = { me: ['Toi', 'me'], room: ['Dans la pièce', 'room'], remote: ['En visio', 'remote'], mic: ['Micro', 'mic'] }
const defaultTitle = () => `Réunion du ${new Date().toLocaleDateString('fr-BE', { day: 'numeric', month: 'long' })}`

/** Libellé et couleur d’une voix : nom donné, « Toi », « Pièce 1 », « Visio 2 », sinon l’ancien libellé. */
function whoOf(s: NoteSeg, speakers?: NoteSpeaker[]): [string, string] {
  const [label, cls] = WHO[s.who] ?? WHO.mic
  if (!s.speaker) return [label, cls]
  const m = /^([pv])(\d+)$/.exec(s.speaker)
  const group = s.speaker === 'me' ? 'me' : m ? (m[1] === 'p' ? 'room' : 'remote') : cls
  const name = speakers?.find((x) => x.id === s.speaker)?.name?.trim()
  return [name || (s.speaker === 'me' ? 'Toi' : m ? `${m[1] === 'p' ? 'Pièce' : 'Visio'} ${m[2]}` : label), group]
}

function Seg({ s, speakers, onForget }: { s: NoteSeg; speakers?: NoteSpeaker[]; onForget?: () => void }) {
  const [label, cls] = whoOf(s, speakers)
  return (
    <div className="nt-seg">
      <time>{hms(s.t0)}</time>
      <b className={`nt-who ${cls}`}>{label}</b>
      <span>{s.text}</span>
      {onForget && <button type="button" className="nt-forget" aria-label="Oublier cette ligne" title="Oublier cette ligne" onClick={onForget}>✕</button>}
    </div>
  )
}

/* ---------- En cours ---------- */

const LANGS: [NotesLang, string][] = [['auto', 'Auto'], ['fr', 'FR'], ['en', 'EN'], ['nl', 'NL']]

/** Titre d’une note, modifiable sur place (Entrée ou clic ailleurs pour garder, Échap pour annuler). */
function TitleEdit({ id, title }: { id: string | null; title: string }) {
  const [v, setV] = useState(title)
  useEffect(() => setV(title), [title])
  const keep = () => {
    const t = v.trim()
    if (!id || !t || t === title) return setV(title)
    useNotes.setState({ title: t })
    void api.notesRename(id, t)
  }
  return (
    <input className="nt-title-edit" aria-label="Titre de la note" value={v} onChange={(e) => setV(e.target.value)} onBlur={keep}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setV(title); e.currentTarget.blur() } }} />
  )
}

function Live() {
  const n = useNotes()
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [ending, setEnding] = useState(false)
  useEffect(() => {
    const el = box.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [n.segs.length])
  const langs = [...new Set(n.segs.map((s) => s.lang?.toUpperCase()).filter(Boolean))].join(', ')
  const paused = n.status === 'paused'
  return (
    <div className="ag-card nt-live">
      <div className="nt-bar">
        <span className={`nt-dot ${paused ? 'off' : ''}`} aria-hidden="true" />
        <b role="status">{ending ? 'Fin de la transcription…' : paused ? 'En pause' : 'Notes en cours'} · {clock(n.elapsed)}</b>
        <span className="ag-sp" />
        <div className="seg" role="group" aria-label="Langue de la réunion" title="Langue de la réunion : « Auto » laisse Whisper deviner, peu fiable sur les phrases courtes">
          {LANGS.map(([v, l]) => <button key={v} type="button" aria-pressed={n.lang === v} onClick={() => setNotesLang(v)}>{l}</button>)}
        </div>
        <button type="button" className="btn sm" disabled={ending} onClick={() => pauseNotes(!paused)}>{paused ? 'Reprendre' : 'Pause · Ctrl+Alt+A'}</button>
        <button type="button" className="btn sm primary" disabled={ending} onClick={() => { setEnding(true); void finishNotes() }}>Terminer</button>
      </div>
      <div className="ag-sub">
        <TitleEdit id={n.noteId} title={n.title} /> · Toi : micro{n.pcOk ? ' · visio : son du PC' : ''}{langs ? ` · langues détectées : ${langs}` : ''}
      </div>
      {n.warning && <div className="ag-err" role="alert">{n.warning}</div>}
      <div className="nt-list" ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40 }}>
        {n.segs.length === 0 && <span className="ag-sub">En attente des premiers mots…</span>}
        {n.segs.map((s) => <Seg key={s.id} s={s} onForget={() => removeSeg(s.id)} />)}
      </div>
      <div className="nt-speak">
        <span className={n.micSpeaking ? 'on' : ''}>Micro : parle…</span>
        {n.pcOk && <span className={n.pcSpeaking ? 'on' : ''}>Son du PC : parle…</span>}
      </div>
    </div>
  )
}

/* ---------- Détail ---------- */

function Point({ it }: { it: { text: string; ctx?: string } }) {
  if (!it.ctx) return <span>{it.text}</span>
  return (
    <details className="ag-pt">
      <summary>{it.text}</summary>
      <p>{it.ctx}</p>
    </details>
  )
}

/** Une voix repérée : son nom se saisit sur place (Entrée ou clic ailleurs pour garder). */
function SpeakerRow({ noteId, sp, label }: { noteId: string; sp: NoteSpeaker; label: string }) {
  const [v, setV] = useState(sp.name ?? '')
  useEffect(() => setV(sp.name ?? ''), [sp.name])
  const keep = () => {
    if (v.trim() !== (sp.name ?? '')) void api.notesNameSpeaker(noteId, sp.id, v.trim())
  }
  const cls = sp.id === 'me' ? 'me' : sp.id.startsWith('p') ? 'room' : 'remote'
  return (
    <div className="nt-sp">
      <div className="nt-sp-who">
        <b className={`nt-who ${cls}`}>{label}</b>
        <span>{Math.round(sp.share * 100)} % de la parole</span>
      </div>
      <q className="nt-sp-q">{sp.sample}</q>
      {sp.id === 'me' ? (
        <span className="nt-sp-me">C’est toi</span>
      ) : (
        <input className="nt-sp-in" list={`nt-names-${noteId}`} aria-label={`Nom de ${label}`} placeholder="Nom…" value={v} onChange={(e) => setV(e.target.value)} onBlur={keep}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
      )}
    </div>
  )
}


function Detail({ id, onBack }: { id: string; onBack: () => void }) {
  const projects = useStore((s) => s.projects)
  const meetings = useAgenda((s) => s.state?.meetings)
  const [note, setNote] = useState<MeetingNote | null>(null)
  const [showDraft, setShowDraft] = useState(false)
  const [off, setOff] = useState<Set<number>>(new Set())
  const [pid, setPid] = useState('')
  const [fb, setFb] = useState('')
  const load = () => void api.notesGet(id).then(setNote)
  useEffect(load, [id])
  useEffect(() => api.onEvent((e) => e.type === 'notes:changed' && (!e.id || e.id === id) && load()), [id])
  if (!note) return <div className="ag-sub">Chargement…</div>
  const shown = showDraft && note.draft ? note.draft : note.segments
  const names = [...new Set((meetings?.find((m) => m.id === note.meetingId)?.attendees ?? []).flatMap((a) => [a.name, a.email]).filter((x): x is string => !!x))]
  const md = note.summary ?? ''
  const brief = briefItems(md, 'En bref')
  const decisions = briefItems(md, 'Décisions')
  const actions = briefItems(md, 'Actions')
  const questions = briefItems(md, 'Questions ouvertes')
  const project = note.projectId ?? pid
  const checked = (actions ?? []).filter((_, i) => !off.has(i)).map((a) => a.text)
  const toList = async () => {
    setFb('')
    const r = await api.notesToChecklist(id, project, checked)
    setFb(r.ok ? `${checked.length} action${checked.length > 1 ? 's ajoutées' : ' ajoutée'} à la checklist.` : r.error)
  }
  const remove = async () => {
    if (!window.confirm(`Supprimer « ${note.title} » ?`)) return
    await api.notesDelete(id)
    onBack()
  }
  return (
    <div className="ag-brief">
      <button type="button" className="ag-link" onClick={onBack}>← Notes de réunion</button>
      <div className="ag-meta"><span>{new Date(note.startedAt).toLocaleString('fr-BE', { dateStyle: 'long', timeStyle: 'short' })}</span>{note.endedAt && <><span>·</span><span>{clock(note.endedAt - note.startedAt)}</span></>}</div>
      <h2 className="ag-hero-t"><TitleEdit id={note.id} title={note.title} /></h2>
      {note.state === 'refining' && (
        <div className="ag-card">
          <span className="ag-working" role="status"><i aria-hidden="true" />Deuxième passe : transcription précise et voix…</span>
          <progress max={1} value={note.progress ?? 0} aria-label="Avancement de la deuxième passe" style={{ width: '100%' }} />
        </div>
      )}
      {note.state === 'summarizing' && <div className="ag-card"><span className="ag-working" role="status"><i aria-hidden="true" />Claude rédige le compte rendu…</span></div>}
      {note.state === 'error' && (
        <div className="ag-card">
          <span className="ag-err">{note.error || 'Le compte rendu n’a pas pu être rédigé.'}</span>
          <div className="ag-acts"><button type="button" className="btn sm" onClick={() => { void api.notesSummarize(id) }}>Relancer</button></div>
        </div>
      )}
      {note.state === 'done' && (
        <>
          {brief && <div className="ag-card"><h3 className="ag-h">En bref</h3>{brief.map((b, i) => <p key={i} className="nt-p">{b.text}</p>)}</div>}
          {decisions && <div className="ag-card"><h3 className="ag-h">Décisions</h3><ul className="ag-ul">{decisions.map((d, i) => <li key={i}><Point it={d} /></li>)}</ul></div>}
          {actions && (
            <div className="ag-card">
              <h3 className="ag-h">Actions</h3>
              <ul className="ag-ul chk">
                {actions.map((a, i) => (
                  <li key={i} className="ag-chk"><input type="checkbox" aria-label={a.text} checked={!off.has(i)} onChange={() => setOff((o) => { const x = new Set(o); if (!x.delete(i)) x.add(i); return x })} /><Point it={a} /></li>
                ))}
              </ul>
              <div className="ag-acts">
                {!note.projectId && (
                  <select aria-label="Projet" value={pid} onChange={(e) => setPid(e.target.value)}>
                    <option value="">Choisir un projet…</option>
                    {projects.filter((p) => !p.sandbox).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                )}
                <button type="button" className="btn sm primary" disabled={!project || !checked.length} onClick={() => void toList()}>Ajouter à la checklist du projet</button>
                {fb && <span className="ag-sub" role="status">{fb}</span>}
              </div>
            </div>
          )}
          {questions && <div className="ag-card"><h3 className="ag-h">Questions ouvertes</h3><ul className="ag-ul">{questions.map((q, i) => <li key={i}><Point it={q} /></li>)}</ul></div>}
        </>
      )}
      {note.speakers && note.speakers.length > 0 && (
        <div className="ag-card">
          <h3 className="ag-h">Qui est qui ?</h3>
          <datalist id={`nt-names-${note.id}`}>{names.map((x) => <option key={x} value={x} />)}</datalist>
          {note.speakers.map((sp) => <SpeakerRow key={sp.id} noteId={note.id} sp={sp} label={whoOf({ speaker: sp.id, who: sp.track === 'pc' ? 'remote' : 'room' } as NoteSeg)[0]} />)}
          <div className="ag-acts"><button type="button" className="btn sm" disabled={note.state === 'summarizing' || note.state === 'refining'} onClick={() => { void api.notesSummarize(id) }}>Réécrire le compte rendu avec ces noms</button></div>
        </div>
      )}
      <details className="ag-card nt-full" open={note.state === 'refining' || undefined}>
        <summary>
          {note.draft?.length ? (showDraft ? 'Transcript en direct' : 'Transcript précis · deuxième passe') : 'Transcript en direct'} ({shown.length} segments
          {!showDraft && note.speakers?.length ? ` · ${note.speakers.length} voix` : ''})
        </summary>
        {note.draft && note.draft.length > 0 && (
          <div className="ag-acts"><button type="button" className="btn sm ghost" onClick={() => setShowDraft((v) => !v)}>{showDraft ? 'Voir la version précise' : 'Voir la version en direct'}</button></div>
        )}
        <div className="nt-list">{shown.map((s) => <Seg key={s.id} s={s} speakers={showDraft ? undefined : note.speakers} onForget={() => void api.notesRemoveSeg(note.id, s.id)} />)}</div>
      </details>
      <div className="ag-acts"><button type="button" className="btn sm ghost" onClick={() => void remove()}>Supprimer</button></div>
    </div>
  )
}

/* ---------- Liste ---------- */

const STATE: Record<string, string> = { recording: 'en cours', paused: 'en pause', refining: 'deuxième passe…', summarizing: 'compte rendu en cours…', done: 'prêt', error: 'en erreur' }

export function NotesTab() {
  const n = useNotes()
  const [list, setList] = useState<MeetingNoteMeta[]>([])
  const [openId, setOpenId] = useState<string | null>(null)
  const load = () => void api.notesList().then(setList)
  useEffect(load, [])
  useEffect(() => api.onEvent((e) => e.type === 'notes:changed' && load()), [])
  // À la fin d'une prise de notes, on ouvre son résultat.
  const last = useRef(n.lastNoteId)
  useEffect(() => {
    if (n.lastNoteId && n.lastNoteId !== last.current) setOpenId(n.lastNoteId)
    last.current = n.lastNoteId
  }, [n.lastNoteId])
  if (n.status === 'starting') return <div className="ag-card"><span className="ag-working" role="status"><i aria-hidden="true" />{n.step}</span></div>
  if (n.status !== 'idle') return <Live />
  if (openId) return <Detail id={openId} onBack={() => { setOpenId(null); load() }} />
  return (
    <div className="ag-col">
      <div className="ag-card">
        <div className="ag-acts"><button type="button" className="btn primary" onClick={() => void startNotes({ title: defaultTitle() })}>Nouvelle prise de notes</button><span className="ag-sub">Micro + son du PC, transcrits en direct ; Claude rédige le compte rendu à la fin. Le titre se change ensuite.</span></div>
        {n.error && <span className="ag-err" role="alert">{n.error}</span>}
      </div>
      <h3 className="ag-h">Notes précédentes</h3>
      {list.length === 0 && <div className="ag-card ag-empty">Aucune prise de notes pour l’instant.</div>}
      {list.map((m) => (
        <div key={m.id} className="ag-row">
          <div className="ag-when"><span>{new Date(m.startedAt).toLocaleDateString('fr-BE', { day: 'numeric', month: 'short' })}</span><b>{hms(m.startedAt).slice(0, 5)}</b></div>
          <div className="ag-row-main">
            <button type="button" className="ag-row-t" onClick={() => setOpenId(m.id)} title={m.title}>{m.title}</button>
            <div className="ag-row-s"><span>{m.endedAt ? `${clock(m.endedAt - m.startedAt)} · ` : ''}{m.count} segment{m.count > 1 ? 's' : ''} · {STATE[m.state] ?? m.state}</span></div>
          </div>
        </div>
      ))}
    </div>
  )
}
