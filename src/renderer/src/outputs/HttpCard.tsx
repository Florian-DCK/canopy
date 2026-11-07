import { useState } from 'react'
import type { HttpCall, Item } from '../../../shared/types'
import { api } from '../store'
import './outputs.css'

// Requête HTTP lancée par l'agent (planche 48) : méthode, adresse, statut, puis corps formaté,
// en-têtes et requête envoyée. « Rejouer » seulement pour un GET vers la machine locale.

type Tool = Extract<Item, { kind: 'tool' }>
type Tab = 'body' | 'headers' | 'req'

const pretty = (s: string) => {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}
const tone = (st?: number) => (!st ? '' : st < 300 ? 'ok' : st < 400 ? 'redir' : 'bad')
const isLocal = (u: string) => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/.test(u)

export function HttpCard({ t }: { t: Tool }) {
  const [call, setCall] = useState<HttpCall & { ms?: number }>(t.http!)
  const [tab, setTab] = useState<Tab>('body')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const replay = async () => {
    setBusy(true)
    setErr('')
    const r = await api.httpReplay(call.url)
    setBusy(false)
    if (r.error) return setErr(r.error)
    setCall({ ...call, status: r.status, statusText: r.statusText, headers: r.headers, body: r.body, ms: r.ms })
  }
  const kb = new Blob([call.body]).size
  const text =
    tab === 'body'
      ? pretty(call.body) || '(corps vide)'
      : tab === 'headers'
        ? (call.headers ?? []).map(([k, v]) => `${k}: ${v}`).join('\n') || 'En-têtes non affichés par la commande (curl -i ou -v pour les voir).'
        : [`${call.method} ${call.url}`, ...(call.reqHeaders ?? []).map(([k, v]) => `${k}: ${v}`), ...(call.reqBody ? ['', pretty(call.reqBody)] : [])].join('\n')
  const json = /json/i.test(call.headers?.find(([k]) => /content-type/i.test(k))?.[1] ?? '') || /^\s*[{[]/.test(call.body)
  return (
    <div className="out-card">
      <div className="out-head">
        <span className="out-method mono">{call.method}</span>
        <span className="mono out-url" title={call.url}>{call.url}</span>
        <span className={`out-status ${tone(call.status)}`}>{call.status ? `${call.status}${call.statusText ? ` ${call.statusText}` : ''}` : 'statut ?'}</span>
        <span className="small muted">{[call.ms !== undefined && `${call.ms} ms`, kb < 1024 ? `${kb} o` : `${(kb / 1024).toLocaleString('fr-BE', { maximumFractionDigits: 1 })} Ko`].filter(Boolean).join(' · ')}</span>
      </div>
      <div className="out-tabs" role="tablist" aria-label="Partie de la réponse">
        {([['body', 'Corps'], ['headers', 'En-têtes'], ['req', 'Requête']] as [Tab, string][]).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      <pre className="out-raw mono" style={{ borderTop: 'none', maxHeight: 260 }}>{text}</pre>
      <div className="out-foot">
        <span className={`small ${err ? 'out-bad' : 'muted'}`} style={{ flex: 1 }}>
          {err || [json && tab === 'body' ? 'JSON formaté' : '', !call.status ? 'curl -i pour voir le statut et les en-têtes' : ''].filter(Boolean).join(' · ')}
        </span>
        <button type="button" className="btn sm" onClick={() => navigator.clipboard.writeText(call.body)}>Copier le corps</button>
        {call.method === 'GET' && isLocal(call.url) && (
          <button type="button" className="btn sm primary" disabled={busy} onClick={replay}>{busy ? 'En cours…' : 'Rejouer'}</button>
        )}
      </div>
    </div>
  )
}
