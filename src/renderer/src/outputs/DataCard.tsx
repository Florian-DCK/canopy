import { useEffect, useMemo, useState } from 'react'
import type { MediaItem } from '../../../shared/types'
import { fmtSize } from '../media'
import { api, useStore } from '../store'
import './outputs.css'

// JSON et journaux dans le fil (planche 48) : arbre repliable avec filtre et chemin copiable,
// journal filtrable par niveau avec histogramme, lignes répétées regroupées. Lecture seule.

type Loaded = { text: string; size: number; truncated: boolean; error?: string }

export function DataCard({ m }: { m: MediaItem }) {
  const [d, setD] = useState<Loaded | null>(null)
  useEffect(() => {
    let live = true
    api.dataRead(m.id).then((x) => live && setD(x))
    return () => {
      live = false
    }
  }, [m.id])
  if (!d) return null
  if (d.error) return null
  const isLog = /\.(jsonl|ndjson|log)$/i.test(m.name)
  return isLog ? <LogView m={m} d={d} /> : <JsonView m={m} d={d} />
}

/* ---------- JSON ---------- */

type Row = { key: string; path: string; depth: number; v: unknown; isObj: boolean; arr: boolean; n: number; exp: boolean; hit: boolean }
const MAX_ROWS = 1500

const isBadDate = (s: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]))
  return d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]
}
const seg = (k: string, arr: boolean) => (arr ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`)

function JsonView({ m, d }: { m: MediaItem; d: Loaded }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [all, setAll] = useState(false)
  const [filter, setFilter] = useState('')
  const [raw, setRaw] = useState(false)
  const [copied, setCopied] = useState('')
  const parsed = useMemo(() => {
    try {
      return { v: JSON.parse(d.text) as unknown }
    } catch (e) {
      return { err: (e as Error).message }
    }
  }, [d.text])

  // Chemins qui mènent à une valeur suspecte (date impossible) : dépliés d'office, pour qu'elle se voie.
  const suspect = useMemo(() => {
    const out = new Set<string>()
    if (!('v' in parsed)) return out
    const walk = (v: unknown, path: string): boolean => {
      if (typeof v === 'string') return isBadDate(v)
      if (!v || typeof v !== 'object') return false
      let hit = false
      for (const [k, x] of Array.isArray(v) ? v.map((x, i) => [String(i), x] as const) : Object.entries(v as object)) if (walk(x, path + seg(k, Array.isArray(v)))) hit = true
      if (hit) out.add(path)
      return hit
    }
    walk(parsed.v, '')
    return out
  }, [parsed])

  const rows = useMemo(() => {
    if (!('v' in parsed)) return []
    const f = filter.trim().toLowerCase()
    const out: Row[] = []
    const walk = (v: unknown, key: string, path: string, depth: number): Row[] => {
      const isObj = !!v && typeof v === 'object'
      const arr = Array.isArray(v)
      const kids = isObj ? (arr ? (v as unknown[]).map((x, i) => [String(i), x] as const) : Object.entries(v as object)) : []
      const exp = all || (open[path] ?? (depth < 2 || suspect.has(path)))
      const hit = !!f && `${key} ${isObj ? '' : String(v)}`.toLowerCase().includes(f)
      const sub: Row[] = []
      if (isObj && (exp || f)) for (const [k, x] of kids) sub.push(...walk(x, k, path + seg(k, arr), depth + 1))
      if (f && !hit && !sub.length) return []
      return [{ key, path, depth, v, isObj, arr, n: kids.length, exp: exp || !!f, hit }, ...sub]
    }
    out.push(...walk(parsed.v, '', '', 0))
    return out.slice(1, MAX_ROWS + 1)
  }, [parsed, open, all, filter, suspect])

  const top = 'v' in parsed && parsed.v && typeof parsed.v === 'object' ? (Array.isArray(parsed.v) ? `${(parsed.v as unknown[]).length} éléments` : `${Object.keys(parsed.v as object).length} clés`) : ''
  const copy = (p: string) => {
    navigator.clipboard.writeText(p)
    setCopied(p)
    setTimeout(() => setCopied(''), 1500)
  }

  return (
    <div className="out-card">
      <div className="out-head">
        <span className="out-badge mono">{'{ }'}</span>
        <span className="mono" style={{ fontSize: 13 }}>{m.name}</span>
        <span className="small muted">· {[d.size < 1024 ? `${d.size} o` : fmtSize(d.size), top].filter(Boolean).join(' · ')}</span>
        <span style={{ flex: 1 }} />
        {'v' in parsed && !raw && (
          <>
            <label className="out-filter">
              <span className="sr-only">Filtrer par clé ou valeur</span>
              <input type="search" placeholder="clé ou valeur…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            </label>
            <button type="button" className="btn sm" onClick={() => (setAll(!all), setOpen({}))}>{all ? 'Replier' : 'Tout déplier'}</button>
          </>
        )}
      </div>
      {'err' in parsed || raw ? (
        <pre className="out-raw mono">{'err' in parsed ? `JSON invalide : ${parsed.err}\n\n` : ''}{d.text.slice(0, 20000)}</pre>
      ) : (
        <div className="out-tree mono" role="tree" aria-label={`Contenu de ${m.name}`}>
          {rows.map((r) => {
            const str = typeof r.v === 'string'
            const bad = str && isBadDate(r.v as string)
            return (
              <div key={r.path} role="treeitem" aria-expanded={r.isObj ? r.exp : undefined} className={`out-node ${r.hit ? 'hit' : ''}`} style={{ paddingLeft: 14 + (r.depth - 1) * 18 }}>
                {r.isObj ? (
                  <button type="button" className="out-caret" aria-label={`${r.exp ? 'Replier' : 'Déplier'} ${r.key}`} onClick={() => (setOpen({ ...open, [r.path]: !r.exp }), setAll(false))}>
                    {r.exp ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="out-caret" />
                )}
                <button type="button" className="out-key" title={`Copier ${r.path.replace(/^\./, '')}`} onClick={() => copy(r.path.replace(/^\./, ''))}>
                  {/^\d+$/.test(r.key) ? `[${r.key}]` : `"${r.key}"`}
                </button>
                {!r.isObj && <span className="muted">:</span>}
                <span className={r.isObj ? 'muted' : bad ? 'out-bad-val' : str ? 'out-str' : r.v === null || typeof r.v === 'boolean' ? 'out-kw' : ''}>
                  {r.isObj ? (r.arr ? '[ ]' : '{ }') : str ? JSON.stringify(r.v) : String(r.v)}
                </span>
                {r.isObj && <span className="out-meta">{r.arr ? `${r.n} éléments` : `${r.n} clés`}</span>}
                {bad && <span className="out-meta out-bad-note">date impossible</span>}
              </div>
            )
          })}
          {rows.length >= MAX_ROWS && <div className="out-more small muted">Affichage limité à {MAX_ROWS} lignes : filtre ou ouvre le fichier.</div>}
        </div>
      )}
      <div className="out-foot">
        <span className="small muted" style={{ flex: 1 }}>
          {copied ? `Copié : ${copied}` : d.truncated ? 'Fichier tronqué à 4 Mo.' : 'Clic sur une clé : copie son chemin.'}
        </span>
        <button type="button" className="btn sm" aria-pressed={raw} onClick={() => setRaw(!raw)}>{raw ? 'Arbre' : 'Texte brut'}</button>
        <button type="button" className="btn sm" onClick={() => api.openMedia(m.id)}>Ouvrir avec…</button>
      </div>
    </div>
  )
}

/* ---------- Journal ---------- */

type Level = 'FATAL' | 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE'
const LEVELS: Level[] = ['FATAL', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE']
const PINO: Record<number, Level> = { 60: 'FATAL', 50: 'ERROR', 40: 'WARN', 30: 'INFO', 20: 'DEBUG', 10: 'TRACE' }
type Line = { t?: number; time: string; lv: Level; msg: string; detail: string; rep: number }

function levelOf(x: unknown): Level {
  if (typeof x === 'number') return PINO[Math.round(x / 10) * 10] ?? 'INFO'
  const s = String(x ?? '').toUpperCase()
  if (s.startsWith('FATAL') || s.startsWith('CRIT')) return 'FATAL'
  if (s.startsWith('ERR')) return 'ERROR'
  if (s.startsWith('WARN')) return 'WARN'
  if (s.startsWith('DEBUG')) return 'DEBUG'
  if (s.startsWith('TRACE') || s.startsWith('VERB')) return 'TRACE'
  return 'INFO'
}

function parseLog(text: string): Line[] {
  const out: Line[] = []
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue
    let l: Omit<Line, 'rep'>
    if (raw.trimStart().startsWith('{')) {
      try {
        const o = JSON.parse(raw)
        const ts = o.time ?? o.timestamp ?? o.ts ?? o['@timestamp'] ?? o.date
        const t = typeof ts === 'number' ? (ts < 1e12 ? ts * 1000 : ts) : ts ? Date.parse(ts) : NaN
        l = { t: Number.isNaN(t) ? undefined : t, time: Number.isNaN(t) ? '' : new Date(t).toLocaleTimeString('fr-BE'), lv: levelOf(o.level ?? o.severity ?? o.lvl), msg: String(o.msg ?? o.message ?? o.event ?? raw).slice(0, 400), detail: JSON.stringify(o, null, 2) }
      } catch {
        l = { time: '', lv: levelOf(''), msg: raw.slice(0, 400), detail: raw }
      }
    } else {
      const m = /^\s*\[?((?:\d{4}-\d{2}-\d{2}[T ])?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)\]?\s*/.exec(raw)
      const rest = m ? raw.slice(m[0].length) : raw
      const lv = /^\[?\s*(FATAL|CRITICAL|ERROR|ERR|WARN(?:ING)?|INFO|DEBUG|TRACE)\b\]?:?\s*/i.exec(rest)
      const t = m ? Date.parse(/\d{4}-/.test(m[1]) ? m[1].replace(' ', 'T').replace(',', '.') : `1970-01-01T${m[1].replace(',', '.')}`) : NaN
      l = { t: Number.isNaN(t) ? undefined : t, time: m ? m[1].replace(/^\d{4}-\d{2}-\d{2}[T ]/, '').slice(0, 8) : '', lv: lv ? levelOf(lv[1]) : /error|exception|fail/i.test(rest) ? 'ERROR' : 'INFO', msg: (lv ? rest.slice(lv[0].length) : rest).slice(0, 400), detail: raw }
    }
    const last = out[out.length - 1]
    if (last && last.lv === l.lv && last.msg === l.msg) last.rep++
    else out.push({ ...l, rep: 1 })
  }
  return out
}

function LogView({ m, d }: { m: MediaItem; d: Loaded }) {
  const sessionId = m.sessionId
  const readOnly = useStore((s) => !!s.sessions[sessionId]?.readOnly)
  const insertDraft = useStore((s) => s.insertDraft)
  const lines = useMemo(() => parseLog(d.text), [d.text])
  const counts = useMemo(() => {
    const c: Partial<Record<Level, number>> = {}
    for (const l of lines) c[l.lv] = (c[l.lv] ?? 0) + l.rep
    return c
  }, [lines])
  const present = LEVELS.filter((l) => counts[l])
  const [on, setOn] = useState<Partial<Record<Level, boolean>>>({ FATAL: true, ERROR: true, WARN: true, INFO: true })
  const [sel, setSel] = useState(-1)
  const [find, setFind] = useState('')
  const total = lines.reduce((a, l) => a + l.rep, 0)

  // Histogramme : 40 tranches de temps, part des erreurs en couleur.
  const hist = useMemo(() => {
    const ts = lines.filter((l) => l.t !== undefined)
    if (ts.length < 2) return null
    const t0 = ts[0].t!, t1 = ts[ts.length - 1].t!
    if (t1 <= t0) return null
    const n = 40
    const bins = Array.from({ length: n }, () => ({ all: 0, err: 0 }))
    for (const l of ts) {
      const b = bins[Math.min(n - 1, Math.floor(((l.t! - t0) / (t1 - t0)) * n))]
      b.all += l.rep
      if (l.lv === 'ERROR' || l.lv === 'FATAL') b.err += l.rep
    }
    const max = Math.max(...bins.map((b) => b.all))
    return { bins: bins.map((b) => ({ h: Math.max(2, Math.round((b.all / max) * 30)), err: b.err > b.all / 2 })), from: ts[0].time, to: ts[ts.length - 1].time }
  }, [lines])

  const f = find.trim().toLowerCase()
  const shown = lines.map((l, i) => ({ l, i })).filter(({ l }) => on[l.lv] && (!f || l.msg.toLowerCase().includes(f))).slice(-500)
  const errors = lines.filter((l) => l.lv === 'ERROR' || l.lv === 'FATAL')

  return (
    <div className="out-card">
      <div className="out-head" style={{ flexWrap: 'wrap' }}>
        <span className="out-badge">Journal</span>
        <span className="mono" style={{ fontSize: 13 }}>{m.name}</span>
        <span className="small muted">· {[`${total.toLocaleString('fr-BE')} lignes`, hist && `${hist.from} → ${hist.to}`, d.truncated && 'fin du fichier'].filter(Boolean).join(' · ')}</span>
        <span style={{ flex: 1 }} />
        <div className="out-levels" role="group" aria-label="Niveaux">
          {present.map((l) => (
            <button key={l} type="button" aria-pressed={!!on[l]} className={`lv ${l.toLowerCase()}`} onClick={() => setOn({ ...on, [l]: !on[l] })}>
              {l} {counts[l]!.toLocaleString('fr-BE')}
            </button>
          ))}
        </div>
      </div>
      {hist && (
        <>
          <div className="out-hist" aria-hidden="true">
            {hist.bins.map((b, i) => <span key={i} className={b.err ? 'err' : ''} style={{ height: b.h }} />)}
          </div>
          <div className="out-hist-axis mono"><span>{hist.from}</span><span>{hist.to}</span></div>
        </>
      )}
      <div className="out-logs">
        {shown.map(({ l, i }) => (
          <div key={i} className="out-log">
            <button type="button" aria-expanded={sel === i} onClick={() => setSel(sel === i ? -1 : i)}>
              <span className="mono out-log-t">{l.time}</span>
              <span className={`lv ${l.lv.toLowerCase()}`}>{l.lv}</span>
              <span className="out-log-msg">{l.msg}</span>
              {l.rep > 1 && <span className="small muted">×{l.rep}</span>}
            </button>
            {sel === i && <pre className="out-log-detail mono">{l.detail}</pre>}
          </div>
        ))}
        {!shown.length && <div className="out-more small muted">Aucune ligne pour ces niveaux.</div>}
      </div>
      <div className="out-foot">
        <label className="out-filter" style={{ flex: 1, maxWidth: 260 }}>
          <span className="sr-only">Chercher dans le journal</span>
          <input type="search" placeholder="chercher…" value={find} onChange={(e) => setFind(e.target.value)} />
        </label>
        <span className="small muted" style={{ flex: 1 }}>Lignes identiques regroupées{shown.length === 500 ? ' · 500 dernières affichées' : ''}</span>
        {!readOnly && errors.length > 0 && (
          <button type="button" className="btn sm primary" onClick={() => insertDraft(sessionId, `Erreurs de \`${m.path}\` :\n\`\`\`\n${errors.slice(-30).map((l) => `${l.time} ${l.lv} ${l.msg}${l.rep > 1 ? ` (×${l.rep})` : ''}`).join('\n')}\n\`\`\``)}>
            Joindre les erreurs
          </button>
        )}
        <button type="button" className="btn sm" onClick={() => api.openMedia(m.id)}>Ouvrir avec…</button>
      </div>
    </div>
  )
}
