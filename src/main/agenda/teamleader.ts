import { shell } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { FocusTask } from '../../shared/agenda'
import { vaultDelete, vaultGet, vaultStore } from '../vault'
import { waitForCode } from './google'

// Teamleader Focus : OAuth2 (redirection http://localhost:8723/callback, celle enregistrée pour l'application).
// Teamleader renouvelle le refresh_token à chaque usage : Canopy a SON accès, on ne touche jamais au .focus-token.json de l'outil timesheet.

const ID = 'FOCUS_CLIENT_ID'
const SECRET = 'FOCUS_CLIENT_SECRET'
const REFRESH = 'FOCUS_REFRESH_TOKEN'
const REDIRECT = 'http://localhost:8723/callback'
const v = (n: string) => vaultGet(n, '')

/** Identifiants de l'application : ceux du Coffre, sinon importés une fois du .focus-env de l'outil timesheet (autorisé). */
function creds() {
  if (!v(ID) || !v(SECRET)) {
    try {
      const f = join(homedir(), 'Documents', 'timesheet', '.focus-env')
      if (existsSync(f)) {
        const env: Record<string, string> = {}
        for (const l of readFileSync(f, 'utf8').split(/\r?\n/)) {
          const m = l.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*?)\s*$/)
          if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
        }
        if (env[ID] && env[SECRET]) {
          vaultStore(ID, env[ID], 'global', '')
          vaultStore(SECRET, env[SECRET], 'global', '')
          console.log('[agenda] identifiants Teamleader importés dans le Coffre')
        }
      }
    } catch {
      /* pas d'import possible */
    }
  }
  return { id: v(ID), secret: v(SECRET) }
}

export const teamleaderConfigured = () => !!creds().id && !!creds().secret
export const teamleaderConnected = () => !!v(REFRESH)
// Une seule actualisation du jeton à la fois (le refresh_token tourne à chaque usage) ; `gen` change à chaque (dé)connexion.
let inflight: Promise<string> | null = null
let gen = 0
export const teamleaderDisconnect = () => {
  gen++
  vaultDelete(REFRESH, 'global')
  token = null
  inflight = null
}

let token: { value: string; exp: number } | null = null
let account = ''
let meId = ''
export const teamleaderAccount = () => account

async function tokenCall(body: Record<string, string>) {
  const g0 = gen
  const c = creds()
  const r = await fetch('https://focus.teamleader.eu/oauth2/access_token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: c.id ?? '', client_secret: c.secret ?? '', ...body }) })
  const j = (await r.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string }
  if (j.error === 'invalid_grant' && body.grant_type === 'refresh_token') {
    // Accès révoqué ou expiré : on oublie le jeton, la source s'affiche déconnectée.
    if (g0 === gen) {
      vaultDelete(REFRESH, 'global')
      token = null
    }
    throw new Error('Connexion expirée : reconnecte-toi.')
  }
  if (!r.ok || !j.access_token) throw new Error(`Teamleader a refusé la connexion (${j.error ?? r.status}).`)
  // Une connexion plus récente a pris le relais : ce résultat ne doit rien écraser.
  if (g0 !== gen) throw new Error('Une autre connexion a pris le relais.')
  // Le refresh_token change à chaque appel : toujours garder le nouveau.
  if (j.refresh_token) vaultStore(REFRESH, j.refresh_token, 'global', '')
  token = { value: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 - 60_000 }
  return token.value
}

export async function teamleaderConnect() {
  const c = creds()
  if (!c.id || !c.secret) throw new Error('Identifiants Teamleader introuvables.')
  gen++
  inflight = null
  const state = randomBytes(16).toString('hex')
  const { code } = await waitForCode({ host: 'localhost', port: 8723, path: '/callback', state })
  void shell.openExternal(`https://focus.teamleader.eu/oauth2/authorize?${new URLSearchParams({ client_id: c.id, response_type: 'code', redirect_uri: REDIRECT, state })}`)
  await tokenCall({ grant_type: 'authorization_code', code: await code, redirect_uri: REDIRECT })
}

function accessToken(): Promise<string> {
  if (token && token.exp > Date.now()) return Promise.resolve(token.value)
  if (inflight) return inflight
  const rt = v(REFRESH)
  if (!rt) return Promise.reject(new Error('Teamleader n’est pas connecté.'))
  const p: Promise<string> = tokenCall({ grant_type: 'refresh_token', refresh_token: rt }).finally(() => {
    if (inflight === p) inflight = null
  })
  return (inflight = p)
}

async function call<T>(method: string, body: unknown = {}): Promise<T> {
  const r = await fetch(`https://api.focus.teamleader.eu/${method}`, { method: 'POST', headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`Teamleader a répondu ${r.status} (${method}).`)
  return (await r.json()) as T
}

type Ref = { id?: string; type?: string } | null | undefined
type Raw = { id: string; description?: string; title?: string; name?: string; due_on?: string | null; end_date?: string | null; completed?: boolean; status?: string; assignees?: { assignee?: Ref }[] | Ref[]; project?: Ref & { name?: string; title?: string }; milestone?: Ref }

const day = (s?: string | null) => (s ? s.slice(0, 10) : undefined)

function map(t: Raw): FocusTask {
  return { id: t.id, title: (t.description ?? t.title ?? t.name ?? '').trim() || '(Sans titre)', due: day(t.due_on ?? t.end_date), projectId: null, projectName: t.project?.name ?? t.project?.title, done: !!t.completed || t.status === 'done' }
}

/** Tâches ouvertes assignées à l'utilisateur (API non vérifiée : deux routes essayées). */
export async function teamleaderTasks(): Promise<FocusTask[]> {
  const me = await call<{ data?: { id?: string; email?: string } }>('users.me')
  meId = me.data?.id ?? ''
  account = me.data?.email ?? account
  try {
    const r = await call<{ data?: Raw[] }>('tasks.list', { filter: { user_id: meId, completed: false }, page: { size: 100 } })
    return (r.data ?? []).map(map).filter((t) => !t.done)
  } catch (e) {
    console.log('[agenda] tasks.list indisponible, essai projects-v2/tasks.list')
    const out: FocusTask[] = []
    for (let n = 1; n <= 10; n++) {
      const r = await call<{ data?: Raw[] }>('projects-v2/tasks.list', { page: { size: 100, number: n } }).catch((e2) => {
        if (n === 1) throw e2 instanceof Error ? e2 : e
        return { data: [] as Raw[] }
      })
      const d = r.data ?? []
      for (const t of d) {
        const mine = (t.assignees ?? []).some((a) => {
          const x = a as { id?: string; assignee?: Ref }
          return x?.id === meId || x?.assignee?.id === meId
        })
        const task = map(t)
        if (mine && !task.done) out.push(task)
      }
      if (d.length < 100) break
    }
    return out
  }
}
