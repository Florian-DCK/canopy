import { useEffect, useState } from 'react'
import type { Item, VaultEntry } from '../../../../shared/types'
import { Icon } from '../../icons'
import { api, useStore } from '../../store'

// Carte « Claude a besoin d'un secret » (planche 39). La valeur saisie part au processus principal (chiffrée, écrite
// dans .env.local) ; ni le fil ni Claude ne la voient jamais.

type SecretItem = Extract<Item, { kind: 'secret' }>

export function Lock({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  )
}

export function SecretCard({ item, sessionId }: { item: SecretItem; sessionId: string }) {
  const projectId = useStore((s) => s.sessions[sessionId]?.projectId)
  const project = useStore((s) => s.projects.find((p) => p.id === projectId))
  const [value, setValue] = useState('')
  const [show, setShow] = useState(false)
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [stored, setStored] = useState<VaultEntry | null>(null)
  useEffect(() => {
    if (item.state !== 'pending' || !projectId) return
    void api.vaultList(projectId).then((l) => setStored(l.find((e) => e.name === item.name) ?? null)).catch(() => {})
  }, [item.state, item.name, projectId])

  if (item.state !== 'pending')
    return (
      <div className={`sec-done ${item.state}`}>
        <Lock size={15} />
        <b>{item.name}</b>
        {item.state === 'given' ? <span>fourni{item.where ? <> · écrit dans <code>{item.where}</code></> : null}</span> : <span>non fourni</span>}
      </div>
    )

  const run = async (f: () => Promise<{ ok: boolean; error?: string } | void>) => {
    setBusy(true)
    setErr('')
    try {
      const r = await f()
      if (r && !r.ok) setErr(r.error ?? 'Ça n’a pas marché.')
    } catch (e) {
      setErr(String((e as Error)?.message ?? e))
    } finally {
      setBusy(false)
    }
  }
  const provide = () =>
    projectId && value && run(() => api.vaultProvide({ sessionId, itemId: item.id, projectId, name: item.name, value, remember: remember ? 'project' : null }))
  return (
    <div className="sec-card" role="group" aria-label={`Secret demandé : ${item.name}`}>
      <div className="sec-head">
        <Lock size={16} />
        <b>Claude a besoin d’un secret</b>
        <span style={{ flex: 1 }} />
        <span className="sec-muted">il ne verra jamais la valeur</span>
      </div>
      <div className="sec-body">
        <div className="sec-what">
          <code>{item.name}</code>
          <span>{item.purpose}</span>
        </div>
        <form
          className="sec-row"
          onSubmit={(e) => {
            e.preventDefault()
            void provide()
          }}
        >
          <label className="sr-only" htmlFor={`sec-${item.id}`}>Valeur de {item.name}</label>
          <div className="sec-field">
            <input id={`sec-${item.id}`} type={show ? 'text' : 'password'} autoComplete="off" spellCheck={false} value={value} placeholder="Colle la valeur ici" onChange={(e) => setValue(e.target.value)} />
            <button type="button" className="sec-show" onClick={() => setShow(!show)}>{show ? 'Masquer' : 'Afficher'}</button>
          </div>
          <button type="submit" className="btn clay sm" disabled={busy || !value}>Utiliser</button>
        </form>
        <div className="sec-opts">
          <label className="sec-check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Retenir pour {project?.name ?? 'ce projet'}
          </label>
          {stored && (
            <button type="button" className="sec-stored" disabled={busy} onClick={() => projectId && void run(() => api.vaultUseStored({ sessionId, itemId: item.id, projectId, name: item.name }))}>
              <Lock size={12} /> {item.name} est déjà dans le coffre{stored.scope === 'global' ? ' (global)' : ''} · l’utiliser
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button type="button" className="sec-later" disabled={busy} onClick={() => void run(() => api.vaultDecline(sessionId, item.id))}>
            <Icon name="close" size={12} />Ne pas fournir
          </button>
        </div>
        {err && <p className="sec-err">{err}</p>}
      </div>
    </div>
  )
}
